import { describe, expect, it } from 'vitest'

import {
  describeVoiceEngineOptions,
  findVoiceEngineAdapter,
  KOKORO_ENGINE_ADAPTER,
  LIA_DEFAULT_VOICE_ENGINE_ID,
  listVoiceEngineBackends,
  resolveVoiceEngineBackend,
  resolveVoiceEngineSelection,
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

  it('resolves \'auto\' to the declared default - cpu for kokoro', () => {
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

describe('voice engine selection resolution (Phase 7.9F)', () => {
  const available = ['kokoro'] as const

  it('legacy/fresh config (no preference) resolves the product default engine: Kokoro', () => {
    expect(resolveVoiceEngineSelection({ availableEngineIds: available })).toEqual({
      engineId: 'kokoro',
      source: 'default',
    })
    expect(resolveVoiceEngineSelection({ availableEngineIds: available, preferred: '  ' })).toEqual({
      engineId: 'kokoro',
      source: 'default',
    })
    expect(LIA_DEFAULT_VOICE_ENGINE_ID).toBe('kokoro')
  })

  it('explicit selection of a build-known engine answers configured', () => {
    expect(resolveVoiceEngineSelection({ availableEngineIds: available, preferred: 'kokoro' })).toEqual({
      engineId: 'kokoro',
      source: 'configured',
    })
    expect(resolveVoiceEngineSelection({
      availableEngineIds: ['kokoro', 'future-engine'],
      preferred: 'future-engine',
    })).toEqual({ engineId: 'future-engine', source: 'configured' })
  })

  it('uNKNOWN configured engine NEVER silently falls back: empty selection + the pinned id named', () => {
    const selection = resolveVoiceEngineSelection({ availableEngineIds: available, preferred: 'alltalk-server' })
    expect(selection.engineId).toBeUndefined()
    expect(selection).toEqual({ source: 'configured', unknownConfiguredId: 'alltalk-server' })
  })

  it('no preference AND build without the default engine answers none (future honesty)', () => {
    expect(resolveVoiceEngineSelection({ availableEngineIds: ['future-only'] })).toEqual({ source: 'none' })
  })

  it('descriptors are product-shaped: localized-name handle, honest facts, NO backend/provider jargon', () => {
    const selection = resolveVoiceEngineSelection({ availableEngineIds: available })
    const descriptors = describeVoiceEngineOptions({
      installed: id => id === 'kokoro',
      selection,
    })
    expect(descriptors).toHaveLength(VOICE_ENGINE_ADAPTERS.length)
    const kokoro = descriptors.find(d => d.id === 'kokoro')!
    expect(kokoro).toEqual({
      id: 'kokoro',
      installed: true,
      name: 'Kokoro',
      nameKey: 'lia.voice.engines.kokoro.name',
      selectable: true,
      selected: true,
    })
    // Jargon firewall: nothing backend/provider-ish may reach a normal UI label.
    expect(JSON.stringify(descriptors)).not.toMatch(/python|provider|backend|onnx|directml|cpu/i)
  })

  it('a NOT-installed engine is honestly NOT selectable (never a dead-end choice)', () => {
    const descriptors = describeVoiceEngineOptions({ installed: () => false, selection: { source: 'none' } })
    expect(descriptors.every(d => d.installed === false && d.selectable === false)).toBe(true)
  })
})
