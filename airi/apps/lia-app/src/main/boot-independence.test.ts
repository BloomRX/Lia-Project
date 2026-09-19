import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { AiriStageManager } from './airi-stage-manager'
import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

/**
 * Tests A, B and C of the Phase 7 contract: the launcher boots without
 * AIRI, the launcher boots with the AIRI folder missing entirely, and
 * opening the launcher never spawns the stage.
 */

const MAIN_SRC = import.meta.dirname
const RENDERER_SRC = join(import.meta.dirname, '..', 'renderer')

/** Every TypeScript file under a folder, recursively. */
async function tsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules')
        files.push(...await tsFiles(full))
    }
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

/** Import specifiers of one file (bare and relative), without node builtins. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)].map(match => match[1])
}

describe('a. Lia App boots without importing AIRI', () => {
  it('no source file of main/preload/renderer reaches an AIRI package', async () => {
    const files = [
      ...await tsFiles(MAIN_SRC),
      ...await tsFiles(join(import.meta.dirname, '..', 'preload')),
      ...await tsFiles(RENDERER_SRC),
    ].filter(f => !f.endsWith('.test.ts'))

    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const specifier of importsOf(source)) {
        if (
          specifier.startsWith('@proj-airi/stage')
          || specifier.startsWith('@proj-airi/stage-ui')
          || specifier.includes('stage-tamagotchi')
          || specifier.includes('godot')
          || specifier.includes('spotlight')
        ) {
          offenders.push({ file, specifier })
        }
      }
    }

    expect(offenders).toEqual([])
    expect(files.length).toBeGreaterThan(5) // the scan is not vacuous
  })
})

describe('b. Lia App boots with the AIRI folder missing', () => {
  it('the host is fully functional and merely reports the stage unavailable', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      workspaceRoot: '/definitely/missing/airi-workspace',
    })

    const status = await host.homeStatus()

    expect(status.config.status).toBe('ok')
    expect(status.voices.count).toBe(2)
    expect(status.stage.available).toBe(false)
    expect(host.stage.isAvailable()).toBe(false)

    await expect(host.stage.start()).resolves.toMatchObject({ phase: 'error' })
  })
})

describe('c. Opening Lia never spawns the stage', () => {
  it('no host surface besides conversar() calls stage.start', async () => {
    const home = await makeLiaHome()
    const stageStart = vi.fn(async (_options?: { env?: Record<string, string | undefined> }) => ({ logTail: [], phase: 'running' as const }))
    const factory = vi.fn((_d: ConstructorParameters<typeof AiriStageManager>[0]) => new AiriStageManager({
      spawnImpl: (() => ({
        emit: () => {},
        exitCode: 0,
        kill: () => true,
        once: () => {},
        pid: 1,
      })) as never,
      workspaceRoot: '/missing',
    }))
    const factoryWithMockStart = vi.fn((d: ConstructorParameters<typeof AiriStageManager>[0]) => {
      const manager = factory(d)
      manager.start = stageStart
      return manager
    })

    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      stageManagerFactory: factoryWithMockStart,
      workspaceRoot: '/missing',
    })

    // Every shot the boot window takes: status, config, voices, bridge env.
    // (There is deliberately no host.runtime() surface anymore - Phase 7.8E:
    // the launcher hosts no voice worker, and none can be materialized here.)
    await host.homeStatus()
    await host.productSnapshot()
    await host.listVoices()
    await host.bridgeConfig()
    await host.stageEnv()

    expect(stageStart).not.toHaveBeenCalled()
  })
})
