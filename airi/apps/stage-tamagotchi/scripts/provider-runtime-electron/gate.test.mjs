import assert from 'node:assert/strict'

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'
import { build } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const stage = resolve(here, '../..')
const repo = resolve(stage, '../../..')

async function waitUntil(predicate, label, milliseconds = 5000) {
  const end = Date.now() + milliseconds
  while (!await predicate()) {
    assert.ok(Date.now() < end, label)
    await new Promise(done => setTimeout(done, 25))
  }
}

function exists(pid) {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    return error.code !== 'ESRCH'
  }
}

function electronProcesses() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$rows = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select-Object ProcessId,ParentProcessId); ConvertTo-Json -InputObject $rows -Compress`], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(output)
}

function descendants(rootPid) {
  const processes = electronProcesses()
  const owned = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const entry of processes) {
      if (owned.has(entry.ParentProcessId) && !owned.has(entry.ProcessId)) {
        owned.add(entry.ProcessId)
        changed = true
      }
    }
  }
  return [...owned]
}

test('Electron real: production IPC, encrypted vault and native provider runtime against local HTTP', { skip: process.platform !== 'win32' && 'Requires Windows for the real safeStorage gate', timeout: 180000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-provider-electron-'))
  const artifacts = join(repo, 'Tests/artifacts/provider-runtime-electron', `${Date.now()}`)
  await mkdir(artifacts, { recursive: true })
  const preload = join(stage, 'out/preload/index.mjs')
  await readFile(preload)
  const secrets = { generic: `synthetic-A-${randomUUID()}`, local: `synthetic-B-${randomUUID()}` }
  const report = { preexistingProcesses: electronProcesses(), scope: 'real Electron components + local HTTP fixture; not full Stage or external model', root, startedAt: new Date().toISOString(), checks: [], requests: [], processes: [], exitCode: null }
  let logs = ''
  let application
  let applicationProcess
  let closed = false
  const sockets = new Set()
  const server = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'authorization, content-type')
    response.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    let body = ''
    for await (const chunk of request)
      body += chunk.toString()
    const data = body ? JSON.parse(body) : {}
    const path = request.url
    const expected = path.startsWith('/local/') ? secrets.local : secrets.generic
    const entry = { path, model: data.model, authenticated: request.headers.authorization === `Bearer ${expected}`, closed: false }
    report.requests.push(entry)
    response.on('close', () => {
      entry.closed = true
    })
    if (!entry.authenticated) {
      response.writeHead(401, { 'content-type': 'application/json' }).end('{}')
      return
    }
    if (path.includes('/http-error/')) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: expected } }))
      return
    }
    if (path.includes('/timeout/'))
      return
    if (path.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'custom/Electron:Q4' }] }))
      return
    }
    if (!data.stream) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: path.includes('/empty/') ? '' : 'Electron Lia\n42' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    if (path.includes('/sse-error/')) {
      response.end(`data: ${JSON.stringify({ error: { message: expected } })}\n\n`)
      return
    }
    response.write(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { content: 'Electron ' }, finish_reason: null }] })}\n\n`)
    if (path.includes('/cancel/') || path.includes('/crash/'))
      return
    response.end(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { content: 'Lia\n42' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = server.address().port
    const base = `http://127.0.0.1:${port}`
    await build({ configFile: false, root: stage, logLevel: 'warn', ssr: { noExternal: true }, build: {
      ssr: join(here, 'main.ts'),
      outDir: root,
      emptyOutDir: false,
      rolldownOptions: { external: ['electron', /^node:/], output: { format: 'cjs', entryFileNames: 'main.cjs' } },
    } })
    await build({ configFile: false, root: here, base: './', logLevel: 'warn', build: { outDir: join(root, 'renderer'), emptyOutDir: false } })
    const env = { ...process.env, LIA_PROVIDER_GATE_DIR: root, LIA_PROVIDER_GATE_PRELOAD: preload }
    delete env.ELECTRON_RUN_AS_NODE
    const launch = async () => {
      application = await electron.launch({ executablePath: join(stage, 'node_modules/electron/dist/electron.exe'), args: [join(root, 'main.cjs')], cwd: stage, env })
      applicationProcess = application.process()
      applicationProcess.stdout?.on('data', (data) => {
        logs += data.toString()
      })
      applicationProcess.stderr?.on('data', (data) => {
        logs += data.toString()
      })
      const page = await application.firstWindow()
      page.on('console', (message) => {
        logs += `${message.type()}: ${message.text()}\n`
      })
      await page.getByRole('status').filter({ hasText: 'Pronto' }).waitFor()
      const security = await application.evaluate(({ app, BrowserWindow }) => ({ userData: app.getPath('userData'), windows: BrowserWindow.getAllWindows().map(window => ({ contextIsolation: window.webContents.getLastWebPreferences().contextIsolation, nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration, webSecurity: window.webContents.getLastWebPreferences().webSecurity })), pids: app.getAppMetrics().map(metric => metric.pid) }))
      assert.equal(security.userData, join(root, 'profile'))
      assert.ok(security.windows.every(window => window.contextIsolation && !window.nodeIntegration && window.webSecurity !== false))
      report.versions = await application.evaluate(() => ({ electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome }))
      report.processes.push(...security.pids)
      return page
    }
    let page = await launch()
    assert.equal(await page.evaluate(() => window.providerGate.encryptionAvailable()), true)
    await page.evaluate(async ({ generic, local }) => {
      if (!await window.providerGate.seed('openai-compatible', generic) || !await window.providerGate.seed('lm-studio', local))
        throw new Error('Could not seed synthetic fixture credentials')
    }, secrets)
    const vault = await readFile(join(root, 'profile/lia-secrets.json'), 'utf8')
    assert.ok(!Object.values(secrets).some(value => vault.includes(value)))
    const initialState = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    assert.deepEqual(initialState.readScopes, [])
    report.checks.push('real safeStorage encryption and zero credential reads before operation')

    const run = async (mode, button = 'Executar JSON', provider = 'openai-compatible') => {
      await page.getByLabel('Serviço').selectOption(provider)
      await page.getByLabel('Endereço').fill(`${base}/${mode}/v1/`)
      await page.getByRole('button', { name: button, exact: true }).click()
      return page.evaluate(() => window.providerGate.wait())
    }
    assert.deepEqual(await run('json'), { phase: 'done', code: '', text: 'Electron Lia\n42' })
    assert.deepEqual(await run('stream', 'Executar streaming'), { phase: 'done', code: '', text: 'Electron Lia\n42' })
    assert.equal((await run('json', 'Descobrir')).phase, 'done')
    assert.deepEqual(await run('local', 'Executar JSON', 'lm-studio'), { phase: 'done', code: '', text: 'Electron Lia\n42' })
    assert.ok(report.requests.every(entry => entry.authenticated))
    assert.ok(report.requests.filter(entry => entry.model).every(entry => entry.model === 'custom/Electron:Q4'))
    const operationState = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    assert.deepEqual(operationState.readScopes, ['openai-compatible', 'openai-compatible', 'openai-compatible', 'lm-studio'])
    report.checks.push('JSON, SSE, discovery, custom model and separate provider credentials')
    assert.equal((await run('empty')).code, 'empty')
    const failed = await run('http-error')
    assert.equal(failed.phase, 'error')
    assert.equal(failed.code, 'credentials')
    assert.ok(!Object.values(secrets).some(value => JSON.stringify(failed).includes(value)))
    assert.equal((await run('sse-error', 'Executar streaming')).code, 'protocol')
    report.checks.push('empty, HTTP and SSE errors are safe and terminal')

    await page.getByLabel('Endereço').fill(`${base}/cancel/v1/`)
    await page.getByRole('button', { name: 'Executar streaming', exact: true }).click()
    await waitUntil(() => report.requests.some(entry => entry.path.includes('/cancel/')), 'cancel request was not observed')
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    const cancelled = await page.evaluate(() => window.providerGate.wait())
    assert.equal(cancelled.phase, 'error')
    assert.equal(cancelled.code, 'cancelled')
    await waitUntil(() => report.requests.find(entry => entry.path.includes('/cancel/')).closed, 'cancel did not release the real HTTP response')
    report.checks.push('caller cancellation closes HTTP response and reaches terminal UI')

    const timeoutStart = Date.now()
    const timedOut = await run('timeout')
    assert.equal(timedOut.phase, 'error')
    assert.equal(timedOut.code, 'timeout')
    report.timeoutElapsedMs = Date.now() - timeoutStart
    await waitUntil(() => report.requests.find(entry => entry.path.includes('/timeout/')).closed, 'timeout did not release HTTP response')
    report.checks.push('production default timeout reaches terminal UI and closes HTTP response')

    await run('local', 'Executar JSON', 'lm-studio')
    await page.screenshot({ path: join(artifacts, 'electron.png') })
    await waitUntil(async () => {
      try {
        const product = JSON.parse(await readFile(join(root, 'profile/lia-product.json'), 'utf8'))
        return product.provider.chat.preferred.modelId === 'custom/Electron:Q4' && product.provider.chat.preferred.providerId === 'lm-studio'
      }
      catch { return false }
    }, 'production config did not persist')
    report.processes.push(...descendants(applicationProcess.pid))
    const product = await readFile(join(root, 'profile/lia-product.json'), 'utf8')
    const rendererState = await page.evaluate(() => JSON.stringify({ html: document.body.textContent, storage: { ...localStorage } }))
    assert.ok(!Object.values(secrets).some(value => product.includes(value) || rendererState.includes(value)))
    await application.close()
    report.exitCode = applicationProcess.exitCode
    assert.equal(report.exitCode, 0)
    page = await launch()
    const restored = await page.evaluate(() => window.providerGate.config())
    assert.equal(restored.preferred.modelId, 'custom/Electron:Q4')
    assert.equal(restored.preferred.providerId, 'lm-studio')
    assert.equal((await run('json')).phase, 'done')
    assert.equal(report.requests.at(-1).authenticated, true)
    report.checks.push('real application restart restores product model and decrypts stored key')

    await page.getByLabel('Endereço').fill(`${base}/crash/v1/`)
    await page.getByRole('button', { name: 'Executar streaming', exact: true }).click()
    await waitUntil(() => report.requests.some(entry => entry.path.includes('/crash/')), 'crash request was not observed')
    report.processes.push(...descendants(applicationProcess.pid))
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
    await waitUntil(() => report.requests.find(entry => entry.path.includes('/crash/')).closed, 'renderer crash did not release HTTP response')
    const crashed = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    assert.ok(crashed.rendererGone.length > 0)
    report.processes.push(...descendants(applicationProcess.pid))
    await application.close()
    closed = true
    report.exitCode = applicationProcess.exitCode
    assert.equal(report.exitCode, 0)
    assert.ok(report.requests.every(entry => entry.authenticated && entry.closed))
    await waitUntil(() => [...new Set(report.processes)].every(pid => !exists(pid)), 'a gate Electron process remained alive')
    assert.ok(!Object.values(secrets).some(value => logs.includes(value)))
    report.checks.push('unexpected renderer exit releases request; owned Electron processes terminate; no secret in logs')
    report.result = 'PASS Electron components with local HTTP fixture'
    t.diagnostic(`Evidence: ${artifacts}`)
  }
  finally {
    if (application && !closed) {
      try {
        await application.close()
      }
      catch {
        report.cleanupError = 'Electron application.close failed'
        report.result = 'FAIL cleanup'
        process.exitCode = 1
      }
    }
    for (const socket of sockets)
      socket.destroy()
    server.closeAllConnections()
    if (server.listening) {
      server.close()
      await once(server, 'close')
    }
    report.finishedAt = new Date().toISOString()
    report.logSecretsAbsent = !Object.values(secrets).some(value => logs.includes(value))
    await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2))
    await writeFile(join(artifacts, 'electron.log'), logs.replaceAll(secrets.generic, '[REDACTED]').replaceAll(secrets.local, '[REDACTED]'))
  }
})
