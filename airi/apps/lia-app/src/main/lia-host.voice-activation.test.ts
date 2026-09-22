/**
 * Voice activation integration tests - transitional contract (Phase 7.8E).
 *
 * The launcher gates "Conversar com Lia" on the voice facts, in order:
 * profile -> canonical files -> seam-proven install -> stage start.
 *
 * There is NO voice worker anymore (7.8C): the old worker-readiness step of
 * the chain is a commented seam in the host, where the modular engine
 * (Kokoro first) re-enters the order when it lands. Only the stage child is
 * faked here; the REAL host runs against the REAL fixture disk, and the
 * install proof arrives exclusively through `inspectInstallImpl` - exactly
 * the seam the engine's adapter will implement.
 */
import type { LiaHomeFixture } from './test-helpers'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { inspectKokoroInstall, resolveKokoroLayout } from '@lia/core/voice/engines/kokoro'
import { describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'
import { createLiaVoiceInstallInspector } from './voice-install-inspector'

interface EventsList { detail?: string, event: string }

function makeVoiceHost(options: {
  env?: Record<string, string>
  fixture?: Parameters<typeof makeLiaHome>[0]
  /**
   * Phase 7.9E.2: 'stub' keeps the historical injected boolean; 'real'
   * plugs the PRODUCTION inspector (createLiaVoiceInstallInspector), so the
   * gate is decided by bytes on the fixture disk, never by test truth.
   */
  inspector?: 'real' | 'stub'
  platform?: NodeJS.Platform
  runtimeInstalled?: boolean
} = {}) {
  const events: EventsList[] = []
  const order: string[] = []
  return (async () => {
    const home = await makeLiaHome({ firstVoiceId: '80202d55-24e8-4edf-a665-fa8236af2c5e', ...options.fixture })
    const host = createLiaHost({
      cipher: identityCipher,
      env: { ...fixtureEnv(home), ...options.env },
      inspectInstallImpl: options.inspector === 'real'
        ? createLiaVoiceInstallInspector()
        : async () => options.runtimeInstalled ?? true,
      onEvent: (event, detail) => events.push({ detail, event }),
      ...(options.platform !== undefined ? { platform: options.platform } : {}),
      stageManagerFactory: () => ({
        holdsOwnedStage: () => order.includes('stage-start'),
        isAvailable: () => true,
        start: async () => {
          order.push('stage-start')
          return { logTail: [], phase: 'running' as const }
        },
        state: () => ({ logTail: [], phase: 'running' as const }),
        stop: async () => { order.push('stage-stop') },
      } as never),
      workspaceRoot: '/missing',
    })
    await host.vault.setSecret('openrouter', 'apiKey', 'sk-hidden-test')
    return { events, home, host, order }
  })()
}

describe('7.8 A - transitional import: no engine is hosted, so it defers cleanly', () => {
  it('import refuses with engineUnknown; the original source is left alone and nothing enters the library', async () => {
    const { host } = await makeVoiceHost()
    const outside = await mkdtemp(join(tmpdir(), 'lia-audio-src-'))
    const source = join(outside, 'amostra de voz.wav')
    await writeFile(source, Buffer.alloc(2048))

    const before = await host.listVoices()
    const imported = await host.importVoice(
      { engine: 'f5-tts', name: 'Voz da Ana', sources: [{ path: source, role: 'referenceAudio' }] },
      new Set([source]),
    )
    expect(imported.ok).toBe(false)
    if (!imported.ok) {
      expect(imported.error).toBe('engineUnknown')
      // The deferral is honest and human - not a crash, not a fake id.
      expect(imported.message).toContain('temporarily disabled')
    }

    // No copy happened anywhere; the user's source file stays untouched and
    // the pre-existing library (fixture-seeded legacy profiles) is unchanged.
    expect((await stat(source)).size).toBe(2048)
    const after = await host.listVoices()
    expect(after.length).toBe(before.length)
    expect(after.some(entry => entry.name === 'Voz da Ana')).toBe(false)
    await rm(outside, { force: true, recursive: true })
  })
})

describe('7.9E.1 - Windows runtime-home contract regression (env object vs lookup)', () => {
  // path.join is host-separator (posix in CI, win32 in production); build the
  // expected runtime root through the same join the resolver uses.
  const WINDOWS_LOCALAPPDATA = 'C:\\Users\\lucas\\AppData\\Local'
  const WINDOWS_RUNTIME_ROOT = join(WINDOWS_LOCALAPPDATA, 'Lia', 'runtimes')

  function windowsFixtureProduct(): Record<string, unknown> {
    // Custom local voice selected WITHOUT a configured runtime.installDir:
    // exactly the branch that resolves the canonical home through
    // resolveVoiceRuntimeHome (every older fixture short-circuited it with
    // an explicit installDir, which is why this crash hid until real QA).
    return {
      persona: { activeCardId: 'lia-default' },
      preferences: { language: 'pt-BR' },
      provider: {
        chat: {
          onboarded: true,
          preferred: { modelId: 'test-model', providerId: 'openrouter' },
        },
      },
      schemaVersion: 1,
      voice: {
        tts: { preferred: { providerId: 'custom-local-voice', voiceId: '80202d55-24e8-4edf-a665-fa8236af2c5e' } },
      },
    }
  }

  it('conversar on Windows with LOCALAPPDATA set: no "env is not a function", home is the Lia runtime root, the stage starts', async () => {
    const { events, host, order } = await makeVoiceHost({
      env: { LOCALAPPDATA: WINDOWS_LOCALAPPDATA },
      fixture: { productConfig: windowsFixtureProduct() },
      platform: 'win32',
    })

    // Before the fix this threw TypeError: env is not a function, from
    // resolveLocalAppDataDir inside resolveVoiceRuntimeHome inside
    // effectiveRuntimeHome inside ensureVoiceReadyForConversar.
    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(order).toContain('stage-start')
    expect(events.find(entry => entry.event === 'lia-app.conversar-blocked')).toBeUndefined()

    // The canonical home resolved EXACTLY to the Lia runtime root, never
    // to a substituted/mutated location: %LOCALAPPDATA%\Lia\runtimes.
    const location = await host.runtimeLocationStatus()
    expect(location.customActive).toBe(false)
    expect(location.canonicalDefaultDir).toBe(WINDOWS_RUNTIME_ROOT)
    expect(location.effectiveInstallDir).toBe(WINDOWS_RUNTIME_ROOT)
  })

  it('an INVALID Windows LOCALAPPDATA still surfaces the resolver\'s own operational error (lookup honored, not bypassed)', async () => {
    const { host } = await makeVoiceHost({
      env: { LOCALAPPDATA: 'relative\\not\\absolute' },
      fixture: { productConfig: windowsFixtureProduct() },
      platform: 'win32',
      runtimeInstalled: true,
    })
    await expect(host.conversar()).rejects.toThrow(/Could not resolve Windows LocalAppData/)
  })
})

describe('7.9E.2 - real Kokoro install proof drives the gate (no injected truth)', () => {
  function customVoiceProduct(): Record<string, unknown> {
    // Custom local voice selected WITHOUT a configured runtime.installDir:
    // the effective home is the canonical resolver home, like production.
    return {
      persona: { activeCardId: 'lia-default' },
      preferences: { language: 'pt-BR' },
      provider: {
        chat: {
          onboarded: true,
          preferred: { modelId: 'test-model', providerId: 'openrouter' },
        },
      },
      schemaVersion: 1,
      voice: {
        tts: { preferred: { providerId: 'custom-local-voice', voiceId: '80202d55-24e8-4edf-a665-fa8236af2c5e' } },
      },
    }
  }

  /** Effective posix runtime home: makeLiaHome.userData + '/runtimes'. */
  function fixtureRuntimeHome(home: LiaHomeFixture): string {
    return join(home.userData, 'runtimes')
  }

  /**
   * Exactly the markers a finished installer leaves - nothing else. The
   * required set is DISCOVERED from the engine's own inspector (recording
   * probe), so the engine stays the single authority even for fixtures.
   */
  async function materializeKokoroInstall(home: string, options: { without?: string[] } = {}) {
    const layout = resolveKokoroLayout({ home })
    const required: string[] = []
    inspectKokoroInstall(layout, {
      existsSync: (path) => {
        required.push(path)
        return false
      },
    })
    for (const target of required) {
      if (options.without?.includes(target))
        continue
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, 'ok')
    }
    return layout
  }

  it('a REAL validated Kokoro tree on disk lets Conversar reach stage.start (the QA blocker retires)', async () => {
    const { events, home, host, order } = await makeVoiceHost({
      fixture: { productConfig: customVoiceProduct() },
      inspector: 'real',
    })
    // The production-smoke-validated shape: <effective runtime home>/kokoro
    // with every required marker. The gate decides from THESE bytes.
    await materializeKokoroInstall(fixtureRuntimeHome(home))

    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(order).toContain('stage-start')
    expect(events.find(entry => entry.event === 'lia-app.conversar-blocked')).toBeUndefined()
  })

  it('a REAL tree missing ONE required marker still blocks with voice-runtime-not-installed (no bypass)', async () => {
    const { events, home, host, order } = await makeVoiceHost({
      fixture: { productConfig: customVoiceProduct() },
      inspector: 'real',
    })
    const layout = await materializeKokoroInstall(fixtureRuntimeHome(home))
    // Remove exactly ONE required marker - the installer never finished.
    await rm(layout.stateFile, { force: true })

    await expect(host.conversar()).rejects.toThrow('O sistema de voz precisa ser instalado.')
    expect(order).toEqual([])
    expect(events).toContainEqual({ detail: 'reason=voice-runtime-not-installed', event: 'lia-app.conversar-blocked' })
  })

  it('an ABSENT runtime home stays blocked through the real inspector (7.8 negative preserved end-to-end)', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: { productConfig: customVoiceProduct() },
      inspector: 'real',
    })
    await expect(host.conversar()).rejects.toThrow('O sistema de voz precisa ser instalado.')
    expect(order).toEqual([])
    expect(events).toContainEqual({ detail: 'reason=voice-runtime-not-installed', event: 'lia-app.conversar-blocked' })
  })
})

