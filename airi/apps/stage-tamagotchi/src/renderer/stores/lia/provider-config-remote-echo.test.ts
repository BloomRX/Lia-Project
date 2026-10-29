import type { InferenceServiceProvider } from '@proj-airi/stage-ui/libs/providers/types'

import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { useLiaProviderConfigFacade } from './provider-config-facade'

/**
 * B0.7.2, T-F — the remote echo, pinned before anything is allowed to change it.
 *
 * `updateProviderConfig` (`stage-ui/src/stores/providers/config.ts:211-232`) does
 * three things a caller cannot see from its signature:
 *
 *  1. it writes the local record **first** (`:216-221`), then awaits the
 *     replication (`:224`);
 *  2. on success the record returned by the server **replaces the local one
 *     wholesale** (`:225`) — the local write is not authoritative;
 *  3. on failure the local record survives and is what the caller gets back
 *     (`:228-231`).
 *
 * And `patchConfigRemote` → `normalize` translate the status across the wire:
 * `status` goes out as two booleans (`inference-service-providers.ts:193-194`)
 * and comes back reconstructed from them (`:114-130`), with `configuredBy`
 * re-derived from the **local** definition registry rather than from the
 * payload.
 *
 * Why this is a test and not a refactor: the next step (D-4) is the product
 * decision to stop replicating. Whoever makes it needs to know exactly which
 * local behaviour today comes from the server. Each test below names one of
 * those behaviours, so removing or changing it cannot pass silently.
 *
 * No network: `fetch` is stubbed in every case, and the stub also records the
 * store state **at the moment of the call**, which is what proves the ordering.
 */

interface CapturedRequest {
  url: string
  method: string
  body: Record<string, unknown> | undefined
  /** The local record as it existed when the request was issued. */
  localRecordAtCall: InferenceServiceProvider | undefined
}

const captured = vi.hoisted(() => ({ requests: [] as CapturedRequest[] }))

/** Plain snapshot: the store hands back reactive proxies, not raw objects. */
function snapshot(record: InferenceServiceProvider | undefined): InferenceServiceProvider | undefined {
  return record ? JSON.parse(JSON.stringify(record)) : undefined
}

const GROQ = 'groq'
/** A definition whose lifecycle belongs to the AIRI account (official/index.ts:77). */
const AUTHENTICATED_DEFINITION = 'official-provider'

function installStores(options: { reply?: unknown, unreachable?: boolean } = {}) {
  const { reply = { data: [] }, unreachable = false } = options
  captured.requests = []

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (unreachable)
      throw new Error('remote unavailable')

    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const rawBody = init?.body
    captured.requests.push({
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
      localRecordAtCall: snapshot(useProviderConfigStore().getProvider(GROQ)),
      method: init?.method ?? 'GET',
      url,
    })
    return new Response(JSON.stringify(reply), { status: 200 })
  }))

  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)

  return { config: useProviderConfigStore(), facade: useLiaProviderConfigFacade() }
}

/** Seeds the record a previous write would have left behind. */
function seedRecord(config: ReturnType<typeof useProviderConfigStore>) {
  config.ensureProvider(GROQ, GROQ, { baseUrl: 'https://seed.invalid/v1' })
}

describe('lia provider config — local write precedes the remote attempt (T-F.1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('t-f.1: the store already holds the new payload when the request leaves', async () => {
    const { config, facade } = installStores({
      reply: { config: { baseUrl: 'https://server.invalid/v1' }, definitionId: GROQ, id: GROQ, validated: false },
    })
    seedRecord(config)

    await facade.updateConfig(GROQ, { baseUrl: 'https://new.invalid/v1' }, 'unconfigured')

    // The request really happened: without this the ordering claim would be
    // satisfied by never reaching the network at all.
    expect(captured.requests).toHaveLength(1)
    // And at that instant the local record was already the new one.
    expect(captured.requests[0].localRecordAtCall?.config)
      .toEqual({ baseUrl: 'https://new.invalid/v1' })
    expect(captured.requests[0].localRecordAtCall?.status).toBe('unconfigured')
  })

  it('t-f.1: the outgoing body carries the status as two booleans and nothing else', async () => {
    const { config, facade } = installStores({ reply: { config: {}, definitionId: GROQ, id: GROQ, validated: true } })
    seedRecord(config)

    await facade.updateConfig(GROQ, { baseUrl: 'https://body.invalid/v1' }, 'configured')

    // The wire format is derived, not forwarded: `status` never travels as a
    // string, and no local-only field (configuredBy / id) is sent.
    expect(captured.requests[0].method).toBe('PATCH')
    expect(captured.requests[0].body).toStrictEqual({
      config: { baseUrl: 'https://body.invalid/v1' },
      validated: true,
      validationBypassed: false,
    })
  })
})

