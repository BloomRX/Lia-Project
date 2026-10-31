import type { LiaProviderValidationSource } from './provider-validation'

import { PiniaColada } from '@pinia/colada'
import { registerProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useLiaProviderRuntime } from './provider-runtime'
import { createLiaProviderValidation, useLiaProviderValidation } from './provider-validation'

/**
 * E3 — the validation port delegates, and the shared validators still decide.
 *
 * Three questions, and the third is the one that matters:
 *
 *  1. **Does it delegate?** Over a recording double, `validate` must forward the
 *     id, the draft config and the optional switches, and hand back the delegate's
 *     result untouched — same object, same thrown error.
 *  2. **Do the validators still come from the provider definition?** The same
 *     empty config must be `valid` for a definition with no validators and
 *     `invalid` for one that requires a key, with the definition's own message.
 *     A Lia-side copy of the rules could not produce that difference.
 *  3. The editor now uses a selected-model text probe (provider-models.test.ts).
 *     The last cases here guard against treating these historical validators
 *     as approval of a missing model or returning raw reasons to the editor.
 *
 * Credentials, deliberately: the shared operation does **not** use the credential
 * resolver that `getProviderInstance` uses — it builds its validation instance
 * straight from the config it is given, and the Lia's call site is what puts the
 * vault key into that config. The test below pins that, so a later "helpful"
 * resolver hop in the port would be caught instead of silently changing which key
 * the validators test.
 *
 * No network: `fetch` is stubbed, and every test asserts the file issued no
 * request. The invalid paths fail on their config validators before any provider
 * validator runs, which is what keeps them offline and deterministic.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md and the
 * B0.9 dependency map, section 6, candidate P2.
 */

/** No validators, `validationRequiredWhen` false: the deterministic valid path. */
const NO_VALIDATOR_PROVIDER = 'speech-noop'

/** Requires an API key; its config validator fails before any network call. */
const CREDENTIALED_PROVIDER = 'groq'

const UNKNOWN_PROVIDER = 'e3-no-such-provider'

/** Deliberately fake. Never a real key, and never expected in any output. */
const FAKE_KEY = 'sk-lia-e3-fake-not-a-real-key'

/** Passes nothing and documents the shape the shared store returns. */
type ValidationResult = Awaited<ReturnType<ReturnType<typeof useProviderStore>['validateProviderConfig']>>

const observed = vi.hoisted(() => ({
  requests: [] as string[],
}))

const ipc = vi.hoisted(() => ({
  chatConfig: vi.fn(async () => ({})),
  encryptionAvailable: vi.fn(async () => true),
  saveChatConfig: vi.fn(async () => {}),
  secretDelete: vi.fn(async () => true),
  secretGet: vi.fn(async () => undefined),
  secretHas: vi.fn(async () => false),
  secretSet: vi.fn(async () => true),
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

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const { useLiaProviderStore } = await import('./provider')

function installStores() {
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    observed.requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }))
}

beforeEach(() => {
  observed.requests = []
  vi.clearAllMocks()
  stubFetch()
})

