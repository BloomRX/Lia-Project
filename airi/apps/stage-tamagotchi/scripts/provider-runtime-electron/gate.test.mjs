import assert from 'node:assert/strict'

import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { _electron as electron } from 'playwright'
import { build } from 'vite'

import { errorText } from './lib/errors.mjs'
import { classifyAll, isSameProcess, parseProcessTable, processTableCommand } from './lib/process-identity.mjs'
import { createPowerShellSnapshot, createProcessMonitor } from './lib/process-monitor.mjs'
import { createGroupRecorder, describeGroups } from './lib/run-groups.mjs'
import { createSecretRegistry, redactionSummary, writeArtifact } from './lib/secret-redaction.mjs'

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

/*
 * Process identity and descendant tracking live in `./lib`, so both are testable
 * on Linux without an Electron host. What remains here is the wiring:
 *
 *   - `snapshot()` reads the live table once, carrying creation stamps;
 *   - one monitor per Electron lifetime samples it continuously, so a child that
 *     starts and exits is no longer invisible between two fixed snapshots;
 *   - `tracked` is the union of every identity ever observed, and the teardown
 *     check classifies all of them by PID **and** creation time.
 *
 * `monitor` is per lifetime; the previous one is stopped before the next launch.
 */
// Playwright launches Electron through cmd.exe on Windows. Keep the wrapper
// and its descendants in the same process table for the teardown proof.
const snapshot = createPowerShellSnapshot({ execFileSync, processName: null })
const execFileAsync = promisify(execFile)
async function asyncSnapshot() {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', processTableCommand(null)], { encoding: 'utf8', windowsHide: true })
  return parseProcessTable(stdout)
}

/** Everything ever observed, across every Electron lifetime in this run. */
const tracked = []

let monitor

/**
 * The report object. Declared here, assigned inside the test, because
 * `settleProcesses()` is module-scoped and reads it.
 */
let report

/**
 * Fold the monitor's observations into `tracked` and mirror them into the
 * report. Deduplicated by identity, so a recycled PID contributes twice — as the
 * two processes it actually was.
 *
 * The report keeps `processes` as plain PIDs for continuity with the previous
 * shape, and adds `processIdentity` with the creation stamps a reviewer needs to
 * replay the teardown reasoning.
 */
function settleProcesses() {
  if (monitor) {
    monitor.rescan()
    for (const identity of monitor.identities()) {
      if (!tracked.some(existing => isSameProcess(existing, identity)))
        tracked.push(identity)
    }
  }
  report.processes = [...new Set(tracked.map(identity => identity.pid))]
  report.processIdentity = tracked.map(identity => ({
    pid: identity.pid,
    createdAt: identity.createdAt === undefined ? 'unknown' : new Date(identity.createdAt).toISOString(),
  }))
  return tracked
}

/**
 * Stop the current lifetime's monitor after taking a last reading.
 *
 * Called before every `application.close()`, so the observations of a lifetime
 * are complete before the processes it tracked disappear.
 */
async function stopMonitor() {
  if (!monitor)
    return
  monitor.stop()
  await monitor.drain()
  settleProcesses()
  report.processTracking ??= []
  report.processTracking.push(monitor.stats())
  monitor = undefined
}

/*
 * How to run this gate (it is not part of any pnpm script on purpose: it needs
 * a machine with a display and the OS keychain):
 *
 *   1. install the runtime from the OFFICIAL package installer, which downloads
 *      the asset matching the locked version and verifies checksums.json:
 *        pnpm --filter @proj-airi/stage-tamagotchi exec node node_modules/electron/install.js
 *      (no version, lockfile or dependency change; `ELECTRON_MIRROR` must point
 *      at an official mirror, never at a third-party host)
 *   2. build the Stage's preload, which the gate reads:
 *        pnpm --filter @proj-airi/stage-tamagotchi build
 *   3. run the gate from the package directory:
 *        node --test scripts/provider-runtime-electron/gate.test.mjs
 *      or, to watch it as a Vitest file, `node --test --test-reporter spec ...`.
 *
 * It skips itself outside Windows because the teardown proof enumerates
 * processes with `Get-CimInstance` and launches `dist/electron.exe`.
 */
