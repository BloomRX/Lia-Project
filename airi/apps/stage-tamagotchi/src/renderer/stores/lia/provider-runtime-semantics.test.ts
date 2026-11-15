import type { InferenceServiceProvider } from '@proj-airi/stage-ui/libs/providers/types'
import type { ChatProvider, SpeechProvider } from '@xsai-ext/providers/utils'

import { PiniaColada } from '@pinia/colada'
import { defineProvider } from '@proj-airi/stage-ui/libs/providers/providers/registry'
import { registerProviderCredentialResolver, resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore, withResolvedCredential } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import { z } from 'zod'

/**
 * E1 — the observable semantics of `getProviderInstance`, pinned before the
 * Lia grows a `LiaProviderRuntime` port over it.
 *
 * `getProviderInstance` is not a getter. It reads the credential, may create a
 * configuration record as a side effect, resolves a per-build secret, applies
 * schema defaults, builds an instance and caches it. A port written from a
 * memory of that would preserve the return value and silently change the
 * effects, so this file fixes the effects themselves:
 *
 *   - E1-A, a provider that needs no credentials: the record is created from
 *     the definition defaults, the instance is built from it, and a cached
 *     instance short-circuits before any of that.
 *   - E1-B, a provider that needs credentials: an absent record is an error and
 *     creates nothing, while a present record builds without touching the store.
 *   - E1-C, the credential: what the resolver supplies wins over the stored
 *     config and over a declared schema default, the stored record is not a
 *     destination for the secret, and a resolver failure is not swallowed.
 *   - E1-D, cache and disposal: identity while cached, a new build and a new
 *     credential resolution after disposal, and no caching of failures.
 *
 * Deliberately narrow, per the E1 charter:
 *
 *   - It changes no production code. Every call below reaches the real shared
 *     stores, unchanged.
 *   - It does not test the Stage as a product. Behaviour that belongs to the
 *     Stage (authentication-owned providers, remote replication) is out.
 *   - No network. `fetch` is stubbed, and every test also asserts that the
 *     whole file issued no request.
 *
 * Two definitions are used. `speech-noop` and `groq` are real, registered
 * definitions, so the credential-free and credentialed paths are exercised
 * against shipped code. Neither lets a test see what `createProvider` received,
 * which is the one thing E1-C is about, so a third definition is registered
 * through the same `defineProvider` registry the shipped definitions use. It is
 * an observation point, not a stand-in for the code under test: the subject of
 * every assertion below is `getProviderInstance`, which is imported unmodified.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md and the
 * B0.9 dependency map, section 7, step E1.
 */

/** Registered with `requiresCredentials: false`. */
const NO_CREDENTIAL_PROVIDER = 'speech-noop'

/** Registered with credentials required. */
const CREDENTIALED_PROVIDER = 'groq'

/** A provider id no definition claims. */
const UNKNOWN_PROVIDER = 'e1-no-such-provider'

/** The definition this file registers to observe what a build is given. */
const FIXTURE_PROVIDER = 'e1-runtime-fixture'

/**
 * Mutable state of the fixture definition. Reset per test so one case cannot
 * leak a counter or a failure flag into the next.
 */
const fixture = {
  provideDispose: true,
  failNextBuild: false,
  builds: 0,
  disposeCalls: 0,
  received: [] as Record<string, unknown>[],
}

