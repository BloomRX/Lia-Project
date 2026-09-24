#!/usr/bin/env node
/**
 * Lia QA harness (Phase 7.9G-QA) - product-config backup / activate / restore.
 *
 * The ONLY supported runtime-location seam is used: `voice.runtime.installDir`
 * in the canonical `lia-product.json` (read by `effectiveRuntimeHome` in the
 * launcher host). The harness never invents a path convention - Kokoro still
 * installs under whatever that key points at, via the engine's own layout
 * resolver.
 *
 * Safety order (Ctrl+C-proof): the snapshot file is written BEFORE the config
 * is touched, and the ACTIVE marker is written LAST. An abort at any point
 * therefore either changed nothing or left a restorable marker behind.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  ACTIVE_MARKER,
  RUNS_DIR,
  findActiveRun,
  getInstallDir,
  jsonToWrite,
  readJsonSafe,
  resolveProductPaths,
  withInstallDir,
  withoutInstallDir,
} from './qa-shared.mjs'

const ABSENT = '(absent)'

/**
 * Points Lia at the run's isolated runtime root.
 * @returns facts about what was saved and changed
 */
export function activateRun({ environment = process.env, now = new Date(), runDir }) {
  if (!existsSync(nodePath.join(runDir, 'snapshots')))
    throw new Error(`Not a harness run folder (missing snapshots): ${runDir}`)

  const paths = resolveProductPaths(environment)
  const configFile = paths.productConfigFile
  const snapshotDir = nodePath.join(runDir, 'snapshots')
  const backupFile = nodePath.join(snapshotDir, 'lia-product.before.json')

  const hadFile = existsSync(configFile)
  const original = hadFile ? readJsonSafe(configFile) : undefined
  const originalInstallDir = getInstallDir(original) ?? ABSENT

  // 1) Backup FIRST - if this fails, nothing is mutated.
  if (hadFile)
    copyFileSync(configFile, backupFile)

  // 2) Mutate ONLY the supported runtime-location key (creating the product
  //    dir on a fresh machine, exactly where lia-core's default points).
  const isolatedRoot = nodePath.join(runDir, 'runtime')
  const nextConfig = withInstallDir(original, isolatedRoot)
  mkdirSync(nodePath.dirname(configFile), { recursive: true })
  writeFileSync(configFile, jsonToWrite(nextConfig), 'utf-8')

  // 3) Record exactly how this is undone.
  const instructions = [
    'Lia QA harness - restore instructions',
    `created: ${now.toISOString()}`,
    '',
    `product config file : ${configFile}`,
    `resolved via        : ${paths.source}`,
    `full backup         : ${hadFile ? backupFile : '(no file existed before this run)'}`,
    '',
    `original voice.runtime.installDir : ${originalInstallDir}`,
    `QA value (isolated runtime root)  : ${isolatedRoot}`,
    '',
    'How to restore: run LiaTests.bat -> option 4 (Restore normal Lia configuration).',
    'Restore semantics: the single key voice.runtime.installDir is reverted to the',
    'original value above (or removed when it was absent). Every other setting the',
    'user may have changed during QA is left untouched. The full backup above is',
    'kept for forensics only.',
  ].join('\n')
  writeFileSync(nodePath.join(snapshotDir, 'restore-instructions.txt'), `${instructions}\n`, 'utf-8')

  // 4) Marker LAST: its presence means "a restore is owed".
  const marker = [
    `configFile=${configFile}`,
    `runDir=${runDir}`,
    `originalInstallDir=${originalInstallDir}`,
    `activatedAt=${now.toISOString()}`,
  ].join('\n')
  writeFileSync(nodePath.join(runDir, ACTIVE_MARKER), `${marker}\n`, 'utf-8')

  return {
    backupFile: hadFile ? backupFile : undefined,
    configFile,
    isolatedRoot,
    originalInstallDir,
    source: paths.source,
  }
}

function parseMarker(runDir) {
  const lines = readFileSync(nodePath.join(runDir, ACTIVE_MARKER), 'utf-8').split(/\r?\n/)
  const values = {}
  for (const line of lines) {
    const index = line.indexOf('=')
    if (index > 0)
      values[line.slice(0, index)] = line.slice(index + 1)
  }
  return values
}

/**
 * Reverts `voice.runtime.installDir` for the newest active run.
 * @returns facts about the restore (undefined when nothing was active)
 */
export function restoreRun({ environment = process.env, runsDir = RUNS_DIR }) {
  const active = findActiveRun(runsDir)
  if (!active)
    return undefined

  const marker = parseMarker(active.runDir)
  const configFile = marker.configFile ?? resolveProductPaths(environment).productConfigFile
  const originalInstallDir = marker.originalInstallDir ?? ABSENT

  const current = readJsonSafe(configFile)
  const beforeValue = getInstallDir(current) ?? ABSENT
  const nextConfig = originalInstallDir === ABSENT
    ? withoutInstallDir(current)
    : withInstallDir(current, originalInstallDir)
  writeFileSync(configFile, jsonToWrite(nextConfig), 'utf-8')

  unlinkSync(nodePath.join(active.runDir, ACTIVE_MARKER))

  return {
    beforeValue,
    configFile,
    restoredValue: originalInstallDir,
    runDir: active.runDir,
    runId: active.id,
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function printStatus() {
  let paths
  try {
    paths = resolveProductPaths()
  }
  catch (error) {
    console.log(`product config : UNRESOLVED (${error.message})`)
    return
  }
  const config = readJsonSafe(paths.productConfigFile)
  const installDir = getInstallDir(config)
  console.log(`product config : ${paths.productConfigFile} (${paths.source}${existsSync(paths.productConfigFile) ? '' : ', file not created yet'})`)
  console.log(`runtime key    : voice.runtime.installDir = ${installDir ?? '(absent -> production default)'}`)
  const active = findActiveRun()
  if (active) {
    console.log('')
    console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!')
    console.log(`  WARNING: QA configuration is ACTIVE (run ${active.id}).`)
    console.log('  Lia is pointed at an isolated test runtime right now.')
    console.log('  When QA is finished, choose option 4 to restore.')
    console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!')
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [, , command, ...args] = process.argv

if (!isMain) {
  // Imported by tests - library only.
}
else if (command === 'status-banner') {
  printStatus()
}
else if (command === 'activate') {
  const runDir = args[0]
  if (!runDir) {
    console.error('usage: qa-config.mjs activate <runDir>')
    process.exit(2)
  }
  try {
    const facts = activateRun({ runDir: nodePath.resolve(runDir) })
    console.log(`backed up to   : ${facts.backupFile ?? '(no previous file)'}`)
    console.log(`config file    : ${facts.configFile}`)
    console.log(`original key   : ${facts.originalInstallDir}`)
    console.log(`isolated root  : ${facts.isolatedRoot}`)
  }
  catch (error) {
    console.error(`[qa-config] activate failed: ${error.message}`)
    process.exit(1)
  }
}
else if (command === 'restore') {
  try {
    const facts = restoreRun({})
    if (!facts) {
      console.log('No active QA run found - nothing to restore.')
    }
    else {
      console.log(`restored run   : ${facts.runId}`)
      console.log(`config file    : ${facts.configFile}`)
      console.log(`key reverted   : voice.runtime.installDir ${facts.beforeValue} -> ${facts.restoredValue}`)
      console.log('Lia now uses its normal runtime configuration again.')
    }
  }
  catch (error) {
    console.error(`[qa-config] restore failed: ${error.message}`)
    process.exit(1)
  }
}
else {
  console.error('usage: qa-config.mjs <status-banner|activate <runDir>|restore>')
  process.exit(2)
}
