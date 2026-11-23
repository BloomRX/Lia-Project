import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createProductionBrainCatalog } from '@lia/core'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createWindowsUserCipher } from '@lia/core/secrets/windows-user-cipher'
import { _electron } from 'playwright'

import { bindCredential } from '../../core/src/credentials/destination.ts'

assert.equal(process.platform, 'win32')
assert.equal(process.argv.length, 4, 'Informe o certificado e a chave TLS sintéticos do ensaio.')
const certificate = resolve(process.argv[2])
const privateKey = resolve(process.argv[3])
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-vision-'))
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const token = `fixture-${randomUUID()}`
const providerId = 'groq'
const models = createProductionBrainCatalog().models.filter(model => model.engineId === providerId)
const textModel = models.find(model => !model.capabilities.imageInput)?.id
const visionModel = models.find(model => model.capabilities.imageInput)?.id
assert.ok(textModel && visionModel)
console.log(`Evidências em ${root}`)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD2sAAAAASUVORK5CYII=', 'base64')
const seen = []
const server = createServer({
  cert: await readFile(certificate),
  key: await readFile(privateKey),
}, async (request, response) => {
  const chunks = []
  for await (const chunk of request)
    chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const content = body.messages.at(-1).content
  const authorized = request.headers.authorization === `Bearer ${token}`
  const imageMatches = Array.isArray(content) && content.some(part =>
    part.type === 'image_url' && part.image_url?.url === `data:image/png;base64,${png.toString('base64')}`)
  seen.push({ authorized, model: body.model, imageMatches, path: request.url })
  response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { content: imageMatches ? 'Imagem recebida.' : 'Texto recebido.' } }] }))
})
server.listen(0, '127.0.0.1')
let app
try {
  await once(server, 'listening')
  const destination = new URL(`https://127.0.0.1:${server.address().port}/v1`)
  const unexpected = () => { throw new Error('Backend de credenciais legado inesperado') }
  const vaultPath = join(root, 'lia-secrets.json')
  const vault = createLiaSecretVault({
    filePath: vaultPath,
    cipher: createWindowsUserCipher({ available: () => false, decrypt: unexpected, encrypt: unexpected }),
  })
  assert.ok(await vault.setSecret(providerId, 'apiKey', bindCredential(providerId, destination, token, 'chat')))
  assert.ok(!(await readFile(vaultPath, 'utf8')).includes(token))
  await Promise.all([
    writeFile(join(root, 'lia-product.json'), JSON.stringify({
      brain: { mode: 'automatic' },
      provider: { chat: { preferred: { providerId, modelId: textModel } } },
    })),
    writeFile(join(root, 'lia-transports.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      records: [{
        id: providerId,
        providerId,
        definitionId: providerId,
        type: 'http',
        protocol: 'chat-completions',
        baseUrl: destination.href,
        modelIds: [textModel],
        adapterOptions: {},
        enabled: true,
        metadata: {},
        credentialRef: { scope: providerId, key: 'apiKey' },
      }],
      tombstones: [],
      migration: { version: 1, imported: [] },
    })),
  ])
  app = await _electron.launch({
    executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [join(stage, 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      NODE_EXTRA_CA_CERTS: certificate,
      NODE_TLS_REJECT_UNAUTHORIZED: '1',
      LIA_USER_DATA: root,
      LIA_STAGE_PROFILE_DIR: join(root, 'profile'),
    },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Anexar imagem', exact: true }).click(),
  ])
  await chooser.setFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png })
  const field = page.getByLabel('Mensagem', { exact: true })
  const submit = page.getByRole('button', { name: 'Enviar', exact: true })
  await field.fill('Imagem de teste')
  await submit.click()
  await page.getByText('Lia: Imagem recebida.', { exact: true }).waitFor()
  await field.fill('Apenas texto')
  await submit.click()
  await page.getByText('Lia: Texto recebido.', { exact: true }).waitFor()
  assert.deepEqual(seen, [
    { authorized: true, model: visionModel, imageMatches: true, path: '/v1/chat/completions' },
    { authorized: true, model: textModel, imageMatches: false, path: '/v1/chat/completions' },
  ])
  assert.ok(!(await page.locator('body').textContent()).includes(token))
  await page.screenshot({ path: join(root, 'stage.png'), fullPage: true })
  const report = { provider: 'synthetic HTTPS loopback', syntheticCredential: true, encryptedVault: true, visionThenText: true }
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
