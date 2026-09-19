import { describe, expect, it } from 'vitest'

import {
  readVoiceEngineConfig,
  readVoiceFallbackConfig,
  readVoiceRuntimeSelection,
  writeVoiceConfig,
} from './config'

/**
 * Phase 7.8C: the engine-neutral voice configuration surface.
 * Any engine id is read back verbatim - the config layer knows no engine.
 * Legacy alltalk keys stay readable but INERT.
 */
describe('voice config: engine-neutral surface', () => {
  it('reads engine/fallback/runtime keys verbatim, with no engine hard-coded', () => {
    expect(readVoiceEngineConfig(undefined)).toEqual({ preferred: undefined })
    expect(readVoiceEngineConfig({ engine: { preferred: 'some-engine' } })).toEqual({ preferred: 'some-engine' })
    expect(readVoiceEngineConfig({ engine: { preferred: '  ' } })).toEqual({ preferred: undefined })

    expect(readVoiceFallbackConfig(undefined)).toEqual({ enabled: true })
    expect(readVoiceFallbackConfig({ fallback: { enabled: false } })).toEqual({ enabled: false })
    expect(readVoiceFallbackConfig({ fallback: { enabled: true, engineId: 'some-engine' } }))
      .toEqual({ enabled: true, engineId: 'some-engine' })

    expect(readVoiceRuntimeSelection(undefined)).toEqual({})
    expect(readVoiceRuntimeSelection({ runtime: { installDir: 'D:/voice' } })).toEqual({ installDir: 'D:/voice' })
    expect(readVoiceRuntimeSelection({ runtime: { installDir: '  ' } })).toEqual({})
  })

  it('legacy alltalk keys remain readable by nobody and drive nothing (inert by contract)', () => {
    const legacy = {
      runtime: {
        alltalk: {
          baseUrl: 'http://127.0.0.1:7851',
          installDir: 'C:/old/alltalk',
          voicesDir: 'C:/old/voices',
        },
      },
    }
    // The neutral readers never observe legacy fields.
    expect(readVoiceRuntimeSelection(legacy)).toEqual({})
    expect(readVoiceEngineConfig(legacy)).toEqual({ preferred: undefined })
    expect(readVoiceFallbackConfig(legacy)).toEqual({ enabled: true })

    // Writing new keys PRESERVES the legacy block (no destructive erase).
    const merged = writeVoiceConfig(legacy, { engine: { preferred: 'some-engine' } })
    expect(merged.engine).toEqual({ preferred: 'some-engine' })
    expect(merged.runtime).toEqual(legacy.runtime)
  })

  it('writes new keys without touching sibling config', () => {
    const merged = writeVoiceConfig(
      { other: { deep: true } },
      {
        fallback: { enabled: false, engineId: 'some-engine' },
        runtime: { installDir: 'D:/voice' },
      },
    )
    expect(merged.other).toEqual({ deep: true })
    expect(merged.fallback).toEqual({ enabled: false, engineId: 'some-engine' })
    expect(merged.runtime).toEqual({ installDir: 'D:/voice' })

    const cleared = writeVoiceConfig(merged, { runtime: { installDir: '' } })
    expect(cleared.runtime).toEqual({})

    const clearedFallback = writeVoiceConfig(merged, { fallback: { engineId: '' } })
    expect(clearedFallback.fallback).toEqual({ enabled: false })
  })
})
