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
import { once } from 'node:events'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
const require = createRequire(new URL('../../airi/apps/stage-tamagotchi/package.json', import.meta.url))
const { _electron, chromium } = require('playwright')
const root = `${evidenceRoot}/completion-resume-runtime-${Date.now()}`
await mkdir(`${root}/captures`, { recursive: true })
const secret = randomUUID()
const localEndpointArgument = process.argv.find(value => value.startsWith('--local-endpoint='))
const localModel = process.argv.find(value => value.startsWith('--local-model='))?.slice('--local-model='.length)
const localEndpoint = localEndpointArgument ? new URL(localEndpointArgument.slice('--local-endpoint='.length)) : undefined
if (localEndpoint && (!['http:', 'https:'].includes(localEndpoint.protocol) || !['127.0.0.1', '[::1]'].includes(localEndpoint.hostname)
  || localEndpoint.username || localEndpoint.password || localEndpoint.search || localEndpoint.hash))
  throw new Error('--local-endpoint requires an HTTP(S) address on literal loopback')
const keyless = !!localEndpoint || process.argv.includes('--without-key')
const packaged = process.argv.includes('--packaged')
const credentialHandoff = process.argv.includes('--credential-handoff')
if (localEndpoint && credentialHandoff)
  throw new Error('--credential-handoff uses the synthetic service')
const handoffPrompt = 'Validação após o Launcher fechar.'
const handoffReply = 'Resposta sintética com o Launcher fechado.'
const performance = process.argv.includes('--performance')
const soakArgument = process.argv.find(value => value.startsWith('--soak-seconds='))
const soakSeconds = soakArgument ? Number(soakArgument.split('=')[1]) : 0
if (!Number.isInteger(soakSeconds) || soakSeconds < 0 || soakSeconds > 86400)
  throw new Error('Invalid soak duration')
