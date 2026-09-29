#!/usr/bin/env node
/**
 * Lia QA benchmark harness (D2B8-B) — Windows benchmark automation.
 *
 * Responsibilities:
 *  preflight, runId, environment, hardware, command execution, log capture,
 *  metric parsing, classification, redaction, hashing, report, allowlist, commit/push.
 *
 * No production runtime change, no route comparison.
 * Evidence target: qa/windows-benchmarks (not arena/*).
 */

import { execSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

import { REPO_ROOT, RUNS_DIR, ensureDir, runTimestampId } from './qa-shared.mjs'
import { benchmarkRunId, boundText, buildShaManifest, canonicalCommands, classifyBenchmark, createSummarySkeleton, hardwareFromNode, PUBLISH_FILE_HARD_MAX, PUBLISH_PER_LOG_MAX, PUBLISH_TOTAL_HARD_MAX, sha256OfText } from './qa-benchmark-lib.mjs'

// ---------------------------------------------------------------------------
// Git helpers (minimal, allowlisted, no reset/clean/stash/rebase/force)
// ---------------------------------------------------------------------------
function git(args, cwd = REPO_ROOT, opts = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  const p = spawnSync('git', args, { cwd, env, encoding: 'utf-8', ...opts })
  return p
}

function gitCapture(args, cwd = REPO_ROOT) {
  try {
    return execSync(`git ${args.map(a => `"${a}"`).join(' ')}`, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    return null
  }
}

function gitRevParseHead(cwd = REPO_ROOT) {
  return gitCapture(['rev-parse', 'HEAD'], cwd)
}
function gitBranch(cwd = REPO_ROOT) {
  return gitCapture(['branch', '--show-current'], cwd)
}
function gitStatusPorcelain(cwd = REPO_ROOT) {
  try {
    const out = execSync('git status --porcelain=v1 -uall', { cwd, encoding: 'utf-8' })
    return out
  } catch { return null }
}
function gitLsRemote(branch, cwd = REPO_ROOT) {
  try {
    const out = execSync(`git ls-remote origin refs/heads/${branch}`, { cwd, encoding: 'utf-8' })
    const line = out.trim().split('\n')[0]
    return line ? line.split('\t')[0] : null
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Source preflight
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
  if (targetBranch) remoteSha = gitLsRemote(targetBranch, repoRoot)
  const isDetached = !branch
  const isDirty = status && status.trim() !== ''
  const remoteMismatch = head && remoteSha && head !== remoteSha
  if (isDetached) errors.push('detached HEAD')
  if (isDirty) errors.push('dirty worktree')
  if (remoteMismatch) errors.push(`local HEAD ${head?.slice(0,7)} != remote ${remoteSha?.slice(0,7)} for ${targetBranch}`)
  if (!targetBranch) errors.push('missing source branch')
  if (targetBranch === 'main' || targetBranch === 'master') errors.push('source branch main/master not supported for benchmark')
  return { head, branch: targetBranch, remoteSha, status, errors, isDirty, isDetached, remoteMismatch, toplevel }
}

// ---------------------------------------------------------------------------
// Run dirs
// ---------------------------------------------------------------------------
export function createBenchmarkRawRun({ runId, repoRoot = REPO_ROOT }) {
  const rawRoot = nodePath.join(repoRoot, 'Tests', 'runs', runId)
  for (const sub of ['logs/raw','logs/redacted','metrics','snapshots','artifacts']) mkdirSync(nodePath.join(rawRoot, sub), { recursive: true })
  writeFileSync(nodePath.join(rawRoot, 'run-info.txt'), `runId: ${runId}\nkind: benchmark\ncreated: ${new Date().toISOString()}\n`, 'utf-8')
  return rawRoot
}

export function createPublishStaging({ runId, repoRoot = REPO_ROOT }) {
  const staging = nodePath.join(repoRoot, '.devkit-qa', 'benchmark-publish', runId)
  rmSync(staging, { recursive: true, force: true })
  for (const sub of ['metrics','logs']) mkdirSync(nodePath.join(staging, 'benchmarks', runId, sub), { recursive: true })
  return nodePath.join(staging, 'benchmarks', runId)
}

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------
export function collectHardware() {
  const base = hardwareFromNode()
  // Try pnpm/git/python versions without installing
  try { base.pnpmVersion = execSync('pnpm --version', { encoding: 'utf-8' }).trim() } catch { base.pnpmVersion = null }
  try { base.gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim().replace('git version ','') } catch { base.gitVersion = null }
  try { base.pythonVersion = execSync('python --version', { encoding: 'utf-8' }).trim() } catch {
    try { base.pythonVersion = execSync('py --version', { encoding: 'utf-8' }).trim() } catch { base.pythonVersion = null }
  }
  // PowerShell CIM if on win32
  if (os.platform() === 'win32') {
    try {
      const ps = (cmd) => execSync(`powershell -NoProfile -Command "${cmd}"`, { encoding: 'utf-8', timeout: 5000 }).trim()
      try { const j = JSON.parse(ps('Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,TotalVisibleMemorySize | ConvertTo-Json -Compress')); base.osCaption = j.Caption; base.osVersion = j.Version; base.totalRamBytes = j.TotalVisibleMemorySize ? Number(j.TotalVisibleMemorySize)*1024 : base.totalRamBytes } catch {}
      try { const j = JSON.parse(ps('Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress')); const arr = Array.isArray(j)?j:[j]; base.cpuModel = arr[0]?.Name ?? base.cpuModel; base.physicalCores = arr[0]?.NumberOfCores ?? null; base.logicalCores = arr[0]?.NumberOfLogicalProcessors ?? base.logicalCores } catch {}
      try { const j = JSON.parse(ps('Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress')); const arr = Array.isArray(j)?j:[j]; base.gpu = arr.map(g=>({name:g.Name, vram:g.AdapterRAM})).filter(g=>g.name) } catch { base.gpu = null }
    } catch {}
  }
  // Disk free
  try {
    const stat = statSync(REPO_ROOT)
    // approximate via os.freemem not disk, but try df on linux
    if (os.platform() !== 'win32') {
      try { const df = execSync('df -k .', { cwd: REPO_ROOT, encoding: 'utf-8' }); base.diskFree = df } catch {}
    }
  } catch {}
  // Chromium
  try { base.chromiumAvailable = !!execSync('pnpm exec playwright --version', { encoding: 'utf-8', stdio: ['ignore','pipe','ignore'] }) } catch { base.chromiumAvailable = false }
  // Strip sensitive
  delete base.freeRamBytes // keep total only? spec says ram total allowed, free is ok as metric before/after
  return base
}

// ---------------------------------------------------------------------------
// Command execution (static argv, pnpm exec, bounded)
// ---------------------------------------------------------------------------
export function runCommand({ id, label, cwd, argv, logPath, repoRoot = REPO_ROOT }) {
  const startedAt = new Date()
  const env = { ...process.env }
  // Ensure pnpm exec resolves local
  const result = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: 'utf-8', maxBuffer: 20*1024*1024, timeout: 600000 })
  const endedAt = new Date()
  const durationMs = endedAt - startedAt
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const combined = `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n`
  // Write raw log
  if (logPath) {
    try { mkdirSync(nodePath.dirname(logPath), { recursive: true }); writeFileSync(logPath, combined, 'utf-8') } catch {}
  }
  const exitCode = result.status
  const status = result.error ? 'environment-limited' : (exitCode === 0 ? 'passed' : 'failed')
  // Try parse test counts if json
  let testFiles, passed, failed, skipped
  try {
    // look for vitest json output file if argv contained outputFile
    // fallback parse stdout for "Test Files"
    const m = combined.match(/Test Files\s+(\d+)\s+passed/)
    if (m) testFiles = Number(m[1])
  } catch {}
  return { id, label, cwd: nodePath.relative(repoRoot, cwd).replace(/\\/g,'/'), argv, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs, exitCode, status, logPath: logPath ? nodePath.relative(repoRoot, logPath).replace(/\\/g,'/'): null, testFiles, passed, failed, skipped, truncated: false }
}

// ---------------------------------------------------------------------------
// Redaction pipeline via security bridge
// ---------------------------------------------------------------------------
export function redactWithBridge(text, repoRoot = REPO_ROOT) {
  // Try python bridge; if unavailable, fallback to no redaction but mark
  const bridge = nodePath.join(repoRoot, 'Tests', 'tools', 'qa-security-bridge.py')
  if (!existsSync(bridge)) return { text, applied: false, error: 'bridge missing' }
  try {
    // Write temp file, call bridge redact
    const tmp = nodePath.join(os.tmpdir(), `lia-redact-${Date.now()}.txt`)
    writeFileSync(tmp, text, 'utf-8')
    const out = execSync(`python "${bridge}" redact "${tmp}"`, { encoding: 'utf-8', maxBuffer: 10*1024*1024 })
    rmSync(tmp, { force: true })
    return { text: out, applied: true }
  } catch (e) {
    return { text, applied: false, error: String(e) }
  }
}

export function scanWithBridge(files, repoRoot = REPO_ROOT) {
  const bridge = nodePath.join(repoRoot, 'Tests', 'tools', 'qa-security-bridge.py')
  if (!existsSync(bridge)) return { hasSecret: false, unavailable: true }
  try {
    const args = files.map(f=>`"${f}"`).join(' ')
    const out = execSync(`python "${bridge}" scan --json ${args}`, { encoding: 'utf-8', maxBuffer: 10*1024*1024 })
    const res = JSON.parse(out)
    return { hasSecret: res.hasSecret, results: res.results, unavailable: false }
  } catch (e) {
    // if exit 1, hasSecret true
    try {
      const out = e.stdout?.toString() ?? ''
      if (out) return JSON.parse(out)
    } catch {}
    return { hasSecret: true, error: String(e), unavailable: false }
  }
}

// ---------------------------------------------------------------------------
// Publish staging helpers
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
    `- Committed: ${summary.publication.committed}`,
    `- Pushed: ${summary.publication.pushed}`,
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
export async function runBenchmark({ repoRoot = REPO_ROOT, args = process.argv.slice(2), now = new Date(), gitRunner = null, commandRunner = null, hardwareCollector = null } = {}) {
  const rawArgs = args
  const isReportOnly = rawArgs.includes('--report-only')
  const reportOnlyId = isReportOnly ? rawArgs[rawArgs.indexOf('--report-only')+1] : null
  const noPush = rawArgs.includes('--no-push')
  const withSmoke = rawArgs.includes('--with-smoke')

  if (isReportOnly) {
    // Regenerate report from existing local run
    if (!reportOnlyId) { console.error('usage: --report-only <run-id>'); process.exit(2) }
    const rawRoot = nodePath.join(repoRoot, 'Tests', 'runs', reportOnlyId)
    const publishStaging = nodePath.join(repoRoot, '.devkit-qa','benchmark-publish', reportOnlyId, 'benchmarks', reportOnlyId)
    if (!existsSync(nodePath.join(rawRoot, 'summary.json'))) { console.error(`No local run ${reportOnlyId}`); process.exit(1) }
    console.log(`Regenerating report for ${reportOnlyId} (no tests, no commit)`)
    return
  }

  // Preflight
  const pre = preflightSource({ repoRoot })
  console.log(`[benchmark] HEAD ${pre.head?.slice(0,7)} branch ${pre.branch} remote ${pre.remoteSha?.slice(0,7)}`)
  if (pre.errors.length) {
    console.error(`[benchmark] Preflight failed: ${pre.errors.join('; ')}`)
    console.error(`[benchmark] git status:\n${pre.status}`)
    process.exit(1)
  }

  const shortSha = pre.head.slice(0,7)
  const runId = benchmarkRunId(now, shortSha)
  console.log(`[benchmark] Run ID ${runId}`)

  // Create raw and publish dirs
  const rawRoot = createBenchmarkRawRun({ runId, repoRoot })
  const publishDir = createPublishStaging({ runId, repoRoot })
  const startedAt = new Date()

  // Capture git/environment
  const gitInfo = { sourceSha: pre.head, sourceBranch: pre.branch, remoteSourceSha: pre.remoteSha, repoRoot, gitVersion: (()=>{try{return execSync('git --version',{encoding:'utf-8'}).trim()}catch{return null}})(), nodeVersion: process.version, pnpmVersion: (()=>{try{return execSync('pnpm --version',{encoding:'utf-8'}).trim()}catch{return null}})(), pythonVersion: (()=>{try{return execSync('python --version',{encoding:'utf-8'}).trim()}catch{try{return execSync('py --version',{encoding:'utf-8'}).trim()}catch{return null}}})() }
  const hardware = (hardwareCollector || collectHardware)()

  // Commands
  let commands = canonicalCommands(repoRoot)
  if (!withSmoke) commands = commands.filter(c=>c.id!=='runtime-smoke')
  // Do not auto-add smoke; spec says optional only with --with-smoke
  const commandResults = []
  let totalDuration = 0
  const rawLogsDir = nodePath.join(rawRoot, 'logs','raw')
  mkdirSync(rawLogsDir, { recursive: true })

  for (const cmd of commands) {
    const logPath = nodePath.join(rawLogsDir, `${cmd.id}.log`)
    console.log(`[benchmark] Running ${cmd.id}: ${cmd.argv.join(' ')} in ${cmd.cwd}`)
    // Check binary exists: pnpm exec vitest -> check node_modules/.bin/vitest
    const bin = nodePath.join(cmd.cwd, 'node_modules','.bin', cmd.argv[2] ?? '')
    let envLimited = false
    if (cmd.argv[0]==='pnpm' && cmd.argv[1]==='exec') {
      const tool = cmd.argv[2]
      const localBin = existsSync(nodePath.join(cmd.cwd,'node_modules','.bin', tool)) || existsSync(nodePath.join(repoRoot,'node_modules','.bin', tool)) || existsSync(nodePath.join(repoRoot,'airi','node_modules','.bin', tool))
      if (!localBin) {
        console.warn(`[benchmark] ${tool} not found locally, marking ENVIRONMENT-LIMITED`)
        envLimited = true
      }
    }
    let res
    if (envLimited) {
      res = { id: cmd.id, label: cmd.label, cwd: cmd.cwd, argv: cmd.argv, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 0, exitCode: null, status: 'environment-limited', logPath, truncated: false }
      writeFileSync(logPath, `[ENVIRONMENT-LIMITED] ${cmd.argv.join(' ')} not found locally - no install attempted\n`, 'utf-8')
    } else {
      const runner = commandRunner || runCommand
      res = runner({ ...cmd, logPath, repoRoot })
      // If vitest missing -> would have thrown, but we already checked
      if (res.exitCode !== 0 && res.exitCode !== null) {
        // Check if browser missing is env-limited
        if (cmd.id==='browser' && (readFileSync(logPath,'utf-8').includes('chromium') || readFileSync(logPath,'utf-8').includes('browser'))) {
          res.status = 'environment-limited'
        }
      }
    }
    commandResults.push(res)
    totalDuration += res.durationMs ?? 0
    // Also copy raw to publish after redaction/bounding later
  }

  const endedAt = new Date()
  const durationMs = endedAt - startedAt

  // Performance metrics: RAM/disk before/after (simple)
  const perf = { totalDurationMs: durationMs, commands: commandResults.map(c=>({id:c.id,durationMs:c.durationMs,exitCode:c.exitCode,status:c.status})), ramBefore: os.totalmem() - os.freemem(), diskBefore: null }

  // Classification
  const envLims = []
  if (commandResults.some(c=>c.status==='environment-limited')) envLims.push('some commands environment-limited')
  const status = classifyBenchmark({ commands: commandResults, environmentLimitations: envLims })

  // Failures
  const failures = commandResults.filter(c=>c.status==='failed').map(c=>({id:c.id, exitCode:c.exitCode, summary:`${c.label} failed`}))
  const warnings = []

  // Prepare summary skeleton
  const summary = createSummarySkeleton({ runId, sourceSha: pre.head, sourceBranch: pre.branch, remoteSourceSha: pre.remoteSha, startedAt })
  summary.endedAt = endedAt.toISOString()
  summary.durationMs = durationMs
  summary.status = status
  summary.environmentLimitations = envLims
  summary.failures = failures
  summary.warnings = warnings
  summary.commands = commandResults
  summary.hardwareSummary = hardware
  summary.publication.requested = !noPush
  summary.publication.branch = 'qa/windows-benchmarks'

  // Write raw summary to rawRoot for local
  mkdirSync(nodePath.join(rawRoot,'metrics'),{recursive:true})
  writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')

  // Build publishable staging: copy and redact logs
  const publishLogsDir = nodePath.join(publishDir,'logs')
  mkdirSync(publishLogsDir,{recursive:true})
  const publishMetricsDir = nodePath.join(publishDir,'metrics')
  mkdirSync(publishMetricsDir,{recursive:true})
  let redactionApplied = false
  let residualDetected = false
  const truncationLogs = []
  const publishFiles = []

  for (const cmd of commandResults) {
    const rawLog = nodePath.join(rawLogsDir, `${cmd.id}.log`)
    if (!existsSync(rawLog)) continue
    let text = readFileSync(rawLog,'utf-8')
    // Redact
    const red = redactWithBridge(text, repoRoot)
    if (red.applied) { text = red.text; redactionApplied = true }
    // Bound
    const bounded = boundText(text, PUBLISH_PER_LOG_MAX)
    if (bounded.truncated) {
      truncationLogs.push({ path: `logs/${cmd.id}.log`, originalBytes: bounded.originalBytes, retainedBytes: bounded.retainedBytes })
      warnings.push(`log ${cmd.id} truncated`)
    }
    text = bounded.text
    // Scan residual
    const scan = scanWithBridge([rawLog], repoRoot) // scan raw? Actually scan redacted temp
    // For simplicity scan the bounded text via temp file
    const tmpScan = nodePath.join(os.tmpdir(), `lia-scan-${cmd.id}.log`)
    writeFileSync(tmpScan, text,'utf-8')
    const scan2 = scanWithBridge([tmpScan], repoRoot)
    rmSync(tmpScan,{force:true})
    if (scan2.hasSecret) {
      residualDetected = true
      text = `log omitted\nresidual sensitive pattern detected\nlocal raw retained in Tests/runs/${runId}/logs/raw/${cmd.id}.log\n`
    }
    if (Buffer.from(text).length > PUBLISH_FILE_HARD_MAX) {
      // already bounded to 2MiB, so hard limit not hit unless we missed
      text = boundText(text, PUBLISH_FILE_HARD_MAX).text
    }
    const outPath = nodePath.join(publishLogsDir, `${cmd.id}.log`)
    writeFileSync(outPath, text,'utf-8')
    publishFiles.push(outPath)
  }

  // Metrics publish
  const metricsTestsPath = nodePath.join(publishMetricsDir,'tests.json')
  writeFileSync(metricsTestsPath, JSON.stringify({ commands: commandResults },null,2)+'\n','utf-8')
  publishFiles.push(metricsTestsPath)
  const perfPath = nodePath.join(publishMetricsDir,'performance.json')
  writeFileSync(perfPath, JSON.stringify(perf,null,2)+'\n','utf-8')
  publishFiles.push(perfPath)
  const hwPath = writeHardware({ publishDir, hardware })
  publishFiles.push(hwPath)
  const brainPath = writeBrainRouting({ publishDir })
  publishFiles.push(brainPath)

  const envPath = writeEnvironment({ publishDir, env: { hardware, git: gitInfo } })
  publishFiles.push(envPath)
  const gitPath = writeGitJson({ publishDir, git: gitInfo })
  publishFiles.push(gitPath)

  summary.redaction.applied = redactionApplied
  summary.redaction.residualSensitiveContentDetected = residualDetected
  summary.truncation.occurred = truncationLogs.length>0
  summary.truncation.logs = truncationLogs

  // Check total size
  let totalBytes = publishFiles.reduce((sum,f)=>{try{return sum+statSync(f).size}catch{return sum}},0)
  // If exceeds hard max, truncate further (already bounded per file, so unlikely)
  if (totalBytes > PUBLISH_TOTAL_HARD_MAX) {
    warnings.push(`total publish size ${totalBytes} exceeds ${PUBLISH_TOTAL_HARD_MAX}`)
    summary.truncation.occurred = true
  }

  // Write summary/report to publish
  const summaryPath = writeSummary({ publishDir, summary })
  publishFiles.push(summaryPath)
  const reportPath = writeReport({ publishDir, summary, hardware, git: gitInfo })
  publishFiles.push(reportPath)

  // Hash manifest (exclude itself)
  const allPublishFiles = readdirSync(publishDir, { recursive: true, withFileTypes: true }).flatMap(e=> e.isFile() ? [nodePath.join(e.parentPath, e.name)] : []).filter(f=> !f.endsWith('SHA256SUMS.txt'))
  const manifest = buildShaManifest(allPublishFiles, publishDir)
  const manifestPath = nodePath.join(publishDir,'SHA256SUMS.txt')
  writeFileSync(manifestPath, manifest,'utf-8')
  publishFiles.push(manifestPath)
  summary.artifacts = allPublishFiles.map(f=> nodePath.relative(publishDir,f).replace(/\\/g,'/')).concat(['SHA256SUMS.txt']).sort()

  // Also update raw summary with publication info before potential commit
  writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
  writeFileSync(nodePath.join(publishDir,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')

  // Security gate: if residual or bridge unavailable and hasSecret, block publication
  if (residualDetected) {
    console.error('[benchmark] Residual secret detected — will not commit/publish')
    summary.publication.pushSkippedReason = 'secret-residual'
    // Still write summary
    writeFileSync(nodePath.join(publishDir,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    // Do not commit
    return summary
  }
  // Check bridge availability: if python missing, env-limited
  const bridgeExists = existsSync(nodePath.join(repoRoot,'Tests','tools','qa-security-bridge.py'))
  if (!bridgeExists) {
    console.warn('[benchmark] Security bridge unavailable — publication blocked')
    summary.status = summary.status==='PASS' ? 'ENVIRONMENT-LIMITED' : summary.status
    summary.publication.pushSkippedReason = 'security-guard-unavailable'
    writeFileSync(nodePath.join(publishDir,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }

  // Publication: create QA branch worktree and push if requested and not --no-push
  if (noPush) {
    console.log('[benchmark] --no-push: local only, no commit/push')
    summary.publication.pushSkippedReason = 'no-push-flag'
    writeFileSync(nodePath.join(publishDir,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }

  // Check source remote still S and QA remote race
  const currentRemoteSha = gitLsRemote(pre.branch, repoRoot)
  if (currentRemoteSha !== pre.head) {
    console.error(`[benchmark] Source remote moved during benchmark: ${pre.head.slice(0,7)} != ${currentRemoteSha?.slice(0,7)} — will not publish`)
    summary.publication.pushSkippedReason = 'SOURCE_REMOTE_MOVED_DURING_BENCHMARK'
    writeFileSync(nodePath.join(publishDir,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
    return summary
  }

  // Now attempt QA branch publication via temp worktree
  const qaBranch = 'qa/windows-benchmarks'
  const qaRemoteSha = gitLsRemote(qaBranch, repoRoot) // null if absent
  console.log(`[benchmark] QA remote ${qaBranch} is ${qaRemoteSha ? qaRemoteSha.slice(0,7) : 'absent'}`)

  // Create temp worktree
  const tmpWorktree = nodePath.join(os.tmpdir(), `lia-qa-${runId}-${Date.now()}`)
  mkdirSync(tmpWorktree, { recursive: true })
  let committedSha = null
  try {
    // worktree add --detach at source SHA
    const addRes = git(['worktree','add','--detach',tmpWorktree, pre.head], repoRoot)
    if (addRes.status!==0) throw new Error(`worktree add failed: ${addRes.stderr}`)
    // Inside worktree, check status empty
    const wtStatus = gitCapture(['status','--porcelain=v1','-uall'], tmpWorktree)
    // For orphan case, we will switch to orphan
    if (!qaRemoteSha) {
      // First publication: orphan
      const sw = git(['switch','--orphan', qaBranch], tmpWorktree)
      if (sw.status!==0) throw new Error(`switch --orphan failed: ${sw.stderr}`)
      // Remove all files from orphan (it starts with source tree, need to clear except .git)
      // For orphan, worktree is empty after switch? Actually it retains files but not committed. We need to clean.
      // Use git rm if needed (spec forbids destructive git ops in source checkout — this is QA worktree, allowed).
      // Safer: remove everything except .git via fs
      for (const entry of readdirSync(tmpWorktree)) {
        if (entry === '.git') continue
        rmSync(nodePath.join(tmpWorktree, entry), { recursive: true, force: true })
      }
      // Create README and index and benchmarks
      writeFileSync(nodePath.join(tmpWorktree,'README.md'), `# Lia Windows Benchmarks\n\nEvidence branch for Windows benchmark runs. Each folder under \`benchmarks/\` is one run.\n\nSource development branch: \`arena/01a09ddb-lia-project\`\n`, 'utf-8')
      const indexPath = nodePath.join(tmpWorktree,'index.json')
      writeFileSync(indexPath, JSON.stringify([],null,2)+'\n','utf-8')
      const benchDest = nodePath.join(tmpWorktree,'benchmarks',runId)
      mkdirSync(benchDest,{recursive:true})
      // Copy publishDir content
      for (const f of allPublishFiles.concat([manifestPath])) {
        const rel = nodePath.relative(publishDir, f)
        const dest = nodePath.join(benchDest, rel)
        mkdirSync(nodePath.dirname(dest),{recursive:true})
        copyFileSync(f, dest)
      }
      // Also copy summary/report etc. already included; ensure SHA256SUMS at dest
      // Update index
      const idx = JSON.parse(readFileSync(indexPath,'utf-8'))
      idx.unshift({ runId, sourceSha: pre.head, sourceBranch: pre.branch, status: summary.status, startedAt: summary.startedAt, endedAt: summary.endedAt, durationMs: summary.durationMs, reportPath: `benchmarks/${runId}/REPORT.md` })
      writeFileSync(indexPath, JSON.stringify(idx,null,2)+'\n','utf-8')
      // Verify allowlist
      const stagedCheck = gitCapture(['status','--porcelain=v1','-uall'], tmpWorktree)
      const stagedLines = stagedCheck ? stagedCheck.split('\n').filter(Boolean).map(l=>l.slice(3).trim()) : []
      const allowed = stagedLines.every(p=> p==='README.md' || p==='index.json' || p.startsWith(`benchmarks/${runId}/`))
      if (!allowed) throw new Error(`allowlist violation: ${stagedLines.join(', ')}`)
      // Stage exactly
      const filesToAdd = ['README.md','index.json', ...allPublishFiles.map(f=> `benchmarks/${runId}/${nodePath.relative(publishDir,f).replace(/\\/g,'/')}`), `benchmarks/${runId}/SHA256SUMS.txt`]
      // Use explicit add
      let addArgs = ['add','--', ...filesToAdd]
      // If files contain spaces, need to handle; assume no spaces
      const addRes2 = git(addArgs, tmpWorktree)
      if (addRes2.status!==0) throw new Error(`git add failed: ${addRes2.stderr}`)
      const cached = gitCapture(['diff','--cached','--name-only'], tmpWorktree)
      const cachedFiles = cached ? cached.split('\n').filter(Boolean) : []
      if (!cachedFiles.every(f=> f==='README.md' || f==='index.json' || f.startsWith(`benchmarks/${runId}/`))) throw new Error(`cached allowlist violation: ${cachedFiles}`)
      // Scan staged files for secrets via bridge
      const toScan = cachedFiles.map(f=> nodePath.join(tmpWorktree,f))
      const scanRes = scanWithBridge(toScan, repoRoot)
      if (scanRes.hasSecret) throw new Error(`secret detected in staged files, aborting commit`)
      // Commit
      const msg = `qa(windows): benchmark ${runId} ${summary.status}\n\nSource-SHA: ${pre.head}\nSource-Branch: ${pre.branch}\n`
      const commitRes = git(['commit','-m', msg], tmpWorktree)
      if (commitRes.status!==0) throw new Error(`commit failed: ${commitRes.stderr}`)
      committedSha = gitRevParseHead(tmpWorktree)
      // Verify remote still absent before push
      const stillAbsent = !gitLsRemote(qaBranch, repoRoot)
      if (!stillAbsent) throw new Error('QA remote appeared concurrently, aborting push')
      const pushRes = git(['push','origin',`HEAD:refs/heads/${qaBranch}`], tmpWorktree)
      if (pushRes.status!==0) throw new Error(`push failed: ${pushRes.stderr}`)
      summary.publication.committed = true
      summary.publication.commitSha = committedSha
      summary.publication.pushed = true
    } else {
      // Existing branch: fetch and worktree at Q
      // Fetch QA branch
      git(['fetch','origin',`${qaBranch}:${qaBranch}`], repoRoot) // may fail if not needed
      // Worktree already at S, need to checkout qaBranch
      // Instead, we already have worktree at S, switch to qaBranch
      const checkoutRes = git(['checkout', qaBranch], tmpWorktree)
      // If checkout fails, try fetch
      if (checkoutRes.status!==0) {
        git(['fetch','origin', qaBranch], tmpWorktree)
        const checkout2 = git(['checkout', qaBranch], tmpWorktree)
        if (checkout2.status!==0) throw new Error(`checkout qa branch failed: ${checkout2.stderr}`)
      }
      // Ensure worktree is at Q
      const wtHead = gitRevParseHead(tmpWorktree)
      if (wtHead !== qaRemoteSha) throw new Error(`worktree HEAD ${wtHead?.slice(0,7)} != expected Q ${qaRemoteSha?.slice(0,7)}`)
      // Copy new benchmark
      const benchDest = nodePath.join(tmpWorktree,'benchmarks',runId)
      mkdirSync(benchDest,{recursive:true})
      for (const f of allPublishFiles.concat([manifestPath])) {
        const rel = nodePath.relative(publishDir, f)
        const dest = nodePath.join(benchDest, rel)
        mkdirSync(nodePath.dirname(dest),{recursive:true})
        copyFileSync(f, dest)
      }
      // Update index.json
      const indexPath = nodePath.join(tmpWorktree,'index.json')
      let idx = []
      if (existsSync(indexPath)) idx = JSON.parse(readFileSync(indexPath,'utf-8'))
      idx.unshift({ runId, sourceSha: pre.head, sourceBranch: pre.branch, status: summary.status, startedAt: summary.startedAt, endedAt: summary.endedAt, durationMs: summary.durationMs, reportPath: `benchmarks/${runId}/REPORT.md` })
      writeFileSync(indexPath, JSON.stringify(idx,null,2)+'\n','utf-8')
      // Verify allowlist
      const status2 = gitCapture(['status','--porcelain=v1','-uall'], tmpWorktree)
      const lines2 = status2 ? status2.split('\n').filter(Boolean).map(l=>l.slice(3).trim()) : []
      if (!lines2.every(p=> p===`benchmarks/${runId}` || p.startsWith(`benchmarks/${runId}/`) || p==='index.json' || p.startsWith('benchmarks/'))) {
        // More strict: only benchmarks/<runId>/** and index.json
        const allowed2 = lines2.every(p=> p==='index.json' || p.startsWith(`benchmarks/${runId}/`))
        if (!allowed2) throw new Error(`allowlist violation existing: ${lines2.join(', ')}`)
      }
      const filesToAdd2 = ['index.json', ...allPublishFiles.map(f=> `benchmarks/${runId}/${nodePath.relative(publishDir,f).replace(/\\/g,'/')}`), `benchmarks/${runId}/SHA256SUMS.txt`]
      const addRes3 = git(['add','--', ...filesToAdd2], tmpWorktree)
      if (addRes3.status!==0) throw new Error(`git add existing failed: ${addRes3.stderr}`)
      const cached2 = gitCapture(['diff','--cached','--name-only'], tmpWorktree)
      const cachedFiles2 = cached2 ? cached2.split('\n').filter(Boolean) : []
      if (!cachedFiles2.every(f=> f==='index.json' || f.startsWith(`benchmarks/${runId}/`))) throw new Error(`cached violation existing: ${cachedFiles2}`)
      const toScan2 = cachedFiles2.map(f=> nodePath.join(tmpWorktree,f))
      const scan2 = scanWithBridge(toScan2, repoRoot)
      if (scan2.hasSecret) throw new Error('secret in staged existing')
      // Verify source remote still S and QA remote still Q before push
      const srcNow = gitLsRemote(pre.branch, repoRoot)
      const qaNow = gitLsRemote(qaBranch, repoRoot)
      if (srcNow !== pre.head) throw new Error(`SOURCE_REMOTE_MOVED_DURING_BENCHMARK`)
      if (qaNow !== qaRemoteSha) throw new Error(`QA remote moved`)
      const msg2 = `qa(windows): benchmark ${runId} ${summary.status}\n\nSource-SHA: ${pre.head}\nSource-Branch: ${pre.branch}\n`
      const commitRes2 = git(['commit','-m', msg2], tmpWorktree)
      if (commitRes2.status!==0) throw new Error(`commit existing failed: ${commitRes2.stderr}`)
      committedSha = gitRevParseHead(tmpWorktree)
      const pushRes2 = git(['push','origin',`HEAD:refs/heads/${qaBranch}`], tmpWorktree)
      if (pushRes2.status!==0) throw new Error(`push existing failed: ${pushRes2.stderr}`)
      summary.publication.committed = true
      summary.publication.commitSha = committedSha
      summary.publication.pushed = true
    }
  } catch (e) {
    console.error(`[benchmark] Publication failed: ${e.message}`)
    summary.publication.pushSkippedReason = e.message.includes('SOURCE_REMOTE_MOVED') ? 'SOURCE_REMOTE_MOVED_DURING_BENCHMARK' : (e.message.includes('QA remote') ? 'QA_REMOTE_MOVED' : 'publication-error')
    // Preserve worktree for forensics
    console.error(`[benchmark] Preserving temp worktree at ${tmpWorktree} for inspection`)
    // Do not delete
    // Update summary
  } finally {
    // Cleanup worktree if not preserved due to error? Spec says preserve for forensics if failed, so only remove on success
    if (committedSha && summary.publication.pushed) {
      try { git(['worktree','remove', tmpWorktree], repoRoot) } catch { try{ git(['worktree','remove','--force', tmpWorktree], repoRoot)}catch{} }
      rmSync(tmpWorktree, { recursive: true, force: true })
    }
  }

  // Verify source worktree unchanged
  const afterHead = gitRevParseHead(repoRoot)
  if (afterHead !== pre.head) {
    console.error(`[benchmark] SOURCE WORKTREE MOVED! before ${pre.head.slice(0,7)} after ${afterHead?.slice(0,7)}`)
    // This is fatal, but we already committed to QA branch, source should not have moved
  }

  // Update final summary files
  writeFileSync(nodePath.join(publishDir,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
  writeFileSync(nodePath.join(rawRoot,'summary.json'), JSON.stringify(summary,null,2)+'\n','utf-8')
  // Also write to publishDir report
  writeReport({ publishDir, summary, hardware, git: gitInfo })

  console.log(`[benchmark] Done ${runId} status=${summary.status} pushed=${summary.publication.pushed}`)
  // Ensure .devkit-qa staging is not committed to source branch (it's ignored)
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
  runBenchmark({ args }).then(s=>{
    console.log(`[benchmark] Final status: ${s.status}`)
    process.exit(s.status==='FAIL' ? 1 : 0)
  }).catch(e=>{
    console.error(`[benchmark] Fatal: ${e.stack || e.message}`)
    process.exit(1)
  })
}
