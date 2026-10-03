#!/usr/bin/env node
/**
 * Lia QA harness (Phase 7.9G-QA) - storage hygiene.
 *
 * Hard safety rules enforced HERE (the .bat never deletes anything itself):
 *  - deletions only ever touch paths strictly inside the managed roots
 *    (Tests\runs, Tests\runtimes, Tests\logs);
 *  - the currently ACTIVE run (snapshots\ACTIVE.txt present) is never deleted;
 *  - legacy/unknown artifacts are INVENTORIED ONLY - this phase never
 *    deletes them;
 *  - retention and log-prune default to dry-run.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ACTIVE_MARKER,
  INVENTORY_DIR,
  LOGS_DIR,
  REPO_ROOT,
  RUNTIMES_DIR,
  RUNS_DIR,
  dirSizeAndFiles,
  findActiveRun,
  humanBytes,
  isInsideManagedRoot,
  listRunIds,
  runTimestampId,
} from './qa-shared.mjs'

/* ------------------------------------------------------------------ */
/* Managed runs: listing / usage / deletion                            */
/* ------------------------------------------------------------------ */

export function describeRun({ activeRunId, id, runsDir = RUNS_DIR }) {
  const runDir = nodePath.join(runsDir, id)
  const size = dirSizeAndFiles(runDir)
  let mtime
  try {
    mtime = statSync(runDir).mtime
  }
  catch {
    mtime = undefined
  }
  return {
    active: id === activeRunId,
    files: size.files,
    id,
    modified: mtime,
    runDir,
    sizeBytes: size.bytes,
    truncated: size.truncated,
  }
}

export function listManagedRuns({ runsDir = RUNS_DIR } = {}) {
  const active = findActiveRun(runsDir)
  return listRunIds(runsDir).map(id => describeRun({ activeRunId: active?.id, id, runsDir }))
}

/** Guarded deletion of ONE managed run. Throws instead of doing anything unsafe. */
export function deleteManagedRun({ id, runsDir = RUNS_DIR }) {
  if (!/^\d{8}-\d{6}(-\d+)?$/.test(id))
    throw new Error(`refusing: "${id}" is not a harness run id`)
  const runDir = nodePath.resolve(runsDir, id)
  if (!isInsideManagedRoot(runDir, [runsDir]))
    throw new Error(`refusing: ${runDir} is not inside the managed runs root`)
  if (!existsSync(runDir))
    throw new Error(`refusing: run does not exist: ${id}`)
  const active = findActiveRun(runsDir)
  if (active?.id === id)
    throw new Error('refusing: this run is ACTIVE (Lia is configured to use it). Restore first (menu 4).')
  rmSync(runDir, { recursive: true, force: false })
  return runDir
}

/** Guarded deletion of every managed run except the active one. */
export function deleteAllManagedRuns({ runsDir = RUNS_DIR } = {}) {
  const active = findActiveRun(runsDir)
  const deleted = []
  const skipped = []
  for (const id of listRunIds(runsDir)) {
    if (active?.id === id) {
      skipped.push(id)
      continue
    }
    deleteManagedRun({ id, runsDir })
    deleted.push(id)
  }
  return { deleted, skipped }
}

/* ------------------------------------------------------------------ */
/* Retention policy (dry-run by default)                               */
/* ------------------------------------------------------------------ */

/**
 * Computes which runs a retention policy WOULD remove. Nothing is deleted
 * here - the caller decides (and the CLI requires an explicit --apply).
 */
export function retentionPlan({ keepLast = 3, now = new Date(), olderThanDays, runsDir = RUNS_DIR }) {
  const runs = listManagedRuns({ runsDir }) // newest first
  const active = findActiveRun(runsDir)
  const cutoff = olderThanDays !== undefined
    ? now.getTime() - olderThanDays * 24 * 60 * 60 * 1000
    : undefined

  const keep = []
  const remove = []
  runs.forEach((run, index) => {
    if (run.active) {
      keep.push({ ...run, why: 'active run - never deleted' })
      return
    }
    if (index < keepLast) {
      keep.push({ ...run, why: `within keep-last ${keepLast}` })
      return
    }
    if (cutoff !== undefined && run.modified && run.modified.getTime() >= cutoff) {
      keep.push({ ...run, why: `newer than ${olderThanDays} day(s)` })
      return
    }
    remove.push(run)
  })
  return { keep, remove }
}