describe('7.8 B/C/D - provider gating and the worker seam', () => {
  it('b: custom voice + selected profile + seam-proven install -> the stage starts directly', async () => {
    // Transitional (7.8C): there is NO voice worker to start first. The old
    // "worker starts BEFORE the stage" / "stage waits for verified readiness"
    // ordering (original items b/c) collapses into the commented gate-3 seam
    // in the host; today the only ordering fact is that a gated custom voice
    // reaches the stage without any other child materializing.
    const { host, order } = await makeVoiceHost({ fixture: { customVoice: true } })
    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(order).toEqual(['stage-start'])
  })

  it('the host has NO runtime surface at all - host.runtime() is not a thing anymore', async () => {
    const { host } = await makeVoiceHost()
    expect('runtime' in host).toBe(false)
  })

  it('d: a non-custom voice provider never touches the voice gates', async () => {
    const { events, host, order } = await makeVoiceHost()
    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(order).toEqual(['stage-start'])
    expect(events.find(entry => entry.event === 'lia-app.conversar-blocked')).toBeUndefined()
  })
})

describe('7.8 E/F - failure semantics stay human-readable', () => {
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
    const detail = events.find(entry => entry.detail?.includes('files-missing'))?.detail ?? ''
    expect(detail).not.toContain('model.wav')
  })

  it('f: no seam-proven install blocks; the stage never starts', async () => {
    const { events, host, order } = await makeVoiceHost({
      fixture: { customVoice: true },
      runtimeInstalled: false,
    })
    await expect(host.conversar()).rejects.toThrow('O sistema de voz precisa ser instalado.')
    expect(order).toEqual([])
    expect(events).toContainEqual({ detail: 'reason=voice-runtime-not-installed', event: 'lia-app.conversar-blocked' })
  })

  // The old "worker start failure" / "worker never reaches readiness" cases
  // (original item f) were deleted with the worker itself (7.8C): there is
  // nothing left that can fail that way. When the modular engine lands, its
  // own seam re-introduces those human/readable failure shapes and their
  // tests return with it.
})

describe('7.8 L - shutdown stays honest: the stage is the only child to stop', () => {
  it('quit stops the stage exactly once; no voice-runtime step exists anymore', async () => {
    const { host, order } = await makeVoiceHost({ fixture: { customVoice: true } })
    await host.conversar()
    const report = await host.quit()
    expect(order).toEqual(['stage-start', 'stage-stop'])
    expect(report.steps.map(step => step.name)).toEqual(['stage'])
    expect(report.steps[0].outcome).toBe('stopped')
  })
})
