#!/usr/bin/env node
/**
 * Lia QA harness (Phase 7.9G-QA) - run folder lifecycle.
 *
 * One run == one timestamped folder under Tests\runs with the fixed layout:
 *   runtime\    isolated runtime root (clean-install runs only)
 *   logs\       lia-console.log (+ derived stage-console.log)
 *   metrics\    environment.txt, voice-events.txt, voice-summary.txt
 *   snapshots\  config backup + restore instructions + ACTIVE marker
 * plus QA-CHECKLIST.txt and USER-NOTES.txt at the run root.
 *
 * stdout contract for the .bat: `create` and `latest` print EXACTLY one
 * path on stdout (everything else goes to stderr), so `for /f` can capture it.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

import {
  LOGS_DIR,
  REPO_ROOT,
  RUNS_DIR,
  RUNTIMES_DIR,
  ensureDir,
  listRunIds,
  resolveProductPaths,
  runTimestampId,
} from './qa-shared.mjs'

const CLEAN_INSTALL_CHECKLIST = `Lia QA - VOICE CLEAN-INSTALL CHECKLIST (run: {ID})
=============================================================
Isolated runtime root : {RUNTIME_ROOT}
Product config backup : snapshots\\lia-product.before.json
Restore               : LiaTests.bat -> option 4

Confirm each item while Lia is running, then fill USER-NOTES.txt:

[ ] Voz da Lia card appears once
[ ] Kokoro shows Não instalado
[ ] Instalar voz is available
[ ] Clicking it shows Instalando…
[ ] Lia App stays responsive
[ ] It eventually shows Pronto
[ ] Kokoro remains Selecionado
[ ] Conversar com Lia opens Stage
[ ] Startup greeting speaks once
[ ] Normal chat reply is spoken
[ ] No technical backend jargon appears in normal UI

When finished: close Lia, then run LiaTests.bat -> option 4 to restore
the normal configuration. Logs/metrics are extracted during the restore.
`

const SMOKE_CHECKLIST = `Lia QA - EXISTING RUNTIME SMOKE CHECKLIST (run: {ID})
=============================================================
This run executed tools\\kokoro-smoke.mjs against the PRODUCTION runtime
home (the validated install). Nothing was installed or moved.

[ ] Smoke finished with exit code 0 (see logs\\lia-console.log)
[ ] Summary line reports the engine healthy (search "kokoro-smoke] DONE")
[ ] WAV artifacts exist under artifacts\\smoke (inside THIS run folder)
`

const USER_NOTES_TEMPLATE = `Lia QA - USER NOTES (run: {ID})
=============================================================
Type your observations directly in this file.

UI result:
install result:
greeting result:
chat speech result:
perceived voice latency:
visual/UI issue:
other notes:
`

function gitInfo() {
  const run = args => execSync(args, { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return {
      branch: run('git rev-parse --abbrev-ref HEAD'),
      sha: run('git rev-parse HEAD'),
      status: run('git status --short'),
    }
  }
  catch {
    return { branch: 'not available', sha: 'not available', status: 'not available' }
  }
}

/** Creates the run skeleton; returns the run dir. Collisions get -2, -3, ... */
export function createRun({ kind, now = new Date(), runsDir = RUNS_DIR }) {
  if (kind !== 'clean-install' && kind !== 'smoke')
    throw new Error(`unknown run kind: ${kind}`)

  // Materialize the managed roots on first use (all gitignored). Skipped when
  // a test injects its own runs root.
  if (runsDir === RUNS_DIR) {
    for (const root of [RUNTIMES_DIR, LOGS_DIR])
      ensureDir(root)
  }

  let id = runTimestampId(now)
  let suffix = 1
  while (existsSync(nodePath.join(runsDir, id))) {
    suffix += 1
    id = `${runTimestampId(now)}-${suffix}`
  }
  const runDir = nodePath.join(runsDir, id)
  // Every run owns its artifacts root so ALL generated QA content (smoke
  // WAVs today, anything the harness downloads tomorrow) stays reviewable
  // and dies with the run.
  const subs = ['runtime', 'logs', 'metrics', 'snapshots', 'artifacts']
  if (kind === 'smoke')
    subs.push(nodePath.join('artifacts', 'smoke'))
  for (const sub of subs)
    mkdirSync(nodePath.join(runDir, sub), { recursive: true })

  const runtimeRoot = nodePath.join(runDir, 'runtime')
  const fill = text => text.replaceAll('{ID}', id).replaceAll('{RUNTIME_ROOT}', runtimeRoot)
  const checklist = kind === 'clean-install' ? CLEAN_INSTALL_CHECKLIST : SMOKE_CHECKLIST
  writeFileSync(nodePath.join(runDir, 'QA-CHECKLIST.txt'), fill(checklist), 'utf-8')
  writeFileSync(nodePath.join(runDir, 'USER-NOTES.txt'), fill(USER_NOTES_TEMPLATE), 'utf-8')

  const git = gitInfo()
  const info = [
    `run id     : ${id}`,
    `kind       : ${kind}`,
    `created    : ${now.toISOString()}`,
    `branch     : ${git.branch}`,
    `git sha    : ${git.sha}`,
  ].join('\n')
  writeFileSync(nodePath.join(runDir, 'run-info.txt'), `${info}\n`, 'utf-8')

  return runDir
}

