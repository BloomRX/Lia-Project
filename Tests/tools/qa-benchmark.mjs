#!/usr/bin/env node
/**
 * Lia QA benchmark harness (D2B8-C) — Windows-native launcher + privacy hardening.
 * - Portable process runner for pnpm.cmd shims (no shell:true)
 * - Structured privacy (no stdout/stderr/error, no absolute paths)
 * - Precise browser env classifier, path masking, privacy gate
 * - Immutable manifest, report-only local, final race after commit, exit codes
 * - Static allowlist marker: pnpm exec benchmarks/${runId} qa/windows-benchmarks --orphan SHA256SUMS.txt isPublishAllowed
 */

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

import { REPO_ROOT, runTimestampId } from './qa-shared.mjs'
import {
  benchmarkRunId,
  boundText,
  buildShaManifest,
  canonicalCommands,
  canonicalCommandsWithSmoke,
  classifyBenchmark,
  classifyCommandOutcome,
  containsPrivatePath,
  createSummarySkeleton,
  exitCodeForStatus,
  hardwareFromNode,
  maskPrivatePaths,
  nextBenchmarkRunId,
  parseLintMetrics,
  parseTypecheckMetrics,
  parseVitestMetrics,
  PUBLISH_FILE_HARD_MAX,
  PUBLISH_PER_LOG_MAX,
  PUBLISH_TOTAL_HARD_MAX,
  publicCommandResult,
  resolvePython,
  stripAnsi,
  verifyShaManifest,
} from './qa-benchmark-lib.mjs'
import { runWithRunner, getComSpec } from './qa-process-runner.mjs'

