/**
 * Lia QA harness (Phase 7.9G-QA) - shared helpers.
 *
 * Pure Node, zero dependencies, so the harness runs anywhere Node runs and
 * paths containing spaces never break it. Everything destructive in the
 * harness goes through these guarded helpers - the .bat menu never deletes
 * anything itself.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOOLS_DIR = nodePath.dirname(fileURLToPath(import.meta.url))
export const TESTS_DIR = nodePath.resolve(TOOLS_DIR, '..')
export const REPO_ROOT = nodePath.resolve(TESTS_DIR, '..')

/** The three harness-owned managed roots. Nothing outside them is ever deleted. */
export const RUNS_DIR = nodePath.join(TESTS_DIR, 'runs')
export const RUNTIMES_DIR = nodePath.join(TESTS_DIR, 'runtimes')
export const LOGS_DIR = nodePath.join(TESTS_DIR, 'logs')
export const INVENTORY_DIR = nodePath.join(TESTS_DIR, 'inventory')
export const MANAGED_ROOTS = [RUNS_DIR, RUNTIMES_DIR, LOGS_DIR]

/** Marker file: this run's isolated runtime root is currently wired into Lia. */
export const ACTIVE_MARKER = nodePath.join('snapshots', 'ACTIVE.txt')

/** File name of the canonical product document (mirrors lia-core product-paths). */
export const LIA_PRODUCT_CONFIG_FILENAME = 'lia-product.json'

/* ------------------------------------------------------------------ */
/* Product-config path resolution                                      */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `liaUserDataCandidates` in lia-core `src/paths/product-paths.ts`:
 * the well-known %APPDATA% candidates, most specific first. This is a
 * finder, never a mover.
 */
export function liaUserDataCandidates(environment = process.env) {
  const appData = environment.APPDATA ?? environment.APPDATA_LOCAL
  if (!appData)
    return []
  return [
    nodePath.join(appData, 'Lia'),
    nodePath.join(appData, 'lia'),
    nodePath.join(appData, '@proj-airi', 'stage-tamagotchi'),
    nodePath.join(appData, 'stage-tamagotchi'),
    nodePath.join(appData, 'Electron'),
  ]
}

/**
 * Mirrors `liaProductPaths` resolution order in lia-core:
 *   1. LIA_USER_DATA env (explicit override - diagnostics, QA, portable runs)
 *   2. APP_USER_DATA_PATH env (the AIRI override)
 *   3. the first well-known %APPDATA% candidate ALREADY containing lia-product.json
 *   4. %APPDATA%\Lia (product default)
 * The harness MUST edit exactly the file Lia reads, so the order is copied,
 * not approximated.
 */
export function resolveProductPaths(environment = process.env, exists = p => existsSync(p)) {
  const explicit = environment.LIA_USER_DATA?.trim()
  if (explicit)
    return productPathsFor(explicit, 'lia-user-data-env')

  const shared = environment.APP_USER_DATA_PATH?.trim()
  if (shared)
    return productPathsFor(shared, 'app-user-data-env')

  for (const candidate of liaUserDataCandidates(environment)) {
    if (exists(nodePath.join(candidate, LIA_PRODUCT_CONFIG_FILENAME)))
      return productPathsFor(candidate, 'existing-data-candidate')
  }

  const appData = environment.APPDATA ?? environment.APPDATA_LOCAL
  if (!appData) {
    throw new Error('Neither APPDATA nor an explicit Lia user-data override is set; the product home cannot be resolved.')
  }
  return productPathsFor(nodePath.join(appData, 'Lia'), 'product-default')
}

function productPathsFor(userDataDir, source) {
  return {
    productConfigFile: nodePath.join(userDataDir, LIA_PRODUCT_CONFIG_FILENAME),
    source,
    userDataDir,
  }
}

/* ------------------------------------------------------------------ */
/* The one supported runtime-location key: voice.runtime.installDir    */
/* ------------------------------------------------------------------ */

