import { getDefinedProvider } from '@proj-airi/stage-ui/libs/providers/providers/registry'
import { getProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: managed Hearing projection plus the credential
 * alias that makes it work without duplicating a secret.
 *
 * These run against the REAL AIRI runtime stores (provider config, provider
 * instance cache, hearing refs, audio device) and the REAL provider definition
 * registry; only the IPC edge (`@proj-airi/electron-vueuse`) and `vue-i18n` are
 * replaced, exactly as in `secret-bridge.test.ts`. Mocking `vue-i18n` is what
 * makes the stage-ui stores instantiable outside a component - they call
 * `useI18n()`, which throws without a setup context.
 *
 * So "the derived provider is projected" here means the real
 * `ensureProvider` accepted the real `openai-compatible-audio-transcription`
 * definition and stored the derived config - not that a replica was called.
 */

const ipc = vi.hoisted(() => {
  const vault = new Map<string, string>()
  let hearing: Record<string, unknown> = {}
  const secretKey = (scope: string, key: string) => `${scope}\u0000${key}`
  return {
    /** Seeds the vault and the canonical Hearing facts the getter returns. */
    fixture(next: Record<string, unknown>, secrets: Record<string, string> = {}) {
      hearing = structuredClone(next)
      vault.clear()
      for (const [scope, value] of Object.entries(secrets))
        vault.set(secretKey(scope, 'apiKey'), value)
    },
    getHearingConfig: vi.fn(async (): Promise<unknown> => structuredClone(hearing)),
    secretHas: vi.fn(async (payload: { scope: string, key: string }) => vault.has(secretKey(payload.scope, payload.key))),
    secretGet: vi.fn(async (payload: { scope: string, key: string }): Promise<string | undefined> => vault.get(secretKey(payload.scope, payload.key))),
    secretSet: vi.fn(async () => true),
    secretDelete: vi.fn(async () => true),
    encryptionAvailable: vi.fn(async () => true),
    getChatConfig: vi.fn(async (): Promise<unknown> => ({})),
    saveChatConfig: vi.fn(async () => {}),
  }
})

/**
 * The browser media boundary is the ONLY thing replaced in the microphone tests.
 * `@vueuse/core`'s `useDevicesList`/`useUserMedia` stand in for a real
 * microphone, so the REAL `composables/audio/audio-device.ts` and the REAL
 * `stores/settings/audio-device.ts` - including the permission handshake, the
 * device-selection sync and the watcher that reverts `enabled` on failure - are
 * all still executed. What is asserted is therefore the real store's behaviour,
 * not a replica's.
 */
const media = vi.hoisted(() => ({
  handshakeCalls: 0,
  handshakeFailure: undefined as undefined | { message: string, name: string },
  handshakeGrants: true,
  inputs: [] as Array<{ deviceId: string, kind: string, label: string }>,
  permissionGranted: false,
  startCalls: 0,
  startFailure: undefined as undefined | { message: string, name: string },
  /** A healthy machine: one usable microphone, permission grantable. */
  healthy() {
    media.permissionGranted = false
    media.handshakeFailure = undefined
    media.handshakeGrants = true
    media.startFailure = undefined
    media.inputs = [{ deviceId: 'default', kind: 'audioinput', label: 'Simulated Microphone' }]
  },
  reset() {
    media.handshakeCalls = 0
    media.startCalls = 0
    media.inputs = []
    media.permissionGranted = false
    media.handshakeFailure = undefined
    media.handshakeGrants = true
    media.startFailure = undefined
  },
}))

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  const { computed, ref } = await import('vue')

  const failureFrom = (failure: { message: string, name: string }) => {
    const error = new Error(failure.message)
    error.name = failure.name
    return error
  }

  return {
    ...actual,
    useDevicesList: () => {
      const devices = ref(media.inputs.map(device => ({ ...device })))
      const permissionGranted = ref(media.permissionGranted)
      return {
        audioInputs: computed(() => devices.value.filter(device => device.kind === 'audioinput')),
        devices,
        ensurePermissions: async () => {
          media.handshakeCalls += 1
          if (media.handshakeFailure)
            throw failureFrom(media.handshakeFailure)

          if (!media.handshakeGrants)
            return false

          // What the real handshake does once permission lands: the device list
          // becomes identifiable and a device gets selected.
          permissionGranted.value = true
          media.permissionGranted = true
          devices.value = media.inputs.map(device => ({ ...device }))
          return true
        },
        permissionGranted,
      }
    },
    useUserMedia: () => {
      const stream = ref<MediaStream | null>(null)
      return {
        start: async () => {
          media.startCalls += 1
          if (media.startFailure)
            throw failureFrom(media.startFailure)

          stream.value = {} as MediaStream
          return stream.value
        },
        stop: () => { stream.value = null },
        stream,
      }
    },
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

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const { useLiaHearingStore, projectSttTarget, LIA_GROQ_TRANSCRIPTION_DEFINITION_ID, LIA_GROQ_TRANSCRIPTION_PROVIDER_ID } = await import('./hearing')
const { useLiaProviderStore, secretScopeFor } = await import('./provider')

/**
 * Source guards must look at CODE, not prose: the store's own doc comment
 * legitimately explains what it does NOT do, and those words would otherwise
 * trip the negative assertions below.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Collects the `[LIA-HEARING]` event names in emission order, so ordering
 * claims (handshake before enable) are proven from the real log rather than
 * from an assumption about the code.
 */
function captureDiagnostics(): string[] {
  const events: string[] = []
  vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
    const match = /^\[LIA-HEARING\] (\S+)/.exec(typeof message === 'string' ? message : '')
    if (match)
      events.push(match[1])
  })
  return events
}

