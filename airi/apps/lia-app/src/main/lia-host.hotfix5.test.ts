/**
 * Windows integration HOTFIX 5: env transport + truthful partial status.
 *
 * Real-machine QA after c006e00: `lia:home-status` threw
 * "LOCALAPPDATA is not set on this Windows profile" on a PERFECTLY healthy
 * profile - because the Electron entry created the host WITHOUT an env
 * block, and the host forwarded that absence to the core as an EMPTY
 * lookup, masking the process's real environment. One throw then zeroed
 * every unrelated status line.
 *
 * These tests pin:
 * A  the process's real env reaches the core when no fixture block exists;
 * B/C at the core layer (covered in stage voice-runtime-root.test.ts);
 * D  a runtime resolution failure degrades ONLY the alltalk section.
 */
import { join } from 'node:path'

import { createRuntimeManager, inspectAllTalkInstall } from '@lia/core/alltalk/runtime'
import { resolveAllTalkRuntimeDir } from '@lia/core/paths/runtime-paths'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { identityCipher, makeLiaHome } from './test-helpers'

const WIN_LOCAL = 'C:\\Users\\lucas\\AppData\\Local'
const WIN_PLATFORM = 'win32' as const

const savedEnv: Record<string, string | undefined> = {}

function withProcessEnv(changes: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(changes)) {
    savedEnv[key] = process.env[key]
    if (value === undefined)
      delete process.env[key]
    else
      process.env[key] = value
  }
}

function restoreProcessEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined)
      delete process.env[key]
    else
      process.env[key] = value
    delete savedEnv[key]
  }
}

/** A virtual disk holding a proven-installed canonical runtime. */
function winInstalledDisk(): { disk: Set<string>, populate: (appDir: string) => void } {
  const disk = new Set<string>()
  return {
    disk,
    populate: (appDir: string) => {
      for (const marker of [
        'script.py',
        'system',
        'voices',
        join('alltalk_environment', 'conda'),
        join('alltalk_environment', 'env'),
        'start_alltalk.bat',
      ]) {
        disk.add(join(appDir, marker))
      }
      disk.add(join(appDir, '..', 'state.json'))
    },
  }
}

describe('lia host - Windows env transport + resilient status (hotfix 5)', () => {
  beforeEach(() => restoreProcessEnv())
  afterEach(() => restoreProcessEnv())

  it('test A: with NO injected env the process REAL LOCALAPPDATA reaches the core and resolves the canonical runtime', async () => {
    const home = await makeLiaHome({ voiceCount: 0 })
    withProcessEnv({ APPDATA: home.appData, LOCALAPPDATA: WIN_LOCAL })
    const { disk, populate } = winInstalledDisk()
    const canonicalAppDir = resolveAllTalkRuntimeDir({ platform: WIN_PLATFORM })
    populate(canonicalAppDir)
    const events: string[] = []
    const existsOnDisk = async (path: string) => disk.has(path)
    const host = createLiaHost({
      cipher: identityCipher,
      // NO env block - exactly how main/index.ts creates the host. The fix
      // under test: the host must hand the process's real env to the core.
      inspectInstallImpl: async (dir, deps) =>
        await inspectAllTalkInstall(dir, { exists: existsOnDisk, platform: deps?.platform ?? WIN_PLATFORM }),
      onEvent: event => events.push(event),
      platform: WIN_PLATFORM,
      runtimeManagerFactory: config => createRuntimeManager({
        existsImpl: existsOnDisk,
        installDir: config.installDir,
        isHealthy: async () => false,
        platform: WIN_PLATFORM,
      }),
      workspaceRoot: '/missing',
    })

    const status = await host.homeStatus()
    expect(status.alltalk.installed).toBe(true)
    expect(status.alltalk.installDir).toBe(canonicalAppDir)
    expect(status.alltalk.error).toBeUndefined()
    expect(status.alltalk.phase).toBe('stopped')
    // Safe boot diagnostics (item 1): booleans only, never values.
    expect(events).toContain('lia:env')
  })

  it('test D: a runtime resolution failure degrades ONLY the alltalk section - config, voices and stage survive', async () => {
    const home = await makeLiaHome({ voiceCount: 2 })
    // An injected block WITHOUT either resolution source (the masked-lookup
    // shape of the original bug, now pointing at the named operational error).
    const env = { APPDATA: home.appData }
    const events: string[] = []
    const host = createLiaHost({
      cipher: identityCipher,
      env,
      onEvent: event => events.push(event),
      platform: WIN_PLATFORM,
      workspaceRoot: '/missing',
    })

    const status = await host.homeStatus()
    // The runtime section is UNKNOWN, never a fabricated false.
    expect(status.alltalk.phase).toBe('unknown')
    expect(status.alltalk.installed).toBeUndefined()
    expect(status.alltalk.running).toBe(false)
    expect(status.alltalk.error).toMatch(/Could not resolve Windows LocalAppData/)
    expect(status.alltalk.error).not.toMatch(/reinstall/)
    // Everything unrelated stays truthful and intact.
    expect(status.config.status).toBe('ok')
    expect(status.voices.count).toBe(2)
    expect(status.voices.error).toBeUndefined()
    expect(status.stage.available).toBe(false) // fixture has no stage bundle - its OWN truth
    expect(status.paths.userDataDir).toContain('Lia')
    // The env diagnostics note which source fed resolution.
    const envEvent = events.find(event => event === 'lia:env')
    expect(envEvent).toBeDefined()
  })
})
