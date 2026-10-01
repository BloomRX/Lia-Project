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
      argv: ['pnpm', 'run', 'test-ui:run'],
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
      label: 'Core Agent',
      cwd: airi,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@proj-airi/core-agent'],
      mandatory: true,
    },
    {
      id: 'lia-core',
      label: 'Lia Core',
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
      argv: ['pnpm', 'run', 'test-ui:run'],
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
// ANSI stripping + validation evidence helpers (pure)
// ---------------------------------------------------------------------------
export function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '')
}

export function hasVitestFailureEvidence(text) {
  const clean = stripAnsi(String(text))
  // Detect Vitest failure: Test Files ... failed, Tests ... failed, FAIL <test>
  // Examples: "Test Files  9 failed | 15 passed (24)", "Tests  21 failed | 288 passed (309)", "FAIL  src/foo.test.ts"
  if (/Test Files\s+.*\b\d+\s+failed\b/i.test(clean)) return true
  if (/Tests\s+.*\b\d+\s+failed\b/i.test(clean)) return true
  if (/^\s*FAIL\s+/m.test(clean)) return true
  // Also "Test Files  30 failed | 107 passed" etc.
  if (/Test Files\s+\d+\s+failed/i.test(clean)) return true
  return false
}

export function hasTypeScriptError(text) {
  const clean = stripAnsi(String(text))
  return /error TS\d+\s*:/i.test(clean)
}

export function hasLintFailure(text) {
  const clean = stripAnsi(String(text))
  // ESLint: "✖ 498 problems (452 errors, 46 warnings)" or "X problems"
  const m = clean.match(/✖\s*(\d+)\s+problems\s*\(\s*(\d+)\s+errors\s*,\s*(\d+)\s+warnings\s*\)/i)
  if (m) {
    const errors = Number(m[2])
    return errors > 0
  }
  // Fallback: "452 errors" with problems
  if (/problems.*\b\d+\s+errors\b/i.test(clean) && /✖/.test(clean)) {
    const e = clean.match(/(\d+)\s+errors/)
    if (e && Number(e[1]) > 0) return true
  }
  // Also check for "Definition for rule ... was not found" is still lint failure if exit non-zero, but we treat any lint with errors as failure
  // If text contains "error" and lint command non-zero, but we need to avoid false env
  // For now, also consider if contains "error" and "lint" but not env?
  return false
}

export function hasNoTestsButBrowserEnv(text) {
  // Browser-only: no tests executed, no failures, but browser missing
  // We detect "no tests" phrasing
  const clean = stripAnsi(String(text)).toLowerCase()
  return clean.includes('no tests')
}