const facts = { root, execution: packaged ? 'packaged-private' : 'development', inference: localEndpoint ? 'real-local-service' : 'synthetic-fixture', authentication: keyless ? 'explicit-keyless-local-service' : 'synthetic-bearer-key', steps: [], requests: [], errors: [] }
let selectedModel = localEndpoint ? localModel : 'lia-local-fixture'
let app, browser
async function collectPerformance(label, duration = 15, stagePid) {
  const roots = [app.process().pid, stagePid].filter(value => value !== undefined)
  if (roots.some(pid => !Number.isSafeInteger(pid) || pid < 1)) throw new Error('Invalid owned PID')
  const command = `$snapshot=@(Get-CimInstance Win32_Process); $roots=@(${roots.join(',')}); $owned=@($snapshot | Where-Object { $roots -contains $_.ProcessId }); do { $new=@($snapshot | Where-Object { $child=$_; $owned.ProcessId -notcontains $child.ProcessId -and @($owned | Where-Object { $_.ProcessId -eq $child.ParentProcessId -and $_.CreationDate -le $child.CreationDate }).Count -gt 0 }); $owned+= $new } while($new.Count); $ids=@($owned.ProcessId); & ${quotePowerShell(resolve(repositoryRoot, 'tools/desktop-benchmark/collect-windows.ps1'))} -ProcessId $ids -DurationSeconds ${duration} -IntervalSeconds 5 -IncludePrivateWorkingSet -IncludeGpu -ScenarioLabel ${label} -OutputRoot ${quotePowerShell(evidenceRoot)}`
  const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, maxBuffer: 1024 * 1024 })
  facts.performance ??= []
  facts.performance.push({ label, durationSeconds: duration, output: result.stdout.trim(), roots })
  await writeFile(`${root}/progress.json`, JSON.stringify({ execution: facts.execution, performance: facts.performance, steps: facts.steps }, null, 2))
}
const service = createServer(async (req, res) => {
  try {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : undefined
    const authenticated = keyless ? req.headers.authorization === undefined : req.headers.authorization === `Bearer ${secret}`
    const requestEvidence = { path: req.url, credentialPolicyPassed: authenticated, stream: body?.stream === true, correctModel: body ? body.model === selectedModel : undefined, memoryPresent: body ? JSON.stringify(body.messages).includes('laranja-fixture') : undefined, personaSignature: body ? createHash('sha256').update(JSON.stringify(body.messages?.filter(m => m.role === 'system'))).digest('hex') : undefined }
    facts.requests.push(requestEvidence)
    if (!authenticated) { res.writeHead(401); res.end(); return }
    if (localEndpoint) {
      const operation = req.method === 'GET' && req.url === '/v1/models' ? 'models'
        : req.method === 'POST' && req.url === '/v1/chat/completions' ? 'chat/completions' : undefined
      if (!operation) { res.writeHead(404); res.end(); return }
      const signal = new AbortController()
      res.once('close', () => signal.abort())
      const upstream = await fetch(`${localEndpoint.href.replace(/\/+$/, '')}/${operation}`, {
        method: req.method,
        redirect: 'error',
        signal: signal.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: raw } : {}),
      })
      Object.assign(requestEvidence, { upstreamStatus: upstream.status, upstreamContentType: upstream.headers.get('content-type') })
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream' })
      if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res)
      else res.end()
      requestEvidence.upstreamCompleted = true
      return
    }
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'lia-local-fixture' }] })); return }
    const probe = body?.tools?.some(tool => tool.function?.name === 'lia_connection_check')
    let message = { role: 'assistant', content: 'Resposta sintética de validação local.' }
    if (probe && body.messages.length === 1) message = { role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call', type: 'function', function: { name: 'lia_connection_check', arguments: '{}' } }] }
    else if (probe) message.content = body.messages.at(-1).content
    else if (body?.messages?.some(message => message.role === 'user' && JSON.stringify(message.content)?.includes(handoffPrompt))) message.content = handoffReply
    if (body?.stream) {
      res.setHeader('content-type', 'text/event-stream')
      res.end(`data: ${JSON.stringify({ id: 'fixture-stream', object: 'chat.completion.chunk', choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    } else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message, finish_reason: 'stop' }] })) }
  } catch {
    if (res.headersSent) res.destroy()
    else { res.writeHead(500); res.end() }
  }
})
await new Promise(resolve => service.listen(0, '127.0.0.1', resolve))
const debug = createServer()
await new Promise(resolve => debug.listen(0, '127.0.0.1', resolve))
const debugPort = debug.address().port
await new Promise(resolve => debug.close(resolve))
const launchLauncher = () => _electron.launch({
  executablePath: resolve(repositoryRoot, packaged ? 'lia/desktop/dist/windows/win-unpacked/Lia.exe' : 'airi/apps/stage-tamagotchi/node_modules/electron/dist/electron.exe'),
  args: packaged ? [] : [resolve(repositoryRoot, 'lia/desktop/out/main/index.js')],
  env: { ...process.env, NODE_ENV: 'production', LIA_USER_DATA: `${root}/profile`, APP_USER_DATA_PATH: `${root}/profile`, APP_REMOTE_DEBUG: 'true', APP_REMOTE_DEBUG_PORT: String(debugPort), APP_REMOTE_DEBUG_NO_OPEN: 'true', LIA_DEVFLOW_DIAGNOSTICS: '1' },
})
async function closeLauncher(application) {
  const child = application.process()
  if (child.exitCode !== null || child.signalCode !== null) return
  const deadline = AbortSignal.timeout(30000)
  const exit = once(child, 'exit', { signal: deadline })
  // Playwright's Electron close waits for its connection to close. Observe the
  // OS process directly so the detached Stage cannot keep that wait pending.
  void application.evaluate(({ app }) => { setImmediate(() => app.quit()) }).catch(() => {})
  const [code] = await exit
  if (code !== 0) throw new Error('Launcher did not exit cleanly')
}
async function waitForStageStop(page) {
  await page.waitForFunction(async () => (await window.liaApi.stageState()).phase === 'stopped', undefined, { timeout: 30000 })
  return page.evaluate(async () => {
    const { phase, pid, lastExitCode } = await window.liaApi.stageState()
    return { phase, pid, lastExitCode }
  })
}
let detached = false
try {
  app = await launchLauncher()
  facts.launcherPid = app.process().pid
  let page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Lia', exact: true }).waitFor()
  await page.screenshot({ path: `${root}/captures/01-home.png` })
  if (performance) await collectPerformance('beta-launcher-stage-closed')
  await page.getByRole('button', { name: 'Somente texto', exact: true }).click()
  await page.getByRole('button', { name: /IA & Recursos/ }).click()
  if (keyless) await page.getByRole('button', { name: /^IA local/ }).click()
  await page.getByLabel('Endereço do serviço', { exact: true }).fill(`http://127.0.0.1:${service.address().port}/v1`)
  if (!keyless) await page.locator('#ai-key').fill(secret)
  else if (await page.locator('#ai-key').count()) throw new Error('Local connection displayed an API key field')
  const confirmAddress = page.getByRole('checkbox', { name: 'Confirmo que este endereço pertence ao serviço e que confio nele.' })
  if (!keyless) await confirmAddress.check()
  await page.getByRole('button', { name: 'Salvar conexão', exact: true }).click()
  await page.getByText(keyless ? 'Conexão local salva. Busque e selecione um modelo para continuar.' : 'Conexão salva. A Lia já usa esta seleção.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Buscar modelos disponíveis', exact: true }).click()
  const picker = page.getByLabel('Modelo para conversar', { exact: true })
  if (!selectedModel) {
    const firstModel = picker.locator('option:not([disabled])').first()
    await firstModel.waitFor({ state: 'attached' })
    selectedModel = await firstModel.getAttribute('value')
  }
  if (!selectedModel) throw new Error('Local service offered no model ID')
  await page.getByRole('option', { name: selectedModel, exact: true }).waitFor({ state: 'attached' })
  await picker.selectOption(selectedModel)
  if (!keyless) await confirmAddress.check()
  await page.getByRole('button', { name: 'Salvar conexão', exact: true }).click()
  await page.getByRole('button', { name: 'Testar conexão', exact: true }).click()
  await page.getByText(keyless ? 'Conversa de texto verificada.' : 'Conexão verificada:', { exact: false }).waitFor({ timeout: 35000 })
  facts.steps.push(keyless ? 'PASS Windows Launcher UI keyless save, model discovery and text probe' : 'PASS Windows Launcher UI save/discovery/tool-result/final-reply on synthetic HTTP')
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
  if (performance) await collectPerformance('beta-stage-stationary-animated', 15, facts.stagePid)
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
  if (localEndpoint) {
    // On a fresh profile, the first text block in an assistant response proves
    // an actual model reply reached the chat without assuming fixed wording.
    await chat.locator('.chat-message-item-container .break-words > .markdown-content').filter({ hasText: /\S/ }).first().waitFor({ timeout: 60000 })
    await stage.waitForFunction(() => {
      const store = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('chat')
      return store?.sending === false
    })
    if (!facts.requests.some(request => request.stream && request.correctModel && request.upstreamStatus === 200 && request.upstreamCompleted))
      throw new Error('Local response stream did not finish')
  } else {
    await chat.getByText('Resposta sintética de validação local.', { exact: false }).waitFor({ timeout: 60000 })
  }
  if (keyless && (!facts.requests.every(request => request.credentialPolicyPassed)
    || !facts.requests.some(request => request.path === '/v1/models')
    || !facts.requests.some(request => request.path === '/v1/chat/completions' && !request.stream && request.correctModel)
    || !facts.requests.some(request => request.path === '/v1/chat/completions' && request.stream && request.correctModel)))
    throw new Error('Keyless HTTP discovery, text probe or Stage stream was not observed')
  facts.steps.push(localEndpoint ? 'PASS Windows Stage chat UI -> Main SSE -> visible reply from real local model' : 'PASS Windows Stage chat UI -> Main SSE -> visible synthetic response')
  await chat.screenshot({ path: `${root}/captures/04-chat.png` })
  if (!localEndpoint) {
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
    if (performance) await collectPerformance('beta-text-after-presence-and-chat', 15, facts.stagePid)
    if (soakSeconds) await collectPerformance('beta-continuous-ui-local-fixture', soakSeconds, facts.stagePid)
    if (credentialHandoff) {
      const before = facts.requests.length
      const { createRuntimeRegistry } = await import('../../lia/core/src/runtime/index.ts')
      const registry = createRuntimeRegistry(resolve(root, 'profile/runtime'))
      const original = await registry.read()
      if (!original.ok) throw new Error('Stage runtime identity was not registered')
      detached = true
      await closeLauncher(app)
      app = undefined
      await chat.locator('textarea').fill(handoffPrompt)
      await chat.locator('textarea').press('Enter')
      await chat.getByText(handoffReply, { exact: false }).waitFor({ timeout: 60000 })
      const afterClose = facts.requests.slice(before)
      if (!afterClose.some(request => request.stream && request.credentialPolicyPassed))
        throw new Error('No authenticated Stage response after Launcher exit')
      facts.steps.push('PASS Windows Stage authenticated conversation after Launcher exit')

      app = await launchLauncher()
      page = await app.firstWindow()
      await page.getByRole('heading', { name: 'Lia', exact: true }).waitFor()
      await page.getByRole('button', { name: /Encerrar conversa/ }).waitFor()
      facts.adoptedStage = await page.evaluate(async () => {
        const { phase, pid } = await window.liaApi.stageState()
        return { phase, pid }
      })
      const stillActive = await registry.read()
      if (!stillActive.ok || stillActive.record.instanceId !== original.record.instanceId
        || facts.adoptedStage.phase !== 'running' || facts.adoptedStage.pid !== original.record.pid)
        throw new Error('Launcher did not adopt the same Stage process')
      detached = false
      facts.steps.push('PASS Windows Launcher reopened and adopted the same Stage')
    }
  }
  if (keyless && facts.requests.some(request => !request.credentialPolicyPassed))
    throw new Error('An HTTP request attempted to authenticate to the keyless service')
  await page.getByRole('button', { name: /Encerrar conversa/ }).click()
  facts.stopped = await waitForStageStop(page)
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
  if (app && !facts.stopped) {
    try {
      const page = app.windows()[0]
      const stop = page?.getByRole('button', { name: /Encerrar conversa/ })
      if (stop && await stop.count()) {
        await stop.click()
        facts.stopped = await waitForStageStop(page)
        facts.steps.push('PASS Launcher stop observed during cleanup after component failure')
      }
    } catch { facts.steps.push('FAIL UI cleanup; supervisor close still required') }
  }
  if (detached && !facts.stopped) {
    try {
      const { createRuntimeRegistry, pingRuntime, stopRuntimeCooperatively } = await import('../../lia/core/src/runtime/index.ts')
      const read = await createRuntimeRegistry(resolve(root, 'profile/runtime')).read()
      if (read.ok) {
        const { endpoint, instanceId, publicKey } = read.record
        const target = { endpoint, instanceId, publicKey }
        if ((await pingRuntime(target, 1500)).instanceId !== instanceId) throw new Error('Unexpected Stage identity')
        const result = await stopRuntimeCooperatively({ target, timeoutMs: 15000 })
        facts.detachedCleanup = { stopped: result.stopped, forced: result.forced }
        if (!result.stopped) throw new Error('Detached Stage did not stop')
      }
    } catch { process.exitCode = 1; facts.steps.push('FAIL detached Stage cleanup') }
  }
  if (browser) await browser.close().catch(() => {})
  if (app) await closeLauncher(app).catch(() => { process.exitCode = 1; facts.steps.push('FAIL Launcher cleanup') })
  service.closeAllConnections(); await new Promise(resolve => service.close(resolve))
  const serialized = JSON.stringify(facts, null, 2)
  if (serialized.includes(secret)) throw new Error('Synthetic secret rejected from report')
  await writeFile(`${root}/report.json`, serialized)
  console.log(JSON.stringify({ root, steps: facts.steps, errors: facts.errors }))
}