/* ------------------------------------------------------------------ */
/* Log/metric pruning (keeps USER-NOTES.txt / QA-CHECKLIST.txt)        */
/* ------------------------------------------------------------------ */

/**
 * Lists (or with apply=true removes) the files under one run's logs\ and
 * metrics\ folders. The run-root USER-NOTES.txt / QA-CHECKLIST.txt /
 * snapshots\ are structurally untouched. The ACTIVE run is never pruned.
 */
export function pruneRunLogs({ apply = false, id, runsDir = RUNS_DIR }) {
  const runDir = nodePath.resolve(runsDir, id)
  if (!isInsideManagedRoot(runDir, [runsDir]))
    throw new Error(`refusing: ${runDir} is not inside the managed runs root`)
  const active = findActiveRun(runsDir)
  if (active?.id === id)
    throw new Error('refusing: this run is ACTIVE. Restore before pruning its logs.')

  const affected = []
  for (const sub of ['logs', 'metrics']) {
    const dir = nodePath.join(runDir, sub)
    if (!existsSync(dir))
      continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile())
        continue
      const full = nodePath.join(dir, entry.name)
      affected.push(full)
      if (apply)
        rmSync(full)
    }
  }
  return { affected, apply }
}

/* ------------------------------------------------------------------ */
/* Legacy artifact inventory (NON-DESTRUCTIVE)                         */
/* ------------------------------------------------------------------ */

/**
 * Candidate locations of old Lia/AIRI test artifacts. Every entry carries a
 * confidence level and a reason; production data is explicitly classified
 * production-do-not-delete so size alone never marks it disposable.
 */
export function inventoryCandidates({ env = process.env, repoRoot = REPO_ROOT }) {
  const candidates = []
  const push = (path, type, confidence, reason) => {
    if (path && existsSync(path))
      candidates.push({ confidence, path, reason, type })
  }

  // --- harness-owned, safe to manage ---
  push(nodePath.join(repoRoot, '.devkit-qa'), 'qa-output-dir', 'managed-test', 'DevKit kokoro-smoke QA outputs (gitignored by design)')
  push(nodePath.join(repoRoot, 'Tests', 'runs'), 'qa-runs', 'managed-test', 'Lia QA harness runs (this tool manages them)')
  push(nodePath.join(repoRoot, 'Tests', 'runtimes'), 'qa-runtimes', 'managed-test', 'Lia QA harness runtimes root (this tool manages it)')
  push(nodePath.join(repoRoot, 'Tests', 'logs'), 'qa-logs', 'managed-test', 'Lia QA harness logs root (this tool manages it)')

  // --- production: never delete, listed for completeness ---
  const local = env.LOCALAPPDATA
  const appData = env.APPDATA
  push(local && nodePath.join(local, 'Lia', 'runtimes'), 'production-runtime', 'production-do-not-delete', 'PRODUCTION voice runtime home (validated Kokoro install lives here)')
  push(local && nodePath.join(local, 'Lia'), 'production-local-data', 'production-do-not-delete', 'PRODUCTION Lia local data root')
  push(appData && nodePath.join(appData, 'Lia'), 'production-user-data', 'production-do-not-delete', 'Lia product user data (config, voice profiles, secrets)')
  push(appData && nodePath.join(appData, 'lia'), 'production-user-data', 'production-do-not-delete', 'Lia product user data (lowercase candidate)')
  push(appData && nodePath.join(appData, '@proj-airi', 'stage-tamagotchi'), 'stage-user-data', 'production-do-not-delete', 'Stage app userData (production AIRI host data)')
  push(appData && nodePath.join(appData, 'stage-tamagotchi'), 'stage-user-data', 'production-do-not-delete', 'Stage app userData (unscoped candidate)')
  push(appData && nodePath.join(appData, 'Electron'), 'dev-host-data', 'production-do-not-delete', 'Electron dev userData (may hold dev product data)')

  // --- likely-test leftovers from previous QA phases ---
  push(local && nodePath.join(local, 'Lia-QA'), 'qa-leftover', 'likely-test', 'Name matches a previous QA-phase experiment folder')
  push(local && nodePath.join(local, 'lia-qa'), 'qa-leftover', 'likely-test', 'Name matches a previous QA-phase experiment folder')
  if (env.TEMP) {
    for (const entry of safeReadDir(env.TEMP)) {
      if (/^(lia|kokoro|lia-qa)/i.test(entry))
        push(nodePath.join(env.TEMP, entry), 'temp-leftover', 'likely-test', 'TEMP entry named after Lia/Kokoro QA')
    }
  }
  // Repo-top-level venv-like folders (never scans inside airi/ source).
  for (const entry of safeReadDir(repoRoot)) {
    if (/venv/i.test(entry) && !/node_modules/i.test(entry))
      push(nodePath.join(repoRoot, entry), 'python-venv', 'unknown', 'Python venv-like folder at repo root - review before any manual cleanup')
  }

  return candidates
}

