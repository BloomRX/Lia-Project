#!/usr/bin/env node
/**
 * Lia QA benchmark harness (D2B8-B corrective) — Windows benchmark automation.
 * Responsibilities: preflight, runId, env, hardware, commands, logs, classification,
 * redaction, hashing, report, allowlist, commit/push.
 * No shell interpolation, python resolution via py -3, strict gates.
 */

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

import { REPO_ROOT, RUNS_DIR, runTimestampId } from './qa-shared.mjs'
import {
  benchmarkRunId,
  boundText,
  buildShaManifest,
  canonicalCommands,
  canonicalCommandsWithSmoke,
  classifyBenchmark,
  classifyCommandOutcome,
  createSummarySkeleton,
  hardwareFromNode,
  isBenchmarkPublishPath,
  isEnvironmentFailure,
  nextBenchmarkRunId,
  PUBLISH_FILE_HARD_MAX,
  PUBLISH_PER_LOG_MAX,
  PUBLISH_TOTAL_HARD_MAX,
  resolvePython,
  sha256OfText,
  verifyShaManifest,
} from './qa-benchmark-lib.mjs'

// ---------------------------------------------------------------------------
// Git helpers — argv-based, no shell
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

function gitRevParseHead(cwd = REPO_ROOT) {
  return gitCapture(['rev-parse', 'HEAD'], cwd)
}
function gitBranch(cwd = REPO_ROOT) {
  const out = gitCapture(['branch', '--show-current'], cwd)
  // empty string means detached
  return out && out.length ? out : null
}
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
// Python resolver — reuse DevKit behavior: py -3 >=3.10 else python >=3.10
// ---------------------------------------------------------------------------
let cachedPython = null
let pythonResolved = false
function getPython() {
  if (pythonResolved) return cachedPython
  pythonResolved = true
  cachedPython = resolvePython({ spawn: spawnSync })
  return cachedPython
}
function pythonAvailable() {
  return getPython() !== null
}
function pythonArgv(extra = []) {
  const py = getPython()
  if (!py) return null
  return [...py.argv, ...extra]
}

// ---------------------------------------------------------------------------
// Source preflight — strict: remote must exist and equal
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
  } else {
    errors.push('missing source branch')
  }
  const isDetached = !branch
  const isDirty = status !== null ? status.trim() !== '' : true // if status null, treat as dirty/error
  if (isDetached) errors.push('detached HEAD')
  if (isDirty) errors.push('dirty worktree')
  if (targetBranch === 'main' || targetBranch === 'master') errors.push('source branch main/master not supported for benchmark')
  // Require exact equality
  if (head === null) {
    errors.push('local HEAD not resolved')
    sourceRemoteObserved = false
  }
  if (remoteSha === null) {
    // already pushed error, but ensure equality fails
    sourceRemoteObserved = false
  } else if (head !== null && remoteSha !== null && head !== remoteSha) {
    errors.push(`local HEAD ${head?.slice(0,7)} != remote ${remoteSha?.slice(0,7)} for ${targetBranch}`)
  }
  const remoteMismatch = head && remoteSha && head !== remoteSha
  return { head, branch: targetBranch, remoteSha, sourceRemoteObserved, status, errors, isDirty, isDetached, remoteMismatch, toplevel }
}

// ---------------------------------------------------------------------------
// Run dirs — no destructive rmSync on collision
// ---------------------------------------------------------------------------
export function createBenchmarkRawRun({ runId, repoRoot = REPO_ROOT }) {
  const rawRoot = nodePath.join(repoRoot, 'Tests', 'runs', runId)
  if (existsSync(rawRoot)) throw new Error(`run already exists: ${runId}`)
  for (const sub of ['logs/raw', 'logs/redacted', 'metrics', 'snapshots', 'artifacts']) mkdirSync(nodePath.join(rawRoot, sub), { recursive: true })
  writeFileSync(nodePath.join(rawRoot, 'run-info.txt'), `runId: ${runId}\nkind: benchmark\ncreated: ${new Date().toISOString()}\n`, 'utf-8')
  return rawRoot
}

export function createPublishStaging({ runId, repoRoot = REPO_ROOT }) {
  const staging = nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish', runId)
  if (existsSync(staging)) throw new Error(`publish staging already exists: ${runId}`)
  for (const sub of ['metrics', 'logs']) mkdirSync(nodePath.join(staging, 'benchmarks', runId, sub), { recursive: true })
  return nodePath.join(staging, 'benchmarks', runId)
}

