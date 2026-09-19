import { describe, expect, it } from 'vitest'

import { isVoiceVisibleToAllTalk } from './voices-sync'

/**
 * Phase 7.5.1, items B/C (test 3): the comparison follows the REAL upstream
 * contract - `GET /api/voices` answers `{"voices": string[]}` of filenames
 * with extension (fresh per request, `*.wav` filter, no recursion), and
 * `/api/tts-generate` resolves the exact string against the same folder.
 */
describe('isVoiceVisibleToAllTalk', () => {
  it('exact filename membership in the upstream { voices: string[] } shape', () => {
    const voices = ['alice.wav', 'lia-80202d55-24e8-4edf-a665-fa8236af2c5e.wav', 'bob.wav']
    expect(isVoiceVisibleToAllTalk(voices, 'lia-80202d55-24e8-4edf-a665-fa8236af2c5e.wav')).toBe(true)
    expect(isVoiceVisibleToAllTalk(voices, 'lia-80202d55-24e8-4edf-a665-fa8236af2c5e.flac')).toBe(false)
  })

  it('never matches partially: basename-without-extension, substrings, wrong case', () => {
    const target = 'lia-80202d55-24e8-4edf-a665-fa8236af2c5e.wav'
    expect(isVoiceVisibleToAllTalk(['lia-80202d55-24e8-4edf-a665-fa8236af2c5e'], target)).toBe(false)
    expect(isVoiceVisibleToAllTalk(['LIA-80202D55-24E8-4EDF-A665-FA8236AF2C5E.WAV'], target)).toBe(false)
    expect(isVoiceVisibleToAllTalk(['aa-lia-80202d55-24e8-4edf-a665-fa8236af2c5e.wav'], target)).toBe(false)
  })

  it('does not guess at object/nested shapes - unknown shapes are simply not visible', () => {
    const target = 'lia.wav'
    expect(isVoiceVisibleToAllTalk([{ name: 'lia.wav' }], target)).toBe(false)
    expect(isVoiceVisibleToAllTalk([{ filename: 'lia.wav', path: 'voices/lia.wav' }], target)).toBe(false)
  })
})