/** The Lia hearing store source, with comments removed. */
async function hearingStoreCode(): Promise<string> {
  const { readFileSync } = await import('node:fs')
  return stripComments(readFileSync(new URL('./hearing.ts', import.meta.url), 'utf-8'))
}

const SIMULATED_KEY = 'gsk-simulated-hearing-secret'

/** The canonical document the Launcher writes when it is eligible (§14). */
function managedGroqDoc(modelId = 'whisper-large-v3-turbo') {
  return { enabled: true, preferred: { modelId, providerId: 'lia-groq-transcription' } }
}

/** The canonical document for an explicit voice opt-out (§13). */
function voiceDisabledDoc() {
  return { enabled: false, preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' } }
}

beforeEach(() => {
  // A healthy machine unless a test says otherwise: one usable microphone and a
  // grantable permission, which is what the earlier suite implicitly assumed.
  media.reset()
  media.healthy()
  // `askPermission()` calls `enumerateDevices()` directly after the handshake
  // resolves, so the browser boundary has to exist even though the rest of
  // `@vueuse/core` is stubbed above.
  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    mediaDevices: {
      addEventListener: () => {},
      enumerateDevices: async () => media.inputs.map(device => ({ ...device })),
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

describe('credential scope alias (Phase 8.0D SHELL-B1 §22)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    ipc.fixture({})
    vi.clearAllMocks()
  })

  it('the pure mapping aliases exactly the derived target and nothing else', () => {
    // Literal oracle, deliberately not derived from the production table.
    const cases = [
      ['groq', 'groq'],
      ['lia-groq-transcription', 'groq'],
      ['openai', 'openai'],
      ['some-arbitrary-provider', 'some-arbitrary-provider'],
      ['browser-web-speech-api', 'browser-web-speech-api'],
      ['', ''],
    ] as const

    for (const [providerId, expected] of cases)
      expect(secretScopeFor(providerId), `secretScopeFor(${providerId})`).toBe(expected)
  })

  it('the derived target resolves the EXISTING groq vault secret', async () => {
    // The vault holds ONE secret, under the chat provider's own scope.
    ipc.fixture({}, { groq: SIMULATED_KEY })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    const resolver = getProviderCredentialResolver()
    expect(resolver).toBeDefined()
    const credential = await resolver!('lia-groq-transcription')

    expect(credential).toEqual({ apiKey: SIMULATED_KEY })
    // The lookup went to `groq`, never to a second scope of its own.
    expect(ipc.secretGet).toHaveBeenCalledWith({ key: 'apiKey', scope: 'groq' })
    const scopes = ipc.secretGet.mock.calls.map(call => call[0].scope)
    expect(scopes).not.toContain('lia-groq-transcription')
  })

  it('there is no second credential store: an alias-only vault resolves nothing', async () => {
    // If a secret were stored under the derived id instead, it would be a
    // duplicated credential. The alias is read-only, so nothing finds it.
    ipc.fixture({}, { 'lia-groq-transcription': SIMULATED_KEY })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    const credential = await getProviderCredentialResolver()!('lia-groq-transcription')

    expect(credential).toBeUndefined()
    expect(ipc.secretGet).toHaveBeenCalledWith({ key: 'apiKey', scope: 'groq' })
    // Nothing was ever written to the vault: zero duplication, zero migration.
    expect(ipc.secretSet).not.toHaveBeenCalled()
  })

  it('the chat provider still resolves through its own identity', async () => {
    ipc.fixture({}, { groq: SIMULATED_KEY })
    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()

    expect(await getProviderCredentialResolver()!('groq')).toEqual({ apiKey: SIMULATED_KEY })
    expect(ipc.secretGet).toHaveBeenCalledWith({ key: 'apiKey', scope: 'groq' })
  })

  it('the resolver log carries metadata only - never the literal key', async () => {
    ipc.fixture({}, { groq: SIMULATED_KEY })
    const logs: string[] = []
    const info = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(arg => String(arg)).join(' '))
    })

    const store = useLiaProviderStore()
    store.registerRuntimeExtensions()
    await getProviderCredentialResolver()!('lia-groq-transcription')

    const joined = logs.join('\n')
    expect(joined).toContain('providerId=lia-groq-transcription')
    expect(joined).toContain('scope=groq')
    expect(joined).toContain('secretSource=lia-vault')
    expect(joined).not.toContain(SIMULATED_KEY)
    expect(joined).not.toContain('gsk-simulated')
    info.mockRestore()
  })
})

