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
const withVoice = process.argv.includes('--voice')
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
    args: ['--mute-audio', join(stage, 'out', 'main', 'index.js')],
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
  assert.equal(requests[1].messages[0].role, 'system')
  assert.match(requests[1].messages[0].content, /Preset: tsundere/)
  assert.doesNotMatch(requests[1].messages[0].content, /Dirija-se ao usuário pelo nome/)
  assert.deepEqual(requests[1].messages.slice(1), [
    { role: 'user', content: 'Primeira' },
    { role: 'assistant', content: 'Resposta 1' },
    { role: 'user', content: 'Segunda' },
  ])
  await openHistory(page)
  const [legacyChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    page.getByRole('button', { name: 'Importar conversa legada', exact: true }).click(),
  ])
  page.once('dialog', dialog => dialog.accept())
  await legacyChooser.setFiles({
    name: 'fixture.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      format: 'chat-sessions-index:v1',
      sessions: {
        fixture: { meta: { updatedAt: 1 }, messages: [{ role: 'user', content: 'Pergunta legada' }, { role: 'assistant', content: 'Resposta legada' }] },
      },
    })),
  })
  await page.getByText('Conversa legada importada para leitura.', { exact: true }).waitFor()
  await page.getByText('Lia: Resposta legada', { exact: true }).waitFor()
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
  assert.deepEqual(requests[2].messages.slice(1), [{ role: 'user', content: 'Terceira' }])
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
  const picker = page.getByLabel('Conversa ativa', { exact: true })
  const first = await picker.inputValue()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click()
  assert.equal(await draft.inputValue(), 'Rascunho com imagem')
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).click()
  await picker.locator('option').nth(1).waitFor({ state: 'attached' })
  const second = await picker.inputValue()
  assert.notEqual(second, first)
  assert.equal(await page.getByRole('checkbox', { name: 'Guardar histórico' }).isChecked(), false)
  assert.equal(await page.getByRole('log', { name: 'Mensagens' }).locator('.message').count(), 0)
  await submit(page, 'Outro assunto', 5)
  assert.deepEqual(requests[4].messages.slice(1), [{ role: 'user', content: 'Outro assunto' }])
  page.once('dialog', dialog => dialog.accept())
  await picker.selectOption(first)
  await page.getByText('Você: Terceira', { exact: true }).waitFor()
  assert.equal(await page.getByText('Você: Outro assunto', { exact: true }).count(), 0)
  await page.screenshot({ path: join(root, 'conversations.png'), fullPage: true })
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.getByText('Você: Terceira', { exact: true }).waitFor()
  await openHistory(page)
  await page.getByLabel('Conversa ativa', { exact: true }).selectOption(second)
  const deleteButton = page.getByRole('button', { name: 'Excluir conversa', exact: true })
  page.once('dialog', dialog => dialog.dismiss())
  await deleteButton.click()
  assert.equal(await page.getByLabel('Conversa ativa', { exact: true }).inputValue(), second)
  page.once('dialog', dialog => dialog.accept())
  await deleteButton.click()
  await page.getByText('Você: Terceira', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Conversa ativa', { exact: true }).locator('option').count(), 1)
  const openPersona = target => target.getByText('Personalidade', { exact: true }).click()
  await openPersona(page)
  const [personaChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    page.getByRole('button', { name: 'Importar card.json' }).click(),
  ])
  page.once('dialog', dialog => dialog.accept())
  await personaChooser.setFiles({
    name: 'card.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      spec: 'chara_card_v3', spec_version: '3.0',
      data: { name: 'Cartão de teste', personality: 'Tom da personalidade de teste', system_prompt: 'ignored-system-fixture' },
    })),
  })
  await page.getByText('Personalidade ativa: Cartão de teste', { exact: true }).waitFor()
  await submit(page, 'Conversa com cartão', 6)
  assert.deepEqual(requests[5].messages, [{ role: 'system', content: 'Tom da personalidade de teste' }, { role: 'user', content: 'Conversa com cartão' }])
  await page.screenshot({ path: join(root, 'personality.png'), fullPage: true })
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await openPersona(page)
  await page.getByText('Personalidade ativa: Cartão de teste', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Usar personalidade padrão' }).click()
  await page.getByText('Personalidade ativa: Lia', { exact: true }).waitFor()
  await submit(page, 'Retorno à Lia', 7)
  assert.match(requests[6].messages[0].content, /Preset: tsundere/)
  assert.ok(!JSON.stringify(requests[6]).includes('Conversa com cartão'))
  if (withVoice) {
    const speak = page.getByRole('button', { name: 'Ouvir resposta' })
    const stop = page.getByRole('button', { name: 'Parar áudio' })
    const audio = page.locator('audio')
    await speak.click()
    await stop.click()
    await page.getByText('Áudio interrompido.', { exact: true }).waitFor()
    assert.equal(await audio.isVisible(), false)
    await speak.click()
    await audio.waitFor({ state: 'visible', timeout: 90_000 })
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 0)
    await page.screenshot({ path: join(root, 'voice.png'), fullPage: true })
    await stop.click()
    assert.equal(await audio.isVisible(), false)
  }
  const report = { service: 'synthetic local HTTP', optIn: true, reopened: true, resumed: true, legacyTextImported: true, cancellationPreservedHistory: true, cleared: true, rateLimitSanitized: true, refusedImageWithoutVision: true, conversationsIsolated: true, selectionRestored: true, deletionConfirmed: true, builtInPersonaInRequest: true, importedPersonaInRequest: true, importedPersonaRestored: true, personaContextIsolated: true, localKokoroMutedPlayback: withVoice ? 'cancelled, retried, played and stopped' : null }
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
