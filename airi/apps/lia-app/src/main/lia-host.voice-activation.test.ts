/**
 * Phase 7.4 integration tests, launcher level (brief items A-L).
 *
 * The REAL lia-host runs against the REAL fixture disk in tmpfs: the core
 * import produces truly canonical profile copies, the resolution is the
 * production candidate chain, and only the two heavy children (runtime and
 * stage) are fakes - so the ORDER proofs (B/C/L) read the wiring, not a
 * model of it.
 */
import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveAllTalkRuntimeDir } from '@lia/core/paths/runtime-paths'
import { describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

interface EventsList { detail?: string, event: string }

/**
 * A syntactically real profile id (the QA log's own UUID) - managed voice
 * filenames are only minted for true UUIDs, so the fixtures must use one.
 */
const PROFILE_UUID = '80202d55-24e8-4edf-a665-fa8236af2c5e'

/**
 * A host with the two children faked and everything else real (config,
 * vault, voice library, resolution).
 */
/**
 * The Part-8 probe, fed from the REAL voices folder of the fixture so the
 * visibility check reads exactly what sync wrote - a faithful `/api/voices`,
 * not a list hand-fitted to assertions. Divergent tests override it.
 */
async function filesystemVoiceProbe(config: { installDir?: string, voicesDir?: string }): Promise<LiaVoiceVisibilityProbeResult> {
  try {
    const dir = config.voicesDir?.trim() || join(config.installDir ?? '', 'voices')
    const files = await readdir(dir)
    return { ok: true as const, state: 'connected' as const, voices: files.filter(file => !file.startsWith('.')) }
  }
  catch {
    return { error: 'voices listing failed', ok: false as const, state: 'error' as const }
  }
}

type LiaVoiceVisibilityProbeResult
  = | { ok: true, state: 'connected', voices: string[] }
    | { error: string, ok: false, state: 'error' }

async function makeVoiceHost(options: {
  fixture?: Parameters<typeof makeLiaHome>[0]
  runtimeStart?: () => Promise<{ phase: string }>
  runtimeInstalled?: boolean
  voiceVisibilityProbeImpl?: (config: { installDir?: string, voicesDir?: string }) => Promise<LiaVoiceVisibilityProbeResult>
} = {}) {
  const home = await makeLiaHome({ firstVoiceId: PROFILE_UUID, ...options.fixture })
  const events: EventsList[] = []
  const order: string[] = []
  const host = createLiaHost({
    cipher: identityCipher,
    env: fixtureEnv(home),
    onEvent: (event, detail) => events.push({ detail, event }),
    voiceVisibilityProbeImpl: options.voiceVisibilityProbeImpl ?? (async config => await filesystemVoiceProbe(config)),
    runtimeManagerFactory: () => ({
      hasManagedRuntime: () => true,
      isInstalled: async () => options.runtimeInstalled ?? true,
      ownedChildPid: () => 4412,
      runtimeOwnership: () => 'lia-managed' as const,
      start: async () => {
        order.push('runtime-start')
        if (options.runtimeStart)
          return await options.runtimeStart()
        return { phase: 'ready' as const }
      },
      state: () => ({ phase: 'ready' as const }),
      stop: async () => order.push('runtime-stop'),
    } as never),
    stageManagerFactory: () => ({
      holdsOwnedStage: () => true,
      isAvailable: () => true,
      start: async () => {
        order.push('stage-start')
        return { logTail: [], phase: 'running' as const }
      },
      state: () => ({ logTail: [], phase: 'running' as const }),
      stop: async () => {
        order.push('stage-stop')
      },
    } as never),
    workspaceRoot: '/missing',
  })
  await host.vault.setSecret('openrouter', 'apiKey', 'sk-hidden-test')
  return { events, home, host, order }
}

describe('phase 7.4 A - canonical voice import', () => {
  it('import copies into the library; the profile stays valid after the ORIGINAL disappears', async () => {
    const { host } = await makeVoiceHost()
    const outside = await mkdtemp(join(tmpdir(), 'lia-audio-src-'))
    const source = join(outside, 'amostra de voz.wav')
    await writeFile(source, Buffer.alloc(2048))

    const imported = await host.importVoice(
      { engine: 'alltalk', name: 'Voz da Ana', sources: [{ path: source, role: 'referenceAudio' }] },
      new Set([source]),
    )
    expect(imported.ok).toBe(true)
    if (!imported.ok)
      throw new Error('import failed - the assertions below need the profile id')

    // The original external WAV is allowed to disappear right after import.
    await rm(outside, { force: true, recursive: true })

    const listed = await host.listVoices()
    const profile = listed.find(entry => entry.id === imported.value.id)
    expect(profile).toBeDefined()
    expect(profile!.files).toHaveLength(1)
    // Canonical copy exists INSIDE the library, independent of the source.
    const copied = join(host.paths.voicesRoot, profile!.id, profile!.files[0].filename)
    expect((await stat(copied)).size).toBe(2048)
  })
})

describe('phase 7.4 B/C/D - start order', () => {
  it('b: custom voice + selected profile + installed runtime -> AllTalk starts BEFORE the stage', async () => {
    const { host, order } = await makeVoiceHost({ fixture: { customVoice: true } })
    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(order).toEqual(['runtime-start', 'stage-start'])
  })

  it('c: the stage only starts once the runtime is VERIFIED ready', async () => {
    const { host, order } = await makeVoiceHost({
      fixture: { customVoice: true },
      runtimeStart: async () => ({ phase: 'ready' }),
    })
    await host.conversar()
    // Positional proof: no stage entry can precede the runtime's ready return.
    expect(order.indexOf('stage-start')).toBeGreaterThan(order.indexOf('runtime-start'))
  })

  it('d: a non-custom voice provider never starts AllTalk', async () => {
    const { events, host, order } = await makeVoiceHost()
    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(order).toEqual(['stage-start'])
    expect(events.find(entry => entry.event === 'lia-app.conversar-blocked')).toBeUndefined()
  })
})

describe('phase 7.4 E/F - failure semantics', () => {
  it('e: a selected profile that does not exist blocks with a human message and no starts', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: {
        customVoice: true,
        productConfig: {
          persona: { activeCardId: 'lia-default' },
          provider: { chat: { onboarded: true, preferred: { modelId: 'm', providerId: 'openrouter' } } },
          schemaVersion: 1,
          voice: { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'perfil-que-nao-existe' } } },
        },
      },
    })
    await expect(host.conversar()).rejects.toThrow('Não encontrei a voz selecionada.')
    expect(order).toEqual([])
    expect(events).toContainEqual({ detail: 'reason=voice-profile-missing', event: 'lia-app.conversar-blocked' })
  })

  it('e: a profile whose FILES went missing is the same human state (safe count-only diagnostic)', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: { customVoice: true, missingVoiceFiles: true },
    })
    await expect(host.conversar()).rejects.toThrow('Não encontrei a voz selecionada.')
    expect(order).toEqual([])
    expect(events).toContainEqual({ detail: 'reason=voice-profile-files-missing count=1', event: 'lia-app.conversar-blocked' })
    // The diagnostic must not carry filenames - they are the user's private audio.
    const detail = events.find(entry => entry.detail?.includes('files-missing'))?.detail ?? ''
    expect(detail).not.toContain('model.wav')
  })

  it('f: no marker-proven install blocks with the install message; neither child starts', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: { customVoice: true },
      runtimeInstalled: false,
    })
    await expect(host.conversar()).rejects.toThrow('O sistema de voz precisa ser instalado.')
    expect(order).toEqual([])
    expect(events).toContainEqual({ detail: 'reason=voice-runtime-not-installed', event: 'lia-app.conversar-blocked' })
  })

  it('f: a start failure stays human in the UI and technical in the event', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: { customVoice: true },
      runtimeStart: async () => {
        throw new Error('child exited with code 1 after 12.5s')
      },
    })
    await expect(host.conversar()).rejects.toThrow('Não foi possível iniciar o sistema de voz.')
    expect(order).toEqual(['runtime-start'])
    const blocked = events.find(entry => entry.event === 'lia-app.conversar-blocked')
    expect(blocked?.detail).toContain('reason=voice-runtime-start-failed')
    expect(blocked?.detail).toContain('child exited')
  })

  it('f: a runtime that never reaches health blocks with the readiness message and no stage', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: { customVoice: true },
      runtimeStart: async () => ({ phase: 'error' }),
    })
    await expect(host.conversar()).rejects.toThrow('não ficou pronto a tempo')
    expect(order).toEqual(['runtime-start'])
    expect(events).toContainEqual({ detail: 'reason=voice-runtime-readiness-timeout phase=error', event: 'lia-app.conversar-blocked' })
  })
})