describe('managed hearing projection (Phase 8.0D SHELL-B1 §23)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    ipc.fixture({})
    vi.clearAllMocks()
  })

  it('a: the managed groq target is projected and the audio input is enabled', async () => {
    ipc.fixture(managedGroqDoc())

    await useLiaHearingStore().initialize()

    const providerConfigStore = useProviderConfigStore()
    const record = providerConfigStore.providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID]
    expect(record, 'derived provider record projected').toBeDefined()
    expect(record.definitionId).toBe('openai-compatible-audio-transcription')
    expect(record.config).toEqual({
      baseUrl: 'https://api.groq.com/openai/v1/',
      model: 'whisper-large-v3-turbo',
    })

    // The existing hearing pipeline is pointed at the derived instance.
    const hearingStore = useHearingStore()
    expect(hearingStore.activeTranscriptionProvider).toBe('lia-groq-transcription')
    expect(hearingStore.activeTranscriptionModel).toBe('whisper-large-v3-turbo')

    // ...and the microphone is on, so no Settings visit is needed.
    expect(useSettingsAudioDevice().enabled).toBe(true)
    expect(useLiaHearingStore().projected).toBe(true)
  })

  it('b: the derived id rides the EXISTING openai-compatible definition', async () => {
    // The definition really exists in the live registry: no new STT pipeline.
    expect(getDefinedProvider('openai-compatible-audio-transcription')).toBeDefined()
    expect(LIA_GROQ_TRANSCRIPTION_DEFINITION_ID).toBe('openai-compatible-audio-transcription')

    // And the projection is what puts them together.
    expect(projectSttTarget({ providerId: 'lia-groq-transcription' })).toEqual({
      config: { baseUrl: 'https://api.groq.com/openai/v1/', model: 'whisper-large-v3-turbo' },
      definitionId: 'openai-compatible-audio-transcription',
      providerId: 'lia-groq-transcription',
    })
  })

  it('c: the projected config carries a base url and model, and no credential', async () => {
    ipc.fixture(managedGroqDoc())

    await useLiaHearingStore().initialize()

    const record = useProviderConfigStore().providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID]
    const config = record.config as Record<string, unknown>
    expect(config.baseUrl).toBe('https://api.groq.com/openai/v1/')
    expect(config.model).toBe('whisper-large-v3-turbo')

    const serialized = JSON.stringify(config)
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain(SIMULATED_KEY)
    // The credential is resolved at build time from the vault, not stored.
    expect(Object.keys(config).sort()).toEqual(['baseUrl', 'model'])
  })

  it('d: voice.enabled=false never auto-enables the microphone', async () => {
    ipc.fixture(voiceDisabledDoc())

    await useLiaHearingStore().initialize()

    // The runtime projection still lands (so a later explicit opt-in works),
    // but the microphone stays off: text-only mode is respected absolutely.
    expect(useSettingsAudioDevice().enabled).toBe(false)
    expect(useLiaHearingStore().degradedReason).toBe('voice-disabled')
  })

  it('e: a missing target invents nothing - and specifically no web speech', async () => {
    ipc.fixture({})

    await useLiaHearingStore().initialize()

    const store = useLiaHearingStore()
    const hearingStore = useHearingStore()
    expect(store.projected).toBe(false)
    expect(store.degradedReason).toBe('stt-not-configured')
    expect(hearingStore.activeTranscriptionProvider).toBe('')
    expect(useProviderConfigStore().providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID]).toBeUndefined()
    expect(Object.keys(useProviderConfigStore().providers)).toEqual([])
    // No microphone either: nothing was configured, so nothing is enabled.
    expect(useSettingsAudioDevice().enabled).toBe(false)
  })

  it('f: a non-groq canonical target is applied as itself, with no groq projection', async () => {
    // A user or operator who deliberately chose another provider keeps it.
    ipc.fixture({ enabled: true, preferred: { providerId: 'browser-web-speech-api' } })

    await useLiaHearingStore().initialize()

    const providerConfigStore = useProviderConfigStore()
    const record = providerConfigStore.providers['browser-web-speech-api']
    expect(record, 'the chosen provider is projected as its own record').toBeDefined()
    expect(record.definitionId).toBe('browser-web-speech-api')
    // No Groq base URL, no Groq model, nothing derived from another vendor.
    expect(JSON.stringify(record.config)).not.toContain('groq')
    expect(JSON.stringify(record.config)).not.toContain('baseUrl')
    expect(useHearingStore().activeTranscriptionProvider).toBe('browser-web-speech-api')
    // The derived Groq record is never created as a side effect.
    expect(providerConfigStore.providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID]).toBeUndefined()
  })

  it('g: initialization is idempotent', async () => {
    ipc.fixture(managedGroqDoc())
    const store = useLiaHearingStore()

    await store.initialize()
    const first = JSON.parse(JSON.stringify(useProviderConfigStore().providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID]))
    const providerStore = useProviderStore()
    const dispose = vi.spyOn(providerStore, 'disposeProviderInstance')

    await store.initialize()
    await store.initialize()

    expect(useProviderConfigStore().providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID]).toEqual(first)
    // Nothing stale to rebuild: the identical projection disposes nothing.
    expect(dispose).not.toHaveBeenCalled()
    expect(useSettingsAudioDevice().enabled).toBe(true)
    dispose.mockRestore()
  })

  it('h: the microphone is enabled once and no watcher re-enables it', async () => {
    ipc.fixture(managedGroqDoc())
    const store = useLiaHearingStore()
    const audio = useSettingsAudioDevice()

    await store.initialize()
    expect(audio.enabled).toBe(true)

    // The user deliberately turns the microphone off mid-session.
    audio.enabled = false

    // Bootstrap again: a stale re-run must not fight that choice.
    await store.initialize()
    expect(audio.enabled).toBe(false)

    // Structural proof: the store installs no watcher at all, so nothing can
    // re-assert the microphone after this turn ends.
    const source = await hearingStoreCode()
    expect(source).not.toMatch(/\bwatch\s*\(/)
    expect(source).not.toMatch(/\bwatchEffect\s*\(/)
    expect(source).not.toMatch(/\bwatchPostEffect\s*\(/)
    expect(source).not.toMatch(/\bstoreToRefs\s*\(/)
  })

  it('i: a changed canonical target disposes the stale instance and rebuilds it', async () => {
    ipc.fixture(managedGroqDoc('whisper-large-v3-turbo'))
    const store = useLiaHearingStore()
    const providerStore = useProviderStore()
    const dispose = vi.spyOn(providerStore, 'disposeProviderInstance')

    await store.initialize()
    expect(useProviderConfigStore().providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID].config)
      .toMatchObject({ model: 'whisper-large-v3-turbo' })
    expect(dispose).not.toHaveBeenCalled()

    // The Launcher (or the user through the Launcher) changed the target.
    ipc.fixture(managedGroqDoc('whisper-large-v3'))
    await store.initialize()

    // The cached instance is disposed first, so the old endpoint cannot linger.
    expect(dispose).toHaveBeenCalledWith('lia-groq-transcription')
    expect(useProviderConfigStore().providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID].config)
      .toMatchObject({ model: 'whisper-large-v3' })
    expect(useHearingStore().activeTranscriptionModel).toBe('whisper-large-v3')
    dispose.mockRestore()
  })

  it('j: a projection failure degrades instead of throwing', async () => {
    // A target naming a definition that does not exist cannot be built.
    ipc.fixture({ enabled: true, preferred: { providerId: 'no-such-transcription-provider' } })

    await expect(useLiaHearingStore().initialize()).resolves.toBeUndefined()

    const store = useLiaHearingStore()
    expect(store.projected).toBe(false)
    expect(typeof store.degradedReason).toBe('string')
    // The failure never reaches the user as a broken microphone switch.
    expect(useSettingsAudioDevice().enabled).toBe(false)
  })
})

