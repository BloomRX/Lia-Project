import assert from 'node:assert/strict'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

import { isAllTalkVoiceFile } from '../../core/src/providers/alltalk-speech.ts'

assert.equal(process.platform, 'win32')
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-alltalk-'))
const appdata = join(root, 'appdata')
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const liveVoice = process.argv.slice(2)
assert.ok(liveVoice.length === 0 || (liveVoice.length === 2 && liveVoice[0] === '--live'
  && isAllTalkVoiceFile(liveVoice[1])),
'Use --live seguido do nome de um WAV autorizado na biblioteca do AllTalk.')
const live = liveVoice.length > 0
const voiceId = live ? liveVoice[1] : 'voz-sintetica.wav'
const reply = 'Resposta de teste para voz personalizada.'
const wave = Buffer.alloc(32_044)
Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d0000020010006461746102000000', 'hex').copy(wave)
wave.writeUInt32LE(wave.length - 8, 4)
wave.writeUInt32LE(wave.length - 44, 40)
const requests = []
let holdPreview

const server = createServer(async (request, response) => {
  const path = request.url
  if (path === '/v1/chat/completions') {
    request.resume()
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
  }
  else if (!live && path === '/api/voices') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ voices: [voiceId, '../private.wav'] }))
  }
  else if (!live && path === '/api/tts-generate') {
    const chunks = []
    for await (const chunk of request)
      chunks.push(chunk)
    requests.push({ path, method: request.method, form: Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) })
    if (holdPreview) {
      const pending = holdPreview
      holdPreview = undefined
      response.once('close', () => pending.closed.resolve(!response.writableEnded))
      pending.started.resolve()
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'generate-success', output_file_url: '/audio/fixture.wav' }))
  }
  else if (!live && path === '/audio/fixture.wav') {
    requests.push({ path, method: request.method })
    response.writeHead(200, { 'Content-Type': 'audio/wav' })
    response.end(wave)
  }
  else {
    response.writeHead(404).end()
  }
})

async function closeFixture() {
  if (!server.listening)
    return
  server.closeAllConnections()
  await new Promise(resolveClose => server.close(resolveClose))
}