const observed = vi.hoisted(() => ({
  requests: [] as string[],
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

/**
 * Declares both fields as schema defaults on purpose: E1-C asserts that a
 * credential supplied for one build is not replaced by the `apiKey` default,
 * while the `baseUrl` default is still materialised.
 */
const fixtureSchema = z.object({
  apiKey: z.string().default('schema-default-key'),
  baseUrl: z.string().default('https://schema-default.invalid/v1/'),
})

defineProvider({
  id: FIXTURE_PROVIDER,
  name: 'E1 fixture',
  nameLocalize: ctx => ctx.t('e1.fixture.name'),
  description: 'Observation point for the E1 semantics of getProviderInstance.',
  descriptionLocalize: ctx => ctx.t('e1.fixture.description'),
  tasks: ['text-to-speech'],
  requiresCredentials: true,
  createProviderConfig: () => fixtureSchema,
  createProvider(config) {
    if (fixture.failNextBuild) {
      fixture.failNextBuild = false
      throw new Error('e1-factory-failure')
    }

    fixture.builds += 1
    fixture.received.push({ ...config })

    const instance = fixture.provideDispose
      ? {
          dispose: async () => {
            fixture.disposeCalls += 1
          },
          speech: () => ({ baseURL: 'https://e1-fixture.invalid/v1/', model: 'e1-fixture' }),
        }
      : {
          speech: () => ({ baseURL: 'https://e1-fixture.invalid/v1/', model: 'e1-fixture' }),
        }

    return instance
  },
})

type ConfigStore = ReturnType<typeof useProviderConfigStore>

/** One action dispatched on the config store, with the arguments it received. */
interface Dispatch {
  name: string
  args: unknown[]
}

/**
 * Installs the same plugins the desktop renderer installs and records every
 * action the config store dispatches.
 *
 * The record is taken with `$onAction`, which observes dispatch without
 * replacing any member, so a path that writes to the store is distinguishable
 * from one that only reads. Reading through `config.providers` below is a plain
 * state access for the same reason: it must not appear in the log.
 */
function installStores() {
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)

  const config = useProviderConfigStore()
  const runtime = useProviderStore()

  const dispatches: Dispatch[] = []
  config.$onAction(({ name, args }) => {
    dispatches.push({ name, args: [...args] })
  })

  return { config, dispatches, runtime }
}

/** Plain, comparable copy of a stored record. */
function readRecord(config: ConfigStore, providerId: string): InferenceServiceProvider | undefined {
  const record = config.providers[providerId]
  return record ? JSON.parse(JSON.stringify(record)) as InferenceServiceProvider : undefined
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    observed.requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }))
}

beforeEach(() => {
  fixture.provideDispose = true
  fixture.failNextBuild = false
  fixture.builds = 0
  fixture.disposeCalls = 0
  fixture.received = []
  observed.requests = []
  stubFetch()
})

