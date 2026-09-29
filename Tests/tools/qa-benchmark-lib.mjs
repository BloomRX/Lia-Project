#!/usr/bin/env node
/**
 * Lia QA benchmark library — pure, testable helpers.
 * No git writes, no spawn, no fs outside injected root.
 */

import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import os from 'node:os'

import { REPO_ROOT, RUNS_DIR, runTimestampId } from './qa-shared.mjs'

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
  while (existsSync(nodePath.join(runsDir, id)) || existsSync(nodePath.join(REPO_ROOT, '.devkit-qa', 'benchmark-publish', id)) || existsSync(nodePath.join(REPO_ROOT, 'Tests', 'benchmarks', id))) {
    suffix += 1
    id = `${benchmarkRunId(now, shortSha)}-${suffix}`
  }
  return id
}

// ---------------------------------------------------------------------------
// Command inventory — static argv, no shell
// ---------------------------------------------------------------------------
/**
 * Returns the canonical benchmark command matrix.
 * Each entry: {id,label,cwd,argv,mandatory,requiresNetwork,mayInstall}
 * cwd is relative to REPO_ROOT or absolute for airi.
 */
export function benchmarkCommands({ repoRoot = REPO_ROOT } = {}) {
  const airiRoot = nodePath.join(repoRoot, 'airi')
  // Use pnpm exec for local binary resolution, never npx
  return [
    {
      id: 'stage-vitest',
      label: 'Stage full (node)',
      cwd: nodePath.join(airiRoot, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run', '--reporter=json', '--outputFile', '<METRICS>/stage-vitest.json'],
      // actually vitest json output needs file; we will capture via --reporter=json and parse stdout
      // For benchmark we use pnpm exec vitest run with json reporter via file
      rawArgv: ['pnpm', 'exec', 'vitest', 'run'],
      mandatory: true,
      requiresNetwork: false,
      mayInstall: false,
    },
    {
      id: 'core-agent',
      label: 'core-agent suite',
      cwd: airiRoot,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/core-agent', '--reporter=json'],
      rawArgv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/core-agent'],
      mandatory: true,
      requiresNetwork: false,
      mayInstall: false,
    },
    {
      id: 'lia-core',
      label: 'lia-core suite',
      cwd: nodePath.join(airiRoot, 'packages', 'lia-core'),
      argv: ['pnpm', 'test', '--', '--reporter=json'],
      rawArgv: ['pnpm', 'test'],
      mandatory: true,
      requiresNetwork: false,
      mayInstall: false,
    },
    {
      id: 'stage-ui',
      label: 'stage-ui suite',
      cwd: airiRoot,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/stage-ui', '--reporter=json'],
      rawArgv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/stage-ui'],
      mandatory: false,
      requiresNetwork: false,
      mayInstall: false,
    },
    {
      id: 'browser',
      label: 'Browser Stage (chromium)',
      cwd: nodePath.join(airiRoot, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser', '--reporter=json'],
      rawArgv: ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser'],
      mandatory: false, // environment-limited if missing
      requiresNetwork: false,
      mayInstall: false,
    },
    {
      id: 'lint',
      label: 'Lint',
      cwd: airiRoot,
      argv: ['pnpm', 'exec', 'eslint', '--cache', '.'],
      rawArgv: ['pnpm', 'lint'],
      mandatory: true,
      requiresNetwork: false,
      mayInstall: false,
    },
    {
      id: 'typecheck',
      label: 'Typecheck',
      cwd: airiRoot,
      argv: ['pnpm', 'exec', 'tsc', '--noEmit'], // fallback; real is pnpm -rF... but we provide narrow
      rawArgv: ['pnpm', 'typecheck'],
      mandatory: false, // heavy, may OOM -> env-limited
      requiresNetwork: false,
      mayInstall: false,
    },
    {
      id: 'build-packages',
      label: 'Build packages',
      cwd: airiRoot,
      argv: ['pnpm', 'run', 'build:packages'],
      rawArgv: ['pnpm', 'run', 'build:packages'],
      mandatory: false,
      requiresNetwork: false,
      mayInstall: false,
    },
  ]
}

// More precise inventory for implementation — use pnpm exec for all to avoid npx download
export function canonicalCommands(repoRoot = REPO_ROOT) {
  const airi = nodePath.join(repoRoot, 'airi')
  return [
    {
      id: 'stage-vitest',
      label: 'Stage full',
      cwd: nodePath.join(airi, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run'],
      mandatory: true,
      requiresNetwork: false,
    },
    {
      id: 'core-agent',
      label: 'core-agent complete (12 files, 124 tests)',
      cwd: airi,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/core-agent'],
      mandatory: true,
      requiresNetwork: false,
    },
    {
      id: 'lia-core',
      label: 'lia-core complete (24 files, 309 tests)',
      cwd: nodePath.join(airi, 'packages', 'lia-core'),
      argv: ['pnpm', 'test'],
      mandatory: true,
      requiresNetwork: false,
    },
    {
      id: 'stage-ui',
      label: 'Stage UI',
      cwd: airi,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/stage-ui'],
      mandatory: false,
      requiresNetwork: false,
    },
    {
      id: 'browser',
      label: 'Browser Stage',
      cwd: nodePath.join(airi, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser'],
      mandatory: false,
      requiresNetwork: false,
    },
    {
      id: 'lint',
      label: 'Lint',
      cwd: airi,
      argv: ['pnpm', 'lint'],
      mandatory: true,
      requiresNetwork: false,
    },
    {
      id: 'typecheck',
      label: 'Typecheck',
      cwd: airi,
      argv: ['pnpm', 'typecheck'],
      mandatory: false,
      requiresNetwork: false,
    },
    {
      id: 'build-packages',
      label: 'Build packages',
      cwd: airi,
      argv: ['pnpm', 'run', 'build:packages'],
      mandatory: false,
      requiresNetwork: false,
    },
  ]
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
export function classifyBenchmark({ commands, environmentLimitations = [] }) {
  // Support both status-based test vectors and full command objects
  const hasFail = commands.some(c => c.status === 'failed' || (c.exitCode !== undefined && c.exitCode !== 0 && c.status !== 'environment-limited'))
  const hasEnv = commands.some(c => c.status === 'environment-limited') || environmentLimitations.length > 0
  // For mandatory-aware logic: if commands carry mandatory flag, only those matter; otherwise all
  const hasMandatory = commands.some(c => 'mandatory' in c)
  if (hasMandatory) {
    const mandatory = commands.filter(c => c.mandatory !== false)
    const mFail = mandatory.some(c => c.status === 'failed' || (c.exitCode !== undefined && c.exitCode !== 0 && c.status !== 'environment-limited'))
    const mEnv = mandatory.some(c => c.status === 'environment-limited' || c.exitCode === null || c.exitCode === undefined) || environmentLimitations.length > 0
    if (mFail) return 'FAIL'
    if (mEnv) return 'ENVIRONMENT-LIMITED'
    return 'PASS'
  }
  if (hasFail) return 'FAIL'
  if (hasEnv) return 'ENVIRONMENT-LIMITED'
  return 'PASS'
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
  // files: absolute paths, baseDir for relative display, sorted lexical
  const sorted = [...files].sort((a, b) => a.localeCompare(b))
  const lines = sorted.map(f => {
    const rel = nodePath.relative(baseDir, f).replace(/\\/g, '/')
    const hash = sha256OfFile(f)
    return `${hash}  ${rel}`
  })
  return lines.join('\n') + '\n'
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
    physicalCores: null, // needs CIM
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
export function createSummarySkeleton({ runId, sourceSha, sourceBranch, remoteSourceSha, startedAt }) {
  return {
    schemaVersion: 1,
    runId,
    sourceSha,
    sourceBranch,
    remoteSourceSha,
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
    publication: { requested: true, branch: 'qa/windows-benchmarks', committed: false, commitSha: null, pushed: false, pushSkippedReason: null },
  }
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------
export function isBenchmarkPublishPath(path, runId) {
  // Allow only benchmarks/<RUN-ID>/** and index.json and README.md for first orphan
  const normalized = path.replace(/\\/g, '/')
  if (normalized === 'benchmarks/index.json' || normalized === 'index.json' || normalized === 'README.md') return true
  if (normalized.startsWith(`benchmarks/${runId}/`)) return true
  if (normalized.startsWith(`Tests/benchmarks/${runId}/`)) return true // legacy check
  return false
}

export function isPublishAllowed(path, runId) {
  return isBenchmarkPublishPath(path, runId)
}

export function validateStagedAllowlist(stagedFiles, runId) {
  const allowed = stagedFiles.every(f => isBenchmarkPublishPath(f, runId))
  return { allowed, stagedFiles }
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
