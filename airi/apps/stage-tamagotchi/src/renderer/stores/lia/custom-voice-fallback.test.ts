import type { LiaVoiceTtsTarget } from '../../../shared/eventa'

import { getSpeechTtsFallbackPolicy, resetSpeechTtsFallbackForTesting } from '@proj-airi/stage-ui/libs/speech/tts-fallback'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLiaVoiceStore } from './voice'
import { CUSTOM_VOICE_PROVIDER_ID, targetForProfile } from './voice-profiles'

/**
 * An offline speech server must degrade, not mute.
 *
 * A custom voice is the one target most likely to be unavailable: it depends on
 * a server the user starts by hand. So the case that matters is
 * preferred = custom-local-voice, server off, a real reserve behind it. The
 * existing 4D policy has to carry the turn - the provider must not grow its own
 * fallback, or there would be two policies disagreeing about who speaks next.
 *
 * What makes this work at all is that the provider *throws* when the server is
 * unreachable (covered in `alltalk-synthesis.test.ts` and in the provider's own
 * test). A swallowed error would look like success and the policy would never
 * run.
 */

const CUSTOM: LiaVoiceTtsTarget = targetForProfile({ id: 'profile-a' })
// No `modelId`: the bridge drops empty strings rather than persisting them, so
// writing one here would compare against something the store never keeps.
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

describe('a custom voice that is offline', () => {
  it('starts on the custom voice, with the reserve behind it', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    expect(store.preferred).toEqual({ providerId: CUSTOM_VOICE_PROVIDER_ID, voiceId: 'profile-a' })
    expect(store.voiceTargetChain).toEqual([CUSTOM, RESERVE])
    expect(store.resolveCurrentVoiceTarget()).toEqual(CUSTOM)
  })

  it('hands the turn to the reserve when the preferred fails', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    // The provider threw because the server was unreachable; the policy asks for
    // the next target exactly once.
    const next = store.nextVoiceTargetOnFailure()

    expect(next).toEqual(RESERVE)
    expect(store.resolveCurrentVoiceTarget()).toEqual(RESERVE)
    // Sticky for the rest of the turn: nothing walks further without another
    // failure.
    expect(store.resolveCurrentVoiceTarget()).toEqual(RESERVE)
    expect(store.resolveCurrentVoiceTarget()).toEqual(RESERVE)
  })

  it('reports nothing left once the reserve has also failed', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    store.nextVoiceTargetOnFailure()
    expect(store.nextVoiceTargetOnFailure()).toBeUndefined()
    // Stays on the last target rather than falling off the end.
    expect(store.resolveCurrentVoiceTarget()).toEqual(RESERVE)
  })

  it('resets after the turn, so a server that came back is used again', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()

    store.nextVoiceTargetOnFailure()
    expect(store.resolveCurrentVoiceTarget()).toEqual(RESERVE)

    store.resetVoiceTarget()
    expect(store.activeTargetIndex).toBe(0)
    expect(store.resolveCurrentVoiceTarget()).toEqual(CUSTOM)
  })

  it('keeps using the shared policy rather than inventing one', async () => {
    const store = useLiaVoiceStore()
    await store.refreshConfig()
    store.registerRuntimeExtensions()

    // The runtime asks the installed policy - the same one every other provider
    // uses - whether to retry. It is not asked of the Lia store, and the custom
    // voice gets no special treatment.
    const policy = getSpeechTtsFallbackPolicy()
    expect(policy).toBeTruthy()

    // The provider threw because the server was down; that is a recoverable
    // attempt failure, so the policy should switch and ask for a retry.
    const retried = await policy!.onAttemptFailed({
      attempt: 1,
      error: new Error('AllTalk generation failed (503).'),
    })

    expect(retried).toBe(true)
    expect(store.resolveCurrentVoiceTarget()).toEqual(RESERVE)

    // The reserve is the last target, so a second failure ends the chain instead
    // of looping.
    const exhausted = await policy!.onAttemptFailed({
      attempt: 2,
      error: new Error('AllTalk generation failed (503).'),
    })
    expect(exhausted).toBe(false)

    // End of turn: the preferred voice comes back, so a server that recovers is
    // used again on the next turn rather than staying on the reserve.
    await policy!.onTurnEnded?.()
    expect(store.resolveCurrentVoiceTarget()).toEqual(CUSTOM)
  })
})
