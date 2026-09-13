import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { isModellessTarget, resolveSynthesisTarget } from '@proj-airi/stage-ui/libs/speech/synthesize-target'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createVoicePreviewDriver } from './voice-preview'
import { CUSTOM_VOICE_PROVIDER_ID, isCustomVoiceTarget, targetForProfile } from './voice-profiles'

/**
 * Preview and chat must reach a custom voice the same way they reach any other
 * voice: through the provider registry and `speechStore.speech()`.
 *
 * That is the whole point of expressing a custom voice as an ordinary
 * `voice.tts` target. If either path grew a special case, the two would drift -
 * the preview would sound right while the chat stayed mute, which is precisely
 * the failure the earlier rounds chased.
 */

const PROFILE_ID = 'profile-a'

/** Read from the module so the guard cannot pass on a stale literal. */
const CUSTOM_LOCAL_VOICE_ID_SENTINEL = 'custom-local-voice'

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: () => async () => ({}),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'pt-BR' }, t: (key: string) => key }),
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('a custom voice target is an ordinary target', () => {
  it('is exactly providerId + voiceId, with no extra field', () => {
    const target = targetForProfile({ id: PROFILE_ID })

    expect(target).toEqual({ providerId: CUSTOM_VOICE_PROVIDER_ID, voiceId: PROFILE_ID })
    // No modelId: the provider publishes no model catalogue, and an absent one
    // is legal. Carrying a stale model id would leak another provider's value.
    expect(target).not.toHaveProperty('modelId')
    expect(isCustomVoiceTarget(target)).toBe(true)
  })

  it('resolves through the chat path without a model or a catalogue entry', () => {
    // `Stage.vue` calls this before speaking. A custom voice has no model and
    // its id is not in any published catalogue, and it still has to resolve.
    const target = resolveSynthesisTarget({
      providerId: CUSTOM_VOICE_PROVIDER_ID,
      modelId: '',
      voiceId: PROFILE_ID,
      resolvedVoice: undefined,
    })

    expect(target).not.toBeNull()
    expect(target?.voice.id).toBe(PROFILE_ID)
    expect(isModellessTarget(target!)).toBe(true)
  })

  it('is not mistaken for the no-output provider', () => {
    expect(resolveSynthesisTarget({
      providerId: 'speech-noop',
      modelId: '',
      voiceId: PROFILE_ID,
      resolvedVoice: undefined,
    })).toBeNull()
  })
})

describe('the preview goes through the common path', () => {
  it('resolves the provider by id and calls speechStore.speech with the profile id', async () => {
    // Typed parameters: without them `mock.calls[0]` is an empty tuple and the
    // destructuring below has nothing to check.
    const speech = vi.fn(async (_provider: unknown, _model: string, _text: string, _voiceId: string) => new ArrayBuffer(0))
    const speechStore = useSpeechStore()
    vi.spyOn(speechStore, 'speech').mockImplementation(speech as never)

    const instance = { speech: () => ({ baseURL: 'http://custom-local-voice/v1/', model: 'custom-voice' }) }
    const getInstance = vi.spyOn(useProviderStore(), 'getProviderInstance').mockResolvedValue(instance as never)
    vi.spyOn(useProviderConfigStore(), 'getProviderConfig').mockReturnValue({} as never)

    const driver = createVoicePreviewDriver()
    await driver(
      { providerId: CUSTOM_VOICE_PROVIDER_ID, voiceId: PROFILE_ID },
      'Olá! Eu sou a Lia.',
      new AbortController().signal,
      () => {},
    )

    // The provider came from the registry, keyed by the target's providerId.
    expect(getInstance).toHaveBeenCalledWith(CUSTOM_VOICE_PROVIDER_ID)
    expect(speech).toHaveBeenCalledTimes(1)

    const [provider, model, text, voiceId] = speech.mock.calls[0]
    expect(provider).toBe(instance)
    expect(model).toBe('')
    expect(text).toBe('Olá! Eu sou a Lia.')
    // The profile id rides in the ordinary voice slot - no new parameter.
    expect(voiceId).toBe(PROFILE_ID)
  })
})

describe('neither path special-cases the provider', () => {
  // A source-level guard: the anti-pattern to avoid is an
  // `if (provider === 'custom-local-voice')` branch in the stage or the preview.
  // Those files are the two entry points into synthesis, so if the branch is not
  // there, both paths are genuinely common.
  const files = [
    resolve(__dirname, '../../../../../../packages/stage-ui/src/components/scenes/Stage.vue'),
    resolve(__dirname, 'voice-preview.ts'),
    resolve(__dirname, '../../../../../../packages/stage-ui/src/libs/speech/synthesize-target.ts'),
  ]

  it.each(files.map(file => [file.split('/').pop() as string, file] as [string, string]))(
    '%s has no branch on the custom voice provider',
    (_name, file) => {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toContain(CUSTOM_VOICE_PROVIDER_ID)
    },
  )

  it('stage-ui keeps the id only where the provider is defined', () => {
    const providerFile = resolve(
      __dirname,
      '../../../../../../packages/stage-ui/src/libs/providers/providers/custom-local-voice/index.ts',
    )
    expect(readFileSync(providerFile, 'utf8')).toContain(CUSTOM_LOCAL_VOICE_ID_SENTINEL)
  })
})