afterEach(() => {
  expect(observed.requests, 'validation must not introduce requests of its own').toEqual([])
  resetChatProviderRuntimeExtensionsForTesting()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lia provider validation — it only delegates', () => {
  /** The double is not the store: it records what the port forwarded. */
  function createSource(result: ValidationResult) {
    const source = {
      // The parameters are declared so the recorded call is typed: without them
      // the mock's call tuple is empty and the by-reference check below cannot
      // be expressed.
      validateProviderConfig: vi.fn(async (
        _providerId: string,
        _config: Record<string, unknown>,
        _options?: { onlyChatPingCheck?: boolean, skipChatPingCheck?: boolean },
      ) => result),
    }
    return { source, runtime: createLiaProviderValidation(source as unknown as LiaProviderValidationSource) }
  }

  it('forwards the provider id and the draft config', async () => {
    const { runtime, source } = createSource({ errors: [], reason: '', valid: true })
    const config = { apiKey: FAKE_KEY, baseUrl: 'https://e3.invalid/v1' }

    await runtime.validate(CREDENTIALED_PROVIDER, config)

    expect(source.validateProviderConfig).toHaveBeenCalledExactlyOnceWith(CREDENTIALED_PROVIDER, config, undefined)
    // The draft is passed by reference, not copied: a copy would be invisible to
    // `toStrictEqual` and could still change which key the validators test.
    expect(source.validateProviderConfig.mock.calls[0][1]).toBe(config)
  })

  it('forwards the optional chat-ping switches when a caller supplies them', async () => {
    const { runtime, source } = createSource({ errors: [], reason: '', valid: true })

    await runtime.validate(CREDENTIALED_PROVIDER, {}, { skipChatPingCheck: true })

    expect(source.validateProviderConfig).toHaveBeenCalledExactlyOnceWith(
      CREDENTIALED_PROVIDER,
      {},
      { skipChatPingCheck: true },
    )
  })

  it('hands back the delegate result untouched', async () => {
    const result: ValidationResult = {
      errors: [new Error('e3-delegate-reason')],
      reason: 'e3-delegate-reason',
      valid: false,
    }
    const { runtime } = createSource(result)

    // Identity, not equality: no re-shaping of the classification on the way out.
    expect(await runtime.validate(CREDENTIALED_PROVIDER, {})).toBe(result)
  })

  it('propagates a thrown validation error instead of turning it into a result', async () => {
    const source = {
      validateProviderConfig: vi.fn(async () => {
        throw new Error('e3-delegate-failure')
      }),
    }
    const runtime = createLiaProviderValidation(source as unknown as LiaProviderValidationSource)

    await expect(runtime.validate(CREDENTIALED_PROVIDER, {})).rejects.toThrow('e3-delegate-failure')
  })
})

describe('lia provider validation — the shared validators still decide', () => {
  it('classifies a provider with no validators as valid, without reaching the network', async () => {
    installStores()
    const validation = useLiaProviderValidation()

    const result = await validation.validate(NO_VALIDATOR_PROVIDER, {})

    expect(result.valid).toBe(true)
    expect(result.reason).toBe('')
    expect(result.errors).toEqual([])
    expect(observed.requests).toEqual([])
  })

  it('classifies a credentialed provider as invalid and carries the definition message', async () => {
    installStores()
    const validation = useLiaProviderValidation()

    const result = await validation.validate(CREDENTIALED_PROVIDER, {})

    expect(result.valid).toBe(false)
    // The wording belongs to the provider definition, not to the Lia.
    expect(result.reason).toContain('API key is required.')
    expect(result.errors.length).toBeGreaterThan(0)
    // The config validator fails first, so no provider validator runs and no
    // instance is built — that is what keeps this path offline.
    expect(observed.requests).toEqual([])
  })

  it('gives the same verdict and the same text as the direct call', async () => {
    // Port side.
    installStores()
    const throughPort = await useLiaProviderValidation().validate(CREDENTIALED_PROVIDER, {})

    // Same call, straight on the store, in its own Pinia.
    installStores()
    const directly = await useProviderStore().validateProviderConfig(CREDENTIALED_PROVIDER, {})

    expect(throughPort.valid).toBe(directly.valid)
    expect(throughPort.reason).toBe(directly.reason)
    expect(throughPort.errors.map(error => error.message)).toEqual(directly.errors.map(error => error.message))
  })

  it('writes nothing to the configuration store while validating', async () => {
    installStores()
    const config = useProviderConfigStore()
    const validation = useLiaProviderValidation()

    const dispatches: string[] = []
    config.$onAction(({ name }) => {
      dispatches.push(name)
    })

    await validation.validate(CREDENTIALED_PROVIDER, {})
    await validation.validate(NO_VALIDATOR_PROVIDER, {})

    // Validation reads the definitions and the metadata. It persists nothing and
    // replicates nothing, and the record set is untouched.
    expect(dispatches).toEqual([])
    expect(config.providers[CREDENTIALED_PROVIDER]).toBeUndefined()

    // Positive control: the observer is live, so the empty list above means
    // "validation dispatched nothing", not "the listener never attached".
    config.ensureProvider(CREDENTIALED_PROVIDER, CREDENTIALED_PROVIDER, {})
    expect(dispatches).toEqual(['ensureProvider'])
  })

  it('propagates an unknown provider instead of reporting it as invalid', async () => {
    installStores()
    const validation = useLiaProviderValidation()

    await expect(validation.validate(UNKNOWN_PROVIDER, {}))
      .rejects
      .toThrow(`Provider definition for ${UNKNOWN_PROVIDER} not found`)
  })
})

