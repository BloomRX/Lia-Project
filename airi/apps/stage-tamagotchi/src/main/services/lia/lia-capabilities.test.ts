import { describe, expect, it } from 'vitest'

import { defaultLiaProductConfig } from '../../configs/lia-schema'
import { resolveVoiceSelection } from './lia-capabilities'

/**
 * Phase 7.7, Part 12 (main side): `voice.configured` derives ONLY from
 * Lia-managed truth - the product's preferred TTS target on the custom
 * voice provider AND a profile that still exists in the registry.
 */

describe('resolveVoiceSelection', () => {
  it('configured=false when no preferred target exists', () => {
    expect(resolveVoiceSelection(defaultLiaProductConfig, new Set()).configured).toBe(false)
  })

  it('configured=false when the preferred target is a REMOTE provider', () => {
    const config = {
      ...defaultLiaProductConfig,
      voice: {
        tts: {
          preferred: { modelId: 'tts-1', providerId: 'openai', voiceId: 'alloy' },
        },
      },
    } as never
    expect(resolveVoiceSelection(config, new Set()).configured).toBe(false)
  })

  it('configured=true only for the custom voice provider AND an existing profile', () => {
    const config = {
      ...defaultLiaProductConfig,
      voice: {
        tts: {
          preferred: { modelId: '', providerId: 'custom-local-voice', voiceId: 'p-1' },
        },
      },
    } as never

    const configured = resolveVoiceSelection(config, new Set(['p-1']))
    expect(configured.configured).toBe(true)
    expect(configured.profileId).toBe('p-1')

    // Profile deleted -> the selection is dangling -> NOT configured.
    expect(resolveVoiceSelection(config, new Set()).configured).toBe(false)
  })

  it('configured=false for custom voice provider with an empty voiceId', () => {
    const config = {
      ...defaultLiaProductConfig,
      voice: {
        tts: {
          preferred: { modelId: '', providerId: 'custom-local-voice', voiceId: '   ' },
        },
      },
    } as never
    expect(resolveVoiceSelection(config, new Set(['anything'])).configured).toBe(false)
  })
})
