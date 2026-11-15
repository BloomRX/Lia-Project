import { PiniaColada } from '@pinia/colada'
import { getProviderCredentialResolver } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import {
  resetRecordingTranscriptionExecutorsForTesting,
  resolveRecordingTranscriptionExecutor,
  useHearingSpeechInputPipeline,
  useHearingStore,
} from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { setTransportTestVaultResolver } from '../../services/lia/transport-config.fixture'

/**
 * Corte B, Fase 2 — speech-to-text no longer needs the credential.
 *
 * The hearing pipeline used to build its transcription client in this renderer,
 * which is why `groq` was the last curated scope the main process still allowed
 * the renderer to read. The pipeline now hands the finished recording to a host
 * executor (registered here) and main performs the request.
 *
 * These tests pin the two halves that make that safe: no credential is read on
 * this side, and the request that leaves carries audio and options only.
 */

const SECRET = 'SYNTHETIC_GROQ_KEY'
const MODEL = 'whisper-large-v3-turbo'

const ipc = vi.hoisted(() => {
  const vault = new Map<string, string>()
  const key = (payload: { scope: string, key: string }) => `${payload.scope}:${payload.key}`
  return {
    transcriptions: [] as unknown[],
    vault,
    seed(scope: string, value: string) {
      vault.set(key({ scope, key: 'apiKey' }), value)
    },
    reset() {
      vault.clear()
    },
    vaultRead: vi.fn(async (payload: { scope: string, key: string }) => vault.get(key(payload))),
    secretGet: vi.fn(async (payload: { scope: string, key: string }) => vault.get(key(payload))),
    secretHas: vi.fn(async (payload: { scope: string, key: string }) => vault.has(key(payload))),
    secretSet: vi.fn(async (payload: { scope: string, key: string, value: string }) => {
      vault.set(key(payload), payload.value)
      return true
    }),
    secretDelete: vi.fn(async (payload: { scope: string, key: string }) => vault.delete(key(payload))),
    transcriptionRun: vi.fn(async (request: unknown) => {
      ipc.transcriptions.push(structuredClone(request))
      return { ok: true as const, status: 200, text: 'transcrição sintética' }
    }),
    hearingConfig: vi.fn(async () => ({ enabled: false, preferred: { providerId: 'lia-groq-transcription', modelId: MODEL } })),
    chatConfig: vi.fn(async () => ({})),
  }
})

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return {
    useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
      const id = invoke?.receiveEvent?.id ?? ''
      const transport = transportTestInvoke(id)
      if (transport)
        return transport
      const handlers: Record<string, unknown> = {
        'eventa:invoke:lia:transcription:run-receive': ipc.transcriptionRun,
        'eventa:invoke:lia:hearing:config:get-receive': ipc.hearingConfig,
        'eventa:invoke:lia:provider:chat:config:get-receive': ipc.chatConfig,
        'eventa:invoke:lia:provider:chat:config:set-receive': vi.fn(async () => {}),
        'eventa:invoke:lia:secret:encryption-available-receive': vi.fn(async () => true),
        'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
        'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
        'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
        'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
        'eventa:invoke:lia:secret:adopt-receive': createSecretAdoptHandler({ secretHas: ipc.secretHas, secretGet: ipc.secretGet, secretSet: ipc.secretSet }),
      }
      if (id in handlers)
        return handlers[id]
      throw new Error(`Unexpected eventa invoke: ${id}`)
    },
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'en-US' }, t: (key: string, fallback?: string) => fallback ?? key }),
}))

const { useLiaProviderStore } = await import('./provider')
const { useLiaHearingStore, LIA_GROQ_TRANSCRIPTION_PROVIDER_ID } = await import('./hearing')

beforeEach(() => {
  const pinia = createPinia()
  const app = createApp({})
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultRead)
  resetRecordingTranscriptionExecutorsForTesting()
  ipc.reset()
  ipc.transcriptions.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  resetRecordingTranscriptionExecutorsForTesting()
  vi.restoreAllMocks()
})

function audio() {
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x2A])
  return new File([bytes], 'recording.wav', { type: 'audio/wav' })
}