/**
 * Phase 8.0D SHELL-B1.1: the managed microphone bootstrap.
 *
 * The shipped B1 assigned `enabled = true` directly. That fires the store's
 * watcher while permission is still unrequested and the device list is still
 * anonymous, so `getUserMedia` fails and the store reverts `enabled`, and the
 * one-shot flag was already consumed - the microphone stayed dead for the whole
 * session. These gates pin the corrected contract: the same functional
 * preconditions as the proven manual path, and a one-shot consumed only by
 * success.
 */
describe('managed microphone bootstrap (Phase 8.0D SHELL-B1.1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    ipc.fixture({})
    vi.clearAllMocks()
    media.healthy()
  })

  it('gate 1: permission already granted with a usable input enables the microphone', async () => {
    ipc.fixture(managedGroqDoc())
    media.permissionGranted = true

    await useLiaHearingStore().initialize()

    expect(useSettingsAudioDevice().enabled).toBe(true)
    expect(useLiaHearingStore().microphoneReady).toBe(true)
    // The stream was really started, not merely flagged.
    expect(media.startCalls).toBeGreaterThan(0)
  })

  it('gate 2: a missing permission triggers the handshake before any enable attempt', async () => {
    ipc.fixture(managedGroqDoc())
    expect(media.permissionGranted, 'not granted at boot').toBe(false)
    const events = captureDiagnostics()

    await useLiaHearingStore().initialize()

    expect(media.handshakeCalls).toBe(1)
    const handshake = events.indexOf('microphone-handshake-attempted')
    const enable = events.indexOf('microphone-enable-attempted')
    expect(handshake, 'handshake attempted').toBeGreaterThanOrEqual(0)
    expect(enable, 'enable attempted').toBeGreaterThanOrEqual(0)
    expect(handshake, 'handshake precedes enable').toBeLessThan(enable)
  })

  it('gate 3: a permission granted by the handshake leads to an enabled microphone', async () => {
    ipc.fixture(managedGroqDoc())
    expect(media.permissionGranted, 'not granted at boot').toBe(false)

    await useLiaHearingStore().initialize()

    expect(media.permissionGranted, 'the handshake granted it').toBe(true)
    expect(useSettingsAudioDevice().enabled).toBe(true)
    expect(useLiaHearingStore().microphoneReady).toBe(true)
  })

  it('gate 4: a permission that stays denied never announces a ready microphone', async () => {
    ipc.fixture(managedGroqDoc())
    media.handshakeFailure = { message: 'Permission denied by user', name: 'NotAllowedError' }

    await useLiaHearingStore().initialize()

    const store = useLiaHearingStore()
    expect(store.microphoneReady).toBe(false)
    expect(useSettingsAudioDevice().enabled).toBe(false)
    expect(store.degradedReason).toBe('microphone-permission-denied')
    // The runtime projection still landed, so text conversation is untouched.
    expect(store.projected).toBe(true)
  })

  it('gate 4b: a handshake that resolves without granting is still not a ready microphone', async () => {
    ipc.fixture(managedGroqDoc())
    media.handshakeGrants = false

    await useLiaHearingStore().initialize()

    const store = useLiaHearingStore()
    expect(store.microphoneReady).toBe(false)
    expect(useSettingsAudioDevice().enabled).toBe(false)
    expect(store.degradedReason).toBe('microphone-permission-denied')
  })

  it('gate 5: a first stream failure does not consume the one-shot', async () => {
    ipc.fixture(managedGroqDoc())
    media.startFailure = { message: 'Requested device not found', name: 'NotFoundError' }

    await useLiaHearingStore().initialize()

    const store = useLiaHearingStore()
    expect(store.microphoneReady).toBe(false)
    expect(useSettingsAudioDevice().enabled).toBe(false)
    expect(store.degradedReason).toBe('microphone-stream-failed')
  })

  it('gate 6: a later initialization succeeds after a transient first failure', async () => {
    ipc.fixture(managedGroqDoc())
    const store = useLiaHearingStore()
    media.startFailure = { message: 'Requested device not found', name: 'NotFoundError' }

    await store.initialize()
    expect(useSettingsAudioDevice().enabled, 'first attempt failed').toBe(false)

    // The device appeared / the prompt was accepted: the retry must work.
    media.startFailure = undefined
    await store.initialize()

    expect(useSettingsAudioDevice().enabled).toBe(true)
    expect(store.microphoneReady).toBe(true)
    expect(store.degradedReason).toBeUndefined()
  })

  it('gate 7: voice.enabled=false never reaches the microphone handshake', async () => {
    ipc.fixture(voiceDisabledDoc())

    await useLiaHearingStore().initialize()

    expect(media.handshakeCalls).toBe(0)
    expect(useSettingsAudioDevice().enabled).toBe(false)
    expect(useLiaHearingStore().microphoneReady).toBe(false)
    expect(useLiaHearingStore().degradedReason).toBe('voice-disabled')
  })

  it('gate 8: a deliberate mic-off after bootstrap survives later initialization', async () => {
    ipc.fixture(managedGroqDoc())
    const store = useLiaHearingStore()
    const audio = useSettingsAudioDevice()

    await store.initialize()
    expect(audio.enabled).toBe(true)

    audio.enabled = false
    const handshakesBefore = media.handshakeCalls
    await store.initialize()

    expect(audio.enabled, 'the user choice is not overridden').toBe(false)
    expect(media.handshakeCalls, 'not even re-handshaked').toBe(handshakesBefore)
    expect(store.microphoneReady).toBe(true)
  })

  it('gate 9: a missing canonical target still invents no fallback provider', async () => {
    ipc.fixture({})
    const events = captureDiagnostics()

    await useLiaHearingStore().initialize()

    expect(Object.keys(useProviderConfigStore().providers)).toEqual([])
    expect(media.handshakeCalls).toBe(0)
    expect(useSettingsAudioDevice().enabled).toBe(false)
    expect(useLiaHearingStore().degradedReason).toBe('stt-not-configured')
    expect(events).not.toContain('microphone-handshake-attempted')
  })

  it('gate 10: no credential or device identity reaches the diagnostics log', async () => {
    ipc.fixture(managedGroqDoc(), { groq: SIMULATED_KEY })
    const logged: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logged.push(typeof message === 'string' ? message : String(message))
    })

    await useLiaHearingStore().initialize()

    const allLogs = logged.join('\n')
    // Positive first: the diagnostics really ran, so the negatives are not vacuous.
    expect(allLogs).toContain('[LIA-HEARING]')
    expect(allLogs).not.toContain(SIMULATED_KEY)
    expect(allLogs).not.toContain('apiKey')
    // Neither a device id nor a device label.
    expect(allLogs).not.toContain('default')
    expect(allLogs).not.toContain('Simulated Microphone')

    const record = useProviderConfigStore().providers[LIA_GROQ_TRANSCRIPTION_PROVIDER_ID]
    expect(JSON.stringify(record.config)).not.toContain(SIMULATED_KEY)
  })

  it('gate 11: the diagnostics trail covers every stage the next windows run needs', async () => {
    ipc.fixture(managedGroqDoc())
    const events = captureDiagnostics()

    await useLiaHearingStore().initialize()

    for (const event of [
      'canonical-target-received',
      'initialize-complete',
      'initialize-started',
      'microphone-enable-attempted',
      'microphone-handshake-attempted',
      'microphone-preconditions',
      'microphone-ready',
      'projection-completed',
    ])
      expect(events, `${event} was logged`).toContain(event)
  })

  it('gate 12: a raw failure message is sanitized before it is logged', async () => {
    ipc.fixture(managedGroqDoc())
    media.startFailure = {
      message: 'capture failed for https://api.groq.com/openai/v1/ using gsk-ABCDEFGHIJKLMNOP1234567890 on device 0123456789abcdef0123456789abcdef',
      name: 'NotReadableError',
    }
    const logged: string[] = []
    vi.spyOn(console, 'info').mockImplementation((message?: unknown) => {
      logged.push(typeof message === 'string' ? message : String(message))
    })

    await useLiaHearingStore().initialize()

    const allLogs = logged.join('\n')
    expect(allLogs).toContain('NotReadableError')
    expect(allLogs).not.toContain('api.groq.com')
    expect(allLogs).not.toContain('gsk-ABCDEFGHIJKLMNOP1234567890')
    expect(allLogs).not.toContain('0123456789abcdef0123456789abcdef')
  })
})

