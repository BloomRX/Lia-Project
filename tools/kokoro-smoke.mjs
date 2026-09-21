#!/usr/bin/env node
/**
 * Lia - Phase 7.9D dev-only Kokoro smoke (primary target: Windows).
 * Entry point: `DevKit.bat kokoro-smoke` from the repo root.
 *
 * This file is a THIN CLI. It contains no TTS logic of its own: it wires
 * together PRODUCTION modules built from `airi/packages/lia-core` -
 *
 *   - resolveVoiceRuntimeHome   (dist/bootstrap/runtime-root.mjs)
 *   - createKokoroVoiceEngine   (dist/voice/engines/kokoro/index.mjs)
 *   - resolveKokoroLayout       (same dist entry)
 *   - runKokoroSmoke            (same dist entry; the engine-owned driver)
 *
 * so what runs here is exactly the code Lia ships, not a QA duplicate.
 * Everything the smoke prints is measured (process exit codes, wall clock,
 * engine health, sha256 over bytes on disk).
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import nodePath from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const LIA_CORE_DIST = nodePath.join(REPO_ROOT, 'airi', 'packages', 'lia-core', 'dist')

const engineDist = nodePath.join(LIA_CORE_DIST, 'voice', 'engines', 'kokoro', 'index.mjs')
const runtimeDist = nodePath.join(LIA_CORE_DIST, 'bootstrap', 'runtime-root.mjs')

for (const dist of [engineDist, runtimeDist]) {
  if (!existsSync(dist)) {
    console.error(`[kokoro-smoke] ERROR: production dist is missing: ${dist}`)
    console.error('[kokoro-smoke] Build lia-core first: cd airi/packages/lia-core && pnpm run build (or npx tsdown)')
    process.exit(1)
  }
}

const { createKokoroVoiceEngine, resolveKokoroLayout, runKokoroSmoke, kokoroSmokeSummaryLine }
  = await import(pathToFileURL(engineDist).href)
const { resolveVoiceRuntimeHome } = await import(pathToFileURL(runtimeDist).href)

// Dev-only QA corner of the repo (gitignored). On Windows the REAL runtime
// home (%LOCALAPPDATA%\Lia\runtimes) is used - exercising it is the entire
// point of the smoke. POSIX runs stage here so a dev box is never dirtied.
const QA_DIR = nodePath.join(REPO_ROOT, '.devkit-qa')
const stagingUserData = nodePath.join(QA_DIR, 'staging-userData')
const outDir = nodePath.join(QA_DIR, 'kokoro-smoke')
await mkdir(outDir, { recursive: true })

const runtimeHome = resolveVoiceRuntimeHome({ userDataDir: stagingUserData })
console.log(`[kokoro-smoke] voice runtime home (production resolution): ${runtimeHome}`)

const engineFactory = () => createKokoroVoiceEngine({
  runtimeHome: () => runtimeHome,
  log: entry => console.log(`[kokoro-engine] ${JSON.stringify(entry)}`),
})

try {
  const report = await runKokoroSmoke({
    // The layout comes from the SAME production resolver the engine uses,
    // feeding the same runtimeHome - one source of truth, no copies.
    layout: resolveKokoroLayout({ home: runtimeHome }),
    engineFactory,
    log: line => console.log(line),
    outDir,
  })
  console.log(kokoroSmokeSummaryLine(report))
  console.log(`[kokoro-smoke] DONE - dev-only WAV files at: ${outDir}`)
}
catch (error) {
  console.error(`[kokoro-smoke] FAILED: ${error?.message ?? error}`)
  process.exit(1)
}