afterEach(() => {
  // One invariant for the whole file: building an instance never reaches the
  // upstream API. Anything that did not stub its way out of the network would
  // fail here rather than pass quietly.
  expect(observed.requests, 'no build may issue a request').toEqual([])
  resetChatProviderRuntimeExtensionsForTesting()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('e1-a — a provider that needs no credentials', () => {
  it('creates the record from the definition defaults and returns a working instance', async () => {
    const { config, dispatches, runtime } = installStores()

    const instance = await runtime.getProviderInstance<SpeechProvider>(NO_CREDENTIAL_PROVIDER)

    const record = readRecord(config, NO_CREDENTIAL_PROVIDER)
    expect(record, 'the build must create the record for a credential-free provider').toBeDefined()
    expect(record?.definitionId).toBe(NO_CREDENTIAL_PROVIDER)
    expect(record?.status).toBe('unconfigured')
    expect(record?.configuredBy).toBe('user')
    // `getDefaultProviderConfig` materialises a `baseUrl` placeholder even when
    // the definition declares no schema defaults, so the record is never bare.
    expect(record?.config).toStrictEqual({ baseUrl: '' })

    // The record write is the only store effect, and it carries exactly the
    // defaults the definition yields.
    expect(dispatches).toEqual([
      {
        name: 'ensureProvider',
        args: [NO_CREDENTIAL_PROVIDER, NO_CREDENTIAL_PROVIDER, { baseUrl: '' }],
      },
    ])

    // A returned instance is not enough: it has to be a usable one.
    expect(typeof instance.speech).toBe('function')
  })

  it('does not repeat the record write when the instance is already cached', async () => {
    const { config, dispatches, runtime } = installStores()

    const first = await runtime.getProviderInstance<SpeechProvider>(NO_CREDENTIAL_PROVIDER)
    expect(dispatches).toHaveLength(1)
    const afterFirstBuild = readRecord(config, NO_CREDENTIAL_PROVIDER)

    const second = await runtime.getProviderInstance<SpeechProvider>(NO_CREDENTIAL_PROVIDER)

    expect(second).toBe(first)
    // The cache is consulted before the configuration is, so a repeat is free
    // of store effects — not merely free of a second instance.
    expect(dispatches).toHaveLength(1)
    expect(readRecord(config, NO_CREDENTIAL_PROVIDER)).toStrictEqual(afterFirstBuild)
  })
})

describe('e1-b — a provider that needs credentials', () => {
  it('refuses to build with no record, and never creates one', async () => {
    const { config, dispatches, runtime } = installStores()

    await expect(runtime.getProviderInstance(CREDENTIALED_PROVIDER))
      .rejects
      .toThrow(`Provider credentials for ${CREDENTIALED_PROVIDER} not found`)

    // This is the assertion the port has to preserve: the credentialed path
    // does not paper over a missing record by creating one.
    expect(dispatches).toEqual([])
    expect(readRecord(config, CREDENTIALED_PROVIDER)).toBeUndefined()
    expect(observed.requests).toEqual([])

    // A failure is not cached, so a second attempt takes the same path.
    await expect(runtime.getProviderInstance(CREDENTIALED_PROVIDER)).rejects.toThrow()
    expect(dispatches).toEqual([])
  })

  it('builds from an existing record without calling ensureProvider', async () => {
    const { config, dispatches, runtime } = installStores()
    config.ensureProvider(CREDENTIALED_PROVIDER, CREDENTIALED_PROVIDER, {
      apiKey: 'e1-fake-key-not-a-real-credential',
      baseUrl: 'https://e1.invalid/v1',
    })
    dispatches.length = 0

    const instance = await runtime.getProviderInstance<ChatProvider>(CREDENTIALED_PROVIDER)

    expect(dispatches).toEqual([])
    expect(typeof instance.chat).toBe('function')
  })

  it('treats an empty stored config as a present record', async () => {
    const { config, dispatches, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, {})
    dispatches.length = 0

    await runtime.getProviderInstance(FIXTURE_PROVIDER)

    // Presence of the record is what the credentialed path checks, not whether
    // the record happens to hold a key.
    expect(dispatches).toEqual([])
    expect(fixture.builds).toBe(1)
  })

  it('reports an unknown provider id before any credential lookup', async () => {
    const { dispatches, runtime } = installStores()

    await expect(runtime.getProviderInstance(UNKNOWN_PROVIDER))
      .rejects
      .toThrow(`Provider definition for ${UNKNOWN_PROVIDER} not found`)

    expect(dispatches).toEqual([])
  })
})

describe('e1-c — the credential a build resolves', () => {
  it('leaves the config untouched when no resolver is registered', async () => {
    const stored = { baseUrl: 'https://e1.invalid/v1' }

    const resolved = await withResolvedCredential(CREDENTIALED_PROVIDER, stored)

    // Identity, not equality: with no resolver the stored object is what the
    // factory receives, so nothing downstream can be surprised by a copy.
    expect(resolved).toBe(stored)
  })

  it('merges what the resolver supplies over the stored config', async () => {
    registerProviderCredentialResolver(async () => ({ apiKey: 'from-resolver' }))
    const stored = { apiKey: 'from-record', baseUrl: 'https://e1.invalid/v1' }

    const resolved = await withResolvedCredential(CREDENTIALED_PROVIDER, stored)

    expect(resolved).toStrictEqual({ apiKey: 'from-resolver', baseUrl: 'https://e1.invalid/v1' })
    // The stored object is an input, never a destination.
    expect(stored.apiKey).toBe('from-record')
  })

  it('hands the resolved credential to the factory, and a schema default does not overwrite it', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, {})
    registerProviderCredentialResolver(async () => ({ apiKey: 'from-resolver' }))

    await runtime.getProviderInstance(FIXTURE_PROVIDER)

    expect(fixture.received).toHaveLength(1)
    // The declared `apiKey` default loses to the per-build credential; the
    // declared `baseUrl` default is still materialised. That ordering is the
    // documented contract, and it is what keeps a vault-supplied key from being
    // replaced by a schema placeholder.
    expect(fixture.received[0]).toStrictEqual({
      apiKey: 'from-resolver',
      baseUrl: 'https://schema-default.invalid/v1/',
    })
  })

  it('performs no config write while building from an existing record', async () => {
    const { config, dispatches, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, { baseUrl: 'https://e1.invalid/v1' })
    const before = readRecord(config, FIXTURE_PROVIDER)
    dispatches.length = 0
    registerProviderCredentialResolver(async () => ({ apiKey: 'from-resolver' }))

    await runtime.getProviderInstance(FIXTURE_PROVIDER)

    expect(dispatches).toEqual([])
    expect(readRecord(config, FIXTURE_PROVIDER)).toStrictEqual(before)
    // The secret lives for one build and lands nowhere that is persisted.
    expect(JSON.stringify(config.$state)).not.toContain('from-resolver')
  })

  it('propagates a resolver failure instead of building from the unresolved config', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, {})
    registerProviderCredentialResolver(async () => {
      throw new Error('e1-resolver-failure')
    })

    await expect(runtime.getProviderInstance(FIXTURE_PROVIDER)).rejects.toThrow('e1-resolver-failure')

    // No fallback to the unresolved config: a provider that was supposed to
    // receive a credential is never built without one.
    expect(fixture.builds).toBe(0)
  })
})