/**
 * §26/§12 boundary: this store configures the pipeline and stops there. It must
 * never become a second voice-send path.
 */
describe('managed hearing scope boundary (Phase 8.0D SHELL-B1)', () => {
  it('the store owns no chat send, no brain call and no config write', async () => {
    const source = await hearingStoreCode()

    expect(source).not.toMatch(/\bchatStore\b/)
    expect(source).not.toMatch(/\.send\s*\(/)
    expect(source).not.toMatch(/useChatStore/)
    // No Brain calls either.
    expect(source).not.toMatch(/useConsciousnessStore/)
    // And it never becomes a writer of canonical config.
    expect(source).not.toMatch(/electronLiaHearingConfigSet/)
    expect(source).not.toMatch(/updateLiaProductConfig/)
  })

  it('the D2B12 voice-send sequence stays where it was, in the stage page', async () => {
    // Positive coupling: the transcript buffer and the single voice turn still
    // belong to `pages/index.vue`, so B1 configured the pipeline without moving
    // or duplicating the send path.
    const { readFileSync } = await import('node:fs')
    const page = stripComments(
      readFileSync(new URL('../../pages/index.vue', import.meta.url), 'utf-8'),
    )
    expect(page).toContain('flushDelayMs: 1200')
    expect(page).toContain('maxBufferedTextLength: 90')
  })
})
