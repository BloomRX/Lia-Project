import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

assert.equal(process.platform, 'win32')
assert.equal(process.argv.length, 4, 'Informe o certificado e a chave TLS sintéticos.')
const cert = resolve(process.argv[2])
const key = resolve(process.argv[3])
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-speech-'))
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const modelId = 'fixture-speech'
const voiceId = 'fixture-voice'
const token = `fixture-${randomUUID()}`
const reply = 'Resposta de teste para síntese.'
const wave = Buffer.alloc(32_044)
Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d0000020010006461746102000000', 'hex').copy(wave)
wave.writeUInt32LE(wave.length - 8, 4)
wave.writeUInt32LE(wave.length - 44, 40)
const requests = []
const server = createServer({ cert: await readFile(cert), key: await readFile(key) }, async (request, response) => {
  if (request.url === '/v1/chat/completions') {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
    return
  }
  const chunks = []
  for await (const chunk of request)
    chunks.push(chunk)
  const authorized = request.headers.authorization === `Bearer ${token}`
  requests.push({ authorized, path: request.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
  response.writeHead(authorized ? 200 : 401, { 'content-type': 'audio/wav' })
  response.end(wave)
})
server.listen(0, '127.0.0.1')

let app
try {
  await once(server, 'listening')
  const destination = new URL(`https://127.0.0.1:${server.address().port}/v1`)
  console.log(`Evidências em ${root}`)
  const record = (id, protocol, models, adapterOptions) => ({
    id, providerId: id, definitionId: id, type: 'http', protocol, baseUrl: destination.href, enabled: true,
    modelIds: models, adapterOptions, metadata: {}, credentialRef: { scope: id, key: 'apiKey' },
  })
  await writeFile(join(root, 'lia-product.json'), JSON.stringify({
    setup: { completed: true },
    provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'fixture-chat' } } },
  }))
  await writeFile(join(root, 'lia-transports.json'), JSON.stringify({
    schemaVersion: 1, revision: 1, tombstones: [], migration: { version: 1, imported: [] },
    records: [record('local-chat', 'chat-completions', ['fixture-chat'], { localOnly: true, allowUnauthenticated: true })],
  }))
  const launcherProfile = join(root, 'appdata')
  await mkdir(launcherProfile)
  const executablePath = join(stage, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env, APPDATA: launcherProfile, NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1', LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') }
  app = await _electron.launch({ executablePath, args: [fileURLToPath(new URL('../out/main/index.js', import.meta.url))], env })
  const launcher = await app.firstWindow()
  launcher.setDefaultTimeout(10_000)
  await launcher.getByRole('button', { name: 'Voz', exact: true }).click()
  await launcher.getByText('Síntese compatível com OpenAI', { exact: true }).click()
  await launcher.getByLabel('Endereço da API', { exact: true }).fill(destination.href)
  await launcher.getByLabel('Modelo', { exact: true }).fill(modelId)
  await launcher.getByRole('textbox', { name: 'Voz', exact: true }).fill(voiceId)
  await launcher.getByLabel('Chave da API', { exact: true }).fill(token)
  await launcher.getByRole('button', { name: 'Salvar e usar' }).click()
  await launcher.getByText('Síntese compatível selecionada.', { exact: true }).waitFor()
  assert.equal(await launcher.getByLabel('Chave da API', { exact: true }).inputValue(), '')
  assert.ok(!(await readFile(join(root, 'lia-secrets.json'), 'utf8')).includes(token))
  await launcher.getByText('Síntese compatível selecionada.', { exact: true }).scrollIntoViewIfNeeded()
  await launcher.screenshot({ path: join(root, 'speech-settings.png'), fullPage: true })
  await app.close()
  app = undefined
  app = await _electron.launch({
    executablePath,
    args: ['--mute-audio', join(stage, 'out', 'main', 'index.js')],
    env,
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  await page.getByLabel('Mensagem', { exact: true }).fill('Mensagem sintética.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  try {
    await page.getByText(`Lia: ${reply}`, { exact: true }).waitFor()
  }
  catch (error) {
    await page.screenshot({ path: join(root, 'speech-chat-failure.png'), fullPage: true })
    throw error
  }
  const speak = page.getByRole('button', { name: 'Ouvir resposta' })
  const setApproval = response => app.evaluate(({ dialog }, choice) => {
    dialog.showMessageBox = async (_owner, options) => {
      if (options.defaultId !== 0 || options.cancelId !== 0 || options.buttons.length !== 2 || !options.signal)
        throw new Error('Unexpected speech consent contract')
      return { response: choice }
    }
  }, response)
  await setApproval(0)
  await speak.click()
  await page.getByText('Áudio interrompido.', { exact: true }).waitFor()
  assert.equal(requests.length, 0)
  await setApproval(1)
  await speak.click()
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 0)
  assert.deepEqual(requests, [{ path: '/v1/audio/speech', authorized: true, body: { model: modelId, voice: voiceId, input: reply, response_format: 'wav' } }])
  assert.equal(await page.getByText(token).count(), 0)
  await page.getByRole('button', { name: 'Parar áudio' }).click()
  assert.equal(await page.locator('audio').isVisible(), false)
  await page.locator('audio').evaluate((element) => {
    element.play = () => Promise.reject(new DOMException('Fixture playback refused', 'NotAllowedError'))
  })
  await speak.click()
  await page.getByText('Não foi possível reproduzir o áudio. Tente novamente.', { exact: true }).waitFor()
  assert.equal(await page.locator('audio').isVisible(), false)
  assert.equal(await page.locator('audio').getAttribute('src'), null)
  await page.locator('audio').evaluate((element) => { delete element.play })
  await speak.click()
  await page.waitForFunction(() => document.querySelector('audio').currentTime > 0)
  await page.getByRole('button', { name: 'Parar áudio' }).click()
  const report = { service: 'synthetic HTTPS loopback', configuredByLauncher: true, consent: 'injected response', deniedWithoutRequest: true, authorizedSpeech: true, mutedPlayback: true, playbackStopped: true }
  report.playbackFailureRecovered = true
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
finally {
  try {
    await app?.close()
  }
  finally {
    server.closeAllConnections()
    await new Promise(resolveClose => server.close(resolveClose))
  }
}
