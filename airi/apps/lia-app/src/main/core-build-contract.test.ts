/**
 * Windows integration HOTFIX 4 - build/orchestration contract.
 *
 * QA hit on a real Windows machine: `[MISSING_EXPORT] "inspectAllTalkInstall"
 * is not exported by packages/lia-core/dist/alltalk/runtime.mjs`. The source
 * change (hotfix 3) was correct and the sandbox suite was green - but the
 * launcher consumes @lia/core through its BUILT dist, and that dist had been
 * compiled at `pnpm install` time, BEFORE the fixes were pulled. Nothing but
 * the developer's memory ever rebuilt it.
 *
 * The fix is orchestration, not more code: the app's dev/build scripts now
 * rebuild @lia/core first, so `Lia.bat` (which calls `pnpm dev:lia`) is
 * sufficient after a fresh checkout + install. This file pins that contract
 * so a future "optimization" cannot quietly put staleness back.
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

describe('hotfix 4: @lia/core is fresh before any Lia boot', () => {
  it('a: the source really exports inspectAllTalkInstall (no silent regression)', () => {
    const source = readFileSync(join(CORE_DIR, 'src', 'alltalk', 'runtime.ts'), 'utf8')
    expect(source).toContain('export async function inspectAllTalkInstall')

    const runtimePaths = readFileSync(join(CORE_DIR, 'src', 'paths', 'runtime-paths.ts'), 'utf8')
    expect(runtimePaths).toContain('export function resolveLiaRuntimeRoot')
    expect(runtimePaths).toContain('export function resolveAllTalkRuntimeDir')
    expect(runtimePaths).toContain('export function resolveAllTalkInstallCandidates')
  })

  it('b: the package export map exposes the subpaths the app imports', () => {
    const pkg = readJson<{ exports: Record<string, string> }>(join(CORE_DIR, 'package.json'))
    expect(pkg.exports['./alltalk/runtime']).toBe('./dist/alltalk/runtime.mjs')
    expect(pkg.exports['./paths/runtime-paths']).toBe('./dist/paths/runtime-paths.mjs')

    // tsdown must actually be told to emit that entry, or the map points at
    // a file that will never exist (the first incarnation of hotfix 4's bug).
    const tsdown = readFileSync(join(CORE_DIR, 'tsdown.config.ts'), 'utf8')
    expect(tsdown).toContain('\'./src/alltalk/runtime.ts\'')
    expect(tsdown).toContain('\'./src/paths/runtime-paths.ts\'')
  })

  it('c: when a dist exists, it must contain the current API (fresh, not install-time stale)', () => {
    /** A pristine checkout legitimately has no dist yet - the dev script builds it. */
    const distRuntime = join(CORE_DIR, 'dist', 'alltalk', 'runtime.mjs')
    if (!existsSync(distRuntime))
      return

    const artifact = readFileSync(distRuntime, 'utf8')
    expect(artifact).toContain('inspectAllTalkInstall')

    const distRuntimePaths = join(CORE_DIR, 'dist', 'paths', 'runtime-paths.mjs')
    expect(existsSync(distRuntimePaths)).toBe(true)
    const pathsArtifact = readFileSync(distRuntimePaths, 'utf8')
    expect(pathsArtifact).toContain('resolveLiaRuntimeRoot')
    expect(pathsArtifact).toContain('resolveAllTalkInstallCandidates')
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
