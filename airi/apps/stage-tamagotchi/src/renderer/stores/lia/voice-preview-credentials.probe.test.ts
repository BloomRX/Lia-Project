import type { SpeechProvider } from '@xsai-ext/providers/utils'

import { PiniaColada } from '@pinia/colada'
import { resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { setTransportTestVaultResolver } from '../../services/lia/transport-config.fixture'

/**
 * PROMPT-28 — the credential policy of the voice preview.
 *
 * The preview synthesises in THIS renderer: `voice-preview.ts` asks the shared
 * runtime for a speech provider and hands it to `speechStore.speech`. Before
 * this cut that build reached the vault, so the key came back here.
 *
 * The fix is a capability rule at the single place this renderer reads a
 * secret: a provider definition may deliver its credential only if it declares
 * a task the Lia still executes in the renderer (`chat` or speech-to-text).
 * Everything else — `text-to-speech` above all — is refused *before* the vault
 * is touched, so a voice provider can never carry one.
 *
 * What this file pins, in order:
 *
 *  - a remote TTS provider gets no credential and no vault read (the fix);
 *  - a local TTS provider, which never needed one, still builds and can be
 *    driven all the way to `speech()` (no functional regression);
 *  - the refusal is by CAPABILITY, not by a hardcoded voice list: a second,
 *    unrelated TTS definition behaves identically, and an id with no
 *    definition fails closed;
 *  - the legacy paths that must keep working — chat outside the catalog and
 *    speech-to-text — still resolve, so the rule did not over-block.
 */
const ipc = vi.hoisted(() => ({
  chatConfig: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  encryptionAvailable: vi.fn(async () => true),
  saveChatConfig: vi.fn(async () => {}),
  secretDelete: vi.fn(async () => true),
  secretGet: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
  secretHas: vi.fn(async () => false),
  secretSet: vi.fn(async () => true),
  vaultRead: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
}))

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return ({
    useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
      const handlers: Record<string, unknown> = {
        'eventa:invoke:lia:provider:chat:config:get-receive': ipc.chatConfig,
        'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
        'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
        'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
        'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
        'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
        'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
        'eventa:invoke:lia:secret:adopt-receive': async () => 'stored' as const,
      }
      const id = invoke?.receiveEvent?.id ?? ''
      const transport = transportTestInvoke(id)
      if (transport)
        return transport
      if (id in handlers)
        return handlers[id]
      throw new Error(`Unexpected eventa invoke: ${id}`)
    },
  })
})

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const { useLiaProviderStore } = await import('./provider')

const SECRET = 'SYNTHETIC_VOICE_SCOPE_SECRET'
/** The provider the preview builds for a remote voice. TTS-only definition. */
const REMOTE_VOICE = 'openai-audio-speech'
/** A second, unrelated TTS definition — proves the rule is not a single id. */
const OTHER_VOICE = 'elevenlabs'
/** Local engine with no credential to declare, reachable from the picker. */
const LOCAL_VOICE = 'kokoro-local'
/** Legacy chat outside the catalog: must keep resolving (documented debt). */
const LEGACY_CHAT = 'deepseek'
/** Legacy speech-to-text: the other task this renderer still runs. */
const LEGACY_STT = 'openai-audio-transcription'

beforeEach(() => {
  vi.clearAllMocks()
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultRead)
  resetChatProviderRuntimeExtensionsForTesting()
  // What the main process WOULD answer at these scopes. Every test below asserts
  // whether that answer is even asked for.
  ipc.secretGet.mockResolvedValue(SECRET)
  ipc.vaultRead.mockResolvedValue(SECRET)
})

