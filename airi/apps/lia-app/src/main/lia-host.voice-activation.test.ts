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
import { Buffer } from 'node:buffer'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

interface EventsList { detail?: string, event: string }

function makeVoiceHost(options: {
  fixture?: Parameters<typeof makeLiaHome>[0]
  runtimeInstalled?: boolean
} = {}) {
  const events: EventsList[] = []
  const order: string[] = []
  return (async () => {
    const home = await makeLiaHome({ firstVoiceId: '80202d55-24e8-4edf-a665-fa8236af2c5e', ...options.fixture })
    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      inspectInstallImpl: async () => options.runtimeInstalled ?? true,
      onEvent: (event, detail) => events.push({ detail, event }),
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
