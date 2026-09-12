import type { VoiceConfigDiag } from './voice-config'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { logVoiceConfigDiag, shouldLogVoiceConfigDiag } from './voice-config'

/**
 * The voice hydration trace is temporary DEV instrumentation, so the two things
 * worth locking down are that a packaged renderer can never print it and that
 * the payload stays reference-only.
 */

const DIAG: VoiceConfigDiag = {
  stage: 'store',
  ipcGetReturned: true,
  ipcTtsExists: true,
  persistedVoiceTts: true,
  preferredExists: true,
  fallbackCount: 1,
  storePreferredExists: true,
  storeFallbackCount: 1,
  hasConfiguration: true,
  providerId: 'openai-compatible-audio-speech',
  modelId: 'tts-1',
  voiceId: 'alloy',
}

describe('voice config diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is authorized by the build mode alone', () => {
    expect(shouldLogVoiceConfigDiag(true)).toBe(true)
    expect(shouldLogVoiceConfigDiag(false)).toBe(false)
  })

  it('prints nothing outside dev, so a packaged build stays silent', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    logVoiceConfigDiag(false, DIAG)

    expect(info).not.toHaveBeenCalled()
  })

  it('prints a stage-tagged line in dev', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    logVoiceConfigDiag(true, { ...DIAG, stage: 'component' })

    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0][0]).toBe('[VOICE-CONFIG-DIAG] component')
  })

  it('never carries a credential-shaped field', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    logVoiceConfigDiag(true, DIAG)

    const payload = info.mock.calls[0][1] as Record<string, unknown>
    const forbidden = /api[-_]?key|secret|authorization|token|password/i
    for (const key of Object.keys(payload))
      expect(forbidden.test(key), key).toBe(false)

    // References only: the identifiers are safe, and nothing else is included.
    expect(Object.keys(payload).sort()).toEqual([
      'fallbackCount',
      'hasConfiguration',
      'ipcGetReturned',
      'ipcTtsExists',
      'modelId',
      'persistedVoiceTts',
      'preferredExists',
      'providerId',
      'stage',
      'storeFallbackCount',
      'storePreferredExists',
      'voiceId',
    ])
  })
})