export function ensurePublishStaging({ runId, repoRoot = REPO_ROOT }) {
  const staging = nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish', runId)
  mkdirSync(nodePath.join(staging, 'benchmarks', runId, 'metrics'), { recursive: true })
  mkdirSync(nodePath.join(staging, 'benchmarks', runId, 'logs'), { recursive: true })
  return nodePath.join(staging, 'benchmarks', runId)
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------
export function collectHardware() {
  const base = hardwareFromNode()
  try {
    const p = spawnSync('pnpm', ['--version'], { encoding: 'utf-8' })
    if (p.status === 0) base.pnpmVersion = (p.stdout || '').trim()
  } catch {}
  try {
    const p = spawnSync('git', ['--version'], { encoding: 'utf-8' })
    if (p.status === 0) base.gitVersion = (p.stdout || '').trim().replace('git version ', '')
    else base.gitVersion = null
  } catch { base.gitVersion = null }
  const py = getPython()
  if (py) base.pythonVersion = py.version
  else {
    try {
      const p = spawnSync('python', ['--version'], { encoding: 'utf-8' })
      base.pythonVersion = (p.stdout || p.stderr || '').trim()
      if (!base.pythonVersion) base.pythonVersion = null
    } catch { base.pythonVersion = null }
  }
  if (os.platform() === 'win32') {
    try {
      const ps = (cmd) => {
        const p = spawnSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf-8', timeout: 5000 })
        return (p.stdout || '').trim()
      }
      try {
        const j = JSON.parse(ps('Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,TotalVisibleMemorySize | ConvertTo-Json -Compress'))
        base.osCaption = j.Caption; base.osVersion = j.Version; base.totalRamBytes = j.TotalVisibleMemorySize ? Number(j.TotalVisibleMemorySize) * 1024 : base.totalRamBytes
      } catch {}
      try {
        const j = JSON.parse(ps('Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress'))
        const arr = Array.isArray(j) ? j : [j]; base.cpuModel = arr[0]?.Name ?? base.cpuModel; base.physicalCores = arr[0]?.NumberOfCores ?? null; base.logicalCores = arr[0]?.NumberOfLogicalProcessors ?? base.logicalCores
      } catch {}
      try {
        const j = JSON.parse(ps('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'))
        const arr = Array.isArray(j) ? j : [j]; base.gpu = arr.map(g => ({ name: g.Name, vram: g.AdapterRAM })).filter(g => g.name)
      } catch { base.gpu = null }
    } catch {}
  }
  if (os.platform() !== 'win32') {
    try {
      const p = spawnSync('df', ['-k', '.'], { cwd: REPO_ROOT, encoding: 'utf-8' })
      if (p.status === 0) base.diskFree = p.stdout
    } catch {}
  }
  try {
    const p = spawnSync('pnpm', ['exec', 'playwright', '--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    base.chromiumAvailable = p.status === 0
  } catch { base.chromiumAvailable = false }
  delete base.freeRamBytes
  return base
}

// ---------------------------------------------------------------------------
// Command execution — static argv, pnpm exec, bounded, no shell
// ---------------------------------------------------------------------------
export function runCommand({ id, label, cwd, argv, logPath, repoRoot = REPO_ROOT }) {
  const startedAt = new Date()
  const env = { ...process.env }
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024, timeout: 600000 })
  const endedAt = new Date()
  const durationMs = endedAt - startedAt
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const combined = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n`
  if (logPath) {
    try { mkdirSync(nodePath.dirname(logPath), { recursive: true }); writeFileSync(logPath, combined, 'utf-8') } catch {}
  }
  const exitCode = result.status
  const timedOut = result.error && String(result.error).toLowerCase().includes('timed out')
  const status = classifyCommandOutcome({ id, exitCode, error: result.error, stdout, stderr, timedOut })
  return { id, label, cwd: nodePath.relative(repoRoot, cwd).replace(/\\/g, '/'), argv, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs, exitCode, status, stdout, stderr, logPath: logPath ? nodePath.relative(repoRoot, logPath).replace(/\\/g, '/') : null, truncated: false, error: result.error ? String(result.error) : null }
}

// ---------------------------------------------------------------------------
// Redaction pipeline via security bridge — argv-based, python resolved
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
    const p = spawnSync(argv[0], argv.slice(1), { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    rmSync(tmp, { force: true })
    if (p.status !== 0) return { text, applied: false, error: p.stderr || String(p.error || 'redact failed'), unavailable: false }
    return { text: p.stdout, applied: true, unavailable: false }
  } catch (e) {
    return { text, applied: false, error: String(e), unavailable: false }
  }
}

export function scanWithBridge(files, repoRoot = REPO_ROOT) {
  const bridge = nodePath.join(repoRoot, 'Tests', 'tools', 'qa-security-bridge.py')
  if (!existsSync(bridge)) return { hasSecret: true, unavailable: true, hasError: true, safeToPublish: false, results: [], error: 'bridge missing' }
  const py = getPython()
  if (!py) return { hasSecret: true, unavailable: true, hasError: true, safeToPublish: false, results: [], error: 'python unavailable' }
  try {
    const argv = [...py.argv, bridge, 'scan', '--json', ...files]
    const p = spawnSync(argv[0], argv.slice(1), { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
    const out = p.stdout || ''
    let res = null
    try { res = JSON.parse(out) } catch {}
    if (res) {
      return { hasSecret: !!res.hasSecret, hasError: !!res.hasError, safeToPublish: !!res.safeToPublish, results: res.results || [], unavailable: false, error: res.hasError ? 'scan error' : null, raw: res }
    }
    // If no JSON, treat as error safeToPublish false
    if (p.status !== 0) {
      // Try to parse stdout from error object
      const errOut = p.stdout?.toString() ?? ''
      try {
        const r2 = JSON.parse(errOut)
        return { hasSecret: !!r2.hasSecret, hasError: !!r2.hasError, safeToPublish: !!r2.safeToPublish, results: r2.results || [], unavailable: false }
      } catch {}
      return { hasSecret: true, hasError: true, safeToPublish: false, unavailable: false, error: String(p.stderr || p.error || 'scan failed'), results: [] }
    }
    return { hasSecret: false, hasError: false, safeToPublish: true, unavailable: false, results: [] }
  } catch (e) {
    return { hasSecret: true, hasError: true, safeToPublish: false, error: String(e), unavailable: false, results: [] }
  }
}

// ---------------------------------------------------------------------------
// Publish staging helpers — immutable after hash
// ---------------------------------------------------------------------------
export function writeSummary({ publishDir, summary }) {
  const p = nodePath.join(publishDir, 'summary.json')
  writeFileSync(p, JSON.stringify(summary, null, 2) + '\n', 'utf-8')
  return p
}
export function writeEnvironment({ publishDir, env }) {
  const p = nodePath.join(publishDir, 'environment.json')
  writeFileSync(p, JSON.stringify(env, null, 2) + '\n', 'utf-8')
  return p
}
export function writeGitJson({ publishDir, git }) {
  const p = nodePath.join(publishDir, 'git.json')
  writeFileSync(p, JSON.stringify(git, null, 2) + '\n', 'utf-8')
  return p
}
export function writeHardware({ publishDir, hardware }) {
  const p = nodePath.join(publishDir, 'metrics', 'hardware.json')
  mkdirSync(nodePath.dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(hardware, null, 2) + '\n', 'utf-8')
  return p
}
export function writeBrainRouting({ publishDir }) {
  const p = nodePath.join(publishDir, 'metrics', 'brain-routing.json')
  mkdirSync(nodePath.dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify({ available: false, reason: 'structured runtime diagnostic export not available' }, null, 2) + '\n', 'utf-8')
  return p
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
  writeFileSync(p, lines.join('\n')+'\n', 'utf-8')
  return p
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------
export async function runBenchmark({ repoRoot = REPO_ROOT, args = process.argv.slice(2), now = new Date(), commandRunner = null, hardwareCollector = null } = {}) {
  const rawArgs = args
  const isReportOnly = rawArgs.includes('--report-only')
  const reportOnlyId = isReportOnly ? rawArgs[rawArgs.indexOf('--report-only')+1] : null
  const noPush = rawArgs.includes('--no-push')
  let withSmoke = rawArgs.includes('--with-smoke')

  // Handle --report-only real regeneration
  if (isReportOnly) {
    if (!reportOnlyId) { console.error('usage: --report-only <run-id>'); process.exit(2) }
    const rawRoot = nodePath.join(repoRoot, 'Tests', 'runs', reportOnlyId)
    if (!existsSync(nodePath.join(rawRoot, 'summary.json'))) { console.error(`No local run ${reportOnlyId}`); process.exit(1) }
    // Regenerate publish staging from local evidence without tests/commit
    const rawSummary = JSON.parse(readFileSync(nodePath.join(rawRoot, 'summary.json'), 'utf-8'))
    if (rawSummary.status === 'INCOMPLETE') {
      console.error(`[benchmark] Cannot report-only an INCOMPLETE run ${reportOnlyId}`)
      return { ...rawSummary, publication: { ...rawSummary.publication, pushSkippedReason: 'INCOMPLETE' }, reportRegenerated: false }
    }
    // Rebuild publish staging
    const publishDir = ensurePublishStaging({ runId: reportOnlyId, repoRoot })
    // Reconstruct hardware/git from rawSummary if available
    const hardware = rawSummary.hardwareSummary || hardwareFromNode()
    const gitInfo = rawSummary.gitInfo || { sourceSha: rawSummary.sourceSha, sourceBranch: rawSummary.sourceBranch, remoteSourceSha: rawSummary.remoteSourceSha }
    // Copy logs etc if they exist locally? For report-only, we just regenerate REPORT.md/summary.json etc from rawSummary
    // Write publishable summary without commitSha
    const publishSummary = { ...rawSummary }
    publishSummary.publication = { requested: false, branch: 'qa/windows-benchmarks', intendedPush: false, committed: false, pushed: false, pushSkippedReason: 'report-only' }
    // Ensure we have report
    writeSummary({ publishDir, summary: publishSummary })
    writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfo })
    console.log(`[benchmark] Regenerated report for ${reportOnlyId} at ${nodePath.join(publishDir, 'REPORT.md')} (no tests, no commit)`)
    return { ...publishSummary, reportRegenerated: true, publishDir }
  }

  // Preflight strict
  const pre = preflightSource({ repoRoot })
  console.log(`[benchmark] HEAD ${pre.head?.slice(0,7) ?? 'null'} branch ${pre.branch ?? 'null'} remote ${pre.remoteSha?.slice(0,7) ?? 'null'} observed=${pre.sourceRemoteObserved}`)
  if (pre.errors.length) {
    console.error(`[benchmark] Preflight failed: ${pre.errors.join('; ')}`)
    console.error(`[benchmark] git status:\n${pre.status}`)
    // Return object for tests instead of process.exit when invoked programmatically
    if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(1)
    throw new Error(`preflight failed: ${pre.errors.join('; ')}`)
  }
  // Exact equality already enforced in preflight, but double check
  if (!pre.sourceRemoteObserved || pre.head === null || pre.remoteSha === null || pre.head !== pre.remoteSha) {
    const msg = `preflight equality failed: head=${pre.head} remote=${pre.remoteSha} observed=${pre.sourceRemoteObserved}`
    console.error(`[benchmark] ${msg}`)
    if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(1)
    throw new Error(msg)
  }

  const shortSha = pre.head.slice(0,7)
  // Use nextBenchmarkRunId with collision covering both Tests/runs and .devkit-qa
  const baseId = benchmarkRunId(now, shortSha)
  const existingIds = new Set()
  // Build set from existing dirs
  try {
    const runs = readdirSync(nodePath.join(repoRoot, 'Tests', 'runs')).filter(n => n.match(/^\d{8}-\d{6}-/))
    runs.forEach(r => existingIds.add(r))
  } catch {}
  try {
    const stages = readdirSync(nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish')).filter(n => n.match(/^\d{8}-\d{6}-/))
    stages.forEach(r => existingIds.add(r))
  } catch {}
  const runId = existingIds.has(baseId) ? nextBenchmarkRunId(baseId, existingIds) : baseId
  console.log(`[benchmark] Run ID ${runId}`)

  // Capture before snapshot for immutability and QA race
  const beforeHead = pre.head
  const beforeBranch = pre.branch
  const beforeStatus = pre.status
  const initialQaSha = gitLsRemote('qa/windows-benchmarks', repoRoot)
  console.log(`[benchmark] Initial QA remote qa/windows-benchmarks is ${initialQaSha ? initialQaSha.slice(0,7) : 'absent'}`)

  // Create raw and publish dirs — write INCOMPLETE early
  const rawRoot = createBenchmarkRawRun({ runId, repoRoot })
  const publishDir = createPublishStaging({ runId, repoRoot })
  const startedAt = new Date()
  const skeleton = createSummarySkeleton({ runId, sourceSha: pre.head, sourceBranch: pre.branch, remoteSourceSha: pre.remoteSha, startedAt, sourceRemoteObserved: pre.sourceRemoteObserved })
  skeleton.status = 'INCOMPLETE'
  skeleton.hardwareSummary = null
  writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(skeleton, null, 2) + '\n', 'utf-8')
  // Also write to metrics for early visibility
  mkdirSync(nodePath.join(rawRoot, 'metrics'), { recursive: true })
  // Do not publish INCOMPLETE

  // Capture git/environment
  const gitInfo = {
    sourceSha: pre.head,
    sourceBranch: pre.branch,
    remoteSourceSha: pre.remoteSha,
    repoRoot,
    gitVersion: (() => { const p = spawnSync('git', ['--version'], { encoding: 'utf-8' }); return p.status === 0 ? (p.stdout || '').trim() : null })(),
    nodeVersion: process.version,
    pnpmVersion: (() => { const p = spawnSync('pnpm', ['--version'], { encoding: 'utf-8' }); return p.status === 0 ? (p.stdout || '').trim() : null })(),
    pythonVersion: (() => { const py = getPython(); return py ? py.version : null })(),
  }
  const hardware = (hardwareCollector || collectHardware)()

  // Handle --with-smoke: check if flag provided but we support it only if prerequisites exist without download
  // If withSmoke requested, we will append runtime-smoke command; if prerequisites missing, it will be env-limited
  let commands = withSmoke ? canonicalCommandsWithSmoke(repoRoot, true) : canonicalCommands(repoRoot)
  // If withSmoke false, ensure no runtime-smoke
  if (!withSmoke) commands = commands.filter(c => c.id !== 'runtime-smoke')
  else {
    // Validate that kokoro-smoke exists without needing download; if not, remove flag and warn (option B fallback)
    const smokePath = nodePath.join(repoRoot, 'Tests', 'tools', 'kokoro-smoke.mjs')
    if (!existsSync(smokePath)) {
      console.warn('[benchmark] --with-smoke requested but kokoro-smoke.mjs not found, ignoring')
      commands = commands.filter(c => c.id !== 'runtime-smoke')
      withSmoke = false
    }
  }

  const commandResults = []
  const rawLogsDir = nodePath.join(rawRoot, 'logs', 'raw')
  mkdirSync(rawLogsDir, { recursive: true })

  for (const cmd of commands) {
    const logPath = nodePath.join(rawLogsDir, `${cmd.id}.log`)
    console.log(`[benchmark] Running ${cmd.id}: ${cmd.argv.join(' ')} in ${cmd.cwd}`)
    let envLimited = false
    if (cmd.argv[0] === 'pnpm' && cmd.argv[1] === 'exec') {
      const tool = cmd.argv[2]
      const localBin = existsSync(nodePath.join(cmd.cwd, 'node_modules', '.bin', tool)) || existsSync(nodePath.join(repoRoot, 'node_modules', '.bin', tool)) || existsSync(nodePath.join(repoRoot, 'airi', 'node_modules', '.bin', tool))
      if (!localBin) {
        console.warn(`[benchmark] ${tool} not found locally, marking ENVIRONMENT-LIMITED`)
        envLimited = true
      }
    }
    let res
    if (envLimited) {
      res = { id: cmd.id, label: cmd.label, cwd: nodePath.relative(repoRoot, cmd.cwd).replace(/\\/g, '/'), argv: cmd.argv, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 0, exitCode: null, status: 'environment-limited', logPath: nodePath.relative(repoRoot, logPath).replace(/\\/g, '/'), stdout: '', stderr: `[ENVIRONMENT-LIMITED] ${cmd.argv.join(' ')} not found`, truncated: false }
      writeFileSync(logPath, `[ENVIRONMENT-LIMITED] ${cmd.argv.join(' ')} not found locally - no install attempted\n`, 'utf-8')
    } else {
      const runner = commandRunner || runCommand
      // For runtime-smoke, cwd is repoRoot and argv contains placeholder <id>; replace
      let argv = cmd.argv
      if (cmd.id === 'runtime-smoke') {
        argv = ['node', 'Tests/tools/kokoro-smoke.mjs', nodePath.join('Tests', 'runs', runId, 'artifacts', 'smoke')]
      }
      res = runner({ ...cmd, argv, logPath, repoRoot })
    }
    commandResults.push(res)
  }

  const endedAt = new Date()
  const durationMs = endedAt - startedAt

  const perf = { totalDurationMs: durationMs, commands: commandResults.map(c => ({ id: c.id, durationMs: c.durationMs, exitCode: c.exitCode, status: c.status })), ramBefore: os.totalmem() - os.freemem(), diskBefore: null }

  // Classification with global rule
  const envLims = []
  // Python unavailable → env-limited
  if (!pythonAvailable()) envLims.push('python unavailable for security bridge')
  if (commandResults.some(c => c.status === 'environment-limited')) envLims.push('some commands environment-limited')
  const status = classifyBenchmark({ commands: commandResults, environmentLimitations: envLims })

  const failures = commandResults.filter(c => c.status === 'failed').map(c => ({ id: c.id, exitCode: c.exitCode, summary: `${c.label} failed` }))
  const warnings = []

  // Prepare summary skeleton — immutable publish version without commitSha
  const summary = createSummarySkeleton({ runId, sourceSha: pre.head, sourceBranch: pre.branch, remoteSourceSha: pre.remoteSha, startedAt, sourceRemoteObserved: pre.sourceRemoteObserved })
  summary.endedAt = endedAt.toISOString()
  summary.durationMs = durationMs
  summary.status = status
  summary.environmentLimitations = envLims
  summary.failures = failures
  summary.warnings = warnings
  summary.commands = commandResults
  summary.hardwareSummary = hardware
  summary.gitInfo = gitInfo
  summary.publication.requested = !noPush
  summary.publication.intendedPush = !noPush
  summary.publication.branch = 'qa/windows-benchmarks'
  if (summary.status === 'INCOMPLETE') throw new Error('unexpected INCOMPLETE after commands')

  // Build publishable staging: copy and redact logs — immutable set
  const publishLogsDir = nodePath.join(publishDir, 'logs')
  mkdirSync(publishLogsDir, { recursive: true })
  const publishMetricsDir = nodePath.join(publishDir, 'metrics')
  mkdirSync(publishMetricsDir, { recursive: true })
  let redactionApplied = false
  let residualDetected = false
  let scanErrorDetected = false
  const truncationLogs = []
  const publishFiles = []
  let pythonUnavailableForPublish = !pythonAvailable()

  for (const cmd of commandResults) {
    const rawLog = nodePath.join(rawLogsDir, `${cmd.id}.log`)
    if (!existsSync(rawLog)) continue
    let text = readFileSync(rawLog, 'utf-8')
    const red = redactWithBridge(text, repoRoot)
    if (red.applied) { text = red.text; redactionApplied = true }
    else if (red.unavailable) { pythonUnavailableForPublish = true }
    const bounded = boundText(text, PUBLISH_PER_LOG_MAX)
    if (bounded.truncated) {
      truncationLogs.push({ path: `logs/${cmd.id}.log`, originalBytes: bounded.originalBytes, retainedBytes: bounded.retainedBytes })
      warnings.push(`log ${cmd.id} truncated`)
    }
    text = bounded.text
    // Scan redacted bounded text via temp file — argv-based, fail closed
    const tmpScan = nodePath.join(os.tmpdir(), `lia-scan-${cmd.id}-${Date.now()}.log`)
    writeFileSync(tmpScan, text, 'utf-8')
    const scan2 = scanWithBridge([tmpScan], repoRoot)
    rmSync(tmpScan, { force: true })
    if (scan2.unavailable || scan2.hasError) {
      scanErrorDetected = true
      residualDetected = true // treat as unsafe
      text = `log omitted\nscan error or security bridge unavailable\nlocal raw retained in Tests/runs/${runId}/logs/raw/${cmd.id}.log\n`
    } else if (scan2.hasSecret) {
      residualDetected = true
      text = `log omitted\nresidual sensitive pattern detected\nlocal raw retained in Tests/runs/${runId}/logs/raw/${cmd.id}.log\n`
    }
    // Per-file hard size check before write (after bounding, should be <=5MiB)
    if (Buffer.from(text).length > PUBLISH_FILE_HARD_MAX) {
      console.error(`[benchmark] File ${cmd.id}.log exceeds hard max ${PUBLISH_FILE_HARD_MAX}`)
      summary.publication.pushSkippedReason = 'publish-file-size-limit'
      // Don't write oversized file, abort publication
      residualDetected = true // reuse to block
    }
    const outPath = nodePath.join(publishLogsDir, `${cmd.id}.log`)
    writeFileSync(outPath, text, 'utf-8')
    // Verify per-file size after write
    const sz = statSync(outPath).size
    if (sz > PUBLISH_FILE_HARD_MAX) {
      console.error(`[benchmark] Publish file ${cmd.id}.log size ${sz} > hard max`)
      summary.publication.pushSkippedReason = 'publish-file-size-limit'
    }
    publishFiles.push(outPath)
  }

  // Metrics publish — check per-file hard size
  const metricsTestsPath = nodePath.join(publishMetricsDir, 'tests.json')
  writeFileSync(metricsTestsPath, JSON.stringify({ commands: commandResults }, null, 2) + '\n', 'utf-8')
  if (statSync(metricsTestsPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason = 'publish-file-size-limit'
  publishFiles.push(metricsTestsPath)

  const perfPath = nodePath.join(publishMetricsDir, 'performance.json')
  writeFileSync(perfPath, JSON.stringify(perf, null, 2) + '\n', 'utf-8')
  if (statSync(perfPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason = 'publish-file-size-limit'
  publishFiles.push(perfPath)

  const hwPath = writeHardware({ publishDir, hardware })
  if (statSync(hwPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason = 'publish-file-size-limit'
  publishFiles.push(hwPath)

  const brainPath = writeBrainRouting({ publishDir })
  if (statSync(brainPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason = 'publish-file-size-limit'
  publishFiles.push(brainPath)

  const envPath = writeEnvironment({ publishDir, env: { hardware, git: gitInfo } })
  if (statSync(envPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason = 'publish-file-size-limit'
  publishFiles.push(envPath)

  const gitPath = writeGitJson({ publishDir, git: gitInfo })
  if (statSync(gitPath).size > PUBLISH_FILE_HARD_MAX) summary.publication.pushSkippedReason = 'publish-file-size-limit'
  publishFiles.push(gitPath)

  summary.redaction.applied = redactionApplied
  summary.redaction.residualSensitiveContentDetected = residualDetected
  summary.truncation.occurred = truncationLogs.length > 0
  summary.truncation.logs = truncationLogs

  // Hard total size gate — block publication if still over limit after per-log bounding
  let totalBytes = publishFiles.reduce((sum, f) => { try { return sum + statSync(f).size } catch { return sum } }, 0)
  if (totalBytes > PUBLISH_TOTAL_HARD_MAX) {
    console.error(`[benchmark] Total publish size ${totalBytes} exceeds hard max ${PUBLISH_TOTAL_HARD_MAX} — blocking publication`)
    summary.publication.pushSkippedReason = 'publish-size-limit'
    // Do not add summary/report to publishFiles yet; we will still write local but not commit
  }

  // If python unavailable for publish, mark env-limited but allow local finish, block publication
  if (pythonUnavailableForPublish || scanErrorDetected) {
    if (summary.status === 'PASS') summary.status = 'ENVIRONMENT-LIMITED'
    if (!summary.environmentLimitations.includes('python unavailable')) summary.environmentLimitations.push('python unavailable for security bridge')
    if (!summary.publication.pushSkippedReason) summary.publication.pushSkippedReason = pythonUnavailableForPublish ? 'security-python-unavailable' : 'scan-error'
  }

  // Security gate: if residual or scan error, block publication
  if (residualDetected || scanErrorDetected) {
    console.error('[benchmark] Residual secret or scan error — will not commit/publish')
    if (!summary.publication.pushSkippedReason) summary.publication.pushSkippedReason = 'secret-residual'
  }

  // Do NOT publish INCOMPLETE
  if (summary.status === 'INCOMPLETE') {
    console.error('[benchmark] INCOMPLETE — will not publish')
    summary.publication.pushSkippedReason = 'INCOMPLETE'
  }

  // Per-file hard gate already set pushSkippedReason; also check total hard gate

  // Prepare publishable summary — stable, no commitSha, before hashing
  // Remove commitSha from publish version (local raw will have it)
  const publishSummary = JSON.parse(JSON.stringify(summary))
  publishSummary.publication.commitSha = null
  publishSummary.publication.committed = false
  publishSummary.publication.pushed = false
  // Keep intendedPush/requested but not commit-specific

  // Write publishable files before hashing — IMMUTABLE after
  const summaryPath = writeSummary({ publishDir, summary: publishSummary })
  publishFiles.push(summaryPath)
  const reportPath = writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfo })
  publishFiles.push(reportPath)

  // Check total size again after adding summary/report
  totalBytes = publishFiles.reduce((sum, f) => { try { return sum + statSync(f).size } catch { return sum } }, 0)
  if (totalBytes > PUBLISH_TOTAL_HARD_MAX && !summary.publication.pushSkippedReason) {
    console.error(`[benchmark] Total after summary/report ${totalBytes} exceeds hard max — blocking`)
    summary.publication.pushSkippedReason = 'publish-size-limit'
    publishSummary.publication.pushSkippedReason = 'publish-size-limit'
    // Need to rewrite publish summary with reason before hash
    writeFileSync(summaryPath, JSON.stringify(publishSummary, null, 2) + '\n', 'utf-8')
    writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfo })
  } else if (summary.publication.pushSkippedReason && publishSummary.publication.pushSkippedReason !== summary.publication.pushSkippedReason) {
    publishSummary.publication.pushSkippedReason = summary.publication.pushSkippedReason
    writeFileSync(summaryPath, JSON.stringify(publishSummary, null, 2) + '\n', 'utf-8')
    writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfo })
  }

  // Verify per-file hard max for summary/report
  for (const p of [summaryPath, reportPath]) {
    if (existsSync(p) && statSync(p).size > PUBLISH_FILE_HARD_MAX) {
      summary.publication.pushSkippedReason = 'publish-file-size-limit'
      publishSummary.publication.pushSkippedReason = 'publish-file-size-limit'
      writeFileSync(summaryPath, JSON.stringify(publishSummary, null, 2) + '\n', 'utf-8')
      writeReport({ publishDir, summary: publishSummary, hardware, git: gitInfo })
    }
  }

  // Enumerate publishable files for hash — AFTER all writes frozen
  const allPublishFiles = readdirSync(publishDir, { recursive: true, withFileTypes: true }).flatMap(e => e.isFile() ? [nodePath.join(e.parentPath, e.name)] : []).filter(f => !f.endsWith('SHA256SUMS.txt'))
  // Verify no file exceeds hard max
  for (const f of allPublishFiles) {
    if (statSync(f).size > PUBLISH_FILE_HARD_MAX) {
      console.error(`[benchmark] Publish file ${f} exceeds hard max`)
      summary.publication.pushSkippedReason = 'publish-file-size-limit'
      publishSummary.publication.pushSkippedReason = 'publish-file-size-limit'
      // Update manifest-impacting file? Already too late; block publication
    }
  }

  const manifest = buildShaManifest(allPublishFiles, publishDir)
  const manifestPath = nodePath.join(publishDir, 'SHA256SUMS.txt')
  writeFileSync(manifestPath, manifest, 'utf-8')
  // Verify manifest immediately
  const verify = verifyShaManifest(manifest, publishDir)
  if (!verify.ok) {
    console.error(`[benchmark] Manifest verification failed: ${verify.reason}`)
    summary.publication.pushSkippedReason = 'manifest-verification-failed'
    publishSummary.publication.pushSkippedReason = 'manifest-verification-failed'
  }

  // After hash, DO NOT MODIFY any file covered by manifest — only local raw summary may be updated
  summary.artifacts = allPublishFiles.map(f => nodePath.relative(publishDir, f).replace(/\\/g, '/')).concat(['SHA256SUMS.txt']).sort()
  // Local raw summary gets publication metadata including commitSha later (not publish version)
  writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
  // Ensure publishDir summary remains as publishSummary (no commitSha)
  // Do not overwrite publish summary with local one

  // Block publication if hard gates triggered or INCOMPLETE or secret
  const shouldBlock = summary.publication.pushSkippedReason || publishSummary.publication.pushSkippedReason
  const bridgeExists = existsSync(nodePath.join(repoRoot, 'Tests', 'tools', 'qa-security-bridge.py'))
  if (!bridgeExists) {
    console.warn('[benchmark] Security bridge missing — publication blocked')
    if (summary.status === 'PASS') summary.status = 'ENVIRONMENT-LIMITED'
    summary.publication.pushSkippedReason = 'security-guard-unavailable'
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    return summary
  }
  if (shouldBlock) {
    console.error(`[benchmark] Publication blocked: ${shouldBlock}`)
    // Update local raw with reason
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    return summary
  }

  if (noPush) {
    console.log('[benchmark] --no-push: local only, no commit/push')
    summary.publication.pushSkippedReason = 'no-push-flag'
    publishSummary.publication.pushSkippedReason = 'no-push-flag'
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    return summary
  }

  // Check source remote still S before publication — both for first and existing
  const currentRemoteSha = gitLsRemote(pre.branch, repoRoot)
  if (currentRemoteSha !== pre.head) {
    console.error(`[benchmark] Source remote moved during benchmark: ${pre.head.slice(0,7)} != ${currentRemoteSha?.slice(0,7)} — will not publish`)
    summary.publication.pushSkippedReason = 'SOURCE_REMOTE_MOVED_DURING_BENCHMARK'
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    return summary
  }

  // Source checkout immutability check before publication (HEAD/branch/status)
  const midHead = gitRevParseHead(repoRoot)
  const midBranch = gitBranch(repoRoot)
  const midStatus = gitStatusPorcelain(repoRoot)
  if (midHead !== beforeHead || midBranch !== beforeBranch || (midStatus || '').trim() !== (beforeStatus || '').trim()) {
    console.error(`[benchmark] SOURCE_WORKTREE_MUTATED before publish`)
    summary.publication.pushSkippedReason = 'SOURCE_WORKTREE_MUTATED'
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    return summary
  }

  // Now attempt QA branch publication via temp worktree — race gates use initialQaSha captured before commands
  const qaBranch = 'qa/windows-benchmarks'
  const qaRemoteSha = initialQaSha // for compatibility, but final check uses initialQaSha vs current
  const finalQaShaBeforePublish = gitLsRemote(qaBranch, repoRoot)
  console.log(`[benchmark] QA remote ${qaBranch} is ${finalQaShaBeforePublish ? finalQaShaBeforePublish.slice(0,7) : 'absent'} (initial was ${initialQaSha ? initialQaSha.slice(0,7) : 'absent'})`)
  // Race gate: if initial was absent, final must still be absent; if initial was present, final must equal initial
  if (initialQaSha === null && finalQaShaBeforePublish !== null) {
    console.error(`[benchmark] QA remote appeared concurrently (initial absent, now ${finalQaShaBeforePublish.slice(0,7)}) — will not publish`)
    summary.publication.pushSkippedReason = 'QA_REMOTE_MOVED'
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    return summary
  }
  if (initialQaSha !== null && finalQaShaBeforePublish !== initialQaSha) {
    console.error(`[benchmark] QA remote moved (initial ${initialQaSha.slice(0,7)} now ${finalQaShaBeforePublish?.slice(0,7) ?? 'null'}) — will not publish`)
    summary.publication.pushSkippedReason = 'QA_REMOTE_MOVED'
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    return summary
  }
  // For worktree logic, use finalQaShaBeforePublish as qaRemoteSha
  const effectiveQaSha = finalQaShaBeforePublish

  const tmpWorktree = nodePath.join(os.tmpdir(), `lia-qa-${runId}-${Date.now()}`)
  mkdirSync(tmpWorktree, { recursive: true })
  let committedSha = null
  let publicationSucceeded = false
  try {
    const addRes = git(['worktree', 'add', '--detach', tmpWorktree, pre.head], repoRoot)
    if (addRes.status !== 0) throw new Error(`worktree add failed: ${addRes.stderr}`)
    if (!effectiveQaSha) {
      // First publication: orphan — need to check both source and QA still absent before push
      const sw = git(['switch', '--orphan', qaBranch], tmpWorktree)
      if (sw.status !== 0) throw new Error(`switch --orphan failed: ${sw.stderr}`)
      for (const entry of readdirSync(tmpWorktree)) {
        if (entry === '.git') continue
        rmSync(nodePath.join(tmpWorktree, entry), { recursive: true, force: true })
      }
      writeFileSync(nodePath.join(tmpWorktree, 'README.md'), `# Lia Windows Benchmarks\n\nEvidence branch for Windows benchmark runs. Each folder under \`benchmarks/\` is one run.\n\nSource development branch: \`arena/01a09ddb-lia-project\`\n`, 'utf-8')
      const indexPath = nodePath.join(tmpWorktree, 'index.json')
      writeFileSync(indexPath, JSON.stringify([], null, 2) + '\n', 'utf-8')
      const benchDest = nodePath.join(tmpWorktree, 'benchmarks', runId)
      mkdirSync(benchDest, { recursive: true })
      for (const f of allPublishFiles.concat([manifestPath])) {
        const rel = nodePath.relative(publishDir, f)
        const dest = nodePath.join(benchDest, rel)
        mkdirSync(nodePath.dirname(dest), { recursive: true })
        copyFileSync(f, dest)
      }
      const idx = JSON.parse(readFileSync(indexPath, 'utf-8'))
      idx.unshift({ runId, sourceSha: pre.head, sourceBranch: pre.branch, status: summary.status, startedAt: summary.startedAt, endedAt: summary.endedAt, durationMs: summary.durationMs, reportPath: `benchmarks/${runId}/REPORT.md` })
      writeFileSync(indexPath, JSON.stringify(idx, null, 2) + '\n', 'utf-8')
      // Strict allowlist check: only README.md, index.json, benchmarks/<runId>/**
      const stagedCheck = gitCapture(['status', '--porcelain=v1', '-uall'], tmpWorktree)
      const stagedLines = stagedCheck ? stagedCheck.split('\n').filter(Boolean).map(l => l.slice(2).trim()) : []
      const allowedFirst = stagedLines.every(p => p === 'README.md' || p === 'index.json' || p.startsWith(`benchmarks/${runId}/`))
      if (!allowedFirst) throw new Error(`allowlist violation first: ${stagedLines.join(', ')}`)
      const filesToAdd = ['README.md', 'index.json', ...allPublishFiles.map(f => `benchmarks/${runId}/${nodePath.relative(publishDir, f).replace(/\\/g, '/')}`), `benchmarks/${runId}/SHA256SUMS.txt`]
      const addRes2 = git(['add', '--', ...filesToAdd], tmpWorktree)
      if (addRes2.status !== 0) throw new Error(`git add failed: ${addRes2.stderr}`)
      const cached = gitCapture(['diff', '--cached', '--name-only'], tmpWorktree)
      const cachedFiles = cached ? cached.split('\n').filter(Boolean) : []
      if (!cachedFiles.every(f => f === 'README.md' || f === 'index.json' || f.startsWith(`benchmarks/${runId}/`))) throw new Error(`cached allowlist violation: ${cachedFiles}`)
      // Scan staged files — must distinguish secret, unavailable, error, safe
      const toScan = cachedFiles.map(f => nodePath.join(tmpWorktree, f))
      const scanRes = scanWithBridge(toScan, repoRoot)
      if (scanRes.unavailable || scanRes.hasError || scanRes.hasSecret || !scanRes.safeToPublish) throw new Error(`secret or scan error in staged files, aborting commit: ${scanRes.error || 'hasSecret'}`)
      // Final race gates before push: check source == S and QA still absent (using initial)
      const srcNow = gitLsRemote(pre.branch, repoRoot)
      const qaNow = gitLsRemote(qaBranch, repoRoot)
      if (srcNow !== pre.head) throw new Error('SOURCE_REMOTE_MOVED_DURING_BENCHMARK')
      if (qaNow !== null) throw new Error('QA remote appeared concurrently, aborting push')
      if (initialQaSha !== null) throw new Error('QA remote appeared concurrently, aborting push')
      const msg = `qa(windows): benchmark ${runId} ${summary.status}\n\nSource-SHA: ${pre.head}\nSource-Branch: ${pre.branch}\n`
      const commitRes = git(['commit', '-m', msg], tmpWorktree)
      if (commitRes.status !== 0) throw new Error(`commit failed: ${commitRes.stderr}`)
      committedSha = gitRevParseHead(tmpWorktree)
      // No extra push check beyond above; now push
      const pushRes = git(['push', 'origin', `HEAD:refs/heads/${qaBranch}`], tmpWorktree)
      if (pushRes.status !== 0) throw new Error(`push failed: ${pushRes.stderr}`)
      publicationSucceeded = true
      // Update local summary with commit info (local only)
      summary.publication.committed = true
      summary.publication.commitSha = committedSha
      summary.publication.pushed = true
      summary.publication.pushSkippedReason = null
      writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    } else {
      // Existing branch
      const fetchRes = git(['fetch', 'origin', `${qaBranch}:${qaBranch}`], repoRoot)
      // Worktree already at S, checkout QA
      const checkoutRes = git(['checkout', qaBranch], tmpWorktree)
      if (checkoutRes.status !== 0) {
        git(['fetch', 'origin', qaBranch], tmpWorktree)
        const checkout2 = git(['checkout', qaBranch], tmpWorktree)
        if (checkout2.status !== 0) throw new Error(`checkout qa branch failed: ${checkout2.stderr}`)
      }
      const wtHead = gitRevParseHead(tmpWorktree)
      if (wtHead !== effectiveQaSha) throw new Error(`worktree HEAD ${wtHead?.slice(0,7)} != expected Q ${effectiveQaSha?.slice(0,7)}`)
      const benchDest = nodePath.join(tmpWorktree, 'benchmarks', runId)
      if (existsSync(benchDest)) throw new Error(`benchmark dest already exists: ${runId}`)
      mkdirSync(benchDest, { recursive: true })
      for (const f of allPublishFiles.concat([manifestPath])) {
        const rel = nodePath.relative(publishDir, f)
        const dest = nodePath.join(benchDest, rel)
        mkdirSync(nodePath.dirname(dest), { recursive: true })
        copyFileSync(f, dest)
      }
      const indexPath = nodePath.join(tmpWorktree, 'index.json')
      let idx = []
      if (existsSync(indexPath)) idx = JSON.parse(readFileSync(indexPath, 'utf-8'))
      idx.unshift({ runId, sourceSha: pre.head, sourceBranch: pre.branch, status: summary.status, startedAt: summary.startedAt, endedAt: summary.endedAt, durationMs: summary.durationMs, reportPath: `benchmarks/${runId}/REPORT.md` })
      writeFileSync(indexPath, JSON.stringify(idx, null, 2) + '\n', 'utf-8')
      // Strict allowlist: only index.json and benchmarks/<runId>/**
      const status2 = gitCapture(['status', '--porcelain=v1', '-uall'], tmpWorktree)
      const lines2 = status2 ? status2.split('\n').filter(Boolean).map(l => l.slice(2).trim()) : []
      const allowedExisting = lines2.every(p => p === 'index.json' || p.startsWith(`benchmarks/${runId}/`))
      if (!allowedExisting) throw new Error(`allowlist violation existing: ${lines2.join(', ')}`)
      const filesToAdd2 = ['index.json', ...allPublishFiles.map(f => `benchmarks/${runId}/${nodePath.relative(publishDir, f).replace(/\\/g, '/')}`), `benchmarks/${runId}/SHA256SUMS.txt`]
      const addRes3 = git(['add', '--', ...filesToAdd2], tmpWorktree)
      if (addRes3.status !== 0) throw new Error(`git add existing failed: ${addRes3.stderr}`)
      const cached2 = gitCapture(['diff', '--cached', '--name-only'], tmpWorktree)
      const cachedFiles2 = cached2 ? cached2.split('\n').filter(Boolean) : []
      if (!cachedFiles2.every(f => f === 'index.json' || f.startsWith(`benchmarks/${runId}/`))) throw new Error(`cached violation existing: ${cachedFiles2}`)
      const toScan2 = cachedFiles2.map(f => nodePath.join(tmpWorktree, f))
      const scan2 = scanWithBridge(toScan2, repoRoot)
      if (scan2.unavailable || scan2.hasError || scan2.hasSecret || !scan2.safeToPublish) throw new Error(`secret or scan error in staged existing: ${scan2.error || 'hasSecret'}`)
      // Final race gates before commit/push (as close to push as possible)
      const srcNow = gitLsRemote(pre.branch, repoRoot)
      const qaNow = gitLsRemote(qaBranch, repoRoot)
      if (srcNow !== pre.head) throw new Error('SOURCE_REMOTE_MOVED_DURING_BENCHMARK')
      if (qaNow !== effectiveQaSha) throw new Error('QA remote moved')
      // Also ensure initialQaSha still matches (in case QA moved after initial check but before this)
      if (qaNow !== initialQaSha) throw new Error('QA remote moved')
      const msg2 = `qa(windows): benchmark ${runId} ${summary.status}\n\nSource-SHA: ${pre.head}\nSource-Branch: ${pre.branch}\n`
      const commitRes2 = git(['commit', '-m', msg2], tmpWorktree)
      if (commitRes2.status !== 0) throw new Error(`commit existing failed: ${commitRes2.stderr}`)
      committedSha = gitRevParseHead(tmpWorktree)
      const pushRes2 = git(['push', 'origin', `HEAD:refs/heads/${qaBranch}`], tmpWorktree)
      if (pushRes2.status !== 0) throw new Error(`push existing failed: ${pushRes2.stderr}`)
      publicationSucceeded = true
      summary.publication.committed = true
      summary.publication.commitSha = committedSha
      summary.publication.pushed = true
      summary.publication.pushSkippedReason = null
      writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    }
  } catch (e) {
    console.error(`[benchmark] Publication failed: ${e.message}`)
    const msg = String(e.message)
    if (msg.includes('SOURCE_REMOTE_MOVED')) summary.publication.pushSkippedReason = 'SOURCE_REMOTE_MOVED_DURING_BENCHMARK'
    else if (msg.includes('QA remote') || msg.includes('QA appeared') || msg.includes('QA moved')) summary.publication.pushSkippedReason = msg.includes('SOURCE') ? 'SOURCE_REMOTE_MOVED_DURING_BENCHMARK' : 'QA_REMOTE_MOVED'
    else if (msg.includes('SOURCE_WORKTREE_MUTATED')) summary.publication.pushSkippedReason = 'SOURCE_WORKTREE_MUTATED'
    else if (msg.includes('allowlist')) summary.publication.pushSkippedReason = 'allowlist-violation'
    else if (msg.includes('secret') || msg.includes('scan')) summary.publication.pushSkippedReason = 'secret-residual'
    else if (msg.includes('publish-file-size') || msg.includes('publish-size')) summary.publication.pushSkippedReason = 'publish-size-limit'
    else summary.publication.pushSkippedReason = 'publication-error'
    writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    console.error(`[benchmark] Preserving temp worktree at ${tmpWorktree} for inspection`)
  } finally {
    if (publicationSucceeded && committedSha) {
      try { git(['worktree', 'remove', tmpWorktree], repoRoot) } catch { try { git(['worktree', 'remove', '--force', tmpWorktree], repoRoot) } catch {} }
      rmSync(tmpWorktree, { recursive: true, force: true })
    }
  }

  // Verify source worktree unchanged after publication (HEAD/branch/status)
  const afterHead = gitRevParseHead(repoRoot)
  const afterBranch = gitBranch(repoRoot)
  const afterStatus = gitStatusPorcelain(repoRoot)
  if (afterHead !== beforeHead || afterBranch !== beforeBranch || (afterStatus || '').trim() !== (beforeStatus || '').trim()) {
    console.error(`[benchmark] SOURCE_WORKTREE_MUTATED after: before ${beforeHead.slice(0,7)} ${beforeBranch} after ${afterHead?.slice(0,7)} ${afterBranch}`)
    // If publication succeeded but worktree mutated, we have inconsistent state — mark
    if (publicationSucceeded) {
      // Already pushed, but record mutation in local summary
      const local = JSON.parse(readFileSync(nodePath.join(rawRoot, 'summary.json'), 'utf-8'))
      local.publication.pushSkippedReason = 'SOURCE_WORKTREE_MUTATED'
      writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(local, null, 2) + '\n', 'utf-8')
    } else if (!summary.publication.pushSkippedReason) {
      summary.publication.pushSkippedReason = 'SOURCE_WORKTREE_MUTATED'
      writeFileSync(nodePath.join(rawRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8')
    }
  }

  console.log(`[benchmark] Done ${runId} status=${summary.status} pushed=${summary.publication.pushed ?? false}`)
  return summary
}

// CLI entry
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node Tests/tools/qa-benchmark.mjs [--no-push] [--report-only <id>] [--with-smoke]`)
    process.exit(0)
  }
  runBenchmark({ args }).then(s => {
    if (!s) process.exit(1)
    console.log(`[benchmark] Final status: ${s.status}`)
    // Do not treat INCOMPLETE as success
    if (s.status === 'INCOMPLETE') process.exit(1)
    process.exit(s.status === 'FAIL' ? 1 : 0)
  }).catch(e => {
    console.error(`[benchmark] Fatal: ${e.stack || e.message}`)
    process.exit(1)
  })
}