function safeReadDir(dir) {
  try {
    return readdirSync(dir)
  }
  catch {
    return []
  }
}

/** Builds the inventory report text (also returns totals for the console). */
export function buildInventoryReport({ env = process.env, repoRoot = REPO_ROOT } = {}) {
  const candidates = inventoryCandidates({ env, repoRoot })
  const rows = []
  const totals = { 'likely-test': 0, 'managed-test': 0, 'production-do-not-delete': 0, 'unknown': 0 }
  const measured = []

  for (const candidate of candidates) {
    const size = dirSizeAndFiles(candidate.path)
    let mtime
    try {
      mtime = statSync(candidate.path).mtime.toISOString()
    }
    catch {
      mtime = 'unknown'
    }
    totals[candidate.confidence] = (totals[candidate.confidence] ?? 0) + size.bytes
    measured.push({ ...candidate, files: size.files, sizeBytes: size.bytes, truncated: size.truncated, mtime })
    rows.push([
      `path       : ${candidate.path}`,
      `type       : ${candidate.type}`,
      `confidence : ${candidate.confidence}`,
      `size       : ${humanBytes(size.bytes)}${size.truncated ? ' (truncated walk)' : ''} (${size.files} files)`,
      `modified   : ${mtime}`,
      `reason     : ${candidate.reason}`,
    ].join('\n'))
  }

  const largest = [...measured].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 20)
  const lines = [
    'Lia QA harness - legacy artifact inventory (NON-DESTRUCTIVE)',
    `generated: ${new Date().toISOString()}`,
    '',
    'NOTHING is deleted by this report. Production data is classified',
    'production-do-not-delete regardless of size.',
    '',
    '== candidates ==',
    '',
    rows.join('\n\n'),
    '',
    '== summary ==',
    `total managed-test bytes            : ${totals['managed-test']} (${humanBytes(totals['managed-test'])})`,
    `total likely-test bytes             : ${totals['likely-test']} (${humanBytes(totals['likely-test'])})`,
    `total unknown bytes                 : ${totals['unknown']} (${humanBytes(totals['unknown'])})`,
    `total production-do-not-delete bytes: ${totals['production-do-not-delete']} (${humanBytes(totals['production-do-not-delete'])})`,
    '',
    '== largest 20 candidates ==',
    ...largest.map((m, i) => `${String(i + 1).padStart(2)}. ${humanBytes(m.sizeBytes).padStart(10)}  [${m.confidence}] ${m.path}`),
  ]
  return { candidates: measured, report: lines.join('\n'), totals }
}

