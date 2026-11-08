import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const evidenceRoot = process.env.LIA_EVIDENCE_ROOT ?? resolve(tmpdir(), 'lia-completion-evidence')
const quotePowerShell = value => "'" + value.replaceAll("'", "''") + "'"
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const require = createRequire(new URL('../../airi/apps/stage-tamagotchi/package.json', import.meta.url))
const { _electron, chromium } = require('playwright')
const root = `${evidenceRoot}/completion-resume-runtime-${Date.now()}`
await mkdir(`${root}/captures`, { recursive: true })
const secret = randomUUID()
const keyless = process.argv.includes('--without-key')
const packaged = process.argv.includes('--packaged')
const facts = { root, execution: packaged ? 'packaged-private' : 'development', authentication: keyless ? 'explicit-keyless-local-service' : 'synthetic-bearer-key', steps: [], requests: [], errors: [] }
let app, browser
const service = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : undefined
    const authenticated = keyless ? req.headers.authorization === undefined : req.headers.authorization === `Bearer ${secret}`
    facts.requests.push({ path: req.url, credentialPolicyPassed: authenticated, stream: body?.stream === true, correctModel: body ? body.model === 'lia-local-fixture' : undefined, memoryPresent: body ? JSON.stringify(body.messages).includes('laranja-fixture') : undefined, personaSignature: body ? createHash('sha256').update(JSON.stringify(body.messages?.filter(m => m.role === 'system'))).digest('hex') : undefined })
    if (!authenticated) { res.writeHead(401); res.end(); return }
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'lia-local-fixture' }] })); return }
    const probe = body?.tools?.some(tool => tool.function?.name === 'lia_connection_check')
    let message = { role: 'assistant', content: 'Resposta sintética de validação local.' }
    if (probe && body.messages.length === 1) message = { role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call', type: 'function', function: { name: 'lia_connection_check', arguments: '{}' } }] }
    else if (probe) message.content = body.messages.at(-1).content
    if (body?.stream) {
      res.setHeader('content-type', 'text/event-stream')
      res.end(`data: ${JSON.stringify({ id: 'fixture-stream', object: 'chat.completion.chunk', choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    } else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] })) }
  } catch { res.writeHead(500); res.end() }
})
await new Promise(resolve => service.listen(0, '127.0.0.1', resolve))
const debug = createServer()
await new Promise(resolve => debug.listen(0, '127.0.0.1', resolve))
const debugPort = debug.address().port
await new Promise(resolve => debug.close(resolve))
try {
  app = await _electron.launch({ executablePath: resolve(repositoryRoot, packaged ? 'airi/apps/lia-app/dist/windows/win-unpacked/Lia.exe' : 'airi/apps/stage-tamagotchi/node_modules/electron/dist/electron.exe'), args: packaged ? [] : [resolve(repositoryRoot, 'airi/apps/lia-app/out/main/index.js')], env: { ...process.env, NODE_ENV: 'production', LIA_USER_DATA: `${root}/profile`, APP_USER_DATA_PATH: `${root}/profile`, APP_REMOTE_DEBUG: 'true', APP_REMOTE_DEBUG_PORT: String(debugPort), APP_REMOTE_DEBUG_NO_OPEN: 'true', LIA_DEVFLOW_DIAGNOSTICS: '1' } })
  facts.launcherPid = app.process().pid
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Lia', exact: true }).waitFor()
  await page.screenshot({ path: `${root}/captures/01-home.png` })
  await page.getByRole('button', { name: 'Somente texto', exact: true }).click()
  await page.getByRole('button', { name: /IA & Recursos/ }).click()
  await page.getByLabel('Endereço do serviço', { exact: true }).fill(`http://127.0.0.1:${service.address().port}/v1`)
  if (keyless) await page.getByRole('checkbox', { name: 'Este serviço não exige chave de acesso' }).check()
  else await page.locator('#ai-key').fill(secret)
  await page.getByRole('button', { name: 'Salvar serviço e seleção', exact: true }).click()
  await page.getByText('Serviço salvo. Busque os modelos disponíveis para continuar.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Buscar modelos', exact: true }).click()
  await page.getByRole('option', { name: 'lia-local-fixture', exact: true }).waitFor({ state: 'attached' })
  await page.getByLabel('Modelo para conversar', { exact: true }).selectOption('lia-local-fixture')
  await page.getByRole('button', { name: 'Salvar serviço e seleção', exact: true }).click()
  await page.getByRole('button', { name: 'Testar conexão completa', exact: true }).click()
  await page.getByText('Conexão verificada:', { exact: false }).waitFor()
  facts.steps.push('PASS Windows Launcher UI save/discovery/tool-result/final-reply on synthetic HTTP')
  await page.screenshot({ path: `${root}/captures/02-ai-verified.png` })
  await page.getByRole('button', { name: /Início/ }).click()
  await page.getByRole('button', { name: /Conversar com Lia/ }).click()
  await page.getByRole('button', { name: /Encerrar conversa/ }).waitFor({ timeout: 180000 })
  facts.stageState = await page.evaluate(async () => { const { phase, pid, message } = await window.liaApi.stageState(); return { phase, pid, message } })
  facts.steps.push('PASS Launcher manager start')
  // The actual debug endpoint was selected before launch, never guessed.
  for (let n = 0; n < 60; n++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); break } catch { await new Promise(resolve => setTimeout(resolve, 500)) }
  }
  if (!browser) throw new Error('Stage CDP did not become available')
  facts.rendererErrors = []
  const monitor = p => {
    p.on('pageerror', error => facts.rendererErrors.push({ kind: 'pageerror', url: p.url(), message: error.message.slice(0, 1600).replaceAll(secret, '[secret]') }))
    p.on('console', async msg => {
      if (!p.url().startsWith('devtools:') && (msg.type() === 'error' || msg.text().startsWith('[lia-startup]') || msg.text().startsWith('[lia-presence]'))) {
        const args = await Promise.all(msg.args().map(a => a.evaluate(v => v instanceof Error ? { name: v.name, message: v.message, code: v.code, stack: v.stack?.split('\n').slice(0, 4).join('\n') } : undefined).catch(() => undefined)))
        facts.rendererErrors.push({ kind: msg.type(), url: p.url(), message: msg.text().slice(0, 1600).replaceAll(secret, '[secret]'), args: JSON.stringify(args).replaceAll(secret, '[secret]') })
      }
    })
  }
  for (const context of browser.contexts()) { context.on('page', monitor); for (const p of context.pages()) monitor(p) }
  let pages, stage
  for (let n = 0; n < 120; n++) {
    pages = browser.contexts().flatMap(context => context.pages())
    stage = pages.find(p => {
      try { const url = new URL(p.url()); return ['http:', 'https:', 'file:'].includes(url.protocol) && url.searchParams.get('synced-leader') === 'true' && ['', '#/', '#'].includes(url.hash) } catch { return false }
    })
    if (stage) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  facts.targets = await Promise.all(pages.map(async p => ({ url: p.url(), title: await p.title() })))
  if (!stage) throw new Error('No Stage renderer target')
  await stage.locator('canvas').first().waitFor({ timeout: 60000 })
  await stage.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 60000 })
  await stage.screenshot({ path: `${root}/captures/03-stage.png` })
  facts.stageBody = await stage.locator('body').innerText()
  facts.runtimeSelection = await stage.evaluate(() => {
    const stores = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s
    if (!stores) return { unavailable: true }
    return [...stores].filter(([id]) => /consciousness|lia-provider|auth/.test(id)).map(([id, s]) => ({ id, activeProvider: s.activeProvider, activeModel: s.activeModel, initialized: s.initialized, hasPreferred: !!s.loadedConfig?.preferred }))
  })
  facts.steps.push('PASS real Stage renderer canvas and loading finished; visual review required')
  facts.stagePid = facts.stageState.pid
  // Only observable UI and public read-only status; no store mutation.
  facts.buttons = await stage.getByRole('button').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, label: n.getAttribute('aria-label'), title: n.title })))
  await stage.getByLabel(/^(Open Chat|Abrir conversa|Abrir chat)$/).click()
  let chat
  for (let n = 0; n < 60; n++) {
    chat = browser.contexts().flatMap(context => context.pages()).find(p => p.url().includes('#/chat'))
    if (chat) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!chat) throw new Error('Chat window did not appear')
  facts.chatText = await chat.locator('body').innerText()
  facts.chatInputs = await chat.locator('input,textarea,[contenteditable=true]').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, placeholder: n.getAttribute('placeholder'), role: n.getAttribute('role') })))
  await chat.locator('textarea').fill('Validação local da conversa, responda de forma breve.')
  await chat.locator('textarea').press('Enter')
  await chat.getByText('Resposta sintética de validação local.', { exact: false }).waitFor({ timeout: 60000 })
  facts.steps.push('PASS Windows Stage chat UI -> Main SSE -> visible synthetic response')
  await chat.screenshot({ path: `${root}/captures/04-chat.png` })
  await stage.getByLabel(/^(Expand|Expandir)$/).click()
  facts.expandedButtons = await stage.getByRole('button').evaluateAll(nodes => nodes.map(n => ({ label: n.getAttribute('aria-label'), text: n.textContent })))
  await stage.getByLabel(/^(Open Settings|Abrir configurações|Configurações)$/i).focus()
  await stage.getByLabel(/^(Open Settings|Abrir configurações|Configurações)$/i).press('Enter')
  let settings
  for (let n = 0; n < 60; n++) {
    settings = browser.contexts().flatMap(context => context.pages()).find(p => p.url().includes('#/settings/lia'))
    if (settings) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!settings) throw new Error('Lia settings window did not appear')
  await settings.getByTestId('lia-config-tab-memory').click()
  const memory = settings.getByTestId('lia-memory-section')
  await memory.getByRole('checkbox').check()
  await memory.getByRole('textbox').fill('Minha cor favorita é laranja-fixture.')
  await memory.getByRole('button', { name: /^(Guardar lembrança|Save memory)$/ }).click()
  await memory.getByText('Minha cor favorita é laranja-fixture.', { exact: true }).waitFor()
  await settings.screenshot({ path: `${root}/captures/05-memory.png` })
  await chat.locator('textarea').fill('Qual é minha cor favorita?')
  await chat.locator('textarea').press('Enter')
  await chat.getByText('Resposta sintética de validação local.', { exact: false }).nth(1).waitFor({ timeout: 60000 })
  if (!facts.requests.at(-1).memoryPresent) throw new Error('Opted-in memory not sent to synthetic Main service')
  await memory.getByRole('checkbox').uncheck()
  await chat.locator('textarea').fill('Qual é minha cor favorita agora?')
  await chat.locator('textarea').press('Enter')
  await chat.getByText('Resposta sintética de validação local.', { exact: false }).nth(2).waitFor({ timeout: 60000 })
  if (facts.requests.at(-1).memoryPresent) throw new Error('Memory was still sent after opt-out')
  facts.steps.push('PASS Windows memory CRUD/opt-in retrieval/opt-out through UI and Main request under declared credential policy')
  await settings.getByTestId('lia-config-tab-personality').click()
  const beforePersonality = facts.requests.at(-1).personaSignature
  const energy = settings.getByRole('slider', { name: /^(Energia|Energy)$/ })
  await energy.press('Home')
  for (let i = 0; i < 23; i++) await energy.press('ArrowRight')
  await settings.getByRole('button', { name: /^(Salvar personalidade|Save personality)$/ }).click()
  await settings.getByText(/^(Personalidade salva\.|Personality saved\.)$/).waitFor()
  await settings.screenshot({ path: `${root}/captures/06-personality.png` })
  await chat.locator('textarea').fill('Converse comigo após a alteração de personalidade.')
  await chat.locator('textarea').press('Enter')
  await chat.getByText('Resposta sintética de validação local.', { exact: false }).nth(3).waitFor({ timeout: 60000 })
  facts.personalityRequestChanged = facts.requests.at(-1).personaSignature !== beforePersonality
  if (!facts.personalityRequestChanged) throw new Error('Changed personality did not reach the next chat system prompt')
  facts.steps.push('PASS personality UI edit changed the next request persona; model behavior not evaluated')
  await settings.getByTestId('lia-config-tab-presence').click()
  const beforeFree = await stage.evaluate(() => ({ width: outerWidth, height: outerHeight, x: screenX, y: screenY }))
  await settings.getByRole('radio', { name: /Modo Livre|Free mode/ }).check()
  await Promise.race([
    settings.getByRole('checkbox', { name: /Pausar movimento|Pause movement/ }).waitFor(),
    settings.getByRole('alert').first().waitFor().then(() => { throw new Error('Presence update reported an error') }),
  ])
  await settings.getByRole('checkbox', { name: /Pausar movimento|Pause movement/ }).check()
  const duringFree = await stage.evaluate(() => ({ width: outerWidth, height: outerHeight, x: screenX, y: screenY }))
  if (duringFree.width !== 240 || duringFree.height !== 360) throw new Error('Free presence dimensions were not applied')
  facts.presenceBounds = { before: beforeFree, free: duringFree }
  await settings.screenshot({ path: `${root}/captures/07-presence.png` })
  facts.monitors = await settings.getByRole('combobox').locator('option').allTextContents()
  await stage.screenshot({ path: `${root}/captures/08-free-stage.png` })
  if (process.argv.includes('--presence-more')) {
    const displays = await settings.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('lia-presence').state.displays)
    if (displays.length > 1) {
      const destination = displays[1]
      await settings.getByRole('combobox').selectOption(String(destination.id))
      let bounds
      const area = destination.workArea
      const inside = b => b.x >= area.x && b.y >= area.y && b.x + b.width <= area.x + area.width && b.y + b.height <= area.y + area.height
      for (let n = 0; n < 30; n++) {
        bounds = await stage.evaluate(() => ({ x: screenX, y: screenY, width: outerWidth, height: outerHeight }))
        if (inside(bounds)) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!inside(bounds)) throw new Error('Presence did not fit the selected second physical monitor')
      facts.secondMonitor = { workArea: area, bounds }
      facts.steps.push('PASS Windows placement within the second connected monitor; unplug/DPI/game behavior not tested')
    } else facts.steps.push('NOT RUN second monitor: only one display observed')
    await settings.getByRole('checkbox', { name: /Pausar movimento|Pause movement/ }).uncheck()
    const start = await stage.evaluate(() => ({ x: screenX, y: screenY }))
    let moved
    for (let n = 0; n < 30; n++) {
      moved = await stage.evaluate(() => ({ x: screenX, y: screenY }))
      if (moved.x !== start.x || moved.y !== start.y) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (moved.x === start.x && moved.y === start.y) throw new Error('Free presence did not move after unpausing')
    await settings.getByRole('checkbox', { name: /Pausar movimento|Pause movement/ }).check()
    await settings.getByRole('button', { name: /Definir posição atual como Home|Set current position as Home/ }).click()
    facts.steps.push('PASS Windows movement after unpause, pause and explicit Home save')
  }
  await settings.getByRole('radio', { name: /Tamagotchi/ }).check()
  await settings.getByRole('radio', { name: /Modo Livre|Free mode/ }).waitFor()
  // Wait for the real Main window response to the UI preference, never mutate it.
  let restored
  for (let n = 0; n < 30; n++) {
    restored = await stage.evaluate(() => ({ width: outerWidth, height: outerHeight }))
    if (restored.width === beforeFree.width && restored.height === beforeFree.height) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (restored.width !== beforeFree.width || restored.height !== beforeFree.height) throw new Error('Tamagotchi dimensions did not restore')
  facts.steps.push('PASS Windows free presence 240x360, pause and Tamagotchi restoration on observed monitor')
  if (process.argv.includes('--benchmark')) {
    const stageRootPid = Number(facts.stagePid)
    if (!Number.isSafeInteger(stageRootPid) || stageRootPid < 1) throw new Error('Invalid owned Stage PID')
    const command = `$snapshot=@(Get-CimInstance Win32_Process); $owned=@($snapshot | Where-Object ProcessId -eq ${stageRootPid}); if(!$owned.Count){throw 'Owned Stage process unavailable'}; do { $new=@($snapshot | Where-Object { $child=$_; $owned.ProcessId -notcontains $child.ProcessId -and @($owned | Where-Object { $_.ProcessId -eq $child.ParentProcessId -and $_.CreationDate -le $child.CreationDate }).Count -gt 0 }); $owned+= $new } while($new.Count); $ids=@($owned.ProcessId); & ${quotePowerShell(resolve(repositoryRoot, 'tools/desktop-benchmark/collect-windows.ps1'))} -ProcessId $ids -DurationSeconds 15 -IntervalSeconds 1 -ScenarioLabel ${packaged ? 'stage-packaged' : 'stage-dev'}-ui-fixture-idle -OutputRoot ${quotePowerShell(evidenceRoot)}`
    const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, maxBuffer: 1024 * 1024 })
    facts.benchmark = { output: result.stdout.trim(), scope: `Stage ${packaged ? 'packaged' : 'development'} process and currently observed descendants, parent creation time checked; CDP active; no engine comparison or FPS measurement` }
  }
  await page.getByRole('button', { name: /Encerrar conversa/ }).click()
  await page.getByText('Conversa encerrada', { exact: false }).waitFor({ timeout: 30000 })
  facts.stopped = await page.evaluate(async () => { const { phase, pid, lastExitCode } = await window.liaApi.stageState(); return { phase, pid, lastExitCode } })
  facts.steps.push('PASS Launcher stop observed')
} catch (error) {
  facts.errors.push({ name: error.name, message: error.message.replaceAll(secret, '[secret]') }); process.exitCode = 1
  if (app) {
    const state = await app.windows()[0]?.evaluate(async () => {
      const { phase, message, pid, lastExitCode } = await window.liaApi.stageState()
      return { phase, message, pid, lastExitCode }
    }).catch(() => undefined)
    if (state) facts.failedStageState = JSON.parse(JSON.stringify(state).replaceAll(secret, '[secret]'))
  }
  if (app) facts.mainPresenceDiagnostics = await app.windows()[0]?.evaluate(async () => (await window.liaApi.stageState()).logTail.flatMap(chunk => chunk.split('\n')).filter(line => line.includes('[lia-presence]'))).catch(() => [])
  if (browser) {
    facts.diagnostics = []
    for (const p of browser.contexts().flatMap(context => context.pages()).filter(p => !p.url().startsWith('devtools:'))) {
      facts.diagnostics.push({ url: p.url(), text: (await p.locator('body').innerText().catch(() => '')).slice(-3000).replaceAll(secret, '[secret]') })
      if (p.url().includes('#/chat')) await p.screenshot({ path: `${root}/captures/failed-chat.png` }).catch(() => {})
    }
  }
}
finally {
  if (app) {
    try {
      const page = app.windows()[0]
      const stop = page?.getByRole('button', { name: /Encerrar conversa/ })
      if (stop && await stop.count()) {
        await stop.click()
        await page.getByText('Conversa encerrada', { exact: false }).waitFor({ timeout: 30000 })
        facts.stopped = await page.evaluate(async () => { const { phase, pid, lastExitCode } = await window.liaApi.stageState(); return { phase, pid, lastExitCode } })
        facts.steps.push('PASS Launcher stop observed during cleanup after component failure')
      }
    } catch { facts.steps.push('FAIL UI cleanup; supervisor close still required') }
  }
  if (browser) await browser.close().catch(() => {})
  if (app) await app.close().catch(() => {})
  service.closeAllConnections(); await new Promise(resolve => service.close(resolve))
  const serialized = JSON.stringify(facts, null, 2)
  if (serialized.includes(secret)) throw new Error('Synthetic secret rejected from report')
  await writeFile(`${root}/report.json`, serialized)
  console.log(JSON.stringify({ root, steps: facts.steps, errors: facts.errors }))
}