export function parseVitestMetrics(text) {
  let clean = stripAnsi(String(text))
  let testFiles = null, passed = null, failed = null, skipped = null, errors = null
  // D2B9-C: normalize pass-only Vitest summaries to the `failed | passed` form the
  // existing regexes expect, so all-green runs parse instead of yielding nulls.
  const cleanNorm = clean
    .replace(/Test Files\s+(\d+)\s+passed\s*\((\d+)\)/gi, 'Test Files 0 failed | $1 passed ($2)')
    .replace(/Tests\s+(\d+)\s+passed\s*\((\d+)\)/gi, 'Tests 0 failed | $1 passed ($2)')
    .replace(/Test Files\s+(\d+)\s+passed\s*\|\s*(\d+)\s+skipped\s*\((\d+)\)/gi, 'Test Files 0 failed | $1 passed | $2 skipped ($3)')
    .replace(/Tests\s+(\d+)\s+passed\s*\|\s*(\d+)\s+skipped\s*\((\d+)\)/gi, 'Tests 0 failed | $1 passed | $2 skipped ($3)')
  clean = cleanNorm
  // Test Files  9 failed | 15 passed (24)  OR  Test Files  30 failed | 107 passed (141)
  let m = clean.match(/Test Files\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\((\d+)\)/i)
  if (m) {
    failed = Number(m[1]); passed = Number(m[2]); testFiles = Number(m[3])
    // But note: this regex captures failed/passed as files, but we need to distinguish files vs tests
    // For Test Files line, the failed/passed are files
    // We will treat as testFiles metrics
    // To capture both, we need separate matches for Test Files and Tests
    testFiles = Number(m[3])
    // Store files failed/passed separately? Use passed/failed for files?
    // We'll map files failed/passed to failed/passed for now, but later Tests line will override
    // So save as files
    // Keep as is for now
  } else {
    // Browser: Test Files (4) or similar without failed/passed
    m = clean.match(/Test Files\s*\((\d+)\)/i)
    if (m) testFiles = Number(m[1])
  }
  // More robust: match Test Files line with possible ANSI and varied spacing
  // Try alternative: "Test Files  9 failed | 15 passed (24)"
  // Already handled. For Stage: same.
  // Now Tests line: "Tests  21 failed | 288 passed (309)" or "Tests  109 failed | 1438 passed | 1 skipped (1548)"
  let tm = clean.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\|\s*(\d+)\s+skipped\s*\((\d+)\)/i)
  if (tm) {
    failed = Number(tm[1]); passed = Number(tm[2]); skipped = Number(tm[3]); // total = tm[4] but we can compute
    // For Vitest, the Tests line is more important for passed/failed/skipped
    // Override previous failed/passed if they were files?
    // Actually previous failed/passed were files, but we want tests metrics in passed/failed fields
    // So we will use Tests line values for passed/failed/skipped
  } else {
    tm = clean.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\((\d+)\)/i)
    if (tm) {
      failed = Number(tm[1]); passed = Number(tm[2])
      // total = tm[3]
    } else {
      // No tests case: "Tests  no tests" or similar
      if (/Tests\s+no tests/i.test(clean)) {
        failed = 0; passed = 0; skipped = 0
      }
    }
  }
  // Errors: "Errors      1 error" or "Errors  1 errors"
  let em = clean.match(/Errors\s+(\d+)\s+error/i)
  if (em) errors = Number(em[1])
  // Also handle "1 error" without Errors label? Vitest also prints "Errors 1 error"
  // Try to capture files total etc. For browser, Test Files (4) already handled
  // If we matched earlier Test Files with failed/passed, we already have testFiles
  // But if we matched Tests line and it overwrote failed/passed, we lost files info
  // So we should capture both separately and return structured
  // For now, return as parsed
  // Re-parse to ensure correct mapping: testFiles should be from Test Files line, passed/failed from Tests line
  // Let's do more precise:
  const clean2 = clean
  let filesTotal = null, filesFailed = null, filesPassed = null
  const f1 = clean2.match(/Test Files\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\((\d+)\)/i)
  if (f1) {
    filesFailed = Number(f1[1]); filesPassed = Number(f1[2]); filesTotal = Number(f1[3])
  } else {
    const f2 = clean2.match(/Test Files\s*\((\d+)\)/i)
    if (f2) filesTotal = Number(f2[1])
  }
  let testsFailed = null, testsPassed = null, testsSkipped = null, testsTotal = null
  const t1 = clean2.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\|\s*(\d+)\s+skipped\s*\((\d+)\)/i)
  if (t1) {
    testsFailed = Number(t1[1]); testsPassed = Number(t1[2]); testsSkipped = Number(t1[3]); testsTotal = Number(t1[4])
  } else {
    const t2 = clean2.match(/Tests\s+(\d+)\s+failed\s*\|\s*(\d+)\s+passed\s*\((\d+)\)/i)
    if (t2) {
      testsFailed = Number(t2[1]); testsPassed = Number(t2[2]); testsTotal = Number(t2[3])
    } else if (/Tests\s+no tests/i.test(clean2)) {
      testsFailed = 0; testsPassed = 0; testsSkipped = 0; testsTotal = 0
    }
  }
  // Determine final fields for publicCommandResult: testFiles = filesTotal, passed = testsPassed, failed = testsFailed, skipped = testsSkipped, errors = errors
  // But if filesTotal not found but testsTotal exists, use testsTotal? For lia-core, filesTotal 24, testsTotal 309, etc.
  // For publicCommandResult, testFiles is intended as number of test files, passed/failed are tests
  if (filesTotal !== null) testFiles = filesTotal
  else if (testsTotal !== null) testFiles = testsTotal // fallback
  if (testsFailed !== null) failed = testsFailed
  else if (filesFailed !== null) failed = filesFailed
  if (testsPassed !== null) passed = testsPassed
  else if (filesPassed !== null) passed = filesPassed
  if (testsSkipped !== null) skipped = testsSkipped
  // errors already
  return { testFiles, passed, failed, skipped, errors, filesTotal, filesFailed, filesPassed, testsTotal, testsFailed, testsPassed, testsSkipped }
}

