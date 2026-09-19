import { describe, expect, it } from 'vitest'

import { CUSTOM_VOICE_PROVIDER_ID } from './lia-voice'

/**
 * The one contract the transitional voice product keeps (Phase 7.8E).
 *
 * The bootstrap/install vocabulary that used to live in this shim moved out
 * with the old F5/AllTalk era and is gone: with no runnable engine there is
 * no install wizard and no install state machine to keep in sync. What stays
 * - and must NEVER change - is the provider id a custom voice is selected
 * under, because persisted `voice.tts` documents and the whole target schema
 * already point at it.
 */
describe('custom voice provider id', () => {
  it('is the persisted id every channel agrees on', () => {
    expect(CUSTOM_VOICE_PROVIDER_ID).toBe('custom-local-voice')
  })
})
