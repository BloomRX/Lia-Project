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
assert.equal(process.argv.length, 4, 'Informe o certificado e a chave TLS sintéticos.')
const cert = resolve(process.argv[2])
const key = resolve(process.argv[3])
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-speech-'))
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const providerId = 'openai-compatible-audio-speech'
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
  const unexpected = () => { throw new Error('Unexpected legacy cipher') }
  const vault = createLiaSecretVault({
    filePath: join(root, 'lia-secrets.json'),
    cipher: createWindowsUserCipher({ available: () => false, encrypt: unexpected, decrypt: unexpected }),
  })
  assert.ok(await vault.setSecret(providerId, 'apiKey', bindCredential(providerId, destination, token, 'speech')))
  const record = (id, protocol, models, adapterOptions) => ({
    id, providerId: id, definitionId: id, type: 'http', protocol, baseUrl: destination.href, enabled: true,
    modelIds: models, adapterOptions, metadata: {}, credentialRef: { scope: id, key: 'apiKey' },
  })
  await writeFile(join(root, 'lia-product.json'), JSON.stringify({
    provider: { chat: { preferred: { providerId: 'local-chat', modelId: 'fixture-chat' } } },
    voice: { tts: { preferred: { providerId, modelId, voiceId } } },
  }))
  await writeFile(join(root, 'lia-transports.json'), JSON.stringify({
    schemaVersion: 1, revision: 1, tombstones: [], migration: { version: 1, imported: [] },
    records: [record('local-chat', 'chat-completions', ['fixture-chat'], { localOnly: true, allowUnauthenticated: true }),
      record(providerId, 'audio-speech', [modelId], {})],
  }))
  app = await _electron.launch({
    executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['--mute-audio', join(stage, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, NODE_TLS_REJECT_UNAUTHORIZED: '1', LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  await page.getByLabel('Mensagem', { exact: true }).fill('Mensagem sintética.')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await page.getByText(`Lia: ${reply}`, { exact: true }).waitFor()
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
  const report = { service: 'synthetic HTTPS loopback', consent: 'injected response', deniedWithoutRequest: true, authorizedSpeech: true, mutedPlayback: true, playbackStopped: true }
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