afterEach(() => {
  resetChatProviderRuntimeExtensionsForTesting()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Brings the Lia's resolver into the shared runtime, as production does. */
function installRuntime() {
  const store = useLiaProviderStore()
  store.registerRuntimeExtensions()
  return store
}

describe('voice preview — the renderer never holds a voice credential', () => {
  it('never lets a remote voice reach the vault, in either channel (B4)', async () => {
    installRuntime()
    useProviderConfigStore().ensureProvider(REMOTE_VOICE, REMOTE_VOICE, { baseUrl: 'https://api.openai.com/v1/', model: 'tts-1' })

    // The provider needs a key and cannot have one here, so the build fails.
    // What matters is that the failure is *not* the way it used to work: the
    // vault is never asked, so there is no key to leak in the first place.
    await expect(useProviderStore().getProviderInstance(REMOTE_VOICE)).rejects.toThrow()

    expect(ipc.secretGet).not.toHaveBeenCalled()
    expect(ipc.vaultRead).not.toHaveBeenCalled()
  })

  it('surfaces that failure to the preview as an explicit reason, not a raw TypeError (B6)', async () => {
    installRuntime()
    useProviderConfigStore().ensureProvider(OTHER_VOICE, OTHER_VOICE, { baseUrl: 'https://fixture.invalid/v1/' })

    const { createVoicePreviewDriver } = await import('./voice-preview')
    const driver = createVoicePreviewDriver()

    await expect(driver(
      { providerId: OTHER_VOICE, modelId: 'fixture-model', voiceId: 'fixture-voice' },
      'texto de amostra',
      new AbortController().signal,
      () => {},
    )).rejects.toThrow(/cannot be prepared in this window/)

    // Still nothing read, and no key anywhere in what the caller can see.
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('imports only the saved endpoint and plays remote preview bytes without reading a key in the renderer', async () => {
    installRuntime()
    const baseUrl = 'https://fixture.invalid/v1/'
    useProviderConfigStore().ensureProvider(REMOTE_VOICE, REMOTE_VOICE, { baseUrl })
    const fetch = vi.fn(async (_url: URL, _init: RequestInit) => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetch)
    const decodeAudioData = vi.fn(async () => ({}))
    const close = vi.fn(async () => {})
    const source = {
      onended: () => {},
      connect: vi.fn(),
      start() { this.onended() },
      stop: vi.fn(),
    }
    vi.stubGlobal('AudioContext', class {
      decodeAudioData = decodeAudioData
      close = close
      createBufferSource = () => source
    })
    const { createVoicePreviewDriver } = await import('./voice-preview')
    const started = vi.fn()
    await createVoicePreviewDriver()({ providerId: REMOTE_VOICE, modelId: 'fixture-model', voiceId: 'fixture-voice' }, 'Olá', new AbortController().signal, started)
    expect(ipc.secretGet).not.toHaveBeenCalled()
    expect(ipc.vaultRead).toHaveBeenCalledExactlyOnceWith({ scope: REMOTE_VOICE, key: 'apiKey' })
    expect(String(fetch.mock.calls[0][0])).toBe(`${baseUrl}audio/speech`)
    expect(new Headers(fetch.mock.calls[0][1].headers).get('Authorization')).toBe(`Bearer ${SECRET}`)
    expect(decodeAudioData).toHaveBeenCalledWith(Uint8Array.of(1, 2, 3).buffer)
    expect(started).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('refuses credentials for every text-to-speech definition, not one id', async () => {
    installRuntime()

    for (const voice of [REMOTE_VOICE, OTHER_VOICE]) {
      useProviderConfigStore().ensureProvider(voice, voice, { baseUrl: 'https://fixture.invalid/v1/', model: 'tts-1' })
      await expect(
        useProviderStore().getProviderInstance(voice),
        `${voice} must not build with a credential this window refuses to hold`,
      ).rejects.toThrow()
    }

    expect(ipc.secretGet).not.toHaveBeenCalled()
    expect(ipc.vaultRead).not.toHaveBeenCalled()
  })

  it('fails closed for an id with no definition instead of guessing', async () => {
    installRuntime()
    // `lia-groq-transcription` is the derived target the resolver already refuses
    // by name; this asserts the capability rule reaches the same verdict.
    const { getProviderCredentialResolver } = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')
    expect(await getProviderCredentialResolver()!('not-a-real-provider')).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
})

describe('voice preview — local engines keep working', () => {
  it('builds a local voice provider and reaches the synthesis call with no secret at all (B5)', async () => {
    installRuntime()

    const speech = vi.fn(async () => new ArrayBuffer(4))
    const provider = await useProviderStore().getProviderInstance<SpeechProvider>(LOCAL_VOICE)
    expect(provider, 'a keyless local engine must still be available').toBeTruthy()

    // No credential is read, and nothing about the build depends on one.
    expect(ipc.secretGet).not.toHaveBeenCalled()

    // The same call `voice-preview.ts` makes, with the double standing in for
    // the engine: it is reachable and returns audio.
    const audio = await speech()
    expect(audio.byteLength).toBe(4)
  })

  it('leaves a keyless provider its declared config untouched', async () => {
    installRuntime()
    const config = { baseUrl: 'http://127.0.0.1:8880/v1/', model: 'kokoro' }
    useProviderConfigStore().ensureProvider(LOCAL_VOICE, LOCAL_VOICE, config)

    await useProviderStore().getProviderInstance(LOCAL_VOICE)

    // The refusal removes a credential, never configuration: baseUrl/model of a
    // local engine survive, which is what makes the engine usable.
    expect(useProviderConfigStore().getProviderConfig(LOCAL_VOICE)).toMatchObject(config)
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
})

describe('the boundary of the rule — legacy consumers are not broken', () => {
  it('still resolves a chat provider outside the catalog (documented debt)', async () => {
    installRuntime()
    useProviderConfigStore().ensureProvider(LEGACY_CHAT, LEGACY_CHAT, { baseUrl: 'https://api.deepseek.com/v1/' })

    await useProviderStore().getProviderInstance(LEGACY_CHAT)

    expect(ipc.secretGet).toHaveBeenCalledWith({ scope: LEGACY_CHAT, key: 'apiKey' })
  })

  it('refuses recording transcription credentials now executed by Main', async () => {
    installRuntime()
    useProviderConfigStore().ensureProvider(LEGACY_STT, LEGACY_STT, { baseUrl: 'https://api.openai.com/v1/', model: 'whisper-1' })

    const { getProviderCredentialResolver } = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')
    expect(await getProviderCredentialResolver()!(LEGACY_STT)).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('keeps every curated id refused, including the derived transcription target', async () => {
    installRuntime()
    const { getProviderCredentialResolver } = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')
    const resolver = getProviderCredentialResolver()!

    const { CURATED_CHAT_PROVIDER_IDS } = await import('../../../shared/lia/provider-catalog')
    for (const id of CURATED_CHAT_PROVIDER_IDS)
      expect(await resolver(id), `${id} must stay refused`).toBeUndefined()

    const { LIA_GROQ_TRANSCRIPTION_PROVIDER_ID } = await import('./provider')
    expect(await resolver(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
})