/** Reads `voice.runtime.installDir` from a parsed product config. */
export function getInstallDir(config) {
  const value = config?.voice?.runtime?.installDir
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Returns a NEW config object with `voice.runtime.installDir` set (nothing else touched). */
export function withInstallDir(config, dir) {
  const next = structuredClone(config ?? {})
  next.voice ??= {}
  next.voice.runtime ??= {}
  next.voice.runtime.installDir = dir
  return next
}

/** Returns a NEW config object with ONLY `voice.runtime.installDir` removed. */
export function withoutInstallDir(config) {
  const next = structuredClone(config ?? {})
  if (next.voice?.runtime && 'installDir' in next.voice.runtime) {
    delete next.voice.runtime.installDir
    if (Object.keys(next.voice.runtime).length === 0)
      delete next.voice.runtime
  }
  if (next.voice && Object.keys(next.voice).length === 0)
    delete next.voice
  return next
}

/* ------------------------------------------------------------------ */
/* JSON + filesystem helpers                                           */
/* ------------------------------------------------------------------ */

export function readJsonSafe(file) {
  if (!existsSync(file))
    return undefined
  const text = readFileSync(file, 'utf-8')
  return JSON.parse(text)
}

/** 2-space JSON, trailing newline - the same shape the product writer keeps. */
export function jsonToWrite(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/* ------------------------------------------------------------------ */
/* Run folders                                                         */
/* ------------------------------------------------------------------ */

/** Local-time `YYYYMMDD-HHMMSS`; lexicographic order == chronological order. */
export function runTimestampId(now = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** Existing run ids under one runs root, newest first. */
export function listRunIds(runsDir = RUNS_DIR) {
  if (!existsSync(runsDir))
    return []
  return readdirSync(runsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => b.localeCompare(a))
}

/** The newest run whose snapshots/ACTIVE.txt marker is present (or undefined). */
export function findActiveRun(runsDir = RUNS_DIR) {
  for (const id of listRunIds(runsDir)) {
    if (existsSync(nodePath.join(runsDir, id, ACTIVE_MARKER)))
      return { id, runDir: nodePath.join(runsDir, id) }
  }
  return undefined
}

/* ------------------------------------------------------------------ */
/* Size / inventory walking                                            */
/* ------------------------------------------------------------------ */

const MAX_WALK_ENTRIES = 200_000

/** Recursive size + file count with an entry cap (honest truncation flag). */
export function dirSizeAndFiles(root) {
  let bytes = 0
  let files = 0
  let truncated = false
  let visited = 0
  const stack = [root]
  while (stack.length > 0) {
    if (visited >= MAX_WALK_ENTRIES) {
      truncated = true
      break
    }
    const current = stack.pop()
    visited += 1
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    }
    catch {
      continue // locked/vanished entry: skipped, never fatal for a report
    }
    for (const entry of entries) {
      if (visited >= MAX_WALK_ENTRIES) {
        truncated = true
        break
      }
      visited += 1
      const full = nodePath.join(current, entry.name)
      try {
        const stat = entry.isSymbolicLink() ? undefined : statSync(full)
        if (!stat)
          continue
        if (stat.isDirectory()) {
          stack.push(full)
        }
        else {
          files += 1
          bytes += stat.size
        }
      }
      catch { /* same policy: skip unreadable entries */ }
    }
  }
  return { bytes, files, truncated }
}

export function humanBytes(n) {
  if (n < 1024)
    return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n
  let unit = 'B'
  for (const next of units) {
    if (value < 1024)
      break
    value /= 1024
    unit = next
  }
  return `${value.toFixed(1)} ${unit}`
}

/** True when `target` resolves strictly inside one of the managed roots. */
export function isInsideManagedRoot(target, managedRoots = MANAGED_ROOTS) {
  const resolved = nodePath.resolve(target)
  return managedRoots.some((root) => {
    const relative = nodePath.relative(root, resolved)
    return relative !== '' && !relative.startsWith('..') && !nodePath.isAbsolute(relative)
  })
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true })
}