describe('phase 7.4 K boundary facts', () => {
  it('k: the voice library root is independent from the runtime root', async () => {
    const { home, host } = await makeVoiceHost()
    const runtimeRoot = resolveAllTalkRuntimeDir({ userDataDir: home.userData })
    expect(host.paths.voicesRoot).not.toBe(runtimeRoot)
    expect(host.paths.voicesRoot.startsWith(runtimeRoot)).toBe(false)
  })
})

describe('phase 7.5 Parts 6/7/8/9 - conversar prepares, proves, then starts', () => {
  it('publishes the managed voice INTO the install voices folder before the runtime starts (F-order, D-copy)', async () => {
    const { home, host, order } = await makeVoiceHost({
      fixture: { customVoice: true },
      runtimeStart: async () => {
        // At START time, the copy must already exist in THIS install's folder.
        const voices = await readdir(join(home.installDir, 'voices'))
        expect(voices).toContain(`lia-${PROFILE_UUID}.wav`)
        return { phase: 'ready' as const }
      },
    })
    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(order).toEqual(['runtime-start', 'stage-start'])
  })

  it('a healthy runtime with the voice NOT visible blocks with the human line and never starts the stage (I)', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: { customVoice: true },
      // The server answers /api/voices with everything EXCEPT our file
      // (e.g. a second server on the port watching another folder).
      voiceVisibilityProbeImpl: async () => ({ ok: true as const, state: 'connected' as const, voices: ['other.wav'] }),
    })
    await expect(host.conversar()).rejects.toThrow('Não foi possível carregar a voz selecionada.')
    expect(events.some(e => e.event === 'lia-app.conversar-blocked' && e.detail === `reason=voice-not-visible voice=lia-${PROFILE_UUID}.wav present=false knownVoices=1`)).toBe(true)
    expect(order).toEqual(['runtime-start'])
  })

  it('an engine that never loaded XTTS blocks with the model sentence before any start (Part 9)', async () => {
    const { home, host, events, order } = await makeVoiceHost({ fixture: { customVoice: true } })
    // Corrupt the engine the read-back expects: Piper answers every XTTS
    // request with a 500, which is exactly the QA symptom.
    await writeFile(join(home.installDir, 'system', 'tts_engines', 'tts_engines.json'), '{"engine_loaded": "piper"}\n')
    await expect(host.conversar()).rejects.toThrow('O sistema de voz não conseguiu carregar o modelo.')
    expect(events.some(e => e.event === 'lia-app.conversar-blocked' && e.detail === 'reason=voice-engine-not-ready engine=piper modelLoaded=true firstRunPending=false')).toBe(true)
    // The engine gate comes BEFORE start: the runtime never booted.
    expect(order).toEqual([])
  })

  it('emits the safe diagnostics line carrying ONLY the managed filename and counts - no content', async () => {
    const { events, host } = await makeVoiceHost({ fixture: { customVoice: true } })
    await host.conversar()
    expect(events.some(e => e.event === 'lia-app.voice-synced' && e.detail === `voice=lia-${PROFILE_UUID}.wav copied=true`)).toBe(true)
    expect(events.some(e => e.event === 'lia-app.voice-engine-ready' && e.detail === 'engine=xtts modelLoaded=true')).toBe(true)
    expect(events.some(e => e.event === 'lia-app.voice-visible' && e.detail === `voice=lia-${PROFILE_UUID}.wav present=true`)).toBe(true)
  })
})

describe('phase 7.4 L - shutdown order', () => {
  it('a Lia-owned runtime stops AFTER the stage; an external one is never touched', async () => {
    const { host, order } = await makeVoiceHost({ fixture: { customVoice: true } })
    await host.runtime() // materialize ownership before shutdown
    await host.conversar()
    const report = await host.quit()
    expect(order).toEqual(['runtime-start', 'stage-start', 'stage-stop', 'runtime-stop'])
    const stopped = report.steps.filter(step => step.outcome === 'stopped').map(step => step.name)
    expect(stopped.indexOf('stage')).toBeLessThan(stopped.indexOf('voice-runtime'))
  })
})
// M (external runtime never killed) is pinned by the Phase 7.1 ownership
// contract tests in lia-host.test.ts (tests C/D, external/unknown are never
// stopped) - not duplicated here.
