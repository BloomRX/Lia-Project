import type { InferenceServiceProvider } from '@proj-airi/stage-ui/libs/providers/types'

import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createLiaProviderActivation, useLiaProviderActivation } from './provider-activation'

/**
 * B0.8-lite, T-G — the activation port keeps the effects it delegated.
 *
 * Two questions, and the second is the one that matters:
 *
 *  1. **Does it delegate?** Over a recording double, both members must forward
 *     the id and return the delegate's value untouched.
 *  2. **Are the effects the same as before?** This is answered by *equivalence*,
 *     not by a list of expectations: the port is run against one Pinia instance
 *     and the previous direct calls against another, and the resulting state must
 *     be identical. A hand-written expectation would only prove that the test
 *     author and the implementation agree; two runs prove that swapping the call
 *     site changed nothing.
 *
 * The four effects named in the acceptance criteria are asserted on the port side
 * as well, individually, so a future failure says *which* effect broke:
 * record/defaults, runtime state entry, `status: 'configured'`, membership in
 * `addedProviders`.
 *
 * No network: `fetch` is stubbed, and every case asserts it was never called.
 *
 * Reference: docs/architecture/LIA-STAGE-DEPENDENCY-MAP-2026-10-28.md §14 and
 * the D-7 analysis in the B0.7.2 proposal.
 */

/**
 * The shared provider store calls `useI18n()` in its setup, which requires a
 * component instance. The Stage's own tests mock it the same way; the returned
 * `t` is only used to build provider metadata, which stays local.
 */
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en-US' },
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

const PROVIDER_ID = 'groq'

const observed = vi.hoisted(() => ({ requests: [] as string[] }))

/** Installs a fresh Pinia with the plugins the renderer installs. */
function freshPinia() {
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  return pinia
}

/** Plain, comparable snapshot of everything activation can touch. */
function captureState(providerId: string) {
  const config = useProviderConfigStore()
  const runtime = useProviderStore()

  const record: InferenceServiceProvider | undefined = config.getProvider(providerId)
  return {
    added: config.addedProviders[providerId] ?? false,
    configured: config.configuredProviders[providerId] ?? false,
    listed: Boolean(config.listedProviders[providerId]),
    record: record ? JSON.parse(JSON.stringify(record)) : undefined,
    runtimeState: JSON.parse(JSON.stringify(runtime.providerRuntimeState[providerId] ?? null)),
  }
}

function stubFetch() {
  observed.requests = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    observed.requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return new Response(JSON.stringify({ data: [] }), { status: 200 })
  }))
}

describe('lia provider activation — it only delegates', () => {
  it('forwards both members to the delegate and returns its value unchanged', async () => {
    const source = {
      forceProviderConfigured: vi.fn(),
      initializeProvider: vi.fn(async () => {}),
    }
    const activation = createLiaProviderActivation(source)

    await activation.activate(PROVIDER_ID)
    activation.markConfigured(PROVIDER_ID)

    expect(source.initializeProvider).toHaveBeenCalledExactlyOnceWith(PROVIDER_ID)
    expect(source.forceProviderConfigured).toHaveBeenCalledExactlyOnceWith(PROVIDER_ID)
  })

  it('returns the delegate promise (a caller can still await it) and nothing else', async () => {
    let resolveActivation: (() => void) | undefined
    const source = {
      forceProviderConfigured: vi.fn(),
      initializeProvider: vi.fn(() => new Promise<void>((resolve) => {
        resolveActivation = resolve
      })),
    }
    const activation = createLiaProviderActivation(source)

    let settled = false
    const pending = activation.activate(PROVIDER_ID).then(() => {
      settled = true
    })

    expect(settled).toBe(false)
    resolveActivation?.()
    await pending
    expect(settled).toBe(true)
  })
})

describe('lia provider activation — the effects are the ones the Lia relied on (T-G)', () => {
  beforeEach(() => {
    freshPinia()
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('t-g: activate() creates the record with definition defaults and seeds the runtime state', async () => {
    const activation = useLiaProviderActivation()

    await activation.activate(PROVIDER_ID)

    const config = useProviderConfigStore()
    const record = config.getProvider(PROVIDER_ID)
    expect(record, 'the record must exist after activate').toBeDefined()
    expect(record?.definitionId).toBe(PROVIDER_ID)
    // Defaults come from the definition, exactly as the direct call produced
    // them: `getDefaultProviderConfig` always materialises a `baseUrl` key.
    expect(record?.config).toHaveProperty('baseUrl')
    expect(record?.status).toBe('unconfigured')
    expect(record?.configuredBy).toBe('user')

    // The runtime state entry is what makes the provider usable at all.
    const runtimeState = useProviderStore().providerRuntimeState[PROVIDER_ID]
    expect(runtimeState).toBeDefined()
    expect(runtimeState?.models).toEqual([])
    expect(runtimeState?.modelStatus).toBe('idle')

    expect(observed.requests).toEqual([])
  })

  it('t-g: markConfigured() sets the status and adds the provider, synchronously', () => {
    const activation = useLiaProviderActivation()
    const config = useProviderConfigStore()
    config.ensureProvider(PROVIDER_ID, PROVIDER_ID, { baseUrl: 'https://x.invalid/v1' })

    activation.markConfigured(PROVIDER_ID)

    expect(config.getProvider(PROVIDER_ID)?.status).toBe('configured')
    expect(config.configuredProviders[PROVIDER_ID]).toBe(true)
    expect(config.addedProviders[PROVIDER_ID]).toBe(true)
    expect(config.listedProviders[PROVIDER_ID]).toBeDefined()
    expect(observed.requests).toEqual([])
  })

  it('t-g: the real activation sequence leaves nothing on the wire', async () => {
    const activation = useLiaProviderActivation()

    await activation.activate(PROVIDER_ID)
    activation.markConfigured(PROVIDER_ID)

    // Neither operation replicates: configuration writes are the only Lia path
    // that reaches the network, and this is not one of them.
    expect(observed.requests).toEqual([])
  })

  it('t-g: port and direct calls produce byte-identical state (equivalence)', async () => {
    // Control: the previous call sites, verbatim.
    freshPinia()
    stubFetch()
    const controlProvider = useProviderStore()
    await controlProvider.initializeProvider(PROVIDER_ID)
    controlProvider.forceProviderConfigured(PROVIDER_ID)
    const control = captureState(PROVIDER_ID)

    // Subject: the same sequence through the port, on a clean Pinia.
    freshPinia()
    stubFetch()
    const activation = useLiaProviderActivation()
    await activation.activate(PROVIDER_ID)
    activation.markConfigured(PROVIDER_ID)
    const subject = captureState(PROVIDER_ID)

    // If the two sequences diverged in any way that a consumer could observe,
    // this fails — including a change in the runtime-state entry, the status,
    // the `added` flag or the materialised defaults.
    expect(subject).toStrictEqual(control)
    expect(subject.record?.status).toBe('configured')
    expect(subject.added).toBe(true)
    expect(observed.requests).toEqual([])
  })

  it('t-g: activation is idempotent, as the direct pair was', async () => {
    const activation = useLiaProviderActivation()
    await activation.activate(PROVIDER_ID)
    activation.markConfigured(PROVIDER_ID)
    const first = captureState(PROVIDER_ID)

    await activation.activate(PROVIDER_ID)
    activation.markConfigured(PROVIDER_ID)

    expect(captureState(PROVIDER_ID)).toStrictEqual(first)
    expect(observed.requests).toEqual([])
  })
})