/** Writes metrics/environment.txt for one run (never throws on missing git). */
export function writeEnvironment({ runDir, runsDir = RUNS_DIR }) {
  const id = nodePath.basename(runDir)
  const git = gitInfo()
  let paths = { productConfigFile: 'unresolved', source: 'unresolved' }
  try {
    paths = resolveProductPaths()
  }
  catch { /* honest unresolved line below */ }

  const isCleanInstall = existsSync(nodePath.join(runDir, 'runtime'))
    && id !== '' && !runIsSmoke(runDir)
  const qaRuntimeRoot = isCleanInstall
    ? nodePath.join(runDir, 'runtime')
    : `${nodePath.join('%LOCALAPPDATA%', 'Lia', 'runtimes')} (production default - smoke run)`

  const statusLines = (git.status || '(clean)').split('\n').slice(0, 200)
  const lines = [
    'Lia QA - environment',
    '====================',
    `timestamp            : ${new Date().toISOString()}`,
    `run id               : ${id}`,
    `runs root            : ${runsDir}`,
    '',
    `branch               : ${git.branch}`,
    `git sha              : ${git.sha}`,
    `git status --short   :`,
    ...statusLines.map(line => `  ${line}`),
    '',
    `os                   : ${process.platform} ${os.release()} (${os.arch()})`,
    `node                 : ${process.version}`,
    `APPDATA present      : ${process.env.APPDATA ? `yes (${process.env.APPDATA})` : 'no'}`,
    `LOCALAPPDATA present : ${process.env.LOCALAPPDATA ? `yes (${process.env.LOCALAPPDATA})` : 'no'}`,
    '',
    `product config file  : ${paths.productConfigFile}`,
    `config source        : ${paths.source}`,
    `effective QA runtime : ${qaRuntimeRoot}`,
  ]
  const metricsDir = nodePath.join(runDir, 'metrics')
  mkdirSync(metricsDir, { recursive: true })
  writeFileSync(nodePath.join(metricsDir, 'environment.txt'), `${lines.join('\n')}\n`, 'utf-8')
}

function readRunKind(runDir) {
  try {
    const info = readFileSync(nodePath.join(runDir, 'run-info.txt'), 'utf-8')
    const match = info.match(/^kind\s*:\s*(\S+)/m)
    return match?.[1] ?? 'unknown'
  }
  catch {
    return 'unknown'
  }
}

function runIsSmoke(runDir) {
  return readRunKind(runDir) === 'smoke'
}

/** Prints the newest run dir. */
export function latestRun({ runsDir = RUNS_DIR } = {}) {
  const ids = listRunIds(runsDir)
  if (ids.length === 0)
    return undefined
  return nodePath.join(runsDir, ids[0])
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [, , command, ...args] = process.argv

if (!isMain) {
  // Imported by tests - library only.
}
else if (command === 'create') {
  try {
    const runDir = createRun({ kind: args[0] })
    writeEnvironment({ runDir })
    console.error(`run created: ${runDir}`)
    console.log(runDir) // the ONE stdout line the .bat captures
  }
  catch (error) {
    console.error(`[qa-run] create failed: ${error.message}`)
    process.exit(1)
  }
}
else if (command === 'env') {
  const runDir = args[0]
  if (!runDir) {
    console.error('usage: qa-run.mjs env <runDir>')
    process.exit(2)
  }
  writeEnvironment({ runDir: nodePath.resolve(runDir) })
  console.error(`environment written: ${nodePath.join(runDir, 'metrics', 'environment.txt')}`)
}
else if (command === 'latest') {
  const runDir = latestRun()
  if (!runDir) {
    console.error('[qa-run] no test runs found under Tests\\runs')
    process.exit(1)
  }
  console.error(`latest run: ${runDir}`)
  console.log(runDir)
}
else {
  console.error('usage: qa-run.mjs <create <clean-install|smoke>|env <runDir>|latest>')
  process.exit(2)
}