let app
try {
  server.listen(live ? 0 : 7851, '127.0.0.1')
  await once(server, 'listening')
  console.log(`Evidências em ${root}`)
  await mkdir(appdata)
  await writeFile(join(root, 'lia-product.json'), JSON.stringify({
    setup: { completed: true },
    preferences: { language: 'pt-BR' },
    provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'fixture-chat' } } },
  }))
  await writeFile(join(root, 'lia-transports.json'), JSON.stringify({
    schemaVersion: 1, revision: 1, tombstones: [], migration: { version: 1, imported: [] },
    records: [{
      id: 'local-chat', providerId: 'local-chat', definitionId: 'local-chat', type: 'http', protocol: 'chat-completions',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, enabled: true, modelIds: ['fixture-chat'], metadata: {},
      adapterOptions: { localOnly: true, allowUnauthenticated: true }, credentialRef: { scope: 'local-chat', key: 'apiKey' },
    }],
  }))
  const executablePath = join(stage, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env, APPDATA: appdata, LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') }
  app = await _electron.launch({ executablePath, args: ['--mute-audio', fileURLToPath(new URL('../out/main/index.js', import.meta.url))], env })
  const launcher = await app.firstWindow()
  launcher.setDefaultTimeout(10_000)
  await launcher.getByRole('button', { name: 'Voz', exact: true }).click()
  const panel = launcher.getByText('Voz personalizada em servidor local', { exact: true })
  await panel.click()
  if (!live) {
    await launcher.getByRole('button', { name: 'Consultar vozes disponíveis' }).click()
    await launcher.getByText('Biblioteca local disponível.', { exact: true }).waitFor()
    assert.deepEqual(await launcher.locator('#custom-voice-catalog option').evaluateAll(options => options.map(option => option.value)), [voiceId])
  }
  assert.equal(await launcher.evaluate(() => window.liaApi.useCustomSpeech('../outside.wav')), false)
  await launcher.getByLabel('Nome do arquivo WAV', { exact: true }).fill(voiceId)
  await launcher.getByRole('button', { name: 'Selecionar voz personalizada' }).click()
  await launcher.getByText('Voz personalizada selecionada.', { exact: true }).waitFor()
  if (!live) {
    const pending = { started: Promise.withResolvers(), closed: Promise.withResolvers() }
    holdPreview = pending
    const deadline = new AbortController()
    const timeout = delay(10_000, false, { signal: deadline.signal }).catch(() => false)
    try {
      await launcher.getByRole('button', { name: 'Ouvir prévia', exact: true }).click()
      assert.equal(await Promise.race([pending.started.promise.then(() => true), timeout]), true)
      await launcher.getByRole('button', { name: 'Parar prévia', exact: true }).click()
      assert.equal(await Promise.race([pending.closed.promise, timeout]), true)
      await launcher.getByText('Prévia interrompida.', { exact: true }).waitFor()
      assert.equal(await launcher.locator('#custom-preview-audio').getAttribute('src'), null)
      assert.deepEqual(requests.map(request => request.path), ['/api/tts-generate'])
      requests.length = 0
    }
    finally {
      deadline.abort()
    }
  }
  await launcher.getByRole('button', { name: 'Ouvir prévia', exact: true }).click()
  await launcher.waitForFunction(() => document.querySelector('#custom-preview-audio').currentTime > 0, undefined, { timeout: live ? 65_000 : 10_000 })
  await launcher.getByRole('button', { name: 'Parar prévia', exact: true }).click()
  assert.equal(await launcher.locator('#custom-preview-audio').getAttribute('src'), null)
  if (!live) {
    assert.equal(requests[0].form.text_input, 'Olá. Esta é uma prévia da minha voz.')
    assert.equal(requests[0].form.character_voice_gen, voiceId)
    requests.length = 0
  }
  const config = JSON.parse(await readFile(join(root, 'lia-product.json'), 'utf8'))
  assert.deepEqual(config.voice.tts.preferred, { providerId: 'alltalk-local-speech', voiceId })
  if (!live)
    await panel.locator('..').screenshot({ path: join(root, 'selection.png') })
  await app.close()
  app = undefined

  app = await _electron.launch({ executablePath, args: ['--mute-audio', join(stage, 'out', 'main', 'index.js')], env })
  const chat = await app.firstWindow()
  chat.setDefaultTimeout(10_000)
  await chat.getByLabel('Mensagem', { exact: true }).fill('Mensagem de teste.')
  await chat.getByRole('button', { name: 'Enviar', exact: true }).click()
  await chat.getByText(`Lia: ${reply}`, { exact: true }).waitFor()
  const speak = chat.getByRole('button', { name: 'Ouvir resposta', exact: true })
  await speak.click()
  await chat.waitForFunction(() => document.querySelector('audio').currentTime > 0, undefined, { timeout: live ? 65_000 : 10_000 })
  await chat.getByRole('button', { name: 'Parar áudio' }).click()
  if (!live) {
    assert.deepEqual(requests.map(({ path, method }) => ({ path, method })), [
      { path: '/api/tts-generate', method: 'POST' }, { path: '/audio/fixture.wav', method: 'GET' },
    ])
    assert.equal(requests[0].form.text_input, reply)
    assert.equal(requests[0].form.character_voice_gen, voiceId)
    assert.equal(requests[0].form.language, 'pt')
    assert.equal(requests[0].form.autoplay, 'false')
    await closeFixture()
    await speak.click()
    await chat.getByText('A voz selecionada está indisponível.', { exact: true }).waitFor()
    assert.equal(await chat.locator('audio').getAttribute('src'), null)
  }
  const report = {
    configuredByLauncher: true,
    checkedCatalog: live ? null : true,
    persistedSelectionUsedByStage: true,
    service: live ? 'operator-managed local AllTalk V2 HTTP' : 'synthetic local AllTalk V2 HTTP',
    mutedPlayback: true,
    mutedLauncherPreview: true,
    pendingLauncherPreviewCancelled: live ? null : true,
    offlineWithoutFallback: live ? null : true,
  }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
finally {
  try {
    await app?.close()
  }
  finally {
    await closeFixture()
  }
}
