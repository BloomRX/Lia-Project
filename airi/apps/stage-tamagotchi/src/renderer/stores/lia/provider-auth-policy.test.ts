import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Auth-ownership policy for the Lia's providers (B0.2 step 2).
 *
 * What this pins:
 *
 *  1. The policy is derived from data — `configuredBy` — and never touches
 *     AIRI's auth store. It is the same field AIRI's hub reads before it
 *     consults `authStore.isAuthenticated`.
 *  2. Every chat provider the Lia curates is user-owned, so the policy returns
 *     `false` for all of them. This is asserted against the REAL provider
 *     definitions, through the REAL config store, not against a fixture.
 *  3. A provider that genuinely is authentication-owned (the official speech
 *     provider, reachable through the Lia's voice picker) still reports `true`.
 *     The policy is not a blanket `false` — that would be a lie.
 *  4. The Lia's readiness gate fails closed on an authentication-owned provider
 *     instead of reporting "ready to chat" with no session.
 *
 * The IPC edge below clones every payload like Electron does, so a payload that
 * is not structured-clonable fails here the way it fails in the real app. The
 * store under test is never mocked.
 */

const ipc = vi.hoisted(() => {
  let chat: Record<string, unknown> = {}
  const vault = new Set<string>()
  const secretKey = (payload: { scope: string, key: string }) => `${payload.scope}\u0000${payload.key}`

  return {
    reset() {
      chat = {}
      vault.clear()
    },
    getChatConfig: vi.fn(async (): Promise<unknown> => structuredClone(chat)),
    saveChatConfig: vi.fn(async (config: unknown) => {
      chat = structuredClone(config) as Record<string, unknown>
    }),
    encryptionAvailable: vi.fn(async () => true),
    secretHas: vi.fn(async (payload: { scope: string, key: string }) => vault.has(secretKey(payload))),
    secretSet: vi.fn(async (payload: { scope: string, key: string }) => {
      vault.add(secretKey(payload))
      return true
    }),
    secretGet: vi.fn(async (): Promise<string | undefined> => undefined),
    secretDelete: vi.fn(async (payload: { scope: string, key: string }) => vault.delete(secretKey(payload))),
  }
})

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return ({
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

const { isAuthenticationOwnedProvider, isUsableWithoutAiriSession } = await import('./provider-auth-policy')
const { LIA_CHAT_PROVIDER_OPTIONS, useLiaProviderStore } = await import('./provider')
const { useProviderConfigStore } = await import('@proj-airi/stage-ui/stores/providers/config')

/** The id of the official speech provider, whose definition declares auth ownership. */
const OFFICIAL_SPEECH_PROVIDER_ID = 'official-provider-speech'

describe('auth-ownership policy — pure decision', () => {
  it('reports false for a user-owned record', () => {
    expect(isAuthenticationOwnedProvider({ configuredBy: 'user' })).toBe(false)
  })

  it('reports true only for an authentication-owned record', () => {
    expect(isAuthenticationOwnedProvider({ configuredBy: 'authentication' })).toBe(true)
  })

  it('treats a missing record as user-owned, matching AIRI fallback', () => {
    expect(isAuthenticationOwnedProvider(undefined)).toBe(false)
    expect(isAuthenticationOwnedProvider({})).toBe(false)
  })

  it('is a complement, not a second rule', () => {
    for (const record of [{ configuredBy: 'user' } as const, { configuredBy: 'authentication' } as const])
      expect(isUsableWithoutAiriSession(record)).toBe(!isAuthenticationOwnedProvider(record))
  })

  it('decides from data alone and never imports the AIRI auth store', async () => {
    // Structural guard: if the policy ever starts depending on the auth session,
    // this fails. The module graph is the contract.
    const source = await import('node:fs').then(fs =>
      fs.promises.readFile(new URL('./provider-auth-policy.ts', import.meta.url), 'utf8'))
    // Code, not prose: the doc comment is allowed to explain the rule by name.
    expect(source).not.toMatch(/from\s+['"][^'"]*stores\/auth['"]/)
    expect(source).not.toMatch(/\buseAuthStore\s*\(/)
    expect(source).not.toMatch(/isAuthenticated\s*[,)]/)
  })
})

describe('auth-ownership policy — the Lia\'s own providers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.reset()
  })

  it('has ten curated chat providers to check', () => {
    expect(LIA_CHAT_PROVIDER_OPTIONS.length).toBe(10)
  })

  it('marks every curated chat provider user-owned, through the real registry', () => {
    const config = useProviderConfigStore()
    const owned: string[] = []

    for (const option of LIA_CHAT_PROVIDER_OPTIONS) {
      // `ensureProvider` reads the real definition and copies `configuredBy`
      // onto the record; it throws if the definition does not exist, so this
      // also proves each curated id is a real provider.
      const record = config.ensureProvider(option.id, option.id, {})
      expect(record, `missing definition for ${option.id}`).toBeDefined()
      if (isAuthenticationOwnedProvider(record))
        owned.push(option.id)
    }

    expect(owned).toEqual([])
  })

  it('still recognises a genuinely authentication-owned provider', () => {
    const config = useProviderConfigStore()

    // The official speech provider is reachable from the Lia's voice picker
    // (only `speech-noop` is hidden), so this is not hypothetical.
    const record = config.ensureProvider(OFFICIAL_SPEECH_PROVIDER_ID, OFFICIAL_SPEECH_PROVIDER_ID, {})

    expect(record?.configuredBy).toBe('authentication')
    expect(isAuthenticationOwnedProvider(record)).toBe(true)
  })
})

describe('auth-ownership policy — the Lia\'s readiness gate', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.reset()
  })

  it('is ready for a keyless, user-owned provider without any session', async () => {
    const store = useLiaProviderStore()
    await store.refreshConfig()
    await store.persistConfig({
      ...store.loadedConfig,
      preferred: { providerId: 'ollama', modelId: 'llama3' },
      onboarded: true,
    })

    expect(await store.isReadyToChat()).toBe(true)
  })

  it('is not ready for an authentication-owned provider, even when onboarded', async () => {
    const store = useLiaProviderStore()
    await store.refreshConfig()
    await store.persistConfig({
      ...store.loadedConfig,
      preferred: { providerId: OFFICIAL_SPEECH_PROVIDER_ID, modelId: 'any' },
      onboarded: true,
    })

    expect(await store.isReadyToChat()).toBe(false)
  })

  it('stays not ready when nothing is configured at all', async () => {
    const store = useLiaProviderStore()
    await store.refreshConfig()

    expect(await store.isReadyToChat()).toBe(false)
  })
})