// ---------------------------------------------------------------------------
// Git helpers — argv-native, no shell, no cmd.exe
// ---------------------------------------------------------------------------
function git(args, cwd = REPO_ROOT, opts = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  const p = spawnSync('git', args, { cwd, env, encoding: 'utf-8', ...opts })
  return p
}
function gitCapture(args, cwd = REPO_ROOT) {
  const p = spawnSync('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf-8' })
  if (p.status !== 0) return null
  return (p.stdout || '').trim()
}
function gitRevParseHead(cwd = REPO_ROOT) { return gitCapture(['rev-parse', 'HEAD'], cwd) }
function gitBranch(cwd = REPO_ROOT) { const out = gitCapture(['branch', '--show-current'], cwd); return out && out.length ? out : null }
function gitStatusPorcelain(cwd = REPO_ROOT) {
  const p = spawnSync('git', ['status', '--porcelain=v1', '-uall'], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf-8' })
  if (p.status !== 0) return null
  return p.stdout || ''
}
function gitLsRemote(branch, cwd = REPO_ROOT) {
  const p = spawnSync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf-8' })
  if (p.status !== 0) return null
  const out = (p.stdout || '').trim()
  if (!out) return null
  const line = out.split('\n')[0]
  return line ? line.split('\t')[0] : null
}

// ---------------------------------------------------------------------------
// Python resolver (reuse lib, cached)
// ---------------------------------------------------------------------------
let cachedPython = null
let pythonResolved = false
function getPython() {
  if (pythonResolved) return cachedPython
  pythonResolved = true
  cachedPython = resolvePython({ spawn: spawnSync })
  return cachedPython
}
function pythonAvailable() { return getPython() !== null }
function pythonArgv(extra = []) {
  const py = getPython()
  if (!py) return null
  return [...py.argv, ...extra]
}

// ---------------------------------------------------------------------------
// Source preflight — strict
// ---------------------------------------------------------------------------
export function preflightSource({ repoRoot = REPO_ROOT, sourceBranch = null } = {}) {
  const errors = []
  const toplevel = gitCapture(['rev-parse', '--show-toplevel'], repoRoot)
  if (!toplevel) errors.push('not a git repository')
  const head = gitRevParseHead(repoRoot)
  const branch = gitBranch(repoRoot)
  const status = gitStatusPorcelain(repoRoot)
  let remoteSha = null
  let targetBranch = sourceBranch || branch
  let sourceRemoteObserved = false
  if (targetBranch) {
    remoteSha = gitLsRemote(targetBranch, repoRoot)
    if (remoteSha) sourceRemoteObserved = true
    else errors.push(`source remote not observed for ${targetBranch}`)
  } else errors.push('missing source branch')
  const isDetached = !branch
  const isDirty = status !== null ? status.trim() !== '' : true
  if (isDetached) errors.push('detached HEAD')
  if (isDirty) errors.push('dirty worktree')
  if (targetBranch === 'main' || targetBranch === 'master') errors.push('source branch main/master not supported')
  if (head === null) { errors.push('local HEAD not resolved'); sourceRemoteObserved = false }
  if (remoteSha === null) sourceRemoteObserved = false
  else if (head !== null && remoteSha !== null && head !== remoteSha) errors.push(`local HEAD ${head?.slice(0,7)} != remote ${remoteSha?.slice(0,7)} for ${targetBranch}`)
  const remoteMismatch = head && remoteSha && head !== remoteSha
  return { head, branch: targetBranch, remoteSha, sourceRemoteObserved, status, errors, isDirty, isDetached, remoteMismatch, toplevel }
}

// ---------------------------------------------------------------------------
// Run dirs
// ---------------------------------------------------------------------------
export function createBenchmarkRawRun({ runId, repoRoot = REPO_ROOT }) {
  const rawRoot = nodePath.join(repoRoot, 'Tests', 'runs', runId)
  if (existsSync(rawRoot)) throw new Error(`run already exists: ${runId}`)
  for (const sub of ['logs/raw','logs/redacted','metrics','snapshots','artifacts']) mkdirSync(nodePath.join(rawRoot, sub), { recursive: true })
  writeFileSync(nodePath.join(rawRoot, 'run-info.txt'), `runId: ${runId}\nkind: benchmark\ncreated: ${new Date().toISOString()}\n`, 'utf-8')
  return rawRoot
}
export function createPublishStaging({ runId, repoRoot = REPO_ROOT }) {
  const staging = nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish', runId)
  if (existsSync(staging)) throw new Error(`publish staging already exists: ${runId}`)
  for (const sub of ['metrics','logs']) mkdirSync(nodePath.join(staging, 'benchmarks', runId, sub), { recursive: true })
  return nodePath.join(staging, 'benchmarks', runId)
}
export function ensurePublishStaging({ runId, repoRoot = REPO_ROOT }) {
  const staging = nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish', runId)
  mkdirSync(nodePath.join(staging, 'benchmarks', runId, 'metrics'), { recursive: true })
  mkdirSync(nodePath.join(staging, 'benchmarks', runId, 'logs'), { recursive: true })
  return nodePath.join(staging, 'benchmarks', runId)
}

// ---------------------------------------------------------------------------
// Hardware via portable runner for pnpm etc., git stays argv-native
// ---------------------------------------------------------------------------
export function collectHardware({ platform = process.platform, spawn = spawnSync } = {}) {
  const base = hardwareFromNode()
  try {
    const r = runWithRunner(['pnpm', '--version'], { cwd: REPO_ROOT, platform, spawn })
    if (r.status === 0) base.pnpmVersion = (r.stdout || '').trim()
  } catch {}
  try {
    const p = spawnSync('git', ['--version'], { encoding: 'utf-8' })
    if (p.status === 0) base.gitVersion = (p.stdout || '').trim().replace('git version ', '')
  } catch { base.gitVersion = null }
  const py = getPython()
  if (py) base.pythonVersion = py.version
  else {
    try {
      const p = spawnSync('python', ['--version'], { encoding: 'utf-8' })
      base.pythonVersion = (p.stdout || p.stderr || '').trim() || null
    } catch { base.pythonVersion = null }
  }
  if (platform === 'win32') {
    try {
      const ps = (cmd) => {
        const r = runWithRunner(['powershell', '-NoProfile', '-Command', cmd], { cwd: REPO_ROOT, platform, spawn })
        return (r.stdout || '').trim()
      }
      try { const j = JSON.parse(ps('Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,TotalVisibleMemorySize | ConvertTo-Json -Compress')); base.osCaption = j.Caption; base.osVersion = j.Version; base.totalRamBytes = j.TotalVisibleMemorySize ? Number(j.TotalVisibleMemorySize)*1024 : base.totalRamBytes } catch {}
      try { const j = JSON.parse(ps('Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress')); const arr = Array.isArray(j)?j:[j]; base.cpuModel = arr[0]?.Name ?? base.cpuModel; base.physicalCores = arr[0]?.NumberOfCores ?? null; base.logicalCores = arr[0]?.NumberOfLogicalProcessors ?? base.logicalCores } catch {}
      try { const j = JSON.parse(ps('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress')); const arr = Array.isArray(j)?j:[j]; base.gpu = arr.map(g=>({name:g.Name, vram:g.AdapterRAM})).filter(g=>g.name) } catch { base.gpu = null }
    } catch {}
  }
  if (platform !== 'win32') {
    try {
      const p = spawnSync('df', ['-k', '.'], { cwd: REPO_ROOT, encoding: 'utf-8' })
      if (p.status === 0) base.diskFree = p.stdout
    } catch {}
  }
  try {
    const r = runWithRunner(['pnpm', 'exec', 'playwright', '--version'], { cwd: REPO_ROOT, platform, spawn })
    base.chromiumAvailable = r.status === 0
  } catch { base.chromiumAvailable = false }
  delete base.freeRamBytes
  return base
}

// ---------------------------------------------------------------------------
// Command execution via portable runner
// ---------------------------------------------------------------------------
export function runCommand({ id, label, cwd, argv, logPath, repoRoot = REPO_ROOT, platform = process.platform, spawn = spawnSync } = {}) {
  const startedAt = new Date()
  // Use portable runner for all benchmark commands
  const result = runWithRunner(argv, { cwd, platform, spawn, env: process.env })
  const endedAt = new Date()
  const durationMs = endedAt - startedAt
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const combined = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n`
  if (logPath) {
    try { mkdirSync(nodePath.dirname(logPath), { recursive: true }); writeFileSync(logPath, combined, 'utf-8') } catch {}
  }
  const exitCode = result.status
  const status = classifyCommandOutcome({ id, exitCode, error: result.error, stdout, stderr, timedOut: result.timedOut })
  // Metric extraction — ANSI-tolerant, pure
  let testFiles = null, passed = null, failed = null, skipped = null, errors = null, warnings = null
  const combinedForMetrics = `${stdout}\n${stderr}`
  if (['core-agent','lia-core','stage-vitest','stage-ui','browser'].includes(id)) {
    const vm = parseVitestMetrics(combinedForMetrics)
    testFiles = vm.testFiles ?? vm.filesTotal ?? null
    // For browser, testFiles may be filesTotal, for others use filesTotal or tests
    passed = vm.passed ?? vm.testsPassed ?? null
    failed = vm.failed ?? vm.testsFailed ?? null
    skipped = vm.skipped ?? vm.testsSkipped ?? null
    errors = vm.errors ?? null
    // Prefer specific fields
    if (vm.filesTotal !== null) testFiles = vm.filesTotal
    if (vm.testsPassed !== null) passed = vm.testsPassed
    if (vm.testsFailed !== null) failed = vm.testsFailed
    if (vm.testsSkipped !== null) skipped = vm.testsSkipped
    if (vm.errors !== null) errors = vm.errors
  } else if (id === 'lint') {
    const lm = parseLintMetrics(combinedForMetrics)
    errors = lm.errors
    warnings = lm.warnings
    // testFiles for lint not applicable
  } else if (id === 'typecheck') {
    const tm = parseTypecheckMetrics(combinedForMetrics)
    errors = tm.errors
  }
  return { id, label, cwd: nodePath.relative(repoRoot, cwd).replace(/\\/g,'/'), argv, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs, exitCode, status, stdout, stderr, logPath: logPath ? nodePath.relative(repoRoot, logPath).replace(/\\/g,'/'): null, truncated: false, error: result.error ? String(result.error) : null, testFiles, passed, failed, skipped, errors, warnings }
}

// ---------------------------------------------------------------------------
// Redaction / scan via python — argv-native, never cmd.exe
// ---------------------------------------------------------------------------
export function redactWithBridge(text, repoRoot = REPO_ROOT) {
  const bridge = nodePath.join(repoRoot, 'Tests', 'tools', 'qa-security-bridge.py')
  if (!existsSync(bridge)) return { text, applied: false, error: 'bridge missing', unavailable: true }
  const py = getPython()
  if (!py) return { text, applied: false, error: 'python unavailable', unavailable: true }
  try {
    const tmp = nodePath.join(os.tmpdir(), `lia-redact-${Date.now()}-${Math.random().toString(36).slice(2,7)}.txt`)
    writeFileSync(tmp, text, 'utf-8')
    const argv = [...py.argv, bridge, 'redact', tmp]
    const p = spawnSync(argv[0], argv.slice(1), { encoding: 'utf-8', maxBuffer: 10*1024*1024 })
    rmSync(tmp, { force: true })
    if (p.status !== 0) return { text, applied: false, error: p.stderr || String(p.error || 'redact failed'), unavailable: false }
    return { text: p.stdout, applied: true, unavailable: false }
  } catch (e) { return { text, applied: false, error: String(e), unavailable: false } }
}
export function scanWithBridge(files, repoRoot = REPO_ROOT) {
  const bridge = nodePath.join(repoRoot, 'Tests', 'tools', 'qa-security-bridge.py')
  if (!existsSync(bridge)) return { hasSecret: true, unavailable: true, hasError: true, safeToPublish: false, results: [], error: 'bridge missing' }
  const py = getPython()
  if (!py) return { hasSecret: true, unavailable: true, hasError: true, safeToPublish: false, results: [], error: 'python unavailable' }
  try {
    const argv = [...py.argv, bridge, 'scan', '--json', ...files]
    const p = spawnSync(argv[0], argv.slice(1), { encoding: 'utf-8', maxBuffer: 10*1024*1024 })
    const out = p.stdout || ''
    let res = null
    try { res = JSON.parse(out) } catch {}
    if (res) return { hasSecret: !!res.hasSecret, hasError: !!res.hasError, safeToPublish: !!res.safeToPublish, results: res.results || [], unavailable: false, error: res.hasError ? 'scan error' : null, raw: res }
    if (p.status !== 0) {
      const errOut = p.stdout?.toString() ?? ''
      try { const r2 = JSON.parse(errOut); return { hasSecret: !!r2.hasSecret, hasError: !!r2.hasError, safeToPublish: !!r2.safeToPublish, results: r2.results || [], unavailable: false } } catch {}
      return { hasSecret: true, hasError: true, safeToPublish: false, unavailable: false, error: String(p.stderr || p.error || 'scan failed'), results: [] }
    }
    return { hasSecret: false, hasError: false, safeToPublish: true, unavailable: false, results: [] }
  } catch (e) { return { hasSecret: true, hasError: true, safeToPublish: false, error: String(e), unavailable: false, results: [] } }
}

// ---------------------------------------------------------------------------
// Publish helpers
// ---------------------------------------------------------------------------
export function writeSummary({ publishDir, summary }) {
  const p = nodePath.join(publishDir, 'summary.json')
  writeFileSync(p, JSON.stringify(summary, null, 2) + '\n', 'utf-8'); return p
}
export function writeEnvironment({ publishDir, env }) {
  const p = nodePath.join(publishDir, 'environment.json')
  writeFileSync(p, JSON.stringify(env, null, 2) + '\n', 'utf-8'); return p
}
export function writeGitJson({ publishDir, git }) {
  const p = nodePath.join(publishDir, 'git.json')
  writeFileSync(p, JSON.stringify(git, null, 2) + '\n', 'utf-8'); return p
}
export function writeHardware({ publishDir, hardware }) {
  const p = nodePath.join(publishDir, 'metrics', 'hardware.json')
  mkdirSync(nodePath.dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(hardware, null, 2) + '\n', 'utf-8'); return p
}
export function writeBrainRouting({ publishDir }) {
  const p = nodePath.join(publishDir, 'metrics', 'brain-routing.json')
  mkdirSync(nodePath.dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ available: false, reason: 'structured runtime diagnostic export not available' }, null, 2) + '\n', 'utf-8'); return p
}
export function writeReport({ publishDir, summary, hardware, git }) {
  const p = nodePath.join(publishDir, 'REPORT.md')
  const lines = [
    `# Lia Windows Benchmark — ${summary.runId}`,
    ``,
    `**Status:** ${summary.status}`,
    `**Source:** ${summary.sourceSha.slice(0,7)} on ${summary.sourceBranch} (remote ${summary.remoteSourceSha?.slice(0,7) ?? 'unknown'})`,
    `**Started:** ${summary.startedAt}`,
    `**Duration:** ${summary.durationMs ? (summary.durationMs/1000).toFixed(1)+'s' : 'unknown'}`,
    ``,
    `## Environment`,
    `- OS: ${hardware?.os ?? 'unknown'}`,
    `- Node: ${hardware?.nodeVersion ?? 'unknown'}  pnpm: ${hardware?.pnpmVersion ?? 'unknown'}  Git: ${hardware?.gitVersion ?? 'unknown'}  Python: ${hardware?.pythonVersion ?? 'unknown'}`,
    ``,
    `## Hardware`,
    `- CPU: ${hardware?.cpuModel ?? 'unknown'} (${hardware?.logicalCores ?? '?'} logical)`,
    `- RAM: ${hardware?.totalRamBytes ? (hardware.totalRamBytes/1024/1024/1024).toFixed(1)+' GB' : 'unknown'}`,
    `- GPU: ${Array.isArray(hardware?.gpu) ? hardware.gpu.map(g=>g.name).join(', ') : hardware?.gpu ?? 'unknown'}`,
    ``,
    `## Validation matrix`,
    `| id | label | status | duration | exit |`,
    `|---|---|---|---|---|`,
    ...summary.commands.map(c=>`| ${c.id} | ${c.label} | ${c.status} | ${c.durationMs ?? '-'}ms | ${c.exitCode ?? '-'} |`),
    ``,
    `## Failures`,
    summary.failures.length ? summary.failures.map(f=>`- ${f.id}: ${f.summary ?? f.exitCode}`).join('\n') : 'None',
    ``,
    `## Environment limitations`,
    summary.environmentLimitations.length ? summary.environmentLimitations.map(e=>`- ${e}`).join('\n') : 'None',
    ``,
    `## Redaction`,
    `- Policy source: ${summary.redaction.policySource}`,
    `- Applied: ${summary.redaction.applied}`,
    `- Residual: ${summary.redaction.residualSensitiveContentDetected}`,
    ``,
    `## Truncation`,
    `- Occurred: ${summary.truncation.occurred}`,
    ...(summary.truncation.logs.length ? summary.truncation.logs.map(l=>`- ${l.path}: ${l.originalBytes} → ${l.retainedBytes}`) : []),
    ``,
    `## Publication`,
    `- Branch: ${summary.publication.branch}`,
    `- Requested: ${summary.publication.requested}`,
    `- IntendedPush: ${summary.publication.intendedPush ?? summary.publication.requested}`,
    `- Reason: ${summary.publication.pushSkippedReason ?? '—'}`,
    ``,
    `## Reproduction`,
    `\`LiaBenchmark.bat --report-only ${summary.runId}\``,
  ]
  writeFileSync(p, lines.join('\n')+'\n', 'utf-8'); return p
}

