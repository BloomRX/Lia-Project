import type { LiaProviderRuntimeSource } from './provider-runtime'

import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createLiaProviderRuntime, useLiaProviderRuntime } from './provider-runtime'

/**
 * E2 — the runtime port delegates, and changes nothing on the way through.
 *
 * Two questions, and neither is answered by a mock that only proves the port
 * called a function:
 *
 *  1. **Does it delegate faithfully?** Over a recording double, every member
 *     must forward the id and hand back exactly what the delegate produced —
 *     the same promise, the same rejection, the same array reference. A port
 *     that awaited, copied or wrapped would still "call the function" and would
 *     still be wrong.
 *  2. **Is the result indistinguishable from the direct call?** The port is run
 *     against one Pinia and the previous direct store calls against another,
 *     and the resulting state must be identical. That is the same equivalence
 *     argument the activation port uses, and it is what makes this an
 *     encapsulation rather than a behaviour change.
 *
 * `provider-runtime-semantics.test.ts` (E1) remains the authority on what
 * `getProviderInstance` does. This file does not restate those semantics; it
 * proves the port does not perturb them.
 *
 * No network: `fetch` is stubbed, and every test asserts the whole file issued
 * no request.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md and the
 * B0.9 dependency map, section 6, candidate P1.
 */

const NO_CREDENTIAL_PROVIDER = 'speech-noop'
const CREDENTIALED_PROVIDER = 'groq'
const UNKNOWN_PROVIDER = 'e2-no-such-provider'

const observed = vi.hoisted(() => ({
  requests: [] as string[],
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

function installStores() {
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
}

/** Plain, comparable snapshot of everything a runtime operation can touch. */
function captureState(providerId: string) {
  const config = useProviderConfigStore()
  const runtime = useProviderStore()
  const record = config.providers[providerId]

  return {
    added: config.addedProviders[providerId] ?? false,
    configured: config.configuredProviders[providerId] ?? false,
    listed: Boolean(config.listedProviders[providerId]),
    record: record ? JSON.parse(JSON.stringify(record)) : undefined,
    runtimeState: JSON.parse(JSON.stringify(runtime.providerRuntimeState[providerId] ?? null)),
  }
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    observed.requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }))
}

beforeEach(() => {
  observed.requests = []
  stubFetch()
})

