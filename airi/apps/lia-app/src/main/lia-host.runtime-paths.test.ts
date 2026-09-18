/**
 * Windows integration HOTFIX 3, integration half: the launcher must SEE the
 * AllTalk runtime the AIRI installer already wrote to LocalAppData.
 *
 * QA repro that this file pins (items A-E): `%LOCALAPPDATA%\Lia\runtimes\
 * alltalk` existed with `app\` + `state.json`, AIRI used it successfully -
 * yet the launcher reported "installed: no / state: unconfigured / voices: 0".
 * Cause: the install dir came ONLY from the product document (absent there,
 * so "" -> never scanned; phase collapsed to the 'unconfigured' catch-all).
 *
 * The machinery is real all the way through: the REAL host, REAL core path
 * resolver, REAL core install inspector and REAL runtime manager - only the
 * Windows disk is virtual (Set of existing paths), because the canonical
 * root by definition does not exist on this Linux test box.
 */
import { join } from 'node:path'

import { createRuntimeManager, inspectAllTalkInstall } from '@lia/core/alltalk/runtime'
import { resolveAllTalkRuntimeDir } from '@lia/core/paths/runtime-paths'
import { describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

/** Windows-style LOCALAPPDATA exactly as a real profile presents it. */
const WIN_LOCAL = 'C:\\Users\\qa\\AppData\\Local'
/** Where the legacy config doc lives - kept for compat, NEVER the runtime root. */
const WRONG_LEGACY_INSTALL = 'C:\\Users\\qa\\AppData\\Roaming\\@proj-airi\\stage-tamagotchi\\alltalk'
const WIN_PLATFORM = 'win32' as const

/**
 * The SAME marker set the AIRI flow considered installed (item 5 - never
 * weakened to "the directory exists").
 */
function populateWinRuntime(disk: Set<string>, appDir: string): void {
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
}

/**
 * The document exactly as the QA machine presents it: config complete, and
 * `voice.runtime.alltalk` WITH NO installDir (AIRI never wrote one here -
 * that absence, fed to the old doc-only detection, was the whole bug).
 */
function qaProductDocument(alltalk?: { installDir?: string }): Record<string, unknown> {
  return {
    persona: { activeCardId: 'lia-default' },
    preferences: { language: 'pt-BR' },
    schemaVersion: 1,
    voice: {
      runtime: { alltalk: { baseUrl: 'http://127.0.0.1:7851', ...alltalk } },
      tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'chia' } },
    },
  }
}

async function makeWinHomeHost(input: {
  disk: Set<string>
  installDirInDocument?: string
  document?: ReturnType<typeof qaProductDocument>
}) {
  const home = await makeLiaHome({
    productConfig: input.document ?? qaProductDocument(
      input.installDirInDocument === undefined ? undefined : { installDir: input.installDirInDocument },
    ),
    voiceCount: 0,
  })
  const env = { ...fixtureEnv(home), LOCALAPPDATA: WIN_LOCAL }
  const canonicalAppDir = resolveAllTalkRuntimeDir({ env, platform: WIN_PLATFORM, userDataDir: home.userData })
  const existsOnDisk = async (path: string) => input.disk.has(path)
  const host = createLiaHost({
    cipher: identityCipher,
    env,
    inspectInstallImpl: async (dir, deps) =>
      await inspectAllTalkInstall(dir, { exists: existsOnDisk, platform: deps?.platform ?? WIN_PLATFORM }),
    platform: WIN_PLATFORM,
    runtimeManagerFactory: config => createRuntimeManager({
      existsImpl: existsOnDisk,
      installDir: config.installDir,
      isHealthy: async () => false,
      platform: WIN_PLATFORM,
    }),
    workspaceRoot: '/missing',
  })
  return { canonicalAppDir, home, host }
}

describe('lia host - Windows install detection (hotfix 3)', () => {
  it('test A: a valid runtime in LocalAppData is detected with NO installDir in the document', async () => {
    const disk = new Set<string>()
    const { canonicalAppDir, host } = await makeWinHomeHost({ disk })
    populateWinRuntime(disk, canonicalAppDir)

    const status = await host.homeStatus()
    expect(status.alltalk.installed).toBe(true)
    expect(status.alltalk.installDir).toBe(canonicalAppDir)
    expect(status.alltalk.installDir).not.toContain('stage-tamagotchi')
  })

  it('test B: installed but stopped - installed true, running false, phase never "unconfigured"', async () => {
    const disk = new Set<string>()
    const { canonicalAppDir, host } = await makeWinHomeHost({ disk })
    populateWinRuntime(disk, canonicalAppDir)

    const status = await host.homeStatus()
    expect(status.alltalk.installed).toBe(true)
    expect(status.alltalk.running).toBe(false)
    expect(status.alltalk.phase).toBe('stopped')
    expect(status.alltalk.phase).not.toBe('unconfigured')
    expect(status.alltalk.configured).toBe(true)
    expect(status.alltalk.profileSelected).toBe(true)
  })

  it('test C: a stale document path plus a real canonical runtime resolves to LocalAppData (mutation killer)', async () => {
    const disk = new Set<string>()
    const { canonicalAppDir, host } = await makeWinHomeHost({ disk, installDirInDocument: WRONG_LEGACY_INSTALL })
    populateWinRuntime(disk, canonicalAppDir)

    const status = await host.homeStatus()
    expect(status.alltalk.installed).toBe(true)
    expect(status.alltalk.installDir).toBe(canonicalAppDir)
    expect(status.alltalk.installDir).not.toBe(WRONG_LEGACY_INSTALL)
  })

  it('test D: no runtime anywhere - installed false, phase notInstalled, no dir claimed', async () => {
    const { host } = await makeWinHomeHost({ disk: new Set() })
    const status = await host.homeStatus()
    expect(status.alltalk.installed).toBe(false)
    expect(status.alltalk.running).toBe(false)
    expect(status.alltalk.phase).toBe('notInstalled')
    expect(status.alltalk.installDir).toBeUndefined()
  })

  it('test E: the voice-profile root is independent of the runtime root', async () => {
    const disk = new Set<string>()
    const { canonicalAppDir, home, host } = await makeWinHomeHost({ disk })
    populateWinRuntime(disk, canonicalAppDir)

    const status = await host.homeStatus()
    expect(status.paths.voicesRoot).toBe(join(home.userData, 'lia-voices'))
    expect(status.voices.count).toBe(0)
    expect(status.alltalk.installDir).toBe(canonicalAppDir)
    expect(status.alltalk.installDir).not.toContain(status.paths.voicesRoot)
    expect(status.paths.voicesRoot).not.toContain(status.alltalk.installDir ?? 'never')
  })
})
