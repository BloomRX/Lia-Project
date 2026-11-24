import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

assert.equal(process.platform, 'win32')
const nativeDialog = process.argv[4] === '--native-dialog'
const local = process.argv.length === 3 && process.argv[2] === '--local'
assert.equal(process.argv.length, local ? 3 : nativeDialog ? 5 : 4, 'Use --local ou informe o certificado e a chave TLS sintéticos do ensaio.')
const cert = local ? undefined : resolve(process.argv[2])
const key = local ? undefined : resolve(process.argv[3])
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-stt-'))
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const token = `fixture-${randomUUID()}`
const modelId = 'fixture-model'
const transcript = 'Transcrição sintética.'
const audio = Buffer.alloc(46)
audio.write('RIFF', 0)
audio.writeUInt32LE(38, 4)
audio.write('WAVEfmt ', 8)
audio.writeUInt32LE(16, 16)
audio.writeUInt16LE(1, 20)
audio.writeUInt16LE(1, 22)
audio.writeUInt32LE(16000, 24)
audio.writeUInt32LE(32000, 28)
audio.writeUInt16LE(2, 32)
audio.writeUInt16LE(16, 34)
audio.write('data', 36)
audio.writeUInt32LE(2, 40)

const requests = []
const server = local ? createHttpServer() : createHttpsServer({ cert: await readFile(cert), key: await readFile(key) })
server.on('request', async (request, response) => {
  const chunks = []
  for await (const chunk of request)
    chunks.push(chunk)
  const authorized = local ? request.headers.authorization === undefined : request.headers.authorization === `Bearer ${token}`
  const data = Buffer.concat(chunks)
  requests.push({ authorized, audioMatches: data.includes(audio), webm: data.includes(Buffer.from([0x1A, 0x45, 0xDF, 0xA3])), path: request.url })
  response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ text: transcript, ignored: token }))
})
server.listen(0, local ? '127.0.0.1' : '127.0.0.2')