describe('lia provider config — a successful echo replaces the local record (T-F.2)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('t-f.2: the server record wins, including over the status the caller wrote', async () => {
    const { config, facade } = installStores({
      reply: {
        // The server echoes its own copy: a different URL, and `validated: true`.
        config: { baseUrl: 'https://server.invalid/v1' },
        definitionId: GROQ,
        id: GROQ,
        validated: true,
      },
    })
    seedRecord(config)

    const returned = await facade.updateConfig(GROQ, { baseUrl: 'https://local.invalid/v1' }, 'unconfigured')

    // Every field comes from the echo; the caller's `'unconfigured'` is gone.
    const expected = {
      config: { baseUrl: 'https://server.invalid/v1' },
      configuredBy: 'user',
      definitionId: GROQ,
      id: GROQ,
      status: 'configured',
    }
    expect(returned).toStrictEqual(expected)
    expect(config.getProvider(GROQ)).toStrictEqual(expected)
  })

  it('t-f.2: the echoed config is taken wholesale, so an absent field is absent locally', async () => {
    // This is the mechanism by which a custom `baseUrl` can be lost: the local
    // record is not merged with the echo, it is replaced by it.
    const { config, facade } = installStores({ reply: { definitionId: GROQ, id: GROQ, validated: true } })
    config.ensureProvider(GROQ, GROQ, { baseUrl: 'https://custom.invalid/v1', model: 'kept-model' })

    await facade.updateConfig(GROQ, { baseUrl: 'https://custom.invalid/v1', model: 'kept-model' }, 'unconfigured')

    expect(config.getProviderConfig(GROQ)).toBeUndefined()
    // Pinned as current behaviour, not as desired behaviour: changing it is a
    // product decision (D-4), and this test is what would have to change.
    expect(config.getProvider(GROQ)?.status).toBe('configured')
  })
})

describe('lia provider config — a failed replication leaves the local state (T-F.3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('t-f.3: the write survives, the caller gets the local record, nothing throws', async () => {
    const { config, facade } = installStores({ unreachable: true })
    seedRecord(config)

    const returned = await facade.updateConfig(GROQ, { baseUrl: 'https://kept.invalid/v1' }, 'unconfigured')

    expect(returned).toStrictEqual({
      config: { baseUrl: 'https://kept.invalid/v1' },
      configuredBy: 'user',
      definitionId: GROQ,
      id: GROQ,
      status: 'unconfigured',
    })
    expect(config.getProvider(GROQ)).toStrictEqual(returned)
    // The attempt was made and failed: this is a failure path, not a bypass.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })
})

describe('lia provider config — status is rebuilt from the two booleans (T-F.4)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const cases: Array<{ label: string, reply: Record<string, unknown>, expected: string }> = [
    {
      expected: 'configured',
      label: 'validated true, bypassed false',
      reply: { validated: true, validationBypassed: false },
    },
    {
      expected: 'bypassed',
      label: 'validated false, bypassed true',
      reply: { validated: false, validationBypassed: true },
    },
    {
      expected: 'unconfigured',
      label: 'both false',
      reply: { validated: false, validationBypassed: false },
    },
    {
      // Order matters in `normalize`: `validated` is checked first.
      expected: 'configured',
      label: 'both true, validated wins',
      reply: { validated: true, validationBypassed: true },
    },
    {
      // A `status` string in the payload is ignored entirely: only the two
      // booleans are read, so a server saying "configured" with validated=false
      // yields unconfigured.
      expected: 'unconfigured',
      label: 'status string present but validated false',
      reply: { status: 'configured', validated: false, validationBypassed: false },
    },
  ]

  for (const testCase of cases) {
    it(`t-f.4: ${testCase.label} reconstructs '${testCase.expected}'`, async () => {
      const { config, facade } = installStores({ reply: { definitionId: GROQ, id: GROQ, ...testCase.reply } })
      seedRecord(config)

      await facade.updateConfig(GROQ, { baseUrl: 'https://status.invalid/v1' }, 'unconfigured')

      expect(config.getProvider(GROQ)?.status).toBe(testCase.expected)
    })
  }
})

describe('lia provider config — configuredBy comes from the local registry (T-F.5)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('t-f.5: a configuredBy sent by the server is discarded', async () => {
    const { config, facade } = installStores({
      reply: {
        // The server claims the provider belongs to the AIRI account session.
        configuredBy: 'authentication',
        definitionId: GROQ,
        id: GROQ,
        validated: true,
      },
    })
    seedRecord(config)

    await facade.updateConfig(GROQ, { baseUrl: 'https://cb.invalid/v1' }, 'unconfigured')

    // `groq` is user-owned locally, and the local definition decides.
    expect(config.getProvider(GROQ)?.configuredBy).toBe('user')
  })

  it('t-f.5: the lookup key does come from the echo, so an authenticated definition reports its own owner', async () => {
    // Fact, deliberately pinned: `normalize` looks up `item.definitionId` — a
    // remote-supplied value — in the LOCAL registry. The owner is local, but
    // which owner is asked depends on the echo. Any Lia-owned implementation
    // of this path would have to decide the same question explicitly.
    const { config, facade } = installStores({
      reply: { definitionId: AUTHENTICATED_DEFINITION, id: GROQ, validated: true },
    })
    seedRecord(config)

    await facade.updateConfig(GROQ, { baseUrl: 'https://cb2.invalid/v1' }, 'unconfigured')

    expect(config.getProvider(GROQ)?.configuredBy).toBe('authentication')
    expect(config.getProvider(GROQ)?.definitionId).toBe(AUTHENTICATED_DEFINITION)
  })

  it('t-f.5: an echo without a known definition falls back to user-owned', async () => {
    const { config, facade } = installStores({ reply: { definitionId: 'no-such-definition', id: GROQ, validated: false } })
    seedRecord(config)

    await facade.updateConfig(GROQ, { baseUrl: 'https://cb3.invalid/v1' }, 'unconfigured')

    expect(config.getProvider(GROQ)?.configuredBy).toBe('user')
  })
})