describe('speech-to-text through the main process', () => {
  it('rotates a native recording credential only on explicit save and never returns it', async () => {
    const id = 'openai-compatible-audio-transcription'
    useProviderConfigStore().ensureProvider(id, id, { baseUrl: 'https://speech.invalid/v1/' })
    ipc.seed(id, 'synthetic-old')
    // Store construction installs the port in follower settings windows too.
    useLiaProviderStore()
    const { getProviderCredentialConfigPort } = await import('@proj-airi/stage-ui/stores/providers/credential-config-port')
    const port = getProviderCredentialConfigPort(id)!
    expect(await port.has(id)).toBe(true)
    expect(await port.save(id, 'synthetic-rotated')).toBe(true)
    expect(ipc.secretSet).toHaveBeenCalledWith({ scope: id, key: 'apiKey', value: 'synthetic-rotated' })
    expect(useProviderConfigStore().getProviderConfig(id)).not.toHaveProperty('apiKey')
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
  it('runs legacy file playground requests through Main without building an SDK client', async () => {
    useProviderConfigStore().ensureProvider('openai-compatible-audio-transcription', 'openai-compatible-audio-transcription', { baseUrl: 'https://speech.invalid/v1/' })
    useLiaProviderStore().registerChatTransport()
    await useLiaHearingStore().initialize()
    const provider = await useProviderStore().getProviderInstance('openai-compatible-audio-transcription')
    const result = await useHearingStore().transcription('openai-compatible-audio-transcription', provider as never, 'custom-model', audio(), 'json')
    expect(result).toMatchObject({ text: 'transcrição sintética' })
    expect(ipc.transcriptionRun).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'openai-compatible-audio-transcription', model: 'custom-model' }))
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('preserves the confidence filter for native recording and sends the edited endpoint to Main', async () => {
    const id = 'openai-compatible-audio-transcription'
    const config = useProviderConfigStore()
    config.ensureProvider(id, id, { baseUrl: 'https://first.invalid/v1/' })
    useLiaProviderStore().registerChatTransport()
    await useLiaHearingStore().initialize()
    const hearing = useHearingStore()
    hearing.activeTranscriptionProvider = id
    hearing.activeTranscriptionModel = 'selected'
    hearing.confidenceThreshold = -1
    ipc.transcriptionRun.mockResolvedValueOnce({ ok: true, status: 200, text: 'good noise', segments: [{ text: 'good', avg_logprob: -0.2 }, { text: 'noise', avg_logprob: -2 }] } as never)
    const pipeline = useHearingSpeechInputPipeline()
    expect(await pipeline.transcribeForRecording(audio())).toBe('good')
    expect(ipc.transcriptionRun).toHaveBeenLastCalledWith(expect.objectContaining({ responseFormat: 'verbose_json' }))
    config.ensureProvider(id, id).config.baseUrl = 'https://second.invalid/v1/'
    await pipeline.transcribeForRecording(audio())
    expect(useLiaProviderStore().providerBaseUrl(id)).toBe('https://second.invalid/v1/')
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('registers an executor for the projected target and persists a record main can authorize', async () => {
    // The state a user reaches by saving a Groq key in the Launcher: the shared
    // provider config carries the endpoint. The provider metadata catalogue is
    // not loaded in this harness, so the schema default is not available here —
    // seeding the config is the faithful equivalent.
    useProviderConfigStore().ensureProvider('groq', 'groq', { baseUrl: 'https://api.groq.com/openai/v1/' })
    useLiaProviderStore().registerChatTransport()
    await useLiaHearingStore().initialize()

    const executor = resolveRecordingTranscriptionExecutor(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)
    expect(executor).toBeTypeOf('function')
    const record = useLiaProviderStore().providerBaseUrl('groq')
    // The endpoint main will use exists in the persisted record — the request
    // itself will not name one.
    expect(record).toBe('https://api.groq.com/openai/v1/')
  })

  it('sends audio and options only — never an endpoint, never a key', async () => {
    ipc.seed('groq', SECRET)
    const store = useLiaProviderStore()
    store.registerChatTransport()
    await useLiaHearingStore().initialize()

    const transcriber = resolveRecordingTranscriptionExecutor(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)!
    const result = await transcriber({
      providerId: LIA_GROQ_TRANSCRIPTION_PROVIDER_ID,
      model: MODEL,
      file: audio(),
      providerOptions: { language: 'pt' },
    })

    expect(result.text).toBe('transcrição sintética')
    expect(ipc.transcriptions).toHaveLength(1)
    const [request] = ipc.transcriptions as Array<Record<string, unknown>>
    expect(request).toMatchObject({ providerId: 'groq', model: MODEL, language: 'pt', fileName: 'recording.wav', mimeType: 'audio/wav' })
    expect(Object.keys(request).sort()).toEqual(['bytes', 'fileName', 'language', 'mimeType', 'model', 'providerId', 'requestId'])
    expect(JSON.stringify(ipc.transcriptions)).not.toContain(SECRET)
    // The audio survived as bytes, not as a re-encoded string.
    expect(Array.from(request.bytes as Uint8Array)).toEqual([0x52, 0x49, 0x46, 0x46, 0x00, 0x2A])
    // The vault is main's to read (covered against a real server in
    // `transcription-service.test.ts`); what matters here is that THIS side
    // never asked for the value.
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('never builds a transcription provider instance in this renderer', async () => {
    ipc.seed('groq', SECRET)
    useLiaProviderStore().registerRuntimeExtensions()
    await useLiaHearingStore().initialize()
    const source = useProviderStore()
    const build = vi.spyOn(source, 'getProviderInstance')

    const transcriber = resolveRecordingTranscriptionExecutor(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)!
    await transcriber({ providerId: LIA_GROQ_TRANSCRIPTION_PROVIDER_ID, model: MODEL, file: audio() })

    expect(build).not.toHaveBeenCalled()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('surfaces a coded failure instead of a provider body', async () => {
    ipc.seed('groq', SECRET)
    useLiaProviderStore().registerChatTransport()
    await useLiaHearingStore().initialize()
    ipc.transcriptionRun.mockResolvedValueOnce({ ok: false, code: 'credentials', status: 401 } as never)

    const transcriber = resolveRecordingTranscriptionExecutor(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)!
    await expect(transcriber({ providerId: LIA_GROQ_TRANSCRIPTION_PROVIDER_ID, model: MODEL, file: audio() }))
      .rejects
      .toThrow(/credentials/)
  })

  it('resolves no credential for the derived target, nor for the curated scope it aliases', async () => {
    ipc.seed('groq', SECRET)
    useLiaProviderStore().registerRuntimeExtensions()
    const resolver = getProviderCredentialResolver()!
    // The resolver declines the derived id BEFORE touching the vault, so the
    // derived scope cannot be pulled through it even though it aliases `groq`.
    expect(await resolver(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()
    // PROMPT-26: and the scope it aliases is curated too, so the chat id is
    // refused for the same reason — main executes `groq` chat and transcription.
    expect(await resolver('groq')).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })
})
