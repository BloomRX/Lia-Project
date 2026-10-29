import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, createApp, ref } from 'vue'

/**
 * B0.7.1, T-B — the hearing store's configuration write path, with a request
 * counter.
 *
 * `hearing.ts` is the second of the Lia's two configuration write paths and the
 * one the post-B0.7 audit found with no network evidence at all: `hearing.test.ts`
 * drives `initialize()` 27 times and never stubs `fetch`. This file closes that
 * gap for the write itself.
 *
 * The store projects the canonical STT target onto the shared provider record:
 *
 *  - **record absent** → `ensure` — local only, zero requests;
 *  - **record present** → `updateConfig` — one `PATCH`, the same replication the
 *    panel flow performs.
 *
 * The document uses `enabled: false` on purpose. Projection happens *before* the
 * voice-disabled early return (`hearing.ts` `initialize`), so the write is fully
 * exercised while the microphone bootstrap — a separate concern already covered
 * by `hearing.test.ts` — is never entered. That keeps this test about the write
 * path and nothing else.
 *
 * No real network: `fetch` is stubbed for every case and asserted either empty
 * or exactly one request.
 */

const observed = vi.hoisted(() => ({ requests: [] as { url: string, method: string }[] }))

const ipc = vi.hoisted(() => {
  let hearing: Record<string, unknown> = {}
  return {
    fixture(next: Record<string, unknown>) {
      hearing = next
    },
    getHearingConfig: vi.fn(async () => structuredClone(hearing)),
    getChatConfig: vi.fn(async () => ({})),
    saveChatConfig: vi.fn(async () => {}),
    secretHas: vi.fn(async () => true),
    secretGet: vi.fn(async () => undefined),
    secretSet: vi.fn(async () => true),
    secretDelete: vi.fn(async () => true),
    encryptionAvailable: vi.fn(async () => true),
  }
})

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const handlers: Record<string, unknown> = {
      'eventa:invoke:lia:hearing:config:get-receive': ipc.getHearingConfig,
      'eventa:invoke:lia:provider:chat:config:get-receive': ipc.getChatConfig,
      'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
      'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
      'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
      'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
      'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
      'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
    }
    const id = invoke?.receiveEvent?.id ?? ''
    if (id in handlers)
      return handlers[id]
    throw new Error(`Unexpected eventa invoke: ${id}`)
  },
}))

/**
 * The audio device store is constructed with the hearing store, so the browser
 * media boundary has to exist. It is never *used* here: the document disables
 * voice, so `initialize` returns before `bootstrapMicrophone`.
 */
vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useDevicesList: () => ({
      audioInputs: computed(() => []),
      devices: ref([]),
      ensurePermissions: async () => true,
      permissionGranted: ref(true),
    }),
    useUserMedia: () => {
      const stream = ref<MediaStream | null>(null)
      return {
        start: async () => {
          stream.value = {} as MediaStream
          return stream.value
        },
        stop: () => {
          stream.value = null
        },
        stream,
      }
    },
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const {
  LIA_GROQ_TRANSCRIPTION_DEFINITION_ID,
  LIA_GROQ_TRANSCRIPTION_PROVIDER_ID,
  useLiaHearingStore,
} = await import('./hearing')

const MODEL_ID = 'whisper-large-v3-turbo'

/** The canonical document, with voice off so no microphone is involved. */
function projectionDoc() {
  return {
    enabled: false,
    preferred: { modelId: MODEL_ID, providerId: LIA_GROQ_TRANSCRIPTION_PROVIDER_ID },
  }
}

function installStores() {
  observed.requests = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    observed.requests.push({ url, method: init?.method ?? 'GET' })
    return new Response(JSON.stringify({
      id: LIA_GROQ_TRANSCRIPTION_PROVIDER_ID,
      definitionId: LIA_GROQ_TRANSCRIPTION_DEFINITION_ID,
      config: { baseUrl: 'https://api.groq.com/openai/v1/', model: MODEL_ID },
      status: 'unconfigured',
      configuredBy: 'user',
    }), { status: 200 })
  }))

  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)

  return { config: useProviderConfigStore(), hearing: useLiaHearingStore() }
}

describe('lia hearing provider projection — the write path (B0.7.1, T-B)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.fixture({})
    vi.clearAllMocks()
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      mediaDevices: {
        addEventListener: () => {},
        enumerateDevices: async () => [],
        getUserMedia: async () => ({}) as MediaStream,
        removeEventListener: () => {},
      },
      permissions: { query: async () => ({ onchange: null, state: 'granted' }) },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('record absent: creates the record locally and sends no request', async () => {
    ipc.fixture(projectionDoc())
    const { config, hearing } = installStores()

    await hearing.initialize()

    const record = config.getProvider(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)
    expect(record?.definitionId).toBe(LIA_GROQ_TRANSCRIPTION_DEFINITION_ID)
    expect(record?.config).toMatchObject({ model: MODEL_ID })
    expect(observed.requests).toEqual([])
  })

  it('record present: replicates exactly one PATCH, the same as the panel flow', async () => {
    ipc.fixture(projectionDoc())
    const { config, hearing } = installStores()
    // Seed the record the way a previous boot would have left it, so this run
    // takes the update branch instead of the create branch.
    config.ensureProvider(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID, LIA_GROQ_TRANSCRIPTION_DEFINITION_ID, {
      baseUrl: 'https://stale.invalid/v1',
      model: 'stale-model',
    })

    await hearing.initialize()

    expect(observed.requests).toHaveLength(1)
    expect(observed.requests[0].method).toBe('PATCH')
    expect(observed.requests[0].url).toContain(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)
    // The projection landed locally as well: the stale URL/model were replaced.
    expect(config.getProviderConfig(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)).toMatchObject({ model: MODEL_ID })
  })

  it('record present, second initialize: the projection is not re-sent', async () => {
    ipc.fixture(projectionDoc())
    const { config, hearing } = installStores()
    // Seed the record so the first run really does replicate. Without it this
    // test would pass on "zero requests" and prove nothing about the guard.
    config.ensureProvider(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID, LIA_GROQ_TRANSCRIPTION_DEFINITION_ID, {
      baseUrl: 'https://stale.invalid/v1',
      model: 'stale-model',
    })

    await hearing.initialize()
    expect(observed.requests).toHaveLength(1)

    await hearing.initialize()
    await hearing.initialize()

    // The signature guard is what makes the cost one request per boot rather
    // than one per call; this pins it against a future refactor.
    expect(observed.requests).toHaveLength(1)
  })

  it('a failing replication still leaves the projection applied locally', async () => {
    ipc.fixture(projectionDoc())
    const { config, hearing } = installStores()
    config.ensureProvider(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID, LIA_GROQ_TRANSCRIPTION_DEFINITION_ID, { model: 'stale-model' })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('remote unavailable')
    }))

    await expect(hearing.initialize()).resolves.toBeUndefined()

    expect(config.getProviderConfig(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)).toMatchObject({ model: MODEL_ID })
  })
})
