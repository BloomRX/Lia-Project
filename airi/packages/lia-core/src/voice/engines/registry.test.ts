import { describe, expect, it } from 'vitest'

import {
  findVoiceEngineAdapter,
  KOKORO_ENGINE_ADAPTER,
  listVoiceEngineBackends,
  resolveVoiceEngineBackend,
  VOICE_ENGINE_ADAPTERS,
} from './registry'

describe('voice engine adapter registry (Phase 7.9C)', () => {
  it('registers kokoro: id + label + the measured CPU backend', () => {
    const adapter = findVoiceEngineAdapter('kokoro')
    expect(adapter).toBeDefined()
    expect(adapter).toMatchObject({
      id: 'kokoro',
      label: 'Kokoro',
      backends: ['cpu'],
      defaultBackend: 'cpu',
      defaultVoiceId: 'pf_dora',
    })
    expect(VOICE_ENGINE_ADAPTERS).toContain(KOKORO_ENGINE_ADAPTER)
  })

  it('declares the Kokoro capability truth: local, offline, CPU, stock voices', () => {
    expect(KOKORO_ENGINE_ADAPTER.capabilities).toEqual({
      clonesVoice: false,
      requiresNetwork: false,
      runsLocally: true,
      streams: false,
    })
  })

  it('exposes CPU as available and nothing else (DirectML is NOT advertised - 7.9B QA)', () => {
    expect(listVoiceEngineBackends('kokoro')).toEqual(['cpu'])
    expect(listVoiceEngineBackends('kokoro')).not.toContain('directml')
    expect(listVoiceEngineBackends('kokoro')).not.toContain('cuda')
    // No string in every adapter's backend list may drift to an accelerator
    // that was never measured on the target hardware.
    for (const adapter of VOICE_ENGINE_ADAPTERS)
      expect(adapter.backends.every(backend => backend === 'cpu')).toBe(true)
  })

  it("resolves 'auto' to the declared default - cpu for kokoro", () => {
    expect(resolveVoiceEngineBackend('kokoro')).toMatchObject({ backend: 'cpu', requested: 'auto' })
    expect(resolveVoiceEngineBackend('kokoro', 'auto')).toMatchObject({ backend: 'cpu', requested: 'auto' })
    expect(resolveVoiceEngineBackend('kokoro', '  ')).toMatchObject({ backend: 'cpu', requested: 'auto' })
    expect(resolveVoiceEngineBackend('kokoro', 'cpu')).toMatchObject({ backend: 'cpu', requested: 'cpu' })
  })

  it('every registered adapter resolves auto inside its own declared backends', () => {
    for (const adapter of VOICE_ENGINE_ADAPTERS) {
      const resolved = resolveVoiceEngineBackend(adapter.id, 'auto')
      expect(resolved.backend).toBe(adapter.defaultBackend)
      expect((adapter.backends as readonly string[])).toContain(resolved.backend as string)
    }
  })

  it('defers on anything it never measured: directml, cuda, unknown ids and blanks', () => {
    const directml = resolveVoiceEngineBackend('kokoro', 'directml')
    expect(directml.backend).toBeUndefined()
    expect(directml.reason).toBe('backend-not-declared')
    const cuda = resolveVoiceEngineBackend('kokoro', 'cuda')
    expect(cuda.backend).toBeUndefined()
    expect(cuda.reason).toBe('backend-not-declared')
    const unknown = resolveVoiceEngineBackend('not-an-engine')
    expect(unknown.backend).toBeUndefined()
    expect(unknown.reason).toBe('unknown-engine')
    expect(findVoiceEngineAdapter('')).toBeUndefined()
    expect(findVoiceEngineAdapter('not-an-engine')).toBeUndefined()
    expect(listVoiceEngineBackends('not-an-engine')).toBeUndefined()
  })
})
