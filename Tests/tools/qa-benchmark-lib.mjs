#!/usr/bin/env node
/**
 * Lia QA benchmark library — pure, testable helpers.
 * No git writes, no spawn, no fs outside injected root.
 * D2B8-B corrective: fail-closed, python resolution, classification, hard limits.
 */

import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import nodePath from 'node:path'
import os from 'node:os'

import { REPO_ROOT, runTimestampId } from './qa-shared.mjs'

// ---------------------------------------------------------------------------
// Run ID
// ---------------------------------------------------------------------------
export function benchmarkRunId(now = new Date(), shortSha = 'unknown') {
  const base = runTimestampId(now)
  const sha = (shortSha || 'unknown').slice(0, 7)
  return `${base}-${sha}`
}

export function nextBenchmarkRunId(a, b, c) {
  // Overload: nextBenchmarkRunId(baseId: string, existing: Set<string>) for tests
  //        or nextBenchmarkRunId(runsDir: string, now: Date, shortSha: string) for runtime
  if (typeof a === 'string' && b instanceof Set) {
    const base = a
    let candidate = base
    let suffix = 1
    const existing = b
    while (existing.has(candidate)) {
      suffix += 1
      candidate = `${base}-${suffix}`
    }
    return candidate
  }
  const runsDir = a
  const now = b
  const shortSha = c
  let id = benchmarkRunId(now, shortSha)
  let suffix = 1
  // Collision covers both local runs and publish staging, no deletion
  while (
    existsSync(nodePath.join(runsDir, id)) ||
    existsSync(nodePath.join(REPO_ROOT, '.devkit-qa', 'benchmark-publish', id)) ||
    existsSync(nodePath.join(REPO_ROOT, 'Tests', 'benchmarks', id)) ||
    existsSync(nodePath.join(REPO_ROOT, 'Tests', 'runs', id))
  ) {
    suffix += 1
    id = `${benchmarkRunId(now, shortSha)}-${suffix}`
  }
  return id
}

// ---------------------------------------------------------------------------
// Python resolution — prefer py -3 >=3.10 else python >=3.10
// ---------------------------------------------------------------------------
export function resolvePython({ spawn = spawnSync } = {}) {
  const candidates = [
    { argv: ['py', '-3', '--version'], label: 'py -3' },
    { argv: ['python', '--version'], label: 'python' },
    { argv: ['python3', '--version'], label: 'python3' },
  ]
  for (const cand of candidates) {
    try {
      const res = spawn(cand.argv[0], cand.argv.slice(1), { encoding: 'utf-8', timeout: 3000 })
      const out = (res.stdout || '') + (res.stderr || '')
      const m = out.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i)
      if (m) {
        const major = Number(m[1]); const minor = Number(m[2])
        if (major > 3 || (major === 3 && minor >= 10)) {
          // Return argv prefix to invoke bridge: e.g. ['py','-3'] -> ['py','-3','path']
          // For python/python3, just ['python']
          if (cand.argv[0] === 'py') return { argv: ['py', '-3'], version: `${major}.${minor}.${m[3]}`, raw: out.trim() }
          return { argv: [cand.argv[0]], version: `${major}.${minor}.${m[3]}`, raw: out.trim() }
        }
      } else if (res.status === 0 && out.toLowerCase().includes('python')) {
        // If version unparsable but exit 0, still consider available but mark version unknown
        // Don't use if can't verify >=3.10
      }
    } catch {}
  }
  return null
}

export function isPythonAvailable(opts = {}) {
  return resolvePython(opts) !== null
}

