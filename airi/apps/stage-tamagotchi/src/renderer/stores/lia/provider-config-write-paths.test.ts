import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

/**
 * B0.7 — the Lia's two configuration write paths, after the facade.
 *
 * The facade tests prove the seam delegates. This file proves the thing the
 * seam must not have changed: **which** of the Lia's own flows still reach the
 * network, and how many times. It drives the real `useLiaProviderStore` against
 * the real shared store, with `fetch` stubbed, so the assertions are about the
 * Lia's behaviour and not about a mock of it.
 *
 * The three flows from the B0.6 design (§2.2), as pinned here:
 *
 *  - **Flow A, record absent** — `ensureProviderRecord(id, baseUrl)`: creates the
 *    record locally. Zero requests.
 *  - **Flow A, record present + baseUrl** — the one live Lia path with a remote
 *    effect: exactly one `PATCH`, and the local payload keeps the custom URL.
 *  - **Flow C, activation** — `activateTarget` without a base URL: local only.
 *
 * Flow B (`hearing` → `applyProviderProjection`) calls the same
 * `updateConfig` delegate as flow A; it is covered by the facade test and by
 * `hearing.test.ts`, and it is deliberately not re-driven here because it needs
 * the microphone/IPC harness, which would test the harness more than the seam.
 *
 * Reference: docs/architecture/LIA-PROVIDER-ADAPTER-DESIGN-2026-10-29.md §2.2
 * and §6.1 (T2/T3).
 */

const observed = vi.hoisted(() => ({ requests: [] as { url: string, method: string }[] }))

/**
 * Minimal IPC seam: the chat config the store reads, and a vault that reports
 * the credential as present (never its value). Everything else is unused by the
 * flows under test.
 */
const ipc = vi.hoisted(() => {
  let chat: Record<string, unknown> = {}
  return {
    fixture(next: Record<string, unknown>) {
      chat = next
    },
    getChatConfig: vi.fn(async () => chat),
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
      'eventa:invoke:lia:provider:chat:config:get-receive': ipc.getChatConfig,
      'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
      'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
      'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
      'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
      'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
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

const { useLiaProviderStore } = await import('./provider')

function installStores() {
  observed.requests = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    observed.requests.push({ url, method: init?.method ?? 'GET' })
    return new Response(JSON.stringify({
      id: 'groq',
      definitionId: 'groq',
      config: { baseUrl: 'https://custom.invalid/v1' },
      status: 'unconfigured',
      configuredBy: 'user',
    }), { status: 200 })
  }))

  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  return useLiaProviderStore()
}

describe('lia provider config write paths — remote effects are unchanged', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.fixture({})
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('flow A, absent record: writes locally with the custom URL and stays offline', async () => {
    const store = installStores()

    const record = await store.ensureProviderRecord('groq', 'https://custom.invalid/v1')

    expect(record?.config).toEqual({ baseUrl: 'https://custom.invalid/v1' })
    expect(observed.requests).toEqual([])
  })

  it('flow A, existing record: still replicates exactly one PATCH, as before the facade', async () => {
    const store = installStores()
    await store.ensureProviderRecord('groq')
    const config = useProviderConfigStore()

    await store.ensureProviderRecord('groq', 'https://custom.invalid/v1')

    expect(observed.requests).toHaveLength(1)
    // T-D: the replication is a PATCH of the provider config, not a POST/PUT, and
    // the assertion reads the method the runtime actually sent.
    expect(observed.requests[0].method).toBe('PATCH')
    expect(observed.requests[0].url).toContain('groq')
    // Exactly one request: the Lia's flow still replicates once, which is what
    // B0.7 promised not to disable. The URL survives in the shared record, the
    // only place it is stored.
    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://custom.invalid/v1' })
  })

  it('flow A, existing record, remote unavailable: the custom URL is kept locally', async () => {
    const store = installStores()
    await store.ensureProviderRecord('groq')
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('remote unavailable')
    }))

    await store.ensureProviderRecord('groq', 'https://offline.invalid/v1')

    // The replication was attempted and failed; the user's URL is not lost and
    // nothing was thrown at the caller.
    expect(useProviderConfigStore().getProviderConfig('groq')).toEqual({ baseUrl: 'https://offline.invalid/v1' })
  })

  it('flow C, activation: ensures the record without touching the network', async () => {
    const store = installStores()

    await store.activateTarget({ providerId: 'groq', modelId: 'llama-3.3-70b-versatile' })

    expect(observed.requests).toEqual([])
  })

  /**
   * T-C — the two REAL activation entries, not just `activateTarget`.
   *
   * `activateTarget` alone was the weaker half of the claim: both public entries
   * also call `initializeProvider` and `forceProviderConfigured`, which write
   * through the shared runtime store. Those writes are local by construction
   * (status + added flag); this pins that they stay local, because that is the
   * dependency the audit flagged as invisible to the config facade.
   */
  it('t-c: activatePreferred() as the real entry makes no configuration request', async () => {
    ipc.fixture({ preferred: { providerId: 'groq', modelId: 'llama-3.3-70b-versatile' } })
    const store = installStores()

    await expect(store.activatePreferred()).resolves.toBe(true)

    expect(observed.requests).toEqual([])
    expect(useProviderConfigStore().getProvider('groq')).toBeDefined()
  })

  it('t-c: activateConfiguredProvider() as the real entry makes no configuration request', async () => {
    ipc.fixture({
      onboarded: true,
      preferred: { providerId: 'groq', modelId: 'llama-3.3-70b-versatile' },
      strategy: 'manual',
    })
    const store = installStores()

    await expect(store.activateConfiguredProvider()).resolves.toBe(true)

    expect(observed.requests).toEqual([])
    // The runtime-side writes still happen locally, which is the behaviour the
    // Lia depends on to be seen as configured at all.
    const config = useProviderConfigStore()
    expect(config.configuredProviders.groq).toBe(true)
    expect(config.getProvider('groq')?.status).toBe('configured')
  })
})