export function parseLintMetrics(text) {
  const clean = stripAnsi(String(text))
  // "✖ 498 problems (452 errors, 46 warnings)"
  let m = clean.match(/✖\s*(\d+)\s+problems\s*\(\s*(\d+)\s+errors\s*,\s*(\d+)\s+warnings\s*\)/i)
  if (m) {
    return { problems: Number(m[1]), errors: Number(m[2]), warnings: Number(m[3]) }
  }
  // Fallback: "X problems (Y errors, Z warnings)" without icon
  m = clean.match(/(\d+)\s+problems\s*\(\s*(\d+)\s+errors\s*,\s*(\d+)\s+warnings\s*\)/i)
  if (m) {
    return { problems: Number(m[1]), errors: Number(m[2]), warnings: Number(m[3]) }
  }
  return { problems: null, errors: null, warnings: null }
}

export function parseTypecheckMetrics(text) {
  const clean = stripAnsi(String(text))
  const matches = clean.match(/error TS\d+:/gi)
  if (matches) return { errors: matches.length }
  return { errors: null }
}


// ---------------------------------------------------------------------------
// Environment failure normalization — pure, testable
// ---------------------------------------------------------------------------
/**
 * Commands that may be limited by an absent Playwright browser executable.
 *
 * Every one of these still has to pass the attributable-failure checks in
 * classifyCommandOutcome first, so a command with real failed Node tests can
 * never be excused as environment-limited.
 */
export const MISSING_BROWSER_EXECUTABLE_COMMANDS = new Set([
  'browser',
  'stage-ui',
  'stage-vitest',
])

export function isEnvironmentFailure({ id, exitCode, error, stdout = '', stderr = '', timedOut = false }) {
  const combined = `${stdout}\n${stderr}`.toLowerCase()
  if (error) {
    const msg = String(error.message || error).toLowerCase()
    if (msg.includes('enoent') || msg.includes('eacces') || msg.includes('spawn')) return true
    if (msg.includes('enomen') || msg.includes('oom') || msg.includes('heap')) return true
  }
  if (timedOut) return true
  // Narrow timeout: only ETIMEDOUT or explicit process timed out, not generic setTimeout
  if (combined.includes('etimedout') || combined.includes('process timed out')) return true
  // Browser precise: only infrastructure signatures, not generic mention.
  //
  // D2B9-D: the missing-executable limitation is not exclusive to the `browser`
  // command. The stage-ui and stage-vitest node commands also collect a browser
  // suite; when the headless shell is absent that surfaces as an unhandled
  // "browserType.launch: Executable doesn't exist" next to otherwise fully
  // passing node tests (149 files / 1041 tests, Errors 1). classifyCommandOutcome
  // runs every attributable-failure check FIRST, so reaching this point already
  // proves there are no real Vitest/TS/lint failures to blame.
  if (MISSING_BROWSER_EXECUTABLE_COMMANDS.has(id)) {
    if (combined.includes("executable doesn't exist")) return true
    if (combined.includes('chromium executable missing')) return true
    if (combined.includes('browser executable not found')) return true
    if (combined.includes('playwright') && combined.includes('host system is missing dependencies')) return true
    if (combined.includes('playwright') && combined.includes('please install')) return true
    if (combined.includes('install') && combined.includes('playwright') && combined.includes('browser')) return true
    // Do NOT treat generic "chromium" + "browser" as env
  }
  // Typecheck OOM
  if (id === 'typecheck' || combined.includes('typecheck')) {
    if (combined.includes('heap out of memory') || combined.includes('javascript heap out of memory') || combined.includes('enomem') || combined.includes('allocation failure')) return true
  }
  if (combined.includes('heap out of memory') || combined.includes('enomem') || combined.includes('allocation failure')) return true
  // Do NOT infer environment from arbitrary test output containing ENOENT/command not found/python not found
  // Those are handled as spawn errors above, not via output substrings
  return false
}