test('Electron real: production IPC, encrypted vault and native provider runtime against local HTTP', { skip: process.platform !== 'win32' && 'Requires Windows for the real safeStorage gate', timeout: 180000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-provider-electron-'))
  const artifacts = join(repo, 'Tests/artifacts/provider-runtime-electron', `${Date.now()}`)
  await mkdir(artifacts, { recursive: true })
  const preload = join(stage, 'out/preload/index.mjs')
  await readFile(preload)
  // One synthetic credential per curated provider, plus the two historical
  // scopes the earlier checks already use. Local providers are keyless, exactly
  // as the product treats them.
  const curated = ['openai', 'groq', 'cerebras-ai', 'anthropic', 'xai', 'mistral-ai', 'openrouter-ai', 'openai-compatible', 'lm-studio', 'ollama']
  const keyless = new Set(['lm-studio', 'ollama'])
  const speechProvider = 'openai-audio-speech'
  const secrets = { generic: `synthetic-A-${randomUUID()}`, local: `synthetic-B-${randomUUID()}`, [speechProvider]: `synthetic-speech-${randomUUID()}` }
  for (const id of curated) {
    if (!keyless.has(id))
      secrets[id] = `synthetic-${id}-${randomUUID()}`
  }
  /*
   * One registry for every credential this run mints, built here so no writer
   * can be the one that "forgot a secret": all of them go through it.
   */
  const secretRegistry = createSecretRegistry(secrets)
  const groups = createGroupRecorder()
  report = {
    runId: randomUUID(),
    scope: 'real Electron components + local HTTP fixture; not full Stage or external model',
    preexistingProcesses: [],
    root,
    startedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version, electron: 'unknown', chrome: 'unknown' },
    redaction: redactionSummary(secretRegistry),
    checks: [],
    requests: [],
    processes: [],
    exitCode: null,
  }
  try {
    // Recorded, never fatal: this only says what was already running before the
    // gate started, and a machine with an unrelated Electron open is not a gate
    // failure.
    report.preexistingProcesses = createPowerShellSnapshot({ execFileSync })().map(identity => ({ pid: identity.pid, createdAt: identity.createdAt === undefined ? 'unknown' : new Date(identity.createdAt).toISOString() }))
  }
  catch (error) {
    report.preexistingProcesses = []
    report.preexistingProcessesError = errorText(error)
  }
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
    // The first path segment names the provider under test, so each curated
    // provider is authenticated with its own credential and nothing else.
    const segment = path.split('/')[1]
    const expected = keyless.has(segment) ? undefined : secrets[segment] ?? secrets.generic
    const authorization = request.headers.authorization ?? null
    const entry = {
      path,
      segment,
      model: data.model,
      // Never store the value itself, only whether a header was present.
      authorization: authorization === null ? 'absent' : 'present',
      title: request.headers['x-openrouter-title'] ?? null,
      authenticated: expected ? authorization === `Bearer ${expected}` : authorization === null,
      closed: false,
    }
    report.requests.push(entry)
    response.on('close', () => {
      entry.closed = true
    })
    if (!entry.authenticated) {
      response.writeHead(401, { 'content-type': 'application/json' }).end('{}')
      return
    }
    if (path === `/${speechProvider}/v1/audio/speech`) {
      const valid = data.model === 'fixture-speech' && data.voice === 'fixture-voice' && data.input === 'Olá'
      response.writeHead(valid ? 200 : 400, { 'content-type': 'audio/mpeg' }).end(Uint8Array.of(1, 2, 3))
      return
    }
    if (path.includes('/http-error/')) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: expected } }))
      return
    }
    if (path.includes('/unavailable/')) {
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: expected } }))
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
      report.environment.electron = report.versions.electron
      report.environment.chrome = report.versions.chrome
      /*
       * Start sampling now, not at the next `descendants()` call. Electron
       * spawns zygotes, GPU and utility children within moments of launch, and
       * the point of the monitor is to see the short-lived ones too.
       */
      monitor = createProcessMonitor({ rootPid: applicationProcess.pid, snapshot, asyncSnapshot })
      monitor.start()
      const electronPid = await application.evaluate(() => process.pid)
      assert.ok(monitor.identities().some(identity => identity.pid === electronPid && identity.createdAt !== undefined), 'could not identify the Electron main process')
      report.trackedRoots ??= []
      report.trackedRoots.push(applicationProcess.pid)
      report.processTracking ??= []
      report.processTracking.push({ rootPid: applicationProcess.pid, intervalMs: monitor.stats().intervalMs })
      settleProcesses()
      await page.evaluate(() => {
        window.fetch = async () => {
          throw new Error('Renderer network is forbidden in this security gate')
        }
      })
      return page
    }
    let page = await launch()
    groups.begin(1)
    assert.equal(await page.evaluate(() => window.providerGate.encryptionAvailable()), true)
    await page.evaluate(async ({ generic, local }) => {
      if (!await window.providerGate.seed('openai-compatible', generic) || !await window.providerGate.seed('lm-studio', local))
        throw new Error('Could not seed synthetic fixture credentials')
    }, secrets)
    for (const id of ['openai-compatible', 'lm-studio'])
      assert.equal(await page.evaluate(scope => window.providerGate.readProtectedSecret(scope), id), undefined)
    groups.pass(1, 'raw credential reads are denied; renderer network disabled while real main performs HTTP')
    groups.begin(2)
    const vault = await readFile(join(root, 'profile/lia-secrets.json'), 'utf8')
    assert.ok(!Object.values(secrets).some(value => vault.includes(value)))
    const initialState = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    assert.deepEqual(initialState.readScopes, [])
    groups.pass(2, 'real safeStorage encryption and zero credential reads before operation')

    groups.begin(3)
    const legacyFixture = { id: 'legacy/custom-instance', providerId: 'legacy/custom-instance', definitionId: 'openai-compatible', type: 'http', protocol: 'chat-completions', baseUrl: `${base}/json/v1/`, adapterOptions: { temperature: 0.25, nested: { enabled: true } }, modelIds: ['manual/legacy:Q4'], enabled: true, metadata: {}, credentialRef: { scope: 'legacy/custom-instance', key: 'apiKey' } }
    const oldConfigured = { [legacyFixture.id]: { id: legacyFixture.id, definitionId: legacyFixture.definitionId, config: { baseUrl: legacyFixture.baseUrl, ...legacyFixture.adapterOptions }, status: 'configured', configuredBy: 'user' } }
    const oldCredentials = { 'openai-compatible': { baseUrl: `${base}/old-source/v1/`, legacyFlag: true } }
    const migrated = await page.evaluate(({ configured, credentials, modelIds }) => window.providerGate.migrateLegacy(configured, credentials, modelIds), { configured: oldConfigured, credentials: oldCredentials, modelIds: legacyFixture.modelIds })
    assert.equal(migrated.ok, true)
    assert.deepEqual(migrated.snapshot.records.find(record => record.id === legacyFixture.id), legacyFixture)
    assert.equal(await page.evaluate(scope => window.providerGate.readProtectedSecret(scope), legacyFixture.id), undefined)
    assert.deepEqual(migrated.snapshot.records.find(record => record.id === 'openai-compatible').adapterOptions, { legacyFlag: true })
    const repeated = await page.evaluate(({ record, revision }) => window.providerGate.mutate({ kind: 'migrate', expectedRevision: revision, records: [record] }), { record: legacyFixture, revision: migrated.snapshot.revision })
    assert.deepEqual(repeated, migrated)
    groups.pass(3, 'production decoders import both unversioned legacy shapes preserving IDs, options, model and credential reference; main migration is idempotent')

    groups.begin(4)
    const run = async (mode, button = 'Executar JSON', provider = 'openai-compatible') => {
      await page.getByLabel('Serviço').selectOption(provider)
      await page.getByLabel('Endereço').fill(`${base}/${mode}/v1/`)
      await page.getByLabel('Modelo', { exact: true }).fill('custom/Electron:Q4')
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
    const speechBaseUrl = `${base}/${speechProvider}/v1/`
    const speechBefore = await page.evaluate(id => window.providerGate.speechConfig(id), speechProvider)
    assert.equal(speechBefore.ok, true)
    assert.equal(speechBefore.config.hasKey, false)
    const speechSaved = await page.evaluate(input => window.providerGate.saveSpeechConfig(input), {
      providerId: speechProvider,
      baseUrl: speechBaseUrl,
      apiKey: secrets[speechProvider],
      revision: speechBefore.config.revision,
    })
    assert.deepEqual(speechSaved, { ok: true, config: { baseUrl: speechBaseUrl, hasKey: true, revision: speechBefore.config.revision + 1 } })
    assert.deepEqual(await page.evaluate(id => window.providerGate.speechConfig(id), speechProvider), speechSaved)
    assert.equal(await page.evaluate(id => window.providerGate.readProtectedSecret(id), speechProvider), undefined)
    assert.deepEqual(await page.evaluate(({ providerId, baseUrl }) => window.providerGate.synthesizeFixtureSpeech(providerId, baseUrl), { providerId: speechProvider, baseUrl: speechBaseUrl }), [1, 2, 3])
    assert.equal(report.requests.at(-1).authenticated, true)
    groups.pass(4, 'JSON, SSE, discovery, custom model, separate credentials and Main-native speech bytes')

    groups.begin(5)
    const secondWindowId = await application.evaluate(async ({ BrowserWindow }, preloadPath) => {
      const first = BrowserWindow.getAllWindows()[0]
      const second = new BrowserWindow({ show: true, webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false } })
      await second.loadURL(first.webContents.getURL())
      return second.id
    }, preload)
    const secondPage = application.windows().find(window => window !== page)
    assert.ok(secondPage)
    secondPage.on('pageerror', () => {
      report.secondRendererError = true
    })
    report.secondRenderer = await secondPage.evaluate(() => ({ bridge: typeof window.electron?.ipcRenderer, status: document.querySelector('#status')?.textContent }))
    await secondPage.getByRole('status').filter({ hasText: 'Pronto' }).waitFor()
    const prior = await page.evaluate(() => window.providerGate.transports())
    assert.equal(prior.ok, true)
    const firstRecord = prior.snapshot.records.find(record => record.id === 'openai-compatible')
    const concurrent = await Promise.all([
      page.evaluate(({ record, revision }) => window.providerGate.mutate({ kind: 'put', expectedRevision: revision, record: { ...record, metadata: { label: 'Janela A' } } }), { record: firstRecord, revision: prior.snapshot.revision }),
      secondPage.evaluate(({ record, revision }) => window.providerGate.mutate({ kind: 'put', expectedRevision: revision, record: { ...record, metadata: { label: 'Janela B' } } }), { record: firstRecord, revision: prior.snapshot.revision }),
    ])
    assert.equal(concurrent.filter(reply => reply.ok).length, 1)
    assert.equal(concurrent.find(reply => !reply.ok).code, 'conflict')
    const left = await page.evaluate(() => window.providerGate.transports())
    const right = await secondPage.evaluate(() => window.providerGate.transports())
    assert.deepEqual(left, right)
    settleProcesses()
    await application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).close(), secondWindowId)
    groups.pass(5, 'two real renderers share main authority and reject stale concurrent writes')

    // ── curated provider matrix ────────────────────────────────────────────
    // Ten records, each with its own synthetic credential (or none, for the
    // keyless local providers), each executed against its own local endpoint.
    // Main resolves the credential; the renderer only sees response bytes.
    groups.begin(6)
    const models = Object.fromEntries(curated.map((id, index) => [id, `fixture/${id}:Q4-${index}`]))
    assert.equal(await page.evaluate(() => window.providerGate.clearFixtureKey('lm-studio')), true)
    for (const id of curated.filter(item => !keyless.has(item))) {
      if (!await page.evaluate(({ scope, value }) => window.providerGate.seed(scope, value), { scope: id, value: secrets[id] }))
        throw new Error(`Could not seed a synthetic credential for ${id}`)
    }
    const seededIds = await page.evaluate(entries => window.providerGate.seedRecords(entries), curated.map(id => ({ providerId: id, baseUrl: `${base}/${id}/v1/`, model: models[id] })))
    for (const id of curated)
      assert.ok(seededIds.includes(id), `no transport record was stored for ${id}`)
    // A raw read must stay denied for every curated scope, with a record or not.
    for (const id of curated)
      assert.equal(await page.evaluate(scope => window.providerGate.readProtectedSecret(scope), id), undefined)

    const matrixResults = []
    for (const id of curated) {
      const result = await page.evaluate(({ id, model }) => window.providerGate.executeProvider(id, model, 'json'), { id, model: models[id] })
      assert.deepEqual(result, { phase: 'done', code: '', text: 'Electron Lia\n42' }, `${id} did not complete over its own endpoint`)
      matrixResults.push(result)
    }
    for (const id of curated) {
      const request = report.requests.find(entry => entry.path === `/${id}/v1/chat/completions`)
      assert.ok(request, `main never reached the local endpoint of ${id}`)
      assert.equal(request.model, models[id], `${id} sent a different model than its record`)
      assert.equal(request.authorization, keyless.has(id) ? 'absent' : 'present', `${id} credential header mismatch`)
      // The Lia title header belongs to OpenRouter alone.
      assert.equal(request.title, id === 'openrouter-ai' ? 'Lia' : null, `${id} leaked a service-specific header`)
    }
    for (const id of curated) {
      const streamed = await page.evaluate(({ id, model }) => window.providerGate.executeProvider(id, model, 'stream'), { id, model: models[id] })
      assert.deepEqual(streamed, { phase: 'done', code: '', text: 'Electron Lia\n42' }, `${id} did not stream over its own endpoint`)
    }
    const matrixState = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    for (const id of curated.filter(item => !keyless.has(item)))
      assert.ok(matrixState.readScopes.includes(id), `main did not read the vault for ${id}`)
    assert.ok(!curated.some(id => JSON.stringify(matrixResults).includes(secrets[id] ?? '\u0000')))
    groups.pass(6, 'ten curated providers resolve their own credential in main, address their own endpoint and stream without touching renderer state')

    // Concurrency: five providers at once, each on its own channel.
    groups.begin(7)
    const parallelIds = ['openai', 'cerebras-ai', 'anthropic', 'mistral-ai', 'ollama']
    const parallel = await page.evaluate(entries => window.providerGate.concurrent(entries), parallelIds.map(id => ({ providerId: id, model: models[id] })))
    for (const result of parallel) {
      assert.equal(result.code, '', `${result.providerId} failed while running concurrently`)
      assert.equal(result.text, 'Electron Lia\n42', `${result.providerId} received another provider response`)
    }
    for (const id of parallelIds) {
      const request = report.requests.filter(entry => entry.path === `/${id}/v1/chat/completions`).at(-1)
      assert.equal(request.model, models[id])
    }
    groups.pass(7, 'concurrent curated executions stay isolated per provider')

    // A 503 body is never surfaced, not even its error text.
    groups.begin(8)
    await page.evaluate(entries => window.providerGate.seedRecords(entries), [{ providerId: 'xai', baseUrl: `${base}/xai/unavailable/v1/`, model: models.xai }])
    const unavailable = await page.evaluate(({ id, model }) => window.providerGate.executeProvider(id, model, 'json'), { id: 'xai', model: models.xai })
    assert.equal(unavailable.phase, 'error')
    assert.equal(unavailable.code, 'http')
    assert.ok(!JSON.stringify(unavailable).includes(secrets.xai))
    groups.pass(8, 'an invalid curated response fails with a sanitized class only')

    groups.begin(9)
    // Cancellation on a curated endpoint releases the socket.
    await page.evaluate(entries => window.providerGate.seedRecords(entries), [{ providerId: 'groq', baseUrl: `${base}/groq/cancel/v1/`, model: models.groq }])
    const curatedCancel = page.evaluate(({ id, model }) => window.providerGate.executeProvider(id, model, 'stream'), { id: 'groq', model: models.groq })
    await waitUntil(() => report.requests.some(entry => entry.path === '/groq/cancel/v1/chat/completions'), 'curated cancel request was not observed')
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.equal((await curatedCancel).code, 'cancelled')
    await waitUntil(() => report.requests.find(entry => entry.path === '/groq/cancel/v1/chat/completions').closed, 'curated cancel did not release the real HTTP response')
    groups.pass(9, 'cancellation on a curated provider closes the real HTTP response')

    groups.begin(10)
    // A disposed port refuses new work instead of silently re-opening a channel.
    const disposed = await page.evaluate(({ id, model }) => window.providerGate.disposeAndExecute(id, model), { id: 'ollama', model: models.ollama })
    assert.equal(disposed.phase, 'error')
    assert.equal(disposed.code, 'cancelled')
    groups.pass(10, 'a disposed execution port refuses further curated sends')

    groups.begin(11)
    for (const [id, value] of [['openai-compatible', secrets.generic], ['lm-studio', secrets.local]]) {
      if (!await page.evaluate(({ scope, value }) => window.providerGate.seed(scope, value), { scope: id, value }))
        throw new Error(`Could not restore a synthetic fixture credential for ${id}`)
    }
    const stateBeforeDisable = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    await page.getByLabel('Serviço').selectOption('openai-compatible')
    const changed = await page.evaluate(async () => {
      const state = await window.providerGate.transports()
      if (!state.ok)
        throw new Error('Repository unavailable')
      const record = state.snapshot.records.find(item => item.id === 'openai-compatible')
      if (!record)
        throw new Error('Record unavailable')
      return window.providerGate.mutate({ kind: 'put', expectedRevision: state.snapshot.revision, record: { ...record, enabled: false } })
    })
    assert.equal(changed.ok, true)
    const requestsBeforeDisable = report.requests.length
    assert.equal((await page.evaluate(() => window.providerGate.executeStored())).code, 'configuration')
    assert.equal(report.requests.length, requestsBeforeDisable)
    const blockedState = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    assert.deepEqual(blockedState.readScopes, stateBeforeDisable.readScopes)
    const removed = await page.evaluate(async () => {
      const state = await window.providerGate.transports()
      if (!state.ok)
        throw new Error('Repository unavailable')
      return window.providerGate.mutate({ kind: 'remove', expectedRevision: state.snapshot.revision, id: 'openai-compatible' })
    })
    assert.equal(removed.ok, true)
    assert.equal(await page.evaluate(() => window.providerGate.readProtectedSecret('openai-compatible')), undefined)
    assert.equal((await page.evaluate(() => window.providerGate.executeStored())).code, 'configuration')
    assert.equal(report.requests.length, requestsBeforeDisable)
    const removedState = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    assert.deepEqual(removedState.readScopes, stateBeforeDisable.readScopes)
    const replay = await page.evaluate(({ record, revision }) => window.providerGate.mutate({ kind: 'migrate', expectedRevision: revision, records: [record] }), { record: firstRecord, revision: removed.snapshot.revision })
    assert.equal(replay.ok, true)
    assert.ok(!replay.snapshot.records.some(record => record.id === 'openai-compatible'))
    groups.pass(11, 'disable and remove block execution; migration cannot resurrect a tombstone; vault credentials retained')
    groups.begin(12)
    assert.equal((await run('empty')).code, 'empty')
    const failed = await run('http-error')
    assert.equal(failed.phase, 'error')
    assert.equal(failed.code, 'credentials')
    assert.ok(!Object.values(secrets).some(value => JSON.stringify(failed).includes(value)))
    assert.equal((await run('sse-error', 'Executar streaming')).code, 'protocol')
    groups.pass(12, 'empty, HTTP and SSE errors are safe and terminal')

    groups.begin(13)
    await page.getByLabel('Endereço').fill(`${base}/cancel/v1/`)
    await page.getByRole('button', { name: 'Executar streaming', exact: true }).click()
    await waitUntil(() => report.requests.some(entry => entry.path.includes('/cancel/')), 'cancel request was not observed')
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    const cancelled = await page.evaluate(() => window.providerGate.wait())
    assert.equal(cancelled.phase, 'error')
    assert.equal(cancelled.code, 'cancelled')
    await waitUntil(() => report.requests.find(entry => entry.path.includes('/cancel/')).closed, 'cancel did not release the real HTTP response')
    groups.pass(13, 'caller cancellation closes HTTP response and reaches terminal UI')

    groups.begin(14)
    const timeoutStart = Date.now()
    const timedOut = await run('timeout')
    assert.equal(timedOut.phase, 'error')
    assert.equal(timedOut.code, 'timeout')
    report.timeoutElapsedMs = Date.now() - timeoutStart
    await waitUntil(() => report.requests.find(entry => entry.path.includes('/timeout/')).closed, 'timeout did not release HTTP response')
    groups.pass(14, 'production default timeout reaches terminal UI and closes HTTP response')

    groups.begin(15)
    await run('local', 'Executar JSON', 'lm-studio')
    await page.screenshot({ path: join(artifacts, 'electron.png') })
    await waitUntil(async () => {
      try {
        const product = JSON.parse(await readFile(join(root, 'profile/lia-product.json'), 'utf8'))
        return product.provider.chat.preferred.modelId === 'custom/Electron:Q4' && product.provider.chat.preferred.providerId === 'lm-studio'
      }
      catch { return false }
    }, 'production config did not persist')
    settleProcesses()
    const product = await readFile(join(root, 'profile/lia-product.json'), 'utf8')
    const transports = await readFile(join(root, 'profile/lia-transports.json'), 'utf8')
    const rendererState = await page.evaluate(() => JSON.stringify({ html: document.body.textContent, storage: { ...localStorage } }))
    assert.ok(!Object.values(secrets).some(value => product.includes(value) || transports.includes(value) || rendererState.includes(value)))
    assert.ok(!curated.some(id => rendererState.includes(secrets[id] ?? '\u0000')))
    await application.close()
    report.exitCode = applicationProcess.exitCode
    assert.equal(report.exitCode, 0)
    await stopMonitor()
    page = await launch()
    const restored = await page.evaluate(() => window.providerGate.config())
    assert.equal(restored.preferred.modelId, 'custom/Electron:Q4')
    assert.equal(restored.preferred.providerId, 'lm-studio')
    const restoredTransports = await page.evaluate(() => window.providerGate.transports())
    assert.equal(restoredTransports.ok, true)
    const restoredLocal = restoredTransports.snapshot.records.find(record => record.id === 'lm-studio')
    assert.equal(restoredLocal.baseUrl, `${base}/local/v1/`)
    assert.deepEqual(restoredLocal.modelIds, ['custom/Electron:Q4'])
    // Change the visible draft without saving. Execution must retain the main
    // repository endpoint, rather than reading renderer form state.
    await page.getByLabel('Endereço').fill(`${base}/wrong-unsaved/v1/`)
    assert.equal((await page.evaluate(() => window.providerGate.executeStored())).phase, 'done')
    assert.equal(report.requests.at(-1).path, '/local/v1/chat/completions')
    assert.equal((await run('json')).phase, 'done')
    assert.equal(report.requests.at(-1).authenticated, true)
    groups.pass(15, 'real application restart restores product model and decrypts stored key')

    groups.begin(16)
    await page.getByLabel('Endereço').fill(`${base}/crash/v1/`)
    await page.getByRole('button', { name: 'Executar streaming', exact: true }).click()
    await waitUntil(() => report.requests.some(entry => entry.path.includes('/crash/')), 'crash request was not observed')
    settleProcesses()
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
    await waitUntil(() => report.requests.find(entry => entry.path.includes('/crash/')).closed, 'renderer crash did not release HTTP response')
    const crashed = JSON.parse(await readFile(join(root, 'main-state.json'), 'utf8'))
    assert.ok(crashed.rendererGone.length > 0)
    settleProcesses()
    await application.close()
    closed = true
    await stopMonitor()
    report.exitCode = applicationProcess.exitCode
    assert.equal(report.exitCode, 0)
    assert.ok(report.requests.every(entry => entry.authenticated && entry.closed))

    /*
     * Teardown by identity, not by PID.
     *
     * A bare PID probe used to answer "is any process using this number?", which
     * a recycled PID makes true for a process that is long gone. Here every
     * observation is checked against the live table by PID **and** creation
     * time, and a table that cannot be read yields `unknown` — never `gone`.
     */
    const finalProcessCheck = () => {
      let live
      try {
        live = snapshot()
      }
      catch (error) {
        live = undefined
        report.processSnapshotError = errorText(error)
      }
      const verdict = classifyAll({ processes: tracked, live })
      report.finalProcessCheck = {
        alive: verdict.alive.map(entry => entry.pid),
        gone: verdict.gone.length,
        unknown: verdict.unknown.map(entry => ({ pid: entry.pid, reason: entry.reason })),
        unverifiable: verdict.unverifiable,
        roles: { roots: report.trackedRoots ?? [], descendants: verdict.classified.filter(entry => entry.role === 'descendant').length },
      }
      return verdict
    }
    await waitUntil(
      () => {
        const verdict = finalProcessCheck()
        return verdict.alive.length === 0 && verdict.unknown.length === 0
      },
      'a gate Electron process remained alive, or its shutdown could not be confirmed (see report.finalProcessCheck)',
      20_000,
    )
    const settled = finalProcessCheck()
    assert.equal(settled.alive.length, 0, `still alive: ${settled.alive.map(entry => entry.pid).join(', ')}`)
    // Requirement: an unverifiable shutdown is not a pass. Name the reason.
    assert.equal(
      settled.unknown.length,
      0,
      `shutdown unconfirmed: ${settled.unknown.map(entry => `${entry.pid} (${entry.reason})`).join('; ')}`,
    )
    assert.ok(!Object.values(secrets).some(value => logs.includes(value)))
    groups.pass(16, 'unexpected renderer exit releases request; owned Electron processes terminate by identity; no secret in logs')
    report.result = 'PASS Electron components with local HTTP fixture'
    t.diagnostic(`Evidence: ${artifacts}`)
  }
  catch (error) {
    /*
     * Attribute the failure to the group that was running.
     *
     * Without this, a failure in group 7 and a failure in group 12 both left a
     * short `checks` array, and the only way to tell them apart was to count the
     * entries by heart. The group number is recorded, the remaining groups stay
     * `not-run`, and the report says so in words.
     */
    const running = groups.summary().groups.find(group => group.status === 'running')
    groups.fail(running?.id, errorText(error))
    report.failure = {
      group: running?.id ?? null,
      message: errorText(error),
      name: error instanceof Error ? error.name : 'Error',
      // The stack can name internal paths; it is redacted like everything else.
      stack: error instanceof Error ? error.stack : undefined,
    }
    // A failing group can never coexist with a PASS verdict.
    report.result = `FAIL${running ? ` in group ${running.id}` : ''}`
    throw error
  }
  finally {
    await stopMonitor()
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
    /*
     * Every value, not two of them. The old code substituted `generic` and
     * `local` only, so the eight per-provider keys survived into the log — and
     * because this block runs on the failure path, that was exactly when the log
     * was written.
     *
     * `writeArtifact` redacts and then refuses to write anything that still
     * carries a registered value, so a bug in redaction cannot leak by omission.
     */
    report.logSecretsAbsent = secretRegistry.findLeaks(logs).length === 0
    const groupSummary = groups.summary()
    report.groups = groupSummary
    report.groupsDescription = describeGroups(groupSummary)
    // Continuity with the previous shape: `checks` keeps one line per group
    // that actually passed, taken from the text the gate recorded.
    report.checks = groupSummary.groups
      .filter(group => group.status === 'passed')
      .map(group => group.detail ?? group.title)
    if (!groupSummary.complete && !report.result?.startsWith('FAIL'))
      report.result = 'FAIL groups incomplete'
    try {
      const reportWrite = await writeArtifact({ writeFile, join }, artifacts, 'report.json', report, secretRegistry)
      const logWrite = await writeArtifact({ writeFile, join }, artifacts, 'electron.log', logs, secretRegistry)
      report.artifactsWritten = { report: reportWrite.redacted, log: logWrite.redacted }
    }
    catch (error) {
      // The one case where no artifact may be written at all: the payload still
      // held a credential after redaction. Leave a marker instead of the file.
      report.artifactWriteError = errorText(error)
      process.exitCode = 1
      await writeFile(join(artifacts, 'ARTIFACTS-WITHHELD.txt'), 'An artifact was withheld because redaction did not remove a registered credential.\nNo credential was written. Inspect the gate run directly.\n')
    }
  }
})