afterEach(() => {
  expect(observed.requests, 'the runtime port must not introduce requests').toEqual([])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('lia provider runtime — it only delegates', () => {
  /**
   * The double is not the store, and is not pretending to be: it records what
   * the port forwarded. The cast is what lets a four-field stub satisfy
   * signatures derived from the real store.
   */
  function createSource() {
    const source = {
      disposeProviderInstance: vi.fn(async () => {}),
      getModelsForProvider: vi.fn(() => []),
      getProviderInstance: vi.fn(async () => ({})),
      supportsModelListing: vi.fn(() => true),
    }
    return { source, runtime: createLiaProviderRuntime(source as unknown as LiaProviderRuntimeSource) }
  }

  it('forwards every operation to the delegate with the id it was given', async () => {
    const { runtime, source } = createSource()

    await runtime.getInstance('provider-a')
    await runtime.dispose('provider-b')
    runtime.canListModels('provider-c')
    runtime.listModels('provider-d')

    expect(source.getProviderInstance).toHaveBeenCalledExactlyOnceWith('provider-a')
    expect(source.disposeProviderInstance).toHaveBeenCalledExactlyOnceWith('provider-b')
    expect(source.supportsModelListing).toHaveBeenCalledExactlyOnceWith('provider-c')
    expect(source.getModelsForProvider).toHaveBeenCalledExactlyOnceWith('provider-d')
  })

  it('hands back the delegate promise without awaiting or wrapping it', () => {
    let settleInstance: ((value: unknown) => void) | undefined
    let settleDispose: (() => void) | undefined
    const instancePromise = new Promise((resolve) => {
      settleInstance = resolve
    })
    const disposePromise = new Promise<void>((resolve) => {
      settleDispose = resolve
    })
    const source = {
      disposeProviderInstance: vi.fn(() => disposePromise),
      getModelsForProvider: vi.fn(() => []),
      getProviderInstance: vi.fn(() => instancePromise),
      supportsModelListing: vi.fn(() => true),
    }
    const runtime = createLiaProviderRuntime(source as unknown as LiaProviderRuntimeSource)

    // Identity, not equality: the caller awaits exactly the delegate's promise.
    expect(runtime.getInstance('provider-a')).toBe(instancePromise)
    expect(runtime.dispose('provider-a')).toBe(disposePromise)

    settleInstance?.({ ok: true })
    settleDispose?.()
  })

  it('returns the delegate values as they are, including a false predicate and an array reference', () => {
    const models = [{ id: 'a', name: 'A', provider: 'p' }]
    const source = {
      disposeProviderInstance: vi.fn(async () => {}),
      getModelsForProvider: vi.fn(() => models),
      getProviderInstance: vi.fn(async () => ({})),
      supportsModelListing: vi.fn(() => false),
    }
    const runtime = createLiaProviderRuntime(source as unknown as LiaProviderRuntimeSource)

    expect(runtime.canListModels('provider-a')).toBe(false)
    // A copy here would be invisible to `toEqual` and a real behaviour change.
    expect(runtime.listModels('provider-a')).toBe(models)
  })

  it('propagates a delegate rejection instead of turning it into a value', async () => {
    const source = {
      disposeProviderInstance: vi.fn(async () => {}),
      getModelsForProvider: vi.fn(() => []),
      getProviderInstance: vi.fn(async () => {
        throw new Error('e2-delegate-failure')
      }),
      supportsModelListing: vi.fn(() => true),
    }
    const runtime = createLiaProviderRuntime(source as unknown as LiaProviderRuntimeSource)

    await expect(runtime.getInstance('provider-a')).rejects.toThrow('e2-delegate-failure')
  })
})

describe('lia provider runtime — the shared store is still the implementation', () => {
  it('builds, caches and discards exactly like the direct call did', async () => {
    // Port side.
    installStores()
    const port = useLiaProviderRuntime()
    const portFirst = await port.getInstance(NO_CREDENTIAL_PROVIDER)
    const portSecond = await port.getInstance(NO_CREDENTIAL_PROVIDER)
    const portState = captureState(NO_CREDENTIAL_PROVIDER)
    await port.dispose(NO_CREDENTIAL_PROVIDER)
    const portRebuilt = await port.getInstance(NO_CREDENTIAL_PROVIDER)

    // Same operations, straight on the store, in their own Pinia.
    installStores()
    const store = useProviderStore()
    const directFirst = await store.getProviderInstance(NO_CREDENTIAL_PROVIDER)
    const directSecond = await store.getProviderInstance(NO_CREDENTIAL_PROVIDER)
    const directState = captureState(NO_CREDENTIAL_PROVIDER)
    await store.disposeProviderInstance(NO_CREDENTIAL_PROVIDER)
    const directRebuilt = await store.getProviderInstance(NO_CREDENTIAL_PROVIDER)

    // The port changed nothing a consumer can observe.
    expect(portState).toStrictEqual(directState)
    // The record a credential-free provider needs was created on both sides.
    expect(portState.record).toBeDefined()
    // Cache identity, and a rebuild after disposal, on both sides.
    expect(portSecond).toBe(portFirst)
    expect(directSecond).toBe(directFirst)
    expect(portRebuilt).not.toBe(portFirst)
    expect(directRebuilt).not.toBe(directFirst)
  })

  it('keeps the failure of a credentialed provider without a record', async () => {
    installStores()
    const port = useLiaProviderRuntime()

    await expect(port.getInstance(CREDENTIALED_PROVIDER))
      .rejects
      .toThrow(`Provider credentials for ${CREDENTIALED_PROVIDER} not found`)

    // No fallback was introduced: nothing was created for it either.
    expect(captureState(CREDENTIALED_PROVIDER).record).toBeUndefined()
  })

  it('answers the model questions the same way the store does', () => {
    installStores()
    const port = useLiaProviderRuntime()
    const store = useProviderStore()

    expect(port.canListModels(NO_CREDENTIAL_PROVIDER)).toBe(store.supportsModelListing(NO_CREDENTIAL_PROVIDER))
    expect(port.canListModels(UNKNOWN_PROVIDER)).toBe(store.supportsModelListing(UNKNOWN_PROVIDER))
    expect(port.canListModels(UNKNOWN_PROVIDER)).toBe(false)

    // The frozen empty fallback is returned as-is: same reference, no copy.
    expect(port.listModels(UNKNOWN_PROVIDER)).toBe(store.getModelsForProvider(UNKNOWN_PROVIDER))
    expect(port.listModels(UNKNOWN_PROVIDER)).toBe(port.listModels(UNKNOWN_PROVIDER))
  })

  it('disposes an id that was never built without creating anything', async () => {
    installStores()
    const port = useLiaProviderRuntime()

    await expect(port.dispose(UNKNOWN_PROVIDER)).resolves.toBeUndefined()

    expect(captureState(UNKNOWN_PROVIDER).record).toBeUndefined()
  })
})
