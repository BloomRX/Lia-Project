import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

assert.equal(process.platform, 'win32', 'Este gate usa o Electron para Windows.')
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-history-'))
console.log(`Evidências em ${root}`)
const requests = []
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request)
    chunks.push(chunk)
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  response.setHeader('Content-Type', 'application/json')
  if (requests.at(-1).messages.at(-1).content === 'Testar limite') {
    response.writeHead(429)
    response.end(JSON.stringify({ detail: 'fixture-private-upstream-body' }))
    return
  }
  response.end(JSON.stringify({ choices: [{ message: { content: `Resposta ${requests.length}` } }] }))
})
server.listen(0, '127.0.0.1')

let app
try {
  await once(server, 'listening')
  const providerId = 'local-chat'
  const modelId = 'history-gate'
  await Promise.all([
    writeFile(join(root, 'lia-product.json'), JSON.stringify({ provider: { chat: { preferred: { providerId, modelId } } } })),
    writeFile(join(root, 'lia-transports.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      records: [{
        id: providerId,
        providerId,
        definitionId: providerId,
        type: 'http',
        protocol: 'chat-completions',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        modelIds: [modelId],
        adapterOptions: { localOnly: true, allowUnauthenticated: true },
        enabled: true,
        metadata: {},
        credentialRef: { scope: providerId, key: 'apiKey' },
      }],
      tombstones: [],
      migration: { version: 1, imported: [] },
    })),
  ])
  const launch = () => _electron.launch({
    executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [join(stage, 'out', 'main', 'index.js')],
    env: { ...process.env, LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile') },
  })
  const submit = async (page, text, index) => {
    await page.getByLabel('Mensagem', { exact: true }).fill(text)
    await page.getByRole('button', { name: 'Enviar', exact: true }).click()
    await page.getByText(`Lia: Resposta ${index}`, { exact: true }).waitFor()
  }
  const openHistory = page => page.getByText('Histórico da conversa', { exact: true }).click()
  app = await launch()
  let page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  await openHistory(page)
  const checkbox = page.getByRole('checkbox', { name: 'Guardar histórico' })
  assert.equal(await checkbox.isChecked(), false)
  await checkbox.check()
  await page.getByText('Histórico ativado.', { exact: true }).waitFor()
  await submit(page, 'Primeira', 1)
  await app.close()

  app = await launch()
  page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  await page.getByText('Lia: Resposta 1', { exact: true }).waitFor()
  await submit(page, 'Segunda', 2)
  assert.deepEqual(requests[1].messages, [
    { role: 'user', content: 'Primeira' },
    { role: 'assistant', content: 'Resposta 1' },
    { role: 'user', content: 'Segunda' },
  ])
  await openHistory(page)
  await page.screenshot({ path: join(root, 'history.png'), fullPage: true })
  const clear = page.getByRole('button', { name: 'Limpar conversa', exact: true })
  page.once('dialog', dialog => dialog.dismiss())
  await clear.click()
  assert.equal(await page.getByText('Lia: Resposta 1', { exact: true }).count(), 1)
  page.once('dialog', dialog => dialog.accept())
  await clear.click()
  await page.getByText('Conversa limpa.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('log', { name: 'Mensagens' }).locator('.message').count(), 0)
  await submit(page, 'Terceira', 3)
  assert.deepEqual(requests[2].messages, [{ role: 'user', content: 'Terceira' }])
  const draft = page.getByLabel('Mensagem', { exact: true })
  await draft.fill('Testar limite')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await page.getByText('A conexão de IA atingiu seu limite de uso. Aguarde e tente novamente.', { exact: true }).waitFor()
  assert.equal(await draft.inputValue(), 'Testar limite')
  assert.equal(await page.getByText('fixture-private-upstream-body', { exact: false }).count(), 0)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    page.getByRole('button', { name: 'Anexar imagem', exact: true }).click(),
  ])
  await chooser.setFiles({
    name: 'fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD2sAAAAASUVORK5CYII=', 'base64'),
  })
  await draft.fill('Rascunho com imagem')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await page.getByText('A conexão selecionada não tem uma rota de visão disponível.', { exact: true }).waitFor()
  assert.equal(await draft.inputValue(), 'Rascunho com imagem')
  assert.equal(requests.length, 4)
  await page.getByRole('button', { name: 'Remover imagem', exact: true }).click()
  const report = { service: 'synthetic local HTTP', optIn: true, reopened: true, resumed: true, cancellationPreservedHistory: true, cleared: true, rateLimitSanitized: true, refusedImageWithoutVision: true }
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