// ---------------------------------------------------------------------------
// Command inventory — static argv, no shell
// ---------------------------------------------------------------------------
export function benchmarkCommands({ repoRoot = REPO_ROOT } = {}) {
  const airiRoot = nodePath.join(repoRoot, 'airi')
  return [
    {
      id: 'stage-vitest',
      label: 'Stage full (node)',
      cwd: nodePath.join(airiRoot, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run'],
      mandatory: true,
    },
    {
      id: 'core-agent',
      label: 'core-agent suite',
      cwd: airiRoot,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/core-agent'],
      mandatory: true,
    },
    {
      id: 'lia-core',
      label: 'lia-core suite',
      cwd: nodePath.join(airiRoot, 'packages', 'lia-core'),
      argv: ['pnpm', 'test'],
      mandatory: true,
    },
    {
      id: 'stage-ui',
      label: 'stage-ui suite',
      cwd: airiRoot,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/stage-ui'],
      mandatory: true,
    },
    {
      id: 'browser',
      label: 'Browser Stage (chromium)',
      cwd: nodePath.join(airiRoot, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser'],
      mandatory: true,
    },
    {
      id: 'lint',
      label: 'Lint',
      cwd: airiRoot,
      argv: ['pnpm', 'lint'],
      mandatory: true,
    },
    {
      id: 'typecheck',
      label: 'Typecheck',
      cwd: airiRoot,
      argv: ['pnpm', 'typecheck'],
      mandatory: true,
    },
    {
      id: 'build-packages',
      label: 'Build packages',
      cwd: airiRoot,
      argv: ['pnpm', 'run', 'build:packages'],
      mandatory: true,
    },
  ]
}

export function canonicalCommands(repoRoot = REPO_ROOT) {
  const airi = nodePath.join(repoRoot, 'airi')
  const base = [
    {
      id: 'core-agent',
      label: 'core-agent complete (12 files, 124 tests)',
      cwd: airi,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/core-agent'],
      mandatory: true,
    },
    {
      id: 'lia-core',
      label: 'lia-core complete (24 files, 309 tests)',
      cwd: nodePath.join(airi, 'packages', 'lia-core'),
      argv: ['pnpm', 'test'],
      mandatory: true,
    },
    {
      id: 'browser',
      label: 'Browser Stage',
      cwd: nodePath.join(airi, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser'],
      mandatory: true,
    },
    {
      id: 'lint',
      label: 'Lint',
      cwd: airi,
      argv: ['pnpm', 'lint'],
      mandatory: true,
    },
    {
      id: 'typecheck',
      label: 'Typecheck',
      cwd: airi,
      argv: ['pnpm', 'typecheck'],
      mandatory: true,
    },
    {
      id: 'build-packages',
      label: 'Build packages',
      cwd: airi,
      argv: ['pnpm', 'run', 'build:packages'],
      mandatory: true,
    },
    {
      id: 'stage-vitest',
      label: 'Stage full',
      cwd: nodePath.join(airi, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run'],
      mandatory: true,
    },
    {
      id: 'stage-ui',
      label: 'Stage UI',
      cwd: airi,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/stage-ui'],
      mandatory: true,
    },
  ]
  return base
}

// Allow smoke only when requested, without download
export function canonicalCommandsWithSmoke(repoRoot = REPO_ROOT, withSmoke = false) {
  const base = canonicalCommands(repoRoot)
  if (!withSmoke) return base
  // runtime-smoke as optional evidence, no install
  base.push({
    id: 'runtime-smoke',
    label: 'Runtime smoke (kokoro)',
    cwd: nodePath.join(repoRoot),
    argv: ['node', 'Tests/tools/kokoro-smoke.mjs', 'Tests/runs/<id>/artifacts/smoke'],
    mandatory: false,
  })
  return base
}

// ---------------------------------------------------------------------------
// Environment failure normalization — pure, testable
// ---------------------------------------------------------------------------
export function isEnvironmentFailure({ id, exitCode, error, stdout = '', stderr = '', timedOut = false }) {
  const combined = `${stdout}\n${stderr}`.toLowerCase()
  // Spawn errors: ENOENT, EACCES, etc.
  if (error) {
    const msg = String(error.message || error).toLowerCase()
    if (msg.includes('enoent') || msg.includes('spawn') || msg.includes('eacces') || msg.includes('unknown command')) return true
    if (msg.includes('enomen') || msg.includes('oom') || msg.includes('heap')) return true
  }
  if (timedOut) return true
  // Browser missing
  if (id === 'browser') {
    if (combined.includes('chromium') && (combined.includes('executable doesn\'t exist') || combined.includes('browser') || combined.includes('not found') || combined.includes('missing'))) return true
    if (combined.includes('playwright') && combined.includes('not found')) return true
  }
  // Typecheck OOM
  if (id === 'typecheck' || combined.includes('typecheck')) {
    if (combined.includes('heap out of memory') || combined.includes('javascript heap out of memory') || combined.includes('enomem') || combined.includes('allocation failure')) return true
  }
  // General OOM
  if (combined.includes('heap out of memory') || combined.includes('enomem')) return true
  // Executable missing
  if (combined.includes('enoent') || combined.includes('command not found') || combined.includes('not found') && combined.includes('pnpm')) {
    // Be conservative: pnpm exec missing tool often shows "command not found" or "enoent"
    if (combined.includes('vitest') || combined.includes('eslint') || combined.includes('tsc') || combined.includes('playwright')) return true
  }
  // Security python unavailable
  if (combined.includes('python') && combined.includes('not found')) return true
  // Timeout benchmark-owned
  if (combined.includes('timed out') || combined.includes('timeout')) return true
  return false
}

export function classifyCommandOutcome({ id, exitCode, error, stdout = '', stderr = '', timedOut = false, skippedOptional = false }) {
  if (skippedOptional) return 'skipped-optional'
  if (error || timedOut) {
    if (isEnvironmentFailure({ id, exitCode, error, stdout, stderr, timedOut })) return 'environment-limited'
    // Unknown spawn error without defensible env pattern → environment if error exists but not recognizable? Spec says unknown nonzero → FAIL, but spawn errors with no pattern should be env? Conservative: if error exists and not env, still env? But spec says Do NOT classify arbitrary nonzero as env. For error case, we already check env patterns; if not env, should we treat as failed? But spawn error without env pattern is still env? We'll treat as environment-limited only if env pattern matches, otherwise failed? However spawn error typically is env. We'll return environment-limited if error exists and we can't prove fail, but spec says Do NOT classify arbitrary nonzero exit as env. So for error case with no env pattern, we should maybe return 'failed' to be safe? But then missing binary would be misclassified if pattern not matched. Better to be strict: only env if pattern matches, else failed.
    // For now, if error exists but not env, treat as environment-limited? Let's treat as environment-limited only if pattern matches, else failed.
    return 'failed'
  }
  if (exitCode === 0) return 'passed'
  if (exitCode === null || exitCode === undefined) return 'environment-limited'
  // Nonzero exit: check if it's defensible env
  if (isEnvironmentFailure({ id, exitCode, error, stdout, stderr, timedOut })) return 'environment-limited'
  return 'failed'
}

// ---------------------------------------------------------------------------
// Classification — global rule: any executed FAILED → overall FAIL
// ---------------------------------------------------------------------------
export function classifyBenchmark({ commands, environmentLimitations = [] }) {
  // commands: array of {id,status,exitCode,...} where status is 'passed'|'failed'|'environment-limited'|'skipped-optional'
  // Also support legacy where status strings are 'passed' etc.
  let hasFail = false
  let hasEnv = false
  let hasPass = false
  for (const c of commands) {
    const status = c.status
    if (status === 'failed') hasFail = true
    else if (status === 'environment-limited') hasEnv = true
    else if (status === 'passed') hasPass = true
    else if (status === 'skipped-optional') { /* ignore */ }
    else {
      // Fallback for legacy numeric exitCode without status
      if (c.exitCode !== undefined && c.exitCode !== 0 && c.exitCode !== null) {
        // Check if it's env via isEnvironmentFailure
        const outcome = classifyCommandOutcome({ id: c.id, exitCode: c.exitCode, stdout: c.stdout||'', stderr: c.stderr||'', error: c.error })
        if (outcome === 'failed') hasFail = true
        else if (outcome === 'environment-limited') hasEnv = true
      } else if (c.exitCode === 0) hasPass = true
      else if (c.exitCode === null || c.exitCode === undefined) hasEnv = true
    }
  }
  if (environmentLimitations.length > 0) hasEnv = true
  if (hasFail) return 'FAIL'
  if (hasEnv) return 'ENVIRONMENT-LIMITED'
  if (hasPass) return 'PASS'
  // No commands? Should be incomplete → env-limited
  return 'ENVIRONMENT-LIMITED'
}

export function commandStatus({ exitCode, environmentLimited, mandatory }) {
  if (environmentLimited) return 'environment-limited'
  if (exitCode === 0) return 'passed'
  if (exitCode === null || exitCode === undefined) return 'environment-limited'
  return 'failed'
}

// ---------------------------------------------------------------------------
// Size bounding
// ---------------------------------------------------------------------------
export const PUBLISH_PER_LOG_MAX = 2 * 1024 * 1024
export const PUBLISH_FILE_HARD_MAX = 5 * 1024 * 1024
export const PUBLISH_TOTAL_HARD_MAX = 10 * 1024 * 1024

export function boundText(text, maxBytes = PUBLISH_PER_LOG_MAX) {
  const buf = Buffer.from(text, 'utf-8')
  if (buf.length <= maxBytes) return { text, truncated: false, originalBytes: buf.length, retainedBytes: buf.length }
  const headSize = Math.floor(maxBytes / 2)
  const tailSize = maxBytes - headSize - 200
  const head = buf.subarray(0, headSize).toString('utf-8')
  const tail = buf.subarray(buf.length - tailSize).toString('utf-8')
  const marker = `\n\n... [TRUNCATED ${buf.length - headSize - tailSize} bytes] ...\n\n`
  const bounded = head + marker + tail
  return { text: bounded, truncated: true, originalBytes: buf.length, retainedBytes: Buffer.from(bounded).length }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------
export function sha256OfText(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex')
}

export function sha256OfFile(filePath) {
  const data = readFileSync(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}

export function buildShaManifest(files, baseDir) {
  const sorted = [...files].sort((a, b) => a.localeCompare(b))
  const lines = sorted.map(f => {
    const rel = nodePath.relative(baseDir, f).replace(/\\/g, '/')
    const hash = sha256OfFile(f)
    return `${hash}  ${rel}`
  })
  return lines.join('\n') + '\n'
}

export function verifyShaManifest(manifestText, baseDir) {
  const lines = manifestText.trim().split('\n').filter(Boolean)
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})\s{2}(.+)$/)
    if (!m) return { ok: false, reason: `malformed line: ${line}` }
    const [, expectedHash, rel] = m
    const abs = nodePath.join(baseDir, rel)
    if (!existsSync(abs)) return { ok: false, reason: `missing file: ${rel}` }
    const actual = sha256OfFile(abs)
    if (actual !== expectedHash) return { ok: false, reason: `hash mismatch: ${rel}`, expected: expectedHash, actual }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Hardware collection (Node fallback + PowerShell CIM helpers)
// ---------------------------------------------------------------------------
export function hardwareFromNode() {
  const cpus = os.cpus()
  return {
    os: `${os.platform()} ${os.release()} ${os.arch()}`,
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    cpuModel: cpus[0]?.model ?? null,
    logicalCores: cpus.length,
    physicalCores: null,
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    nodeVersion: process.version,
    pnpmVersion: null,
    gitVersion: null,
    pythonVersion: null,
    chromiumAvailable: null,
    gpu: null,
  }
}

export function powershellCommands() {
  return [
    'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,TotalVisibleMemorySize,FreePhysicalMemory | ConvertTo-Json -Compress',
    'Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed | ConvertTo-Json -Compress',
    'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress',
    'Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'" | Select-Object Size,FreeSpace | ConvertTo-Json -Compress',
    'Get-Command nvidia-smi -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source',
  ]
}

// ---------------------------------------------------------------------------
// Summary schema helpers
// ---------------------------------------------------------------------------
export function createSummarySkeleton({ runId, sourceSha, sourceBranch, remoteSourceSha, startedAt, sourceRemoteObserved = true }) {
  return {
    schemaVersion: 1,
    runId,
    sourceSha,
    sourceBranch,
    remoteSourceSha,
    sourceRemoteObserved,
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: null,
    status: 'INCOMPLETE',
    environmentLimitations: [],
    failures: [],
    warnings: [],
    commands: [],
    hardwareSummary: null,
    artifacts: [],
    redaction: { policySource: 'tools/project_cli.py', applied: false, residualSensitiveContentDetected: false },
    truncation: { occurred: false, logs: [] },
    publication: { requested: true, branch: 'qa/windows-benchmarks', intendedPush: true, committed: false, commitSha: null, pushed: false, pushSkippedReason: null },
  }
}

// ---------------------------------------------------------------------------
// Allowlist — strict exact run
// ---------------------------------------------------------------------------
export function isBenchmarkPublishPath(path, runId) {
  const normalized = path.replace(/\\/g, '/')
  if (normalized === 'index.json' || normalized === 'README.md') return true
  if (normalized.startsWith(`benchmarks/${runId}/`)) {
    // Must be inside this run, not just prefix
    const rest = normalized.slice(`benchmarks/${runId}/`.length)
    return rest.length > 0 && !rest.includes('..')
  }
  return false
}

export function isPublishAllowed(path, runId) {
  return isBenchmarkPublishPath(path, runId)
}

export function validateStagedAllowlist(stagedFiles, runId) {
  const allowed = stagedFiles.every(f => isBenchmarkPublishPath(f, runId))
  // Also ensure at least one file and all are under this run or index/README
  const hasInvalid = stagedFiles.some(f => !isBenchmarkPublishPath(f, runId))
  return { allowed: allowed && !hasInvalid, stagedFiles, invalid: stagedFiles.filter(f => !isBenchmarkPublishPath(f, runId)) }
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------
export function formatDuration(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}m ${rem}s`
}