describe('e1-d — cache and disposal', () => {
  it('returns the same instance for the same provider id', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, {})

    const first = await runtime.getProviderInstance(FIXTURE_PROVIDER)
    const second = await runtime.getProviderInstance(FIXTURE_PROVIDER)

    expect(second).toBe(first)
    expect(fixture.builds).toBe(1)
  })

  it('drops the instance on disposal and resolves the credential again', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, {})
    const resolverCalls: string[] = []
    registerProviderCredentialResolver(async (providerId: string) => {
      resolverCalls.push(providerId)
      return { apiKey: 'from-resolver' }
    })

    const first = await runtime.getProviderInstance(FIXTURE_PROVIDER)
    const recordBefore = readRecord(config, FIXTURE_PROVIDER)

    await runtime.disposeProviderInstance(FIXTURE_PROVIDER)
    expect(fixture.disposeCalls).toBe(1)

    const second = await runtime.getProviderInstance(FIXTURE_PROVIDER)

    expect(second).not.toBe(first)
    expect(fixture.builds).toBe(2)
    // The point of disposal is a fresh credential, not just a fresh object.
    expect(resolverCalls).toHaveLength(2)
    // Disposal releases the instance; it is not a configuration change.
    expect(readRecord(config, FIXTURE_PROVIDER)).toStrictEqual(recordBefore)
  })

  it('drops the instance even when it has no dispose hook', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, {})
    fixture.provideDispose = false

    const first = await runtime.getProviderInstance(FIXTURE_PROVIDER)
    await runtime.disposeProviderInstance(FIXTURE_PROVIDER)
    const second = await runtime.getProviderInstance(FIXTURE_PROVIDER)

    expect(fixture.disposeCalls).toBe(0)
    expect(second).not.toBe(first)
    expect(fixture.builds).toBe(2)
  })

  it('disposes an id that was never built without failing or creating a record', async () => {
    const { config, dispatches, runtime } = installStores()

    await expect(runtime.disposeProviderInstance(UNKNOWN_PROVIDER)).resolves.toBeUndefined()

    expect(readRecord(config, UNKNOWN_PROVIDER)).toBeUndefined()
    expect(dispatches).toEqual([])
  })

  it('does not cache a failed build', async () => {
    const { config, runtime } = installStores()
    config.ensureProvider(FIXTURE_PROVIDER, FIXTURE_PROVIDER, {})
    fixture.failNextBuild = true

    await expect(runtime.getProviderInstance(FIXTURE_PROVIDER)).rejects.toThrow('e1-factory-failure')

    const instance = await runtime.getProviderInstance(FIXTURE_PROVIDER)

    // A failed build leaves no poisoned cache entry behind.
    expect(instance).toBeDefined()
    expect(fixture.builds).toBe(1)
  })
})
