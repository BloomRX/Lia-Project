/**
 * Phase 7.4 Part F: the modelId semantics of `custom-local-voice`.
 *
 * Contract proven here (and documented in the provider header): this
 * provider INTENTIONALLY has no AIRI model catalogue - the backend
 * (AllTalk/XTTS) owns model selection where the server is configured. The
 * one identity that matters is the Lia profile id, which rides `voice`.
 */
import { describe, expect, it } from 'vitest'

import { resolveSynthesisTarget } from '../../../speech/synthesize-target'
import { providerCustomLocalVoice } from './index'

describe('phase 7.4 F - custom-local-voice model semantics', () => {
  it('publishes NO model catalogue: model selection is AllTalk-owned, not an AIRI modelId', async () => {
    expect(await providerCustomLocalVoice.extraMethods?.listModels?.()).toEqual([])
  })

  it('an empty modelId flows through the target resolver INTACT (no invented identifier)', () => {
    const target = resolveSynthesisTarget({
      modelId: '',
      providerId: 'custom-local-voice',
      resolvedVoice: undefined,
      voiceId: '80202d55-24e8-4edf-a665-fa8236af2c5e',
    })
    expect(target).not.toBeNull()
    expect(target!.model).toBe('') // intentional - never fabricated
    expect(target!.voice.id).toBe('80202d55-24e8-4edf-a665-fa8236af2c5e')
  })

  it('the speech endpoint still declares its own fixed label for shape parity', () => {
    const provider = providerCustomLocalVoice.createProvider()
    const descriptor = provider.speech?.({
      baseURL: 'http://custom-local-voice/v1/',
      model: 'custom-voice',
    } as never) as
    | { baseURL: string, model: string }
    | undefined
    expect(descriptor?.model).toBe('custom-voice')
  })
})
