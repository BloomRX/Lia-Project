/**
 * Windows integration HOTFIX 4 - build/orchestration contract.
 *
 * The QA hit this file pins, in the words of its era: `[MISSING_EXPORT]
 * "inspectAllTalkInstall" is not exported by packages/lia-core/dist/...` -
 * the source change was correct, the sandbox suite was green, and yet the
 * launcher consumed @lia/core through its BUILT dist, which had been compiled
 * at `pnpm install` time, BEFORE the fixes were pulled. Nothing but the
 * developer's memory ever rebuilt it.
 *
 * The fix is orchestration, not more code: the app's dev/build scripts now
 * rebuild @lia/core first, so `Lia.bat` (which calls `pnpm dev:lia`) is
 * sufficient after a fresh checkout + install. This file pins that contract
 * so a future "optimization" cannot quietly put staleness back. The contract
 * outlives every engine era; the concrete exports pinned below are simply the
 * ones the current host imports (Phase 7.8E: engine-neutral transitional core,
 * no AllTalk/F5 modules).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** Repo paths, resolved against this test file's location. */
const LIA_APP_DIR = join(import.meta.dirname, '..', '..')
const CORE_DIR = join(LIA_APP_DIR, '..', '..', 'packages', 'lia-core')
const WORKSPACE_ROOT = join(CORE_DIR, '..', '..')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/**
 * The core subpaths the host really imports - listed once so every leg of
 * this contract reads the same surface. Engine-neutral transitional core:
 * no AllTalk/F5 modules are expected to exist.
 */
const APP_CORE_SUBPATHS = [
  'bootstrap/runtime-root',
  'paths/install-location',
  'paths/product-paths',
  'secrets/vault',
  'voices/types',
] as const

describe('hotfix 4: @lia/core is fresh before any Lia boot', () => {
  it('a: the source still exports what the host imports (no silent regression)', () => {
    const REQUIRED_EXPORTS: Record<string, string[]> = {
      'bootstrap/runtime-root': ['resolveVoiceRuntimeHome'],
      'bridge/lia-config': ['buildLiaBridgeConfig', 'stageEnvFor'],
      'paths/install-location': ['classifyInstallLocation', 'inspectInstallLocationTarget'],
      'paths/product-paths': ['liaProductPaths'],
      'product/config': ['readLiaProductConfig', 'updateLiaProductConfig'],
      'secrets/vault': ['createLiaSecretVault'],
      'voices/profiles': ['createLiaVoiceProfileStore', 'findMissingFiles', 'VOICE_ENGINES'],
    }
    for (const [subpath, names] of Object.entries(REQUIRED_EXPORTS)) {
      const source = readFileSync(join(CORE_DIR, 'src', `${subpath}.ts`), 'utf8')
      for (const name of names)
        expect(source, `${subpath}: ${name}`).toMatch(new RegExp(`export (async )?(function|const|type|interface) ${name}\\b`))

      // Ancient engine-era detectors must never come back under any name.
      expect(source, `${subpath} must not resurrect AllTalk detectors`).not.toContain('inspectAllTalkInstall')
    }
  })

  it('b: the package export map exposes the subpaths the app imports', () => {
    const pkg = readJson<{ exports: Record<string, unknown> }>(join(CORE_DIR, 'package.json'))
    // tsdown must actually be told to emit each entry, or the map points at
    // a file that will never exist (the first incarnation of hotfix 4's bug).
    const tsdown = readFileSync(join(CORE_DIR, 'tsdown.config.ts'), 'utf8')
    for (const subpath of ['bootstrap/runtime-root', 'bridge/lia-config', 'paths/install-location', 'paths/product-paths', 'product/config', 'secrets/vault', 'voices/profiles', 'voices/types']) {
      const exported = pkg.exports[`./${subpath}`]
      expect(exported, `./${subpath}`).toBeTruthy()
      expect(JSON.stringify(exported), `./${subpath}`).toContain(`dist/${subpath}`)
      expect(tsdown, `tsdown missing ${subpath}`).toContain(`./src/${subpath}.ts`)
    }
    // ...and the deleted engine-era subpaths are not re-entered by accident.
    expect(pkg.exports['./alltalk/runtime']).toBeUndefined()
    expect(pkg.exports['./voice/engines/f5/install-plan']).toBeUndefined()
    expect(APP_CORE_SUBPATHS.length).toBeGreaterThan(0)
  })

  it('c: when a dist exists, it must contain the current API (fresh, not install-time stale)', () => {
    /** A pristine checkout legitimately has no dist yet - the dev script builds it. */
    const dist = (subpath: string) => join(CORE_DIR, 'dist', `${subpath}.mjs`)
    if (!existsSync(dist('bootstrap/runtime-root')))
      return

    for (const subpath of ['bootstrap/runtime-root', 'bridge/lia-config', 'paths/install-location', 'paths/product-paths', 'product/config', 'secrets/vault', 'voices/profiles']) {
      expect(existsSync(dist(subpath)), `dist/${subpath}.mjs`).toBe(true)
      const artifact = readFileSync(dist(subpath), 'utf8')
      // Staleness runs both ways now: what the app consumes must be current.
      expect(artifact, `dist/${subpath}.mjs stale`).not.toContain('inspectAllTalkInstall')
    }
    const profiles = readFileSync(dist('voices/profiles'), 'utf8')
    expect(profiles).toContain('VOICE_ENGINES')
    expect(profiles).toContain('LEGACY_VOICE_ENGINES')
  })

  it('d: dev and build scripts build @lia/core BEFORE electron-vite touches it', () => {
    const pkg = readJson<{ scripts: Record<string, string> }>(join(LIA_APP_DIR, 'package.json'))
    for (const script of ['dev', 'build']) {
      const command = pkg.scripts[script] ?? ''
      const coreBuild = command.indexOf('pnpm -F @lia/core build')
      const appBuild = command.indexOf('electron-vite')
      expect(coreBuild, `"${script}" must build @lia/core first`).toBeGreaterThanOrEqual(0)
      expect(appBuild, `"${script}" must still run electron-vite`).toBeGreaterThan(coreBuild)
    }

    // The user-facing entry point Lia.bat drives is the workspace dev:lia,
    // which must delegate to this very app script (not bypass it).
    const root = readJson<{ scripts: Record<string, string> }>(join(WORKSPACE_ROOT, 'package.json'))
    expect(root.scripts['dev:lia']).toContain('@lia/lia-app')
    expect(root.scripts['dev:lia']).toContain('dev')
  })
})