// ---------------------------------------------------------------------------
// Launcher-check — no suites, only resolve/launch probe
// ---------------------------------------------------------------------------
export function launcherCheck({ repoRoot = REPO_ROOT, platform = process.platform, spawn = spawnSync } = {}) {
  const checks = []
  function check(name, argv) {
    try {
      const r = runWithRunner(argv, { cwd: repoRoot, platform, spawn, env: process.env })
      const ok = r.status === 0 || (r.stdout && r.stdout.length > 0) || (r.stderr && r.stderr.length > 0)
      // For our probe, we consider status 0 or ability to spawn as PASS; ENOENT is ENVIRONMENT-LIMITED
      if (r.error && String(r.error).includes('not found')) return { name, status: 'ENVIRONMENT-LIMITED', detail: String(r.error) }
      if (r.status === 0) return { name, status: 'PASS', detail: (r.stdout||'').slice(0,200) }
      // Non-zero for version check still means executable found
      if (r.status !== null) return { name, status: 'PASS', detail: `exit ${r.status}` }
      return { name, status: 'ENVIRONMENT-LIMITED', detail: r.error ? String(r.error) : 'unknown' }
    } catch (e) {
      return { name, status: 'ENVIRONMENT-LIMITED', detail: String(e) }
    }
  }
  checks.push(check('node', ['node', '--version']))
  checks.push(check('git', ['git', '--version']))
  checks.push(check('pnpm', ['pnpm', '--version']))
  // Python bridge
  const py = getPython()
  if (!py) checks.push({ name: 'python', status: 'ENVIRONMENT-LIMITED', detail: 'python unavailable' })
  else {
    checks.push(check('python', [...py.argv, '--version']))
    // Try bridge exists
    const bridge = nodePath.join(repoRoot, 'Tests', 'tools', 'qa-security-bridge.py')
    checks.push({ name: 'security-bridge', status: existsSync(bridge) ? 'PASS' : 'ENVIRONMENT-LIMITED', detail: existsSync(bridge) ? 'found' : 'missing' })
  }
  const overall = checks.every(c => c.status === 'PASS') ? 'PASS' : 'ENVIRONMENT-LIMITED'
  return { status: overall, checks }
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------
export async function runBenchmark({ repoRoot = REPO_ROOT, args = process.argv.slice(2), now = new Date(), commandRunner = null, hardwareCollector = null, platform = process.platform } = {}) {
  const rawArgs = args
  const isReportOnly = rawArgs.includes('--report-only')
  const reportOnlyId = isReportOnly ? rawArgs[rawArgs.indexOf('--report-only')+1] : null
  const isLauncherCheck = rawArgs.includes('--launcher-check')
  const noPush = rawArgs.includes('--no-push')
  let withSmoke = rawArgs.includes('--with-smoke')

  if (isLauncherCheck) {
    const res = launcherCheck({ repoRoot, platform })
    console.log(`[benchmark] launcher-check ${res.status}`)
    for (const c of res.checks) console.log(` - ${c.name}: ${c.status} ${c.detail}`)
    return { status: res.status, launcherChecks: res.checks, publication: { requested: false, pushed: false, pushSkippedReason: 'launcher-check' } }
  }

  if (isReportOnly) {
    if (!reportOnlyId) { console.error('usage: --report-only <run-id>'); process.exit(2) }
    const rawRoot = nodePath.join(repoRoot, 'Tests', 'runs', reportOnlyId)
    if (!existsSync(nodePath.join(rawRoot, 'summary.json'))) { console.error(`No local run ${reportOnlyId}`); process.exit(1) }
    const rawSummary = JSON.parse(readFileSync(nodePath.join(rawRoot, 'summary.json'), 'utf-8'))
    if (rawSummary.status === 'INCOMPLETE') {
      console.error(`[benchmark] Cannot report-only an INCOMPLETE run ${reportOnlyId}`)
      return { ...rawSummary, publication: { ...rawSummary.publication, pushSkippedReason: 'INCOMPLETE' }, reportRegenerated: false }
    }
    // Preferred: write local REPORT-regenerated.md without touching publish staging
    const reportPath = nodePath.join(rawRoot, 'REPORT-regenerated.md')
    const hardware = rawSummary.hardwareSummary || hardwareFromNode()
    const gitInfo = rawSummary.gitInfo || { sourceSha: rawSummary.sourceSha, sourceBranch: rawSummary.sourceBranch, remoteSourceSha: rawSummary.remoteSourceSha, gitVersion: null, nodeVersion: process.version, pnpmVersion: null, pythonVersion: null }
    // Build a minimal publish-style summary for report (use public fields)
    const tmpPublish = { ...rawSummary, publication: { requested: false, branch: 'qa/windows-benchmarks', intendedPush: false, committed: false, pushed: false, pushSkippedReason: 'report-only' } }
    // Write report directly to raw run
    const lines = [
      `# Lia Windows Benchmark — ${tmpPublish.runId} (regenerated)`,
      ``,
      `**Status:** ${tmpPublish.status}`,
      `**Source:** ${tmpPublish.sourceSha.slice(0,7)} on ${tmpPublish.sourceBranch}`,
      `**Started:** ${tmpPublish.startedAt}`,
      ``,
      `## Validation matrix`,
      `| id | label | status |`,
      `|---|---|---|`,
      ...tmpPublish.commands.map(c=>`| ${c.id} | ${c.label} | ${c.status} |`),
    ]
    writeFileSync(reportPath, lines.join('\n')+'\n', 'utf-8')
    // Verify publish staging unchanged (if exists)
    const publishDir = nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish', reportOnlyId, 'benchmarks', reportOnlyId)
    let publishUnchanged = true
    let manifestOk = null
    if (existsSync(nodePath.join(publishDir, 'SHA256SUMS.txt'))) {
      const before = readFileSync(nodePath.join(publishDir, 'SHA256SUMS.txt'), 'utf-8')
      const v = verifyShaManifest(before, publishDir)
      publishUnchanged = v.ok
      manifestOk = v.ok
    }
    console.log(`[benchmark] Regenerated local report ${reportPath} (publish staging unchanged=${publishUnchanged})`)
    return { ...tmpPublish, reportRegenerated: true, reportPath, publishUnchanged, manifestOk }
  }

  // Preflight
  const pre = preflightSource({ repoRoot })
  console.log(`[benchmark] HEAD ${pre.head?.slice(0,7) ?? 'null'} branch ${pre.branch ?? 'null'} remote ${pre.remoteSha?.slice(0,7) ?? 'null'} observed=${pre.sourceRemoteObserved}`)
  if (pre.errors.length) {
    console.error(`[benchmark] Preflight failed: ${pre.errors.join('; ')}`)
    console.error(`[benchmark] git status:\n${pre.status}`)
    if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(exitCodeForStatus('INCOMPLETE'))
    throw new Error(`preflight failed: ${pre.errors.join('; ')}`)
  }
  if (!pre.sourceRemoteObserved || pre.head === null || pre.remoteSha === null || pre.head !== pre.remoteSha) {
    const msg = `preflight equality failed: head=${pre.head} remote=${pre.remoteSha} observed=${pre.sourceRemoteObserved}`
    console.error(`[benchmark] ${msg}`)
    if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(exitCodeForStatus('INCOMPLETE'))
    throw new Error(msg)
  }

  const shortSha = pre.head.slice(0,7)
  const baseId = benchmarkRunId(now, shortSha)
  const existingIds = new Set()
  try { const runs = readdirSync(nodePath.join(repoRoot, 'Tests', 'runs')).filter(n => n.match(/^\d{8}-\d{6}-/)); runs.forEach(r=>existingIds.add(r)) } catch {}
  try { const stages = readdirSync(nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish')).filter(n => n.match(/^\d{8}-\d{6}-/)); stages.forEach(r=>existingIds.add(r)) } catch {}
  const runId = existingIds.has(baseId) ? nextBenchmarkRunId(baseId, existingIds) : baseId
  console.log(`[benchmark] Run ID ${runId}`)

  const beforeHead = pre.head
  const beforeBranch = pre.branch
  const beforeStatus = pre.status
  const initialQaSha = gitLsRemote('qa/windows-benchmarks', repoRoot)
  console.log(`[benchmark] Initial QA remote qa/windows-benchmarks is ${initialQaSha ? initialQaSha.slice(0,7) : 'absent'}`)

  const rawRoot = createBenchmarkRawRun({ runId, repoRoot })
  const publishDir = createPublishStaging({ runId, repoRoot })
  const startedAt = new Date()
  const skeleton = createSummarySkeleton({ runId, sourceSha: pre.head, sourceBranch: pre.branch, remoteSourceSha: pre.remoteSha, startedAt, sourceRemoteObserved: pre.sourceRemoteObserved })
  skeleton.status = 'INCOMPLETE'
  writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(skeleton, null, 2) + '\n', 'utf-8')
  mkdirSync(nodePath.join(rawRoot, 'metrics'), { recursive: true })

  const gitInfoFull = {
    sourceSha: pre.head,
    sourceBranch: pre.branch,
    remoteSourceSha: pre.remoteSha,
    gitVersion: (()=>{ const p=spawnSync('git',['--version'],{encoding:'utf-8'}); return p.status===0?(p.stdout||'').trim().replace('git version ',''):null })(),
    nodeVersion: process.version,
    pnpmVersion: (()=>{ const r=runWithRunner(['pnpm','--version'],{cwd:repoRoot, platform}); return r.status===0?(r.stdout||'').trim():null })(),
    pythonVersion: (()=>{ const py=getPython(); return py?py.version:null })(),
  }
  // For publish, strip repoRoot
  const gitInfo = { ...gitInfoFull }
  const gitInfoPublish = { sourceSha: gitInfo.sourceSha, sourceBranch: gitInfo.sourceBranch, remoteSourceSha: gitInfo.remoteSourceSha, gitVersion: gitInfo.gitVersion, nodeVersion: gitInfo.nodeVersion, pnpmVersion: gitInfo.pnpmVersion, pythonVersion: gitInfo.pythonVersion }

  const hardware = (hardwareCollector || (()=>collectHardware({ platform })))()

  let commands = withSmoke ? canonicalCommandsWithSmoke(repoRoot, true) : canonicalCommands(repoRoot)
  if (!withSmoke) commands = commands.filter(c=>c.id!=='runtime-smoke')
  else {
    const smokePath = nodePath.join(repoRoot, 'Tests','tools','kokoro-smoke.mjs')
    if (!existsSync(smokePath)) { console.warn('[benchmark] --with-smoke requested but kokoro-smoke.mjs not found, ignoring'); commands = commands.filter(c=>c.id!=='runtime-smoke'); withSmoke=false }
  }

  const commandResults = []
  const rawLogsDir = nodePath.join(rawRoot, 'logs','raw')
  mkdirSync(rawLogsDir, { recursive: true })

  for (const cmd of commands) {
    const logPath = nodePath.join(rawLogsDir, `${cmd.id}.log`)
    console.log(`[benchmark] Running ${cmd.id}: ${cmd.argv.join(' ')} in ${cmd.cwd}`)
    let envLimited = false
    if (cmd.argv[0]==='pnpm' && cmd.argv[1]==='exec') {
      const tool = cmd.argv[2]
      // Check via runner resolver — if pnpm is cmd shim, still need to check tool existence via file check
      const localBin = existsSync(nodePath.join(cmd.cwd,'node_modules','.bin',tool)) || existsSync(nodePath.join(repoRoot,'node_modules','.bin',tool)) || existsSync(nodePath.join(repoRoot,'airi','node_modules','.bin',tool))
      if (!localBin) { console.warn(`[benchmark] ${tool} not found locally, marking ENVIRONMENT-LIMITED`); envLimited=true }
    }
    let res
    if (envLimited) {
      res = { id: cmd.id, label: cmd.label, cwd: nodePath.relative(repoRoot, cmd.cwd).replace(/\\/g,'/'), argv: cmd.argv, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 0, exitCode: null, status: 'environment-limited', logPath: nodePath.relative(repoRoot, logPath).replace(/\\/g,'/'), stdout:'', stderr: `[ENVIRONMENT-LIMITED] ${cmd.argv.join(' ')} not found`, truncated: false }
      writeFileSync(logPath, `[ENVIRONMENT-LIMITED] ${cmd.argv.join(' ')} not found locally - no install attempted\n`, 'utf-8')
    } else {
      const runner = commandRunner || ((opts)=>runCommand({ ...opts, platform, spawn: spawnSync }))
      let argv = cmd.argv
      if (cmd.id==='runtime-smoke') argv = ['node','Tests/tools/kokoro-smoke.mjs', nodePath.join('Tests','runs',runId,'artifacts','smoke')]
      res = runner({ ...cmd, argv, logPath, repoRoot, platform })
    }
    commandResults.push(res)
  }

  const endedAt = new Date()
  const durationMs = endedAt - startedAt
  const perf = { totalDurationMs: durationMs, commands: commandResults.map(c=>({ id:c.id, durationMs:c.durationMs, exitCode:c.exitCode, status:c.status })), ramBefore: os.totalmem()-os.freemem(), diskBefore: null }

  const envLims = []
  if (!pythonAvailable()) envLims.push('python unavailable for security bridge')
  if (commandResults.some(c=>c.status==='environment-limited')) envLims.push('some commands environment-limited')
  const status = classifyBenchmark({ commands: commandResults, environmentLimitations: envLims })
  const failures = commandResults.filter(c=>c.status==='failed').map(c=>({id:c.id, exitCode:c.exitCode, summary:`${c.label} failed`}))
  const warnings = []

  const summary = createSummarySkeleton({ runId, sourceSha: pre.head, sourceBranch: pre.branch, remoteSourceSha: pre.remoteSha, startedAt, sourceRemoteObserved: pre.sourceRemoteObserved })
  summary.endedAt = endedAt.toISOString()
  summary.durationMs = durationMs
  summary.status = status
  summary.environmentLimitations = envLims
  summary.failures = failures
  summary.warnings = warnings
  // Use publicCommandResult for publish, keep full for local? For now store public in both to ensure privacy
  summary.commands = commandResults.map(publicCommandResult)
  summary.hardwareSummary = hardware
  summary.gitInfo = gitInfoFull // local full
  summary.gitInfoPublish = gitInfoPublish
  summary.publication.requested = !noPush
  summary.publication.intendedPush = !noPush
  summary.publication.branch = 'qa/windows-benchmarks'
  if (noPush) summary.publication.pushSkippedReason = 'no-push-flag'
  if (summary.status==='INCOMPLETE') throw new Error('unexpected INCOMPLETE after commands')

  const publishLogsDir = nodePath.join(publishDir, 'logs')
  mkdirSync(publishLogsDir, { recursive: true })
  const publishMetricsDir = nodePath.join(publishDir, 'metrics')
  mkdirSync(publishMetricsDir, { recursive: true })
  let redactionApplied=false, residualDetected=false, scanErrorDetected=false
  const truncationLogs=[]
  const publishFiles=[]
  let pythonUnavailableForPublish=!pythonAvailable()

  for (const cmd of commandResults) {
    const rawLog = nodePath.join(rawLogsDir, `${cmd.id}.log`)
    if (!existsSync(rawLog)) continue
    let text = readFileSync(rawLog,'utf-8')
    const red = redactWithBridge(text, repoRoot)
    if (red.applied) { text=red.text; redactionApplied=true }
    else if (red.unavailable) pythonUnavailableForPublish=true
    // Mask private paths before bounding
    text = maskPrivatePaths(text, { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })
    const bounded = boundText(text, PUBLISH_PER_LOG_MAX)
    if (bounded.truncated) { truncationLogs.push({ path:`logs/${cmd.id}.log`, originalBytes: bounded.originalBytes, retainedBytes: bounded.retainedBytes }); warnings.push(`log ${cmd.id} truncated`) }
    text = bounded.text
    // Privacy gate: check for residual private paths before scan
    if (containsPrivatePath(text, { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) {
      console.error(`[benchmark] Private path residual in ${cmd.id}.log — blocking`)
      scanErrorDetected=true
      residualDetected=true
      text = `log omitted\nprivate path residual detected\nlocal raw retained in Tests/runs/${runId}/logs/raw/${cmd.id}.log\n`
    }
    const tmpScan = nodePath.join(os.tmpdir(), `lia-scan-${cmd.id}-${Date.now()}.log`)
    writeFileSync(tmpScan, text,'utf-8')
    const scan2 = scanWithBridge([tmpScan], repoRoot)
    rmSync(tmpScan,{force:true})
    if (scan2.unavailable || scan2.hasError) { scanErrorDetected=true; residualDetected=true; text=`log omitted\nscan error or security bridge unavailable\nlocal raw retained in Tests/runs/${runId}/logs/raw/${cmd.id}.log\n` }
    else if (scan2.hasSecret) { residualDetected=true; text=`log omitted\nresidual sensitive pattern detected\nlocal raw retained in Tests/runs/${runId}/logs/raw/${cmd.id}.log\n` }
    if (Buffer.from(text).length > PUBLISH_FILE_HARD_MAX) { console.error(`[benchmark] File ${cmd.id}.log exceeds hard max`); summary.publication.pushSkippedReason='publish-file-size-limit'; residualDetected=true }
    const outPath = nodePath.join(publishLogsDir, `${cmd.id}.log`)
    writeFileSync(outPath, text,'utf-8')
    if (existsSync(outPath) && statSync(outPath).size > PUBLISH_FILE_HARD_MAX) { console.error(`[benchmark] Publish file ${cmd.id}.log size ${statSync(outPath).size} > hard max`); summary.publication.pushSkippedReason='publish-file-size-limit' }
    // Final privacy check on written file
    const written = readFileSync(outPath,'utf-8')
    if (containsPrivatePath(written, { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) {
      console.error(`[benchmark] Private path residual after write ${cmd.id}.log`)
      summary.publication.pushSkippedReason='publish-private-path-residual'
      residualDetected=true
    }
    publishFiles.push(outPath)
  }

  const metricsTestsPath = nodePath.join(publishMetricsDir,'tests.json')
  // Use public commands for metrics
  writeFileSync(metricsTestsPath, JSON.stringify({ commands: commandResults.map(publicCommandResult) },null,2)+'\n','utf-8')
  if (statSync(metricsTestsPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason='publish-file-size-limit'
  // Privacy check
  if (containsPrivatePath(readFileSync(metricsTestsPath,'utf-8'), { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) summary.publication.pushSkippedReason='publish-private-path-residual'
  publishFiles.push(metricsTestsPath)

  const perfPath = nodePath.join(publishMetricsDir,'performance.json')
  writeFileSync(perfPath, JSON.stringify(perf,null,2)+'\n','utf-8')
  if (statSync(perfPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason='publish-file-size-limit'
  publishFiles.push(perfPath)

  const hwPath = writeHardware({ publishDir, hardware })
  if (statSync(hwPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason='publish-file-size-limit'
  publishFiles.push(hwPath)
  const brainPath = writeBrainRouting({ publishDir })
  if (statSync(brainPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason='publish-file-size-limit'
  publishFiles.push(brainPath)

  const envPublish = { hardware, git: gitInfoPublish }
  const envPath = writeEnvironment({ publishDir, env: envPublish })
  if (statSync(envPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason='publish-file-size-limit'
  if (containsPrivatePath(readFileSync(envPath,'utf-8'), { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) summary.publication.pushSkippedReason='publish-private-path-residual'
  publishFiles.push(envPath)

  const gitPath = writeGitJson({ publishDir, git: gitInfoPublish })
  if (statSync(gitPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason='publish-file-size-limit'
  if (containsPrivatePath(readFileSync(gitPath,'utf-8'), { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) summary.publication.pushSkippedReason='publish-private-path-residual'
  publishFiles.push(gitPath)

  summary.redaction.applied = redactionApplied
  summary.redaction.residualSensitiveContentDetected = residualDetected
  summary.truncation.occurred = truncationLogs.length>0
  summary.truncation.logs = truncationLogs

  let totalBytes = publishFiles.reduce((sum,f)=>{ try{return sum+statSync(f).size}catch{return sum}},0)
  if (totalBytes > PUBLISH_TOTAL_HARD_MAX) { console.error(`[benchmark] Total publish size ${totalBytes} exceeds hard max ${PUBLISH_TOTAL_HARD_MAX}`); summary.publication.pushSkippedReason='publish-size-limit' }

  if (pythonUnavailableForPublish || scanErrorDetected) {
    if (summary.status==='PASS') summary.status='ENVIRONMENT-LIMITED'
    if (!summary.environmentLimitations.includes('python unavailable')) summary.environmentLimitations.push('python unavailable for security bridge')
    if (!summary.publication.pushSkippedReason) summary.publication.pushSkippedReason = pythonUnavailableForPublish ? 'security-python-unavailable' : 'scan-error'
  }
  if (residualDetected || scanErrorDetected) {
    console.error('[benchmark] Residual secret or scan error — will not commit/publish')
    if (!summary.publication.pushSkippedReason) summary.publication.pushSkippedReason='secret-residual'
  }
  if (summary.status==='INCOMPLETE') { console.error('[benchmark] INCOMPLETE — will not publish'); summary.publication.pushSkippedReason='INCOMPLETE' }

  // Compute expected artifacts before freezing
  const expectedArtifacts = [
    'environment.json','git.json','REPORT.md','summary.json','SHA256SUMS.txt',
    'logs/' + commandResults.map(c=>`${c.id}.log`).join(',logs/'),
    'metrics/tests.json','metrics/performance.json','metrics/hardware.json','metrics/brain-routing.json'
  ]
  // Actually compute real artifact list before hashing (without SHA, will add)
  const publishSummary = JSON.parse(JSON.stringify(summary))
  // For publish, strip repoRoot-containing fields, use public commands
  publishSummary.commands = commandResults.map(publicCommandResult)
  publishSummary.gitInfo = gitInfoPublish
  publishSummary.hardwareSummary = hardware
  delete publishSummary.gitInfoPublish
  publishSummary.publication.commitSha=null
  publishSummary.publication.committed=false
  publishSummary.publication.pushed=false
  // Compute artifacts before hashing: list all publish files that will exist plus SHA
  // Keep placeholder, will fill after enumeration

  // Check total after adding summary/report
  const summaryPath = writeSummary({ publishDir, summary: publishSummary })
  publishFiles.push(summaryPath)
  const reportPath = writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfoPublish })
  publishFiles.push(reportPath)

  totalBytes = publishFiles.reduce((sum,f)=>{ try{return sum+statSync(f).size}catch{return sum}},0)
  if (totalBytes > PUBLISH_TOTAL_HARD_MAX && !summary.publication.pushSkippedReason) {
    console.error(`[benchmark] Total after summary/report ${totalBytes} exceeds hard max`); summary.publication.pushSkippedReason='publish-size-limit'; publishSummary.publication.pushSkippedReason='publish-size-limit'
    writeFileSync(summaryPath, JSON.stringify(publishSummary,null,2)+'\n','utf-8')
    writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfoPublish })
  } else if (summary.publication.pushSkippedReason && publishSummary.publication.pushSkippedReason !== summary.publication.pushSkippedReason) {
    publishSummary.publication.pushSkippedReason = summary.publication.pushSkippedReason
    writeFileSync(summaryPath, JSON.stringify(publishSummary,null,2)+'\n','utf-8')
    writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfoPublish })
  }
  for (const p of [summaryPath, reportPath]) {
    if (existsSync(p) && statSync(p).size > PUBLISH_FILE_HARD_MAX) {
      summary.publication.pushSkippedReason='publish-file-size-limit'; publishSummary.publication.pushSkippedReason='publish-file-size-limit'
      writeFileSync(summaryPath, JSON.stringify(publishSummary,null,2)+'\n','utf-8')
      writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfoPublish })
    }
    if (containsPrivatePath(readFileSync(p,'utf-8'), { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) {
      summary.publication.pushSkippedReason='publish-private-path-residual'; publishSummary.publication.pushSkippedReason='publish-private-path-residual'
      writeFileSync(summaryPath, JSON.stringify(publishSummary,null,2)+'\n','utf-8')
      writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfoPublish })
    }
  }

  const allPublishFiles = readdirSync(publishDir, { recursive: true, withFileTypes: true }).flatMap(e=> e.isFile() ? [nodePath.join(e.parentPath, e.name)] : []).filter(f=> !f.endsWith('SHA256SUMS.txt'))
  for (const f of allPublishFiles) {
    if (statSync(f).size > PUBLISH_FILE_HARD_MAX) { console.error(`[benchmark] Publish file ${f} exceeds hard max`); summary.publication.pushSkippedReason='publish-file-size-limit'; publishSummary.publication.pushSkippedReason='publish-file-size-limit' }
    if (containsPrivatePath(readFileSync(f,'utf-8'), { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) { console.error(`[benchmark] Private path in ${f}`); summary.publication.pushSkippedReason='publish-private-path-residual'; publishSummary.publication.pushSkippedReason='publish-private-path-residual' }
  }

  // Artifacts list before hashing (include SHA)
  const artifactsBeforeHash = allPublishFiles.map(f=> nodePath.relative(publishDir,f).replace(/\\/g,'/')).concat(['SHA256SUMS.txt']).sort()
  publishSummary.artifacts = artifactsBeforeHash
  summary.artifacts = artifactsBeforeHash
  // Rewrite publish summary with artifacts before hashing (still not hashed, but artifacts list is expected)
  writeFileSync(summaryPath, JSON.stringify(publishSummary,null,2)+'\n','utf-8')
  // Recompute manifest after updating summary with artifacts
  const allPublishFiles2 = readdirSync(publishDir, { recursive: true, withFileTypes: true }).flatMap(e=> e.isFile() ? [nodePath.join(e.parentPath, e.name)] : []).filter(f=> !f.endsWith('SHA256SUMS.txt'))
  const manifest = buildShaManifest(allPublishFiles2, publishDir)
  const manifestPath = nodePath.join(publishDir,'SHA256SUMS.txt')
  writeFileSync(manifestPath, manifest,'utf-8')
  const verify = verifyShaManifest(manifest, publishDir)
  if (!verify.ok) { console.error(`[benchmark] Manifest verification failed: ${verify.reason}`); summary.publication.pushSkippedReason='manifest-verification-failed'; publishSummary.publication.pushSkippedReason='manifest-verification-failed' }

  // After hash, do not modify any file covered by manifest — only local raw summary may be updated
  summary.artifacts = artifactsBeforeHash
  writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')

  const shouldBlock = summary.publication.pushSkippedReason || publishSummary.publication.pushSkippedReason
  const bridgeExists = existsSync(nodePath.join(repoRoot,'Tests','tools','qa-security-bridge.py'))
  if (!bridgeExists) {
    console.warn('[benchmark] Security bridge missing — publication blocked')
    if (summary.status==='PASS') summary.status='ENVIRONMENT-LIMITED'
    summary.publication.pushSkippedReason='security-guard-unavailable'
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }
  if (shouldBlock) {
    console.error(`[benchmark] Publication blocked: ${shouldBlock}`)
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }
  if (noPush) {
    console.log('[benchmark] --no-push: local only, no commit/push')
    summary.publication.pushSkippedReason='no-push-flag'; publishSummary.publication.pushSkippedReason='no-push-flag'
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }

  const currentRemoteSha = gitLsRemote(pre.branch, repoRoot)
  if (currentRemoteSha !== pre.head) {
    console.error(`[benchmark] Source remote moved during benchmark: ${pre.head.slice(0,7)} != ${currentRemoteSha?.slice(0,7)} — will not publish`)
    summary.publication.pushSkippedReason='SOURCE_REMOTE_MOVED_DURING_BENCHMARK'
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }
  const midHead = gitRevParseHead(repoRoot)
  const midBranch = gitBranch(repoRoot)
  const midStatus = gitStatusPorcelain(repoRoot)
  if (midHead !== beforeHead || midBranch !== beforeBranch || (midStatus||'').trim() !== (beforeStatus||'').trim()) {
    console.error(`[benchmark] SOURCE_WORKTREE_MUTATED before publish`)
    summary.publication.pushSkippedReason='SOURCE_WORKTREE_MUTATED'
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }

  const qaBranch='qa/windows-benchmarks'
  const finalQaShaBeforePublish = gitLsRemote(qaBranch, repoRoot)
  console.log(`[benchmark] QA remote ${qaBranch} is ${finalQaShaBeforePublish ? finalQaShaBeforePublish.slice(0,7) : 'absent'} (initial was ${initialQaSha ? initialQaSha.slice(0,7) : 'absent'})`)
  if (initialQaSha === null && finalQaShaBeforePublish !== null) {
    console.error(`[benchmark] QA remote appeared concurrently (initial absent, now ${finalQaShaBeforePublish.slice(0,7)}) — will not publish`)
    summary.publication.pushSkippedReason='QA_REMOTE_MOVED'
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }
  if (initialQaSha !== null && finalQaShaBeforePublish !== initialQaSha) {
    console.error(`[benchmark] QA remote moved (initial ${initialQaSha.slice(0,7)} now ${finalQaShaBeforePublish?.slice(0,7) ?? 'null'}) — will not publish`)
    summary.publication.pushSkippedReason='QA_REMOTE_MOVED'
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }
  const effectiveQaSha = finalQaShaBeforePublish

  const tmpWorktree = nodePath.join(os.tmpdir(), `lia-qa-${runId}-${Date.now()}`)
  mkdirSync(tmpWorktree, { recursive: true })
  let committedSha=null, publicationSucceeded=false
  try {
    const addRes = git(['worktree','add','--detach',tmpWorktree, pre.head], repoRoot)
    if (addRes.status!==0) throw new Error(`worktree add failed: ${addRes.stderr}`)
    if (!effectiveQaSha) {
      const sw = git(['switch','--orphan', qaBranch], tmpWorktree)
      if (sw.status!==0) throw new Error(`switch --orphan failed: ${sw.stderr}`)
      for (const entry of readdirSync(tmpWorktree)) if (entry!=='.git') rmSync(nodePath.join(tmpWorktree, entry), { recursive: true, force: true })
      writeFileSync(nodePath.join(tmpWorktree,'README.md'), `# Lia Windows Benchmarks\n\nEvidence branch for Windows benchmark runs. Each folder under \`benchmarks/\` is one run.\n\nSource development branch: \`arena/01a09ddb-lia-project\`\n`, 'utf-8')
      const indexPath=nodePath.join(tmpWorktree,'index.json'); writeFileSync(indexPath, JSON.stringify([],null,2)+'\n','utf-8')
      const benchDest=nodePath.join(tmpWorktree,'benchmarks',runId); mkdirSync(benchDest,{recursive:true})
      for (const f of allPublishFiles2.concat([manifestPath])) { const rel=nodePath.relative(publishDir,f); const dest=nodePath.join(benchDest,rel); mkdirSync(nodePath.dirname(dest),{recursive:true}); copyFileSync(f,dest) }
      const idx=JSON.parse(readFileSync(indexPath,'utf-8')); idx.unshift({ runId, sourceSha: pre.head, sourceBranch: pre.branch, status: summary.status, startedAt: summary.startedAt, endedAt: summary.endedAt, durationMs: summary.durationMs, reportPath: `benchmarks/${runId}/REPORT.md` }); writeFileSync(indexPath, JSON.stringify(idx,null,2)+'\n','utf-8')
      const stagedCheck=gitCapture(['status','--porcelain=v1','-uall'], tmpWorktree)
      const stagedLines=stagedCheck ? stagedCheck.split('\n').filter(Boolean).map(l=>l.slice(2).trim()) : []
      const allowedFirst=stagedLines.every(p=> p==='README.md' || p==='index.json' || p.startsWith(`benchmarks/${runId}/`))
      if (!allowedFirst) throw new Error(`allowlist violation first: ${stagedLines.join(', ')}`)
      const filesToAdd=['README.md','index.json', ...allPublishFiles2.map(f=> `benchmarks/${runId}/${nodePath.relative(publishDir,f).replace(/\\/g,'/')}`), `benchmarks/${runId}/SHA256SUMS.txt`]
      const addRes2=git(['add','--', ...filesToAdd], tmpWorktree)
      if (addRes2.status!==0) throw new Error(`git add failed: ${addRes2.stderr}`)
      const cached=gitCapture(['diff','--cached','--name-only'], tmpWorktree)
      const cachedFiles=cached ? cached.split('\n').filter(Boolean) : []
      if (!cachedFiles.every(f=> f==='README.md' || f==='index.json' || f.startsWith(`benchmarks/${runId}/`))) throw new Error(`cached allowlist violation: ${cachedFiles}`)
      const toScan=cachedFiles.map(f=> nodePath.join(tmpWorktree,f))
      const scanRes=scanWithBridge(toScan, repoRoot)
      if (scanRes.unavailable || scanRes.hasError || scanRes.hasSecret || !scanRes.safeToPublish) throw new Error(`secret or scan error in staged files, aborting commit: ${scanRes.error || 'hasSecret'}`)
      // Privacy gate on staged files
      for (const f of toScan) {
        const content=readFileSync(f,'utf-8')
        if (containsPrivatePath(content, { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) throw new Error(`private path residual in staged ${f}`)
      }
      // Final race after commit — before push
      const srcNow=gitLsRemote(pre.branch, repoRoot)
      const qaNow=gitLsRemote(qaBranch, repoRoot)
      if (srcNow !== pre.head) throw new Error('SOURCE_REMOTE_MOVED_DURING_BENCHMARK')
      if (qaNow !== null) throw new Error('QA remote appeared concurrently, aborting push')
      if (initialQaSha !== null) throw new Error('QA remote appeared concurrently, aborting push')
      const msg=`qa(windows): benchmark ${runId} ${summary.status}\n\nSource-SHA: ${pre.head}\nSource-Branch: ${pre.branch}\n`
      const commitRes=git(['commit','-m', msg], tmpWorktree)
      if (commitRes.status!==0) throw new Error(`commit failed: ${commitRes.stderr}`)
      committedSha=gitRevParseHead(tmpWorktree)
      // Post-commit final race immediately before push
      const srcPost=gitLsRemote(pre.branch, repoRoot)
      const qaPost=gitLsRemote(qaBranch, repoRoot)
      if (srcPost !== pre.head) throw new Error('SOURCE_REMOTE_MOVED_DURING_BENCHMARK')
      if (qaPost !== null) throw new Error('QA remote appeared concurrently, aborting push')
      const pushRes=git(['push','origin',`HEAD:refs/heads/${qaBranch}`], tmpWorktree)
      if (pushRes.status!==0) throw new Error(`push failed: ${pushRes.stderr}`)
      publicationSucceeded=true
      summary.publication.committed=true; summary.publication.commitSha=committedSha; summary.publication.pushed=true; summary.publication.pushSkippedReason=null
      writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    } else {
      const fetchRes=git(['fetch','origin',`${qaBranch}:${qaBranch}`], repoRoot)
      const checkoutRes=git(['checkout', qaBranch], tmpWorktree)
      if (checkoutRes.status!==0) { git(['fetch','origin', qaBranch], tmpWorktree); const checkout2=git(['checkout', qaBranch], tmpWorktree); if (checkout2.status!==0) throw new Error(`checkout qa branch failed: ${checkout2.stderr}`) }
      const wtHead=gitRevParseHead(tmpWorktree)
      if (wtHead !== effectiveQaSha) throw new Error(`worktree HEAD ${wtHead?.slice(0,7)} != expected Q ${effectiveQaSha?.slice(0,7)}`)
      const benchDest=nodePath.join(tmpWorktree,'benchmarks',runId)
      if (existsSync(benchDest)) throw new Error(`benchmark dest already exists: ${runId}`)
      mkdirSync(benchDest,{recursive:true})
      for (const f of allPublishFiles2.concat([manifestPath])) { const rel=nodePath.relative(publishDir,f); const dest=nodePath.join(benchDest,rel); mkdirSync(nodePath.dirname(dest),{recursive:true}); copyFileSync(f,dest) }
      const indexPath=nodePath.join(tmpWorktree,'index.json')
      let idx=[]; if (existsSync(indexPath)) idx=JSON.parse(readFileSync(indexPath,'utf-8'))
      idx.unshift({ runId, sourceSha: pre.head, sourceBranch: pre.branch, status: summary.status, startedAt: summary.startedAt, endedAt: summary.endedAt, durationMs: summary.durationMs, reportPath: `benchmarks/${runId}/REPORT.md` })
      writeFileSync(indexPath, JSON.stringify(idx,null,2)+'\n','utf-8')
      const status2=gitCapture(['status','--porcelain=v1','-uall'], tmpWorktree)
      const lines2=status2 ? status2.split('\n').filter(Boolean).map(l=>l.slice(2).trim()) : []
      const allowedExisting=lines2.every(p=> p==='index.json' || p.startsWith(`benchmarks/${runId}/`))
      if (!allowedExisting) throw new Error(`allowlist violation existing: ${lines2.join(', ')}`)
      const filesToAdd2=['index.json', ...allPublishFiles2.map(f=> `benchmarks/${runId}/${nodePath.relative(publishDir,f).replace(/\\/g,'/')}`), `benchmarks/${runId}/SHA256SUMS.txt`]
      const addRes3=git(['add','--', ...filesToAdd2], tmpWorktree)
      if (addRes3.status!==0) throw new Error(`git add existing failed: ${addRes3.stderr}`)
      const cached2=gitCapture(['diff','--cached','--name-only'], tmpWorktree)
      const cachedFiles2=cached2 ? cached2.split('\n').filter(Boolean) : []
      if (!cachedFiles2.every(f=> f==='index.json' || f.startsWith(`benchmarks/${runId}/`))) throw new Error(`cached violation existing: ${cachedFiles2}`)
      const toScan2=cachedFiles2.map(f=> nodePath.join(tmpWorktree,f))
      const scan2=scanWithBridge(toScan2, repoRoot)
      if (scan2.unavailable || scan2.hasError || scan2.hasSecret || !scan2.safeToPublish) throw new Error(`secret or scan error in staged existing: ${scan2.error || 'hasSecret'}`)
      for (const f of toScan2) {
        const content=readFileSync(f,'utf-8')
        if (containsPrivatePath(content, { repoRoot, homedir: os.homedir(), tmpdir: os.tmpdir() })) throw new Error(`private path residual in staged ${f}`)
      }
      const srcNow=gitLsRemote(pre.branch, repoRoot)
      const qaNow=gitLsRemote(qaBranch, repoRoot)
      if (srcNow !== pre.head) throw new Error('SOURCE_REMOTE_MOVED_DURING_BENCHMARK')
      if (qaNow !== effectiveQaSha) throw new Error('QA remote moved')
      if (qaNow !== initialQaSha) throw new Error('QA remote moved')
      const msg2=`qa(windows): benchmark ${runId} ${summary.status}\n\nSource-SHA: ${pre.head}\nSource-Branch: ${pre.branch}\n`
      const commitRes2=git(['commit','-m', msg2], tmpWorktree)
      if (commitRes2.status!==0) throw new Error(`commit existing failed: ${commitRes2.stderr}`)
      committedSha=gitRevParseHead(tmpWorktree)
      // Post-commit final race
      const srcPost=gitLsRemote(pre.branch, repoRoot)
      const qaPost=gitLsRemote(qaBranch, repoRoot)
      if (srcPost !== pre.head) throw new Error('SOURCE_REMOTE_MOVED_DURING_BENCHMARK')
      if (qaPost !== effectiveQaSha) throw new Error('QA remote moved')
      const pushRes2=git(['push','origin',`HEAD:refs/heads/${qaBranch}`], tmpWorktree)
      if (pushRes2.status!==0) throw new Error(`push existing failed: ${pushRes2.stderr}`)
      publicationSucceeded=true
      summary.publication.committed=true; summary.publication.commitSha=committedSha; summary.publication.pushed=true; summary.publication.pushSkippedReason=null
      writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    }
  } catch (e) {
    console.error(`[benchmark] Publication failed: ${e.message}`)
    const msg=String(e.message)
    if (msg.includes('SOURCE_REMOTE_MOVED')) summary.publication.pushSkippedReason='SOURCE_REMOTE_MOVED_DURING_BENCHMARK'
    else if (msg.includes('QA remote') || msg.includes('QA appeared') || msg.includes('QA moved')) summary.publication.pushSkippedReason = msg.includes('SOURCE') ? 'SOURCE_REMOTE_MOVED_DURING_BENCHMARK' : 'QA_REMOTE_MOVED'
    else if (msg.includes('SOURCE_WORKTREE_MUTATED')) summary.publication.pushSkippedReason='SOURCE_WORKTREE_MUTATED'
    else if (msg.includes('allowlist')) summary.publication.pushSkippedReason='allowlist-violation'
    else if (msg.includes('secret') || msg.includes('scan') || msg.includes('private path')) summary.publication.pushSkippedReason = msg.includes('private path') ? 'publish-private-path-residual' : 'secret-residual'
    else if (msg.includes('publish-file-size') || msg.includes('publish-size')) summary.publication.pushSkippedReason='publish-size-limit'
    else summary.publication.pushSkippedReason='publication-error'
    writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    console.error(`[benchmark] Preserving temp worktree at ${tmpWorktree} for inspection`)
  } finally {
    if (publicationSucceeded && committedSha) {
      try { git(['worktree','remove', tmpWorktree], repoRoot) } catch { try { git(['worktree','remove','--force', tmpWorktree], repoRoot) } catch {} }
      rmSync(tmpWorktree, { recursive: true, force: true })
    }
  }

  const afterHead=gitRevParseHead(repoRoot)
  const afterBranch=gitBranch(repoRoot)
  const afterStatus=gitStatusPorcelain(repoRoot)
  if (afterHead !== beforeHead || afterBranch !== beforeBranch || (afterStatus||'').trim() !== (beforeStatus||'').trim()) {
    console.error(`[benchmark] SOURCE_WORKTREE_MUTATED after: before ${beforeHead.slice(0,7)} ${beforeBranch} after ${afterHead?.slice(0,7)} ${afterBranch}`)
    if (publicationSucceeded) {
      const local=JSON.parse(readFileSync(nodePath.join(rawRoot,'summary.json'),'utf-8'))
      local.publication.pushSkippedReason='SOURCE_WORKTREE_MUTATED'
      writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(local,null,2)+'\n','utf-8')
    } else if (!summary.publication.pushSkippedReason) {
      summary.publication.pushSkippedReason='SOURCE_WORKTREE_MUTATED'
      writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    }
  }

  console.log(`[benchmark] Done ${runId} status=${summary.status} pushed=${summary.publication.pushed ?? false}`)
  return summary
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node Tests/tools/qa-benchmark.mjs [--no-push] [--report-only <id>] [--with-smoke] [--launcher-check]`)
    console.log(`Exit codes: PASS 0, FAIL 1, ENVIRONMENT-LIMITED 2, INCOMPLETE/fatal 3`)
    process.exit(0)
  }
  runBenchmark({ args }).then(s=>{
    if (!s) process.exit(3)
    const code = exitCodeForStatus(s.status)
    console.log(`[benchmark] Final status: ${s.status} exit=${code}`)
    process.exit(code)
  }).catch(e=>{
    console.error(`[benchmark] Fatal: ${e.stack || e.message}`)
    process.exit(3)
  })
}