export function classifyCommandOutcome({ id, exitCode, error, stdout = '', stderr = '', timedOut = false, skippedOptional = false }) {
  if (skippedOptional) return 'skipped-optional'
  const combined = `${stdout}\n${stderr}`
  // FIRST detect ATTRIBUTABLE validation evidence (failure precedence)
  // Vitest: Test Files ... failed / Tests ... failed / FAIL
  if (hasVitestFailureEvidence(combined)) return 'failed'
  // Typecheck: error TSxxxx:
  if (hasTypeScriptError(combined)) return 'failed'
  // Lint:  ✖ N problems (M errors, ...) with M>0
  if (hasLintFailure(combined)) return 'failed'
  // Invalid Vitest project filter (stage-ui misconfiguration)
  if (combined.includes('No projects matched')) return 'failed'
  // Only then may environment signatures classify
  if (isEnvironmentFailure({ id, exitCode, error, stdout, stderr, timedOut })) return 'environment-limited'
  if (error || timedOut) {
    return 'failed'
  }
  if (exitCode === 0) return 'passed'
  if (exitCode === null || exitCode === undefined) return 'environment-limited'
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

// Structured command result privacy — only publish allowed fields
export function publicCommandResult(cmd) {
  // Allowed: id,label,cwd(repo-relative),argv,startedAt,endedAt,durationMs,exitCode,status,testFiles,passed,failed,skipped,errors,warnings,logPath(publish-relative),truncated
  const publicFields = {}
  publicFields.id = cmd.id
  publicFields.label = cmd.label
  // cwd must be repo-relative, never absolute
  if (cmd.cwd) {
    const cwd = String(cmd.cwd).replace(/\\/g, '/')
    // If absolute, make relative or mask
    publicFields.cwd = cwd
    if (nodePath.isAbsolute(cwd)) {
      // Should have been made relative before calling, but mask anyway
      publicFields.cwd = '<REPO>/' + nodePath.basename(cwd)
    } else {
      publicFields.cwd = cwd
    }
  } else {
    publicFields.cwd = null
  }
  publicFields.argv = Array.isArray(cmd.argv) ? [...cmd.argv] : null
  publicFields.startedAt = cmd.startedAt || null
  publicFields.endedAt = cmd.endedAt || null
  publicFields.durationMs = cmd.durationMs ?? null
  publicFields.exitCode = cmd.exitCode ?? null
  publicFields.status = cmd.status || null
  publicFields.testFiles = cmd.testFiles ?? null
  publicFields.passed = cmd.passed ?? null
  publicFields.failed = cmd.failed ?? null
  publicFields.skipped = cmd.skipped ?? null
  publicFields.errors = cmd.errors ?? null
  publicFields.warnings = cmd.warnings ?? null
  // logPath must be publish-relative, never absolute or temp
  if (cmd.logPath) {
    const lp = String(cmd.logPath).replace(/\\/g, '/')
    publicFields.logPath = lp
  } else {
    publicFields.logPath = null
  }
  publicFields.truncated = !!cmd.truncated
  return publicFields
}

export function maskPrivatePaths(text, { repoRoot, homedir, tmpdir } = {}) {
  let out = String(text)
  const repo = repoRoot || REPO_ROOT
  const home = homedir || os.homedir()
  const tmp = tmpdir || os.tmpdir()
  // Order: repoRoot first, home second, temp third
  // Handle both / and \ representations
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const replacements = [
    { val: repo, token: '<REPO>' },
    { val: home, token: '<HOME>' },
    { val: tmp, token: '<TEMP>' },
  ]
  for (const { val, token } of replacements) {
    if (!val) continue
    const re1 = new RegExp(esc(val), 'g')
    out = out.replace(re1, token)
    // Also handle opposite slash direction
    const alt = val.replace(/\\/g, '/').replace(/\//g, '\\')
    // Try both slash variants
    const vSlash = val.replace(/\\/g, '/')
    const vBack = val.replace(/\//g, '\\')
    if (vSlash !== val) {
      const re2 = new RegExp(esc(vSlash), 'g')
      out = out.replace(re2, token)
    }
    if (vBack !== val && vBack !== vSlash) {
      const re3 = new RegExp(esc(vBack), 'g')
      out = out.replace(re3, token)
    }
    // Windows drive letter case-insensitive? keep simple
  }
  return out
}

export function containsPrivatePath(text, { repoRoot, homedir, tmpdir } = {}) {
  const t = String(text)
  const repo = repoRoot || REPO_ROOT
  const home = homedir || os.homedir()
  const tmp = tmpdir || os.tmpdir()
  const checks = [repo, home, tmp]
  for (const v of checks) {
    if (!v) continue
    if (t.includes(v)) return true
    const vSlash = v.replace(/\\/g, '/')
    if (vSlash !== v && t.includes(vSlash)) return true
    const vBack = v.replace(/\//g, '\\')
    if (vBack !== v && t.includes(vBack)) return true
  }
  return false
}

export function exitCodeForStatus(status) {
  switch (status) {
    case 'PASS': return 0
    case 'FAIL': return 1
    case 'ENVIRONMENT-LIMITED': return 2
    case 'INCOMPLETE': return 3
    default: return 3
  }
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