/** Writes the inventory to Tests\inventory\legacy-artifacts-<ts>.txt. */
export function writeInventory({ env = process.env, inventoryDir = INVENTORY_DIR, repoRoot = REPO_ROOT } = {}) {
  mkdirSync(inventoryDir, { recursive: true })
  const { report, totals } = buildInventoryReport({ env, repoRoot })
  const file = nodePath.join(inventoryDir, `legacy-artifacts-${runTimestampId()}.txt`)
  writeFileSync(file, `${report}\n`, 'utf-8')
  return { file, totals }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [, , command, ...args] = process.argv

if (!isMain) {
  // Imported by tests - library only.
}
else if (command === 'usage') {
  const runs = listManagedRuns()
  if (runs.length === 0)
    console.log('No managed test runs yet.')
  for (const run of runs)
    console.log(`${run.active ? 'ACTIVE  ' : '        '}${run.id}  ${humanBytes(run.sizeBytes).padStart(10)}  ${String(run.files).padStart(6)} files  modified ${run.modified?.toISOString() ?? 'unknown'}`)
  for (const root of [RUNTIMES_DIR, LOGS_DIR]) {
    if (existsSync(root)) {
      const size = dirSizeAndFiles(root)
      console.log(`root ${root}: ${humanBytes(size.bytes)} (${size.files} files)`)
    }
  }
}
else if (command === 'show-run') {
  const id = args[0]
  if (!id) {
    console.error('usage: qa-storage.mjs show-run <id>')
    process.exit(2)
  }
  const run = describeRun({ activeRunId: findActiveRun()?.id, id })
  if (!existsSync(run.runDir)) {
    console.error(`no such run: ${id}`)
    process.exit(1)
  }
  console.log(`path     : ${run.runDir}`)
  console.log(`size     : ${humanBytes(run.sizeBytes)}${run.truncated ? ' (truncated walk)' : ''}`)
  console.log(`files    : ${run.files}`)
  console.log(`modified : ${run.modified?.toISOString() ?? 'unknown'}`)
  console.log(`active   : ${run.active ? 'YES - belongs to the current active QA run' : 'no'}`)
}
else if (command === 'delete-run') {
  try {
    const removed = deleteManagedRun({ id: args[0] })
    console.log(`deleted: ${removed}`)
  }
  catch (error) {
    console.error(`[qa-storage] ${error.message}`)
    process.exit(1)
  }
}
else if (command === 'delete-all') {
  try {
    const { deleted, skipped } = deleteAllManagedRuns()
    console.log(`deleted ${deleted.length} run(s)${deleted.length ? `: ${deleted.join(', ')}` : ''}`)
    if (skipped.length > 0)
      console.log(`skipped (ACTIVE): ${skipped.join(', ')}`)
  }
  catch (error) {
    console.error(`[qa-storage] ${error.message}`)
    process.exit(1)
  }
}
else if (command === 'inventory') {
  const { file, totals } = writeInventory()
  console.log(`inventory written: ${file}`)
  console.log(`managed-test: ${humanBytes(totals['managed-test'])} | likely-test: ${humanBytes(totals['likely-test'])} | unknown: ${humanBytes(totals['unknown'])}`)
}
else if (command === 'retention') {
  const apply = args.includes('--apply')
  const keepLastArg = args.indexOf('--keep-last')
  const olderArg = args.indexOf('--older-than-days')
  const keepLast = keepLastArg >= 0 ? Number(args[keepLastArg + 1]) : 3
  const olderThanDays = olderArg >= 0 ? Number(args[olderArg + 1]) : undefined
  const plan = retentionPlan({ keepLast, olderThanDays })
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN (nothing deleted)'}`)
  console.log('would KEEP:')
  for (const run of plan.keep)
    console.log(`  ${run.id} (${humanBytes(run.sizeBytes)}) - ${run.why}`)
  console.log('would REMOVE:')
  if (plan.remove.length === 0)
    console.log('  (none)')
  for (const run of plan.remove)
    console.log(`  ${run.id} (${humanBytes(run.sizeBytes)}, modified ${run.modified?.toISOString() ?? 'unknown'})`)
  if (apply) {
    for (const run of plan.remove)
      deleteManagedRun({ id: run.id })
    console.log(`removed ${plan.remove.length} run(s)`)
  }
}
else if (command === 'prune-logs') {
  const apply = args.includes('--apply')
  const id = args.find(arg => !arg.startsWith('--'))
  if (!id) {
    console.error('usage: qa-storage.mjs prune-logs <runId> [--apply]')
    process.exit(2)
  }
  try {
    const { affected } = pruneRunLogs({ apply, id })
    console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN (nothing deleted)'}`)
    if (affected.length === 0)
      console.log('no log/metric files found for this run')
    for (const file of affected)
      console.log(`  ${apply ? 'removed' : 'would remove'}: ${file}`)
  }
  catch (error) {
    console.error(`[qa-storage] ${error.message}`)
    process.exit(1)
  }
}
else {
  console.error('usage: qa-storage.mjs <usage|delete-run <id>|delete-all|inventory|retention [--keep-last N] [--older-than-days D] [--apply]|prune-logs <runId> [--apply]>')
  process.exit(2)
}
