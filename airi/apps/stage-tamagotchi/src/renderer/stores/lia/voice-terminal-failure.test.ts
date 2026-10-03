import type { LiaVoiceTtsTarget } from '../../../shared/eventa'

import { getSpeechTtsFallbackPolicy, resetSpeechTtsFallbackForTesting, speechTtsTerminalCategory } from '@proj-airi/stage-ui/libs/speech/tts-fallback'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLiaVoiceStore } from './voice'
import { targetForProfile } from './voice-profiles'

/**
 * Phase 7.5, Part 11 - test H: a terminal SETUP failure must not spray one
 * identical fallback-hop per segment. Retrying a voice that does not exist
 * on the server ( `"voice-not-found"` ) or an engine that never loaded its
 * model ( `"engine-unavailable"` ) can never succeed, on this provider or on
 * any fallback - so the policy stops for the WHOLE TURN, warns exactly once,
 * and lets the remaining chunks drop without retry.
 *
 * The category travels as `[category=<key>]` inside the human pt-BR message
 * appended on the main-process boundary: Error.message survives the IPC
 * serialization, custom fields do not. That marker is what this policy reads.
 */

const CUSTOM: LiaVoiceTtsTarget = targetForProfile({ id: 'profile-a' })
const RESERVE: LiaVoiceTtsTarget = { providerId: 'kokoro-local', voiceId: 'af_heart' }

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: unknown) => {
    structuredClone(_config)
  }),
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:get-receive')
      return ipc.getVoiceConfig
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:set-receive')
      return ipc.saveVoiceConfig
    throw new Error(`Unexpected eventa invoke: ${JSON.stringify(invoke)}`)
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'pt-BR' }, t: (key: string) => key }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
  resetSpeechTtsFallbackForTesting()
  ipc.getVoiceConfig.mockResolvedValue({ tts: { preferred: CUSTOM, fallback: [RESERVE] } })
})

describe('speechTtsTerminalCategory', () => {
  it('reads the category marker out of a serialized boundary message', () => {
    expect(speechTtsTerminalCategory(new Error('Não foi possível carregar a voz selecionada. [category=voice-not-found]'))).toBe('voice-not-found')
    expect(speechTtsTerminalCategory(new Error('O sistema de voz não conseguiu carregar o modelo. [category=engine-unavailable]'))).toBe('engine-unavailable')
  })

  it('returns undefined for ordinary failures and for prose that merely mentions a category word', () => {
    expect(speechTtsTerminalCategory(new Error('AllTalk generation failed (500).'))).toBeUndefined()
    expect(speechTtsTerminalCategory(new Error('Não foi possível gerar a fala da Lia. [category=generation-failed]'))).toBeUndefined()
    expect(speechTtsTerminalCategory('not an error with voice-not-found')).toBeUndefined()
  })
})

describe('a terminal voice setup failure', () => {
  it('ends the turn without switching provider and warns exactly once per turn', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()
    store.registerRuntimeExtensions()

    const policy = getSpeechTtsFallbackPolicy()
    expect(policy).toBeDefined()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // First chunk: the policy must refuse the chain switch.
    const first = await policy!.onAttemptFailed!({
      attempt: 1,
      error: new Error('Não foi possível carregar a voz selecionada. [category=voice-not-found]'),
      turnId: 'turn-7',
    })
    expect(first).toBe(false)
    // The voice target did NOT move: no hop onto the reserve ever happened.
    expect(store.resolveCurrentVoiceTarget()).toEqual(CUSTOM)
    // Only ONE warning for this turn - the remaining chunks drop silently.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('terminal for this turn')

    // Second and third chunks of the SAME turn: still no retry, no new warn.
    const second = await policy!.onAttemptFailed!({
      attempt: 2,
      error: new Error('Não foi possível carregar a voz selecionada. [category=voice-not-found]'),
      turnId: 'turn-7',
    })
    expect(second).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(store.resolveCurrentVoiceTarget()).toEqual(CUSTOM)

    warn.mockRestore()
  })

  it('classifies engine-unavailable as terminal too (model never loaded)', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()
    store.registerRuntimeExtensions()

    const policy = getSpeechTtsFallbackPolicy()
    const result = await policy!.onAttemptFailed!({
      attempt: 1,
      error: new Error('O sistema de voz não conseguiu carregar o modelo. [category=engine-unavailable]'),
      turnId: 'turn-9',
    })
    expect(result).toBe(false)
    expect(store.resolveCurrentVoiceTarget()).toEqual(CUSTOM)
  })

  it('still falls back for ORDINARY failures on the same registration', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()
    store.registerRuntimeExtensions()

    const policy = getSpeechTtsFallbackPolicy()
    const result = await policy!.onAttemptFailed!({
      attempt: 1,
      error: new Error('AllTalk generation failed (502).'),
      turnId: 'turn-3',
    })
    expect(result).toBe(true)
    expect(store.resolveCurrentVoiceTarget()).toEqual(RESERVE)
  })

  it('clears the terminal memo at the turn boundary', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()
    store.registerRuntimeExtensions()

    const policy = getSpeechTtsFallbackPolicy()
    await policy!.onAttemptFailed!({
      attempt: 1,
      error: new Error('Não foi possível carregar a voz selecionada. [category=voice-not-found]'),
      turnId: 'turn-1',
    })
    await policy!.onTurnEnded!()

    // A NEW turn gets exactly one fresh warning - the failure never
    // self-heals, but diagnostics must not freeze on turn 1.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const next = await policy!.onAttemptFailed!({
      attempt: 1,
      error: new Error('Não foi possível carregar a voz selecionada. [category=voice-not-found]'),
      turnId: 'turn-2',
    })
    expect(next).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