describe('lia provider validation — credentials', () => {
  it('does not consult the credential resolver, because the shared operation does not', async () => {
    installStores()
    const validation = useLiaProviderValidation()
    const resolver = vi.fn(async () => ({ apiKey: FAKE_KEY }))
    registerProviderCredentialResolver(resolver)

    const result = await validation.validate(CREDENTIALED_PROVIDER, {})

    // Still invalid: a resolver-registered key reaches `getProviderInstance`,
    // never the validators. The Lia's call site supplies the key itself.
    expect(result.valid).toBe(false)
    expect(resolver).not.toHaveBeenCalled()

    // Positive control: the same resolver *is* reached on the instance path, so
    // the assertion above is about validation, not about a dead registration.
    await useLiaProviderRuntime().getInstance(NO_VALIDATOR_PROVIDER)
    expect(resolver).toHaveBeenCalledWith(NO_VALIDATOR_PROVIDER)
    expect(observed.requests).toEqual([])
  })

  it('keeps a supplied key out of the result, and out of the store state', async () => {
    installStores()
    const validation = useLiaProviderValidation()

    // A malformed base URL fails the config validator, so the key never reaches
    // any provider validator — and the result must not echo it either.
    const result = await validation.validate(CREDENTIALED_PROVIDER, {
      apiKey: FAKE_KEY,
      baseUrl: 'not a url',
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Base URL is invalid')
    expect(result.reason).not.toContain(FAKE_KEY)
    expect(JSON.stringify(result.errors)).not.toContain(FAKE_KEY)
    expect(JSON.stringify(useProviderConfigStore().$state)).not.toContain(FAKE_KEY)
    expect(observed.requests).toEqual([])
  })
})

describe('lia provider connection — selected-model probe is separate from definition validation', () => {
  it('does not approve a model merely because a definition has no validators', async () => {
    installStores()
    const store = useLiaProviderStore()

    const result = await store.testConnection({ providerId: NO_VALIDATOR_PROVIDER })

    expect(result).toStrictEqual({ ok: false, scope: 'text', failure: 'configuration', message: '' })
    // No key was supplied, so the call site asked the vault — and the vault had
    // nothing. That is the existing lookup, unchanged.
    expect(ipc.secretGet).toHaveBeenCalled()
    expect(observed.requests).toEqual([])
  })

  it('reports a safe configuration failure without exposing the definition reason', async () => {
    installStores()
    const store = useLiaProviderStore()

    const result = await store.testConnection({
      apiKey: FAKE_KEY,
      modelId: 'manual/model',
      baseUrl: 'not a url',
      providerId: CREDENTIALED_PROVIDER,
    })

    expect(result.ok).toBe(false)
    expect(result.failure).toBe('configuration')
    expect(result.message).toBe('')
    // The sanitized message the UI shows carries no secret.
    expect(result.message).not.toContain(FAKE_KEY)
    expect(observed.requests).toEqual([])
  })

  it('turns a thrown validation error into a sanitized failure, not a crash', async () => {
    installStores()
    const store = useLiaProviderStore()

    const result = await store.testConnection({ apiKey: FAKE_KEY, modelId: 'manual/model', providerId: UNKNOWN_PROVIDER })

    expect(result.ok).toBe(false)
    expect(result.failure).toBe('configuration')
    expect(result.message).toBe('')
    expect(result.message).not.toContain(FAKE_KEY)
  })
})
