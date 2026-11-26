import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

assert.equal(process.platform, 'win32', 'Este gate usa o Electron para Windows.')
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const withVoice = process.argv.includes('--voice')
const kokoroVoice = process.argv.find(argument => argument.startsWith('--kokoro-voice='))?.slice('--kokoro-voice='.length)
assert.ok(kokoroVoice === undefined || ['pf_dora', 'pm_alex', 'pm_santa'].includes(kokoroVoice),
  'Informe um identificador de voz Kokoro conhecido.')
const withPublishedHub = process.argv.includes('--agent-hub')
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-history-'))
console.log(`Evidências em ${root}`)
const requests = []
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request)
    chunks.push(chunk)
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  const requestBody = requests.at(-1)
  response.setHeader('Content-Type', 'application/json')
  if (requestBody.tools) {
    assert.equal(requestBody.tools.length, 1)
    assert.equal(requestBody.tools[0].function.name, 'lia_local_time')
    response.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'clock_fixture', type: 'function', function: { name: 'lia_local_time', arguments: '{}' } }] } }] }))
    return
  }
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
    writeFile(join(root, 'lia-product.json'), JSON.stringify({
      provider: { chat: { preferred: { providerId, modelId } } },
      setup: { completed: true },
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
  if (kokoroVoice) {
    const appData = join(root, 'launcher-appdata')
    await mkdir(appData)
    const launchLauncher = () => _electron.launch({
      executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [fileURLToPath(new URL('../out/main/index.js', import.meta.url))],
      env: { ...process.env, APPDATA: appData, LIA_USER_DATA: root },
    })
    app = await launchLauncher()
    let launcher = await app.firstWindow()
    await launcher.getByRole('button', { name: 'Voz', exact: true }).click()
    const localVoice = launcher.getByLabel('Voz local', { exact: true })
    await localVoice.selectOption(kokoroVoice, { timeout: 10_000 })
    await launcher.getByRole('button', { name: 'Selecionar motor local', exact: true }).click()
    await launcher.getByText('Motor local selecionado.', { exact: true }).waitFor({ timeout: 10_000 })
    const invalidAccepted = await launcher.evaluate(() => window.liaApi.useLocalSpeech('invalid'))
    assert.equal(invalidAccepted, false)
    await app.close()
    app = await launchLauncher()
    launcher = await app.firstWindow()
    await launcher.getByRole('button', { name: 'Voz', exact: true }).click()
    await launcher.getByText('Síntese local ativa.', { exact: true }).waitFor({ timeout: 10_000 })
    assert.equal(await launcher.getByLabel('Voz local', { exact: true }).inputValue(), kokoroVoice)
    await launcher.getByLabel('Voz local', { exact: true }).scrollIntoViewIfNeeded()
    await launcher.screenshot({ path: join(root, 'kokoro-selection.png'), fullPage: true })
    await app.close()
    app = undefined
  }
  const hubHome = withPublishedHub ? process.env.LIA_AGENTHUB_HOME : join(root, 'hub-fixture')
  assert.ok(hubHome, 'Defina LIA_AGENTHUB_HOME para o perfil com catálogo publicado.')
  if (!withPublishedHub) {
    const catalog = join(hubHome, 'Comum', 'Capacidades')
    await mkdir(catalog, { recursive: true })
    await writeFile(join(catalog, 'index.json'), JSON.stringify({
      schemaVersion: 1, scope: 'active',
      capabilities: [{ id: 'catalog-fixture', name: 'Capacidade sintética do Hub', type: 'reference', lifecycle: 'active', description: 'fixture-only-private-prose' }],
    }))
  }
  const launch = () => _electron.launch({
    executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['--mute-audio', join(stage, 'out', 'main', 'index.js')],
    env: { ...process.env, LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: join(root, 'profile'), LIA_AGENTHUB_HOME: hubHome },
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
  await page.getByText('Lia Agent Hub', { exact: true }).click()
  await page.getByRole('button', { name: 'Consultar catálogo' }).click()
  const hubItems = page.locator('#hub-capabilities li')
  await hubItems.first().waitFor()
  const listedHubCapabilities = await hubItems.count()
  if (!withPublishedHub)
    assert.deepEqual(await hubItems.allTextContents(), ['Capacidade sintética do Hub · reference'])
  await page.screenshot({ path: join(root, 'hub-catalog.png'), fullPage: true })
  await page.getByText('Lia Agent Hub', { exact: true }).click()
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
  assert.equal(await clear.isDisabled(), true, 'O botão Limpar fica desabilitado quando a conversa está vazia.')
  await submit(page, 'Terceira', 3)
  await clear.click({ trial: true })
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
  assert.equal(await clear.isDisabled(), true, 'O botão Limpar fica desabilitado quando a conversa está vazia.')
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
    page.getByRole('button', { name: 'Importar cartão' }).click(),
  ])
  page.once('dialog', dialog => dialog.accept())
  await personaChooser.setFiles({
    name: 'personality.ccv3.zip',
    mimeType: 'application/zip',
    buffer: await readFile(join(stage, 'test', 'fixtures', 'personality.ccv3.zip')),
  })
  await page.getByText('Personalidade ativa: Cartão de teste', { exact: true }).waitFor()
  await submit(page, 'Conversa com cartão', 6)
  const identity = 'Você é Lia, a companheira digital pessoal deste aplicativo.'
  assert.ok(requests[1].messages[0].content.startsWith(identity))
  assert.ok(requests[5].messages[0].content.startsWith(identity))
  assert.match(requests[5].messages[0].content, /Tom da personalidade de teste/)
  assert.deepEqual(requests[5].messages.slice(1), [{ role: 'user', content: 'Conversa com cartão' }])
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
    const autoPlay = page.getByRole('checkbox', { name: 'Ler respostas automaticamente' })
    assert.equal(await autoPlay.isChecked(), false)
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
    await autoPlay.click()
    await page.getByText('Preferência de leitura salva.', { exact: true }).waitFor()
    assert.equal(await autoPlay.isChecked(), true)
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    const restoredAutoPlay = page.getByRole('checkbox', { name: 'Ler respostas automaticamente' })
    await page.locator('#voice-autoplay:checked').waitFor()
    assert.equal(await restoredAutoPlay.isChecked(), true)
    await submit(page, 'Leitura automática', 8)
    await page.locator('audio').waitFor({ state: 'visible', timeout: 90_000 })
    await page.waitForFunction(() => document.querySelector('audio').currentTime > 0)
    await page.screenshot({ path: join(root, 'autoplay.png'), fullPage: true })
    await page.getByRole('button', { name: 'Parar áudio' }).click()
    await restoredAutoPlay.click()
    await page.getByText('Preferência de leitura salva.', { exact: true }).waitFor()
    assert.equal(await restoredAutoPlay.isChecked(), false)
    await submit(page, 'Sem leitura automática', 9)
    assert.equal(await page.getByRole('button', { name: 'Parar áudio' }).isDisabled(), true)
  }
  const editor = page.getByText('Editar traços da Lia', { exact: true })
  if (!await editor.isVisible())
    await openPersona(page)
  await editor.click()
  await page.getByRole('spinbutton', { name: 'Energia' }).fill('20')
  await page.getByLabel('Contexto base', { exact: true }).selectOption('serious')
  await page.getByRole('button', { name: 'Salvar traços' }).click()
  await page.getByText('Personalidade ativa: Lia personalizada', { exact: true }).waitFor()
  await submit(page, 'Usar os traços', requests.length + 1)
  assert.match(requests.at(-1).messages[0].content, /energia 0\.2/)
  assert.match(requests.at(-1).messages[0].content, /Contexto base: Assunto sério/)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await openPersona(page)
  await page.getByText('Editar traços da Lia', { exact: true }).click()
  await page.getByText('Personalidade ativa: Lia personalizada', { exact: true }).waitFor()
  assert.equal(await page.getByRole('spinbutton', { name: 'Energia' }).inputValue(), '20')
  assert.equal(await page.getByLabel('Contexto base', { exact: true }).inputValue(), 'serious')
  await page.screenshot({ path: join(root, 'traits.png'), fullPage: true })
  const clock = page.getByRole('checkbox', { name: 'Solicitar consulta à data e hora deste computador nesta mensagem' })
  assert.equal(await clock.isChecked(), false)
  const confirmClock = response => app.evaluate(({ dialog }, choice) => {
    dialog.showMessageBox = async (owner, options) => {
      if (!owner || options.defaultId !== 0 || options.cancelId !== 0 || options.buttons[1] !== 'Consultar')
        throw new Error('Unexpected clock confirmation contract')
      return { response: choice }
    }
  }, response)
  const callIndex = requests.length
  await confirmClock(0)
  await clock.check()
  await page.getByRole('textbox', { name: 'Mensagem' }).fill('Que horas são?')
  await page.getByRole('button', { name: 'Enviar', exact: true }).click()
  await page.getByRole('button', { name: 'Enviar', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('#allow-clock').disabled)
  assert.equal(requests.length, callIndex)
  assert.equal(await page.getByRole('textbox', { name: 'Mensagem' }).inputValue(), 'Que horas são?')
  await confirmClock(1)
  await clock.check()
  await submit(page, 'Que horas são?', callIndex + 2)
  assert.equal(requests[callIndex].messages.at(-1).role, 'user')
  assert.deepEqual(requests[callIndex + 1].messages.at(-1).tool_call_id, 'clock_fixture')
  assert.equal(requests[callIndex + 1].messages.at(-1).role, 'tool')
  assert.match(requests[callIndex + 1].messages.at(-1).content, /\d{2}:\d{2}:\d{2}/)
  assert.equal(requests[callIndex + 1].tools, undefined)
  assert.equal(await clock.isChecked(), false)
  await submit(page, 'Mensagem sem ferramenta', requests.length + 1)
  assert.equal(requests.at(-1).tools, undefined)
  assert.equal(requests.at(-1).messages.some(message => message.role === 'tool'), false)
  await page.getByText('Memória', { exact: true }).click()
  const memoryNote = () => page.getByLabel('Nova nota', { exact: true })
  const clearNotes = () => page.getByRole('button', { name: 'Apagar notas', exact: true })
  assert.equal(await clearNotes().isDisabled(), true)
  await memoryNote().fill('Nota sintética para exclusão.')
  await page.getByRole('button', { name: 'Salvar nota', exact: true }).click()
  await page.getByText('Nota salva.', { exact: true }).waitFor()
  const answerToClear = response => app.evaluate(({ dialog }, choice) => {
    dialog.showMessageBox = async (owner, options) => {
      if (!owner || options.defaultId !== 0 || options.cancelId !== 0 || options.buttons[1] !== 'Apagar notas')
        throw new Error('Unexpected memory confirmation contract')
      return { response: choice }
    }
  }, response)
  await answerToClear(0)
  await clearNotes().click()
  await page.waitForFunction(() => document.activeElement?.id === 'memory-clear')
  await page.getByText('Nota sintética para exclusão.', { exact: true }).waitFor()
  await answerToClear(1)
  await clearNotes().click()
  await page.getByText('Notas apagadas.', { exact: true }).waitFor()
  assert.equal(await page.getByText('Nota sintética para exclusão.', { exact: true }).count(), 0)
  assert.equal(await clearNotes().isDisabled(), true)
  await page.waitForFunction(() => document.activeElement?.id === 'memory-note')
  assert.equal(await page.getByText('Você: Mensagem sem ferramenta', { exact: true }).count(), 1)
  await page.screenshot({ path: join(root, 'memory-cleared.png'), fullPage: true })
  const removeMessage = page.getByRole('button', { name: 'Apagar mensagem — Você: Mensagem sem ferramenta', exact: true })
  const answerToDelete = response => app.evaluate(({ dialog }, choice) => {
    dialog.showMessageBox = async (owner, options) => {
      if (!owner || options.defaultId !== 0 || options.cancelId !== 0 || options.buttons[1] !== 'Apagar mensagem')
        throw new Error('Unexpected message confirmation contract')
      return { response: choice }
    }
  }, response)
  await answerToDelete(0)
  await removeMessage.click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Apagar mensagem — Você: Mensagem sem ferramenta')
  await answerToDelete(1)
  await removeMessage.click()
  await page.getByText('Mensagem apagada.', { exact: true }).waitFor()
  assert.equal(await page.getByText('Você: Mensagem sem ferramenta', { exact: true }).count(), 0)
  assert.equal(await page.getByText(`Lia: Resposta ${requests.length}`, { exact: true }).count(), 1)
  const notesOptIn = () => page.getByRole('checkbox', { name: 'Usar minhas notas' })
  const saveFixtureNote = async (text, expiry = '') => {
    await memoryNote().fill(text)
    await page.getByLabel('Tipo de nota').selectOption('project')
    await page.getByLabel('Classificação').selectOption('hypothesis')
    await page.getByLabel('Recuperar até (data UTC, opcional)').fill(expiry)
    await page.getByRole('button', { name: 'Salvar nota', exact: true }).click()
    await page.getByText('Nota salva.', { exact: true }).waitFor()
  }
  await notesOptIn().check()
  await page.getByText('Preferência salva.', { exact: true }).waitFor()
  await saveFixtureNote('Observatório: usar filtro âmbar.')
  await saveFixtureNote('Observatório: versão expirada.', '2000-01-01')
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  page.setDefaultTimeout(10_000)
  await page.getByText('Memória', { exact: true }).click()
  await page.getByText('Observatório: usar filtro âmbar.', { exact: true }).waitFor()
  assert.equal(await notesOptIn().isChecked(), true)
  await submit(page, 'Qual filtro usar no Observatório?', requests.length + 1)
  assert.match(requests.at(-1).messages.at(-1).content, /filtro âmbar/)
  assert.doesNotMatch(requests.at(-1).messages[0].content, /filtro âmbar/)
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /versão expirada/)
  await page.getByRole('button', { name: 'Editar nota', exact: true }).first().click()
  assert.equal(await memoryNote().inputValue(), 'Observatório: usar filtro âmbar.')
  await saveFixtureNote('Observatório: usar filtro violeta.')
  await submit(page, 'Reveja o filtro do Observatório?', requests.length + 1)
  assert.match(requests.at(-1).messages.at(-1).content, /filtro violeta/)
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /filtro âmbar/)
  const exportPath = join(root, 'exported-memory.json')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async owner => {
      if (!owner)
        throw new Error('Missing export owner')
      return { canceled: false, filePath }
    }
  }, exportPath)
  await page.getByRole('button', { name: 'Exportar notas', exact: true }).click()
  await page.getByText('Notas exportadas.', { exact: true }).waitFor()
  const exported = JSON.parse(await readFile(exportPath, 'utf8'))
  assert.equal(exported.entries.length, 2)
  assert.equal(exported.entries[0].metadata.provenance, 'user')
  assert.equal(exported.entries[0].metadata.classification, 'hypothesis')
  await answerToClear(1)
  await clearNotes().click()
  await page.getByText('Notas apagadas.', { exact: true }).waitFor()
  await submit(page, 'Ainda há notas do Observatório?', requests.length + 1)
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /filtro violeta|versão expirada/)
  const report = { service: 'synthetic local HTTP', optIn: true, reopened: true, resumed: true, legacyTextImported: true, cancellationPreservedHistory: true, cleared: true, clearDisabledWhenEmpty: true, rateLimitSanitized: true, refusedImageWithoutVision: true, conversationsIsolated: true, selectionRestored: true, deletionConfirmed: true, builtInPersonaInRequest: true, importedPersonaInRequest: true, importedPersonaRestored: true, personaContextIsolated: true, kokoroSelectedByLauncher: Boolean(kokoroVoice), kokoroVoice: kokoroVoice ?? (withVoice ? 'default' : null), localKokoroMutedPlayback: withVoice ? 'cancelled, retried, played and stopped' : null, autoPlay: withVoice ? 'opt-in, persisted, played, opted out' : null, customizedTraitsPersisted: true }
  report.localClockRoundTrip = true
  report.clockConfirmation = { dialogResponse: 'injected', deniedWithoutRequest: true, acceptedRoundTrip: true }
  report.identityStableWithImportedPersona = true
  report.singleMessageRemoved = { dialogResponse: 'injected', remainingReplyVisible: true }
  report.memoryLifecycle = { reopened: true, lexicalRecall: true, expiredExcluded: true, edited: true, exported: true, deletionExcluded: true, dialogResponse: 'injected' }
  report.memoryClear = { dialogResponse: 'injected', cancelPreservedNote: true, clearPreservedConversation: true, focusRestored: true }
  report.hubCatalog = { source: withPublishedHub ? 'published Hub index' : 'synthetic index', listed: listedHubCapabilities }
  assert.ok(!JSON.stringify(requests).includes('fixture-only-private-prose'))
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