let app
try {
  await once(server, 'listening')
  // O endereço alternativo mantém o tráfego no loopback do Windows
  // e exercita o consentimento dos adaptadores remotos do produto.
  const destination = new URL(`${local ? 'http://127.0.0.1' : 'https://127.0.0.2'}:${server.address().port}/v1`)
  console.log(`Evidências em ${root}`)
  const launcherProfile = join(root, 'appdata')
  await mkdir(launcherProfile)
  const executablePath = join(stage, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env, APPDATA: launcherProfile, ...(cert ? { NODE_EXTRA_CA_CERTS: cert } : {}), NODE_TLS_REJECT_UNAUTHORIZED: '1', LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') }
  app = await _electron.launch({ executablePath, args: [fileURLToPath(new URL('../out/main/index.js', import.meta.url))], env })
  const launcher = await app.firstWindow()
  launcher.setDefaultTimeout(10_000)
  await launcher.getByRole('button', { name: 'Voz', exact: true }).click()
  await launcher.getByText('Reconhecimento de fala compatível com OpenAI', { exact: true }).click()
  if (local) {
    await launcher.getByLabel('Onde transcrever').selectOption({ label: 'Servidor neste computador' })
    await launcher.getByLabel('Chave de transcrição').waitFor({ state: 'hidden' })
  }
  await launcher.getByLabel('Endereço da API de transcrição').fill(destination.href)
  await launcher.getByLabel('Modelo de transcrição').fill(modelId)
  if (!local)
    await launcher.getByLabel('Chave de transcrição').fill(token)
  await launcher.getByRole('button', { name: 'Salvar reconhecimento' }).click()
  const saved = launcher.getByText('Reconhecimento de fala selecionado.', { exact: true })
  await saved.waitFor()
  if (local) {
    await assert.rejects(readFile(join(root, 'lia-secrets.json')), { code: 'ENOENT' })
  }
  else {
    assert.equal(await launcher.getByLabel('Chave de transcrição').inputValue(), '')
    assert.ok(!(await readFile(join(root, 'lia-secrets.json'), 'utf8')).includes(token))
  }
  await saved.scrollIntoViewIfNeeded()
  await launcher.screenshot({ path: join(root, 'transcription-settings.png'), fullPage: true })
  await app.close()
  app = undefined
  app = await _electron.launch({
    executablePath,
    args: [...(nativeDialog ? [] : ['--use-fake-device-for-media-stream']), join(stage, 'out', 'main', 'index.js')],
    env,
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  const send = async (response) => {
    if (local) {
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => { throw new Error('Unexpected remote consent for local transcription') }
      })
    }
    else if (nativeDialog) {
      console.log(response === 0 ? 'Escolha Cancelar no diálogo do Stage.' : 'Escolha Enviar gravação no diálogo do Stage.')
    }
    else {
      await app.evaluate(({ dialog }, choice) => {
        dialog.showMessageBox = async (_owner, options) => {
          if (options.defaultId !== 0 || options.cancelId !== 0 || options.buttons.length !== 2)
            throw new Error('Unexpected confirmation contract')
          return { response: choice }
        }
      }, response)
    }
    return page.evaluate(bytes => window.liaStageChat.transcribe(Uint8Array.from(bytes), 'audio/wav'), [...audio])
  }
  if (!local) {
    assert.deepEqual(await send(0), { ok: false, code: 'cancelled' })
    assert.deepEqual(requests, [])
  }
  assert.deepEqual(await send(1), { ok: true, text: transcript })
  assert.deepEqual(requests, [{ authorized: true, audioMatches: true, webm: false, path: '/v1/audio/transcriptions' }])
  let chromiumRecording = null
  if (!nativeDialog) {
    await page.evaluate(() => {
      const acquire = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      const enumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
      window.captureFixture = { tracks: [], constraints: [] }
      // Chromium's virtual microphone only reports the default alias in this
      // profile. Inject a second inventory entry to exercise exact selection.
      navigator.mediaDevices.enumerateDevices = async () => [
        ...await enumerate(),
        { kind: 'audioinput', deviceId: 'lia-fixture-secondary', label: 'Microfone de teste' },
      ]
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        window.captureFixture.constraints.push(constraints)
        const stream = await acquire(constraints.audio?.deviceId?.exact === 'lia-fixture-secondary'
          ? { audio: true }
          : constraints)
        window.captureFixture.tracks.push(...stream.getTracks())
        return stream
      }
    })
    const picker = page.getByLabel('Microfone', { exact: true })
    const record = page.getByRole('button', { name: 'Gravar mensagem', exact: true })
    await record.click()
    await page.getByText('Gravando…', { exact: true }).waitFor()
    await picker.locator('option[value="lia-fixture-secondary"]').waitFor({ state: 'attached' })
    await page.getByRole('button', { name: 'Cancelar gravação' }).click()
    await page.getByText('Gravação cancelada.', { exact: true }).waitFor()
    assert.equal(requests.length, 1)
    await picker.selectOption('lia-fixture-secondary')
    const deviceId = await picker.inputValue()
    assert.ok(deviceId)
    await record.click()
    await page.getByText('Gravando…', { exact: true }).waitFor()
    await page.waitForFunction(() => window.captureFixture.tracks.some(track => track.readyState === 'live'))
    await new Promise(resolve => setTimeout(resolve, 600))
    await page.getByRole('button', { name: 'Parar e transcrever' }).click()
    await page.getByText('Transcrição inserida. Revise antes de enviar.', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Mensagem', { exact: true }).inputValue(), transcript)
    assert.equal(await page.evaluate(id => window.captureFixture.constraints.at(-1).audio.deviceId.exact === id, deviceId), true)
    assert.equal(await page.evaluate(() => window.captureFixture.tracks.every(track => track.readyState === 'ended')), true)
    assert.deepEqual(requests[1], { authorized: true, audioMatches: false, webm: true, path: '/v1/audio/transcriptions' })
    await page.screenshot({ path: join(root, 'microphone.png'), fullPage: true })
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture microphone absent', 'NotFoundError') }
    })
    await record.click()
    await page.getByText('O microfone solicitado não está disponível.', { exact: true }).waitFor()
    assert.equal(requests.length, 2)
    chromiumRecording = { deviceInventory: 'synthetic additional input', selectedDeviceConstraint: true, capturedWebm: true, audioTracksReleased: true, cancellationPreventedUpload: true, draftInserted: true, missingMicrophoneError: 'injected NotFoundError' }
  }
  const report = { configuredByLauncher: true, dialogResponse: local ? null : nativeDialog ? 'interactive' : 'injected in test', denialPreventedUpload: local ? null : true, approvalAllowedUpload: local ? null : true, service: local ? 'synthetic HTTP loopback without credentials' : 'synthetic HTTPS loopback', syntheticAudio: true, chromiumRecording }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
finally {
  try {
    await app?.close()
  }
  finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
