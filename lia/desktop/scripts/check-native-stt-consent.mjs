import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createWindowsUserCipher } from '@lia/core/secrets/windows-user-cipher'
import { _electron } from 'playwright'

import { bindCredential } from '../../core/src/credentials/destination.ts'

assert.equal(process.platform, 'win32')
const nativeDialog = process.argv[4] === '--native-dialog'
assert.equal(process.argv.length, nativeDialog ? 5 : 4, 'Informe o certificado e a chave TLS sintéticos do ensaio.')
const cert = resolve(process.argv[2])
const key = resolve(process.argv[3])
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-stt-'))
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const token = `fixture-${randomUUID()}`
const providerId = 'fixture-transcription'
const modelId = 'fixture-model'
const definitionId = 'openai-compatible-audio-transcription'
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
const server = createServer({ cert: await readFile(cert), key: await readFile(key) }, async (request, response) => {
  const chunks = []
  for await (const chunk of request)
    chunks.push(chunk)
  const authorized = request.headers.authorization === `Bearer ${token}`
  const data = Buffer.concat(chunks)
  requests.push({ authorized, audioMatches: data.includes(audio), webm: data.includes(Buffer.from([0x1A, 0x45, 0xDF, 0xA3])), path: request.url })
  response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ text: transcript, ignored: token }))
})
server.listen(0, '127.0.0.2')

let app
try {
  await once(server, 'listening')
  // O endereço alternativo mantém o tráfego no loopback do Windows
  // e exercita o consentimento dos adaptadores remotos do produto.
  const destination = new URL(`https://127.0.0.2:${server.address().port}/v1`)
  console.log(`Evidências em ${root}`)
  const unexpected = () => { throw new Error('Backend de credenciais legado inesperado') }
  const vault = createLiaSecretVault({
    filePath: join(root, 'lia-secrets.json'),
    cipher: createWindowsUserCipher({ available: () => false, encrypt: unexpected, decrypt: unexpected }),
  })
  assert.ok(await vault.setSecret(providerId, 'apiKey', bindCredential(providerId, destination, token, 'transcription')))
  await Promise.all([
    writeFile(join(root, 'lia-product.json'), JSON.stringify({ voice: { stt: { preferred: { providerId, modelId } } } })),
    writeFile(join(root, 'lia-transports.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      records: [{
        id: providerId, providerId, definitionId, type: 'http', protocol: 'audio-transcription',
        baseUrl: destination.href, modelIds: [modelId], adapterOptions: {}, enabled: true,
        metadata: {}, credentialRef: { scope: providerId, key: 'apiKey' },
      }],
      tombstones: [],
      migration: { version: 1, imported: [] },
    })),
  ])
  app = await _electron.launch({
    executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [...(nativeDialog ? [] : ['--use-fake-device-for-media-stream']), join(stage, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1', LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  const send = async (response) => {
    if (nativeDialog) {
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
  assert.deepEqual(await send(0), { ok: false, code: 'cancelled' })
  assert.deepEqual(requests, [])
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
  const report = { dialogResponse: nativeDialog ? 'interactive' : 'injected in test', denialPreventedUpload: true, approvalAllowedUpload: true, service: 'synthetic HTTPS loopback', syntheticAudio: true, chromiumRecording }
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
