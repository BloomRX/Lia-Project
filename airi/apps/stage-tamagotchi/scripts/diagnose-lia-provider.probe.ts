import process from 'node:process'

import { writeFileSync } from 'node:fs'

import { getProviderCredentialResolver, registerProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

/**
 * Runtime half of `DiagnoseLiaProvider.ps1` (sections 5-10).
 *
 * Exercises the REAL provider runtime — the same stores, provider definitions
 * and transport the app uses — with a deliberately FAKE credential and with
 * `globalThis.fetch` intercepted, so no request ever leaves the machine and no
 * real key is involved. Nothing is persisted: the vault is a mock, the pinia
 * instance is local to this process, and the provider config store has no
 * backing localStorage here.
 *
 * Only booleans, ids, lengths and endpoint paths are recorded. A secret value,
 * an Authorization header value and a full header map are never printed.
 *
 * Not collected by the regular suites: `vitest.node.config.ts` includes only
 * `**\/*.test.ts`, while this file is included solely by
 * `vitest.diagnose.config.ts`.
 */

export interface RuntimeDiagnosis {
  providerId: string
  modelId: string
  providerExists: boolean
  providerStatus: string | null
  providerConfigExists: boolean
  resolverRegistered: boolean
  resolvedCredentialAvailable: boolean
  instanceCreated: boolean
  instanceProvider: string | null
  instanceModel: string | null
  factorySawCredential: boolean
  listModelsCalled: boolean
  credentialReachedListModels: boolean
  getChatProviderInstanceCalled: boolean
  credentialReachedChat: boolean
  requests: Array<{
    method: string
    endpoint: string
    hasAuthorizationHeader: boolean
    authorizationHeaderLength: number
  }>
  notes: string[]
}

const providerId = process.env.LIA_DIAG_PROVIDER_ID ?? ''
const modelId = process.env.LIA_DIAG_MODEL_ID ?? ''

const FAKE_SECRET = 'diag-fake-credential-not-a-real-key'

/**
 * Filled in by the test body before anything runs.
 *
 * `vi.hoisted` executes before this module's imports are initialized, so the
 * hoisted mocks cannot read the `node:process` import themselves. The test body
 * populates this holder, and the mocks close over it.
 */
const diagEnv = vi.hoisted(() => ({
  providerId: '',
  modelId: '',
  hasSecret: false,
  // Same literal as FAKE_SECRET below; it is repeated here only because this
  // block cannot reference a module-level const. Keep the two in sync.
  fakeSecret: 'diag-fake-credential-not-a-real-key',
}))

const ipc = vi.hoisted(() => {
  const chat = {
    onboarded: true,
    strategy: 'manual' as const,
    preferred: {
      providerId: '',
      modelId: '',
    },
    fallback: [],
    fallbackEnabled: true,
  }

  return {
    chat,
    getChatConfig: vi.fn(async () => structuredClone({ ...chat, preferred: { ...chat.preferred, providerId: diagEnv.providerId, modelId: diagEnv.modelId } })),
    saveChatConfig: vi.fn(async () => {}),
    encryptionAvailable: vi.fn(async () => true),
    secretHas: vi.fn(async () => diagEnv.hasSecret),
    secretSet: vi.fn(async () => true),
    secretGet: vi.fn(async () => (diagEnv.hasSecret ? diagEnv.fakeSecret : undefined)),
    secretDelete: vi.fn(async () => true),
  }
})

/** Records whether a provider factory was handed a credential. Values are dropped. */
const factory = vi.hoisted(() => ({
  sawCredential: false,
  calls: 0,
}))

vi.mock('@xsai-ext/providers/create', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const wrapped: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(actual)) {
    wrapped[name] = typeof value === 'function'
      ? (...args: unknown[]) => {
          factory.calls += 1
          const first = args[0]
          if (typeof first === 'string' && first.length > 0)
            factory.sawCredential = true
          return (value as (...a: unknown[]) => unknown)(...args)
        }
      : value
  }
  return wrapped
})

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const handlers: Record<string, unknown> = {
      'eventa:invoke:lia:provider:chat:config:get-receive': ipc.getChatConfig,
      'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
      'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
      'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
      'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
      'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
      'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
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

const { useLiaProviderStore } = await import('../src/renderer/stores/lia/provider')

/** Origin + pathname only: no query string, no token, no credentials. */
function safeEndpoint(input: string | URL | Request): string {
  try {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return `${url.origin}${url.pathname}`
  }
  catch {
    return '<unparsable-url>'
  }
}

function headerSnapshot(init: RequestInit | undefined, request: Request | undefined) {
  const source = init?.headers ?? request?.headers
  if (!source)
    return { has: false, length: 0 }

  const entries = source instanceof Headers
    ? source.entries()
    : Array.isArray(source)
      ? source
      : Object.entries(source as Record<string, string>)

  for (const [name, value] of entries) {
    if (name.toLowerCase() === 'authorization')
      return { has: String(value).length > 0, length: String(value).length }
  }

  return { has: false, length: 0 }
}

describe('lia provider runtime diagnosis', () => {
  it('traces the credential from the resolver to the outgoing request', async () => {
    const result: RuntimeDiagnosis = {
      providerId,
      modelId,
      providerExists: false,
      providerStatus: null,
      providerConfigExists: false,
      resolverRegistered: false,
      resolvedCredentialAvailable: false,
      instanceCreated: false,
      instanceProvider: null,
      instanceModel: null,
      factorySawCredential: false,
      listModelsCalled: false,
      credentialReachedListModels: false,
      getChatProviderInstanceCalled: false,
      credentialReachedChat: false,
      requests: [],
      notes: [],
    }

    if (!providerId) {
      result.notes.push('no preferred provider id in the Lia product config; nothing to trace')
      writeFileSync(process.env.LIA_DIAG_OUT ?? 'lia-diag-runtime.json', JSON.stringify(result, null, 2))
      expect(result.notes.length).toBeGreaterThan(0)
      return
    }

    setActivePinia(createPinia())
    resetChatProviderRuntimeExtensionsForTesting()
    factory.sawCredential = false
    factory.calls = 0

    // Intercept every outbound request. Nothing reaches the network.
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const authorization = headerSnapshot(init, input instanceof Request ? input : undefined)
      result.requests.push({
        method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
        endpoint: safeEndpoint(input),
        hasAuthorizationHeader: authorization.has,
        authorizationHeaderLength: authorization.length,
      })
      return Response.json({ data: [{ id: 'diag-model' }], object: 'list' })
    }) as typeof fetch

    try {
      const store = useLiaProviderStore()
      const consciousness = useConsciousnessStore()
      diagEnv.providerId = providerId
      diagEnv.modelId = modelId
      diagEnv.hasSecret = process.env.LIA_DIAG_HAS_SECRET === 'true'

      const providers = useProviderStore()
      const providerConfigs = useProviderConfigStore()

      store.registerRuntimeExtensions()

      // Counting spy that delegates to the real resolver; it never sees a value
      // it did not already have.
      const realResolver = getProviderCredentialResolver()
      result.resolverRegistered = typeof realResolver === 'function'
      const chatCalls: string[] = []
      const listingCalls: string[] = []
      let bucket = chatCalls
      registerProviderCredentialResolver(async (id: string) => {
        bucket.push(id)
        // Faithful to production when the app registered its own resolver. The
        // fake credential only stands in when it did not, so the plumbing from
        // resolver to request can still be proven without touching a real vault.
        return realResolver ? realResolver(id) : { apiKey: FAKE_SECRET }
      })

      // Deliberately calls the production resolver rather than the wrapper
      // above, so this probe call is not counted as a chat or listing call.
      const resolved = realResolver ? await realResolver(providerId) : { apiKey: FAKE_SECRET }
      result.resolvedCredentialAvailable = Boolean(
        resolved && typeof resolved === 'object' && typeof (resolved as { apiKey?: unknown }).apiKey === 'string'
        && ((resolved as { apiKey: string }).apiKey).length > 0,
      )

      const activated = await store.activateConfiguredProvider()
      result.providerExists = providerConfigs.getProvider(providerId) !== undefined
      result.providerStatus = providerConfigs.getProvider(providerId)?.status ?? null
      result.providerConfigExists = providerConfigs.configs[providerId] !== undefined
      if (!activated)
        result.notes.push('activateConfiguredProvider() returned false: the config is not ready (provider, model or credential)')

      // Model listing path.
      bucket = listingCalls
      result.listModelsCalled = true
      await providers.fetchModelsForProvider(providerId).catch((error: unknown) => {
        result.notes.push(`fetchModelsForProvider threw: ${error instanceof Error ? error.name : 'unknown'}`)
      })
      result.credentialReachedListModels = listingCalls.includes(providerId)

      // Chat instance path.
      bucket = chatCalls
      result.getChatProviderInstanceCalled = true
      factory.sawCredential = false
      try {
        const instance = await consciousness.getChatProviderInstance(providerId)
        result.instanceCreated = instance !== undefined && instance !== null
        result.instanceProvider = consciousness.activeProvider || null
        result.instanceModel = consciousness.activeModel || null
      }
      catch (error) {
        result.notes.push(`getChatProviderInstance threw: ${error instanceof Error ? error.name : 'unknown'}`)
      }
      result.credentialReachedChat = chatCalls.includes(providerId)
      result.factorySawCredential = factory.sawCredential

      if (consciousness.activeProvider && consciousness.activeProvider !== providerId) {
        result.notes.push(`runtime activeProvider is "${consciousness.activeProvider}" but the Lia config prefers "${providerId}"`)
      }
    }
    finally {
      globalThis.fetch = realFetch
      writeFileSync(process.env.LIA_DIAG_OUT ?? 'lia-diag-runtime.json', JSON.stringify(result, null, 2))
    }

    expect(result.providerId).toBe(providerId)
  })
})
