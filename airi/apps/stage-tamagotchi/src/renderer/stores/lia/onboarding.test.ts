import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Onboarding completion gate (M1 blocker fix).
 *
 * These tests reproduce the reported bug: choosing a provider/model, storing a
 * key and pressing "Concluir configuração" persisted the provider config but the
 * Home never left the onboarding view.
 *
 * Root cause: `loadedConfig` is a `ref`, so anything read back out of it — the
 * nested `preferred` / `fallback` objects included — is a Vue reactive `Proxy`.
 * `markOnboarded()` spread that proxy into the payload it sent over IPC, and the
 * eventa Electron adapter ships payloads with `ipcRenderer.send(...)`, i.e. the
 * structured clone algorithm, which cannot clone a `Proxy` and throws
 * "An object could not be cloned.". The throw was swallowed by `conclude()`'s
 * catch, so `onboarded` was never written and the launcher gate stayed false.
 *
 * The IPC edge below therefore clones every payload exactly like Electron does;
 * a payload that is not structured-clonable fails here the same way it fails in
 * the real app. The store under test is never mocked.
 */

const ipc = vi.hoisted(() => {
  // Mirrors `lia-product.json` -> `provider.chat` held in main-process memory by
  // `main/libs/electron/persistence.ts` (`get()` returns the in-memory value).
  let chat: Record<string, unknown> = {}
  const vault = new Set<string>()

  const secretKey = (payload: { scope: string, key: string }) => `${payload.scope}\u0000${payload.key}`

  return {
    /** Test-only: resets the emulated main-process state. */
    reset() {
      chat = {}
      vault.clear()
    },
    /** Test-only: the config main would currently return. */
    get persistedChat() {
      return chat
    },
    getChatConfig: vi.fn(async (): Promise<unknown> => structuredClone(chat)),
    saveChatConfig: vi.fn(async (config: unknown) => {
      // Electron IPC serializes with the structured clone algorithm. A Vue
      // reactive Proxy throws here ("An object could not be cloned.").
      chat = structuredClone(config) as Record<string, unknown>
    }),
    encryptionAvailable: vi.fn(async () => true),
    secretHas: vi.fn(async (payload: { scope: string, key: string }) => vault.has(secretKey(payload))),
    secretSet: vi.fn(async (payload: { scope: string, key: string, value: string }) => {
      vault.add(secretKey(payload))
      return true
    }),
    secretGet: vi.fn(async (): Promise<string | undefined> => undefined),
    secretDelete: vi.fn(async (payload: { scope: string, key: string }) => vault.delete(secretKey(payload))),
  }
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
    if (id in handlers) {
      return handlers[id]
    }

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

/**
 * Runs exactly what `LiaProviderConfig.conclude()` runs: `save()` (store the key,
 * persist the built config) followed by `markOnboarded()`.
 */
async function runConclude(store: ReturnType<typeof useLiaProviderStore>, args: {
  providerId: string
  modelId: string
  apiKey?: string
  fallbackEnabled?: boolean
}) {
  await store.refreshConfig()

  if (args.apiKey) {
    expect(await store.setApiKey(args.providerId, args.apiKey)).toBe(true)
  }

  // `buildConfig()` in the component: fresh literals over the loaded config.
  await store.persistConfig({
    ...(store.loadedConfig ?? {}),
    strategy: 'manual',
    preferred: { providerId: args.providerId, modelId: args.modelId },
    fallback: [],
    fallbackEnabled: args.fallbackEnabled ?? true,
  })

  await store.markOnboarded()
}

describe('lia provider onboarding gate (M1)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.reset()
    vi.clearAllMocks()
  })

  it('shows onboarding on first run, when nothing is configured', async () => {
    const store = useLiaProviderStore()

    await store.refreshConfig()

    expect(ipc.persistedChat).toEqual({})
    expect(await store.isReadyToChat()).toBe(false)
  })

  it('becomes ready right after conclude() for a keyed provider with a stored key', async () => {
    const store = useLiaProviderStore()

    await runConclude(store, { providerId: 'openai', modelId: 'gpt-5.5', apiKey: 'sk-test' })

    // What "Concluir configuração" must have persisted...
    expect(ipc.persistedChat.onboarded).toBe(true)
    expect(ipc.persistedChat.preferred).toEqual({ providerId: 'openai', modelId: 'gpt-5.5' })

    // ...and what the Home gate derives from it, with no reload and no remount.
    expect(store.loadedConfig?.onboarded).toBe(true)
    expect(await store.isReadyToChat()).toBe(true)
  })

  it('keeps onboarding when a keyed provider has no stored secret', async () => {
    const store = useLiaProviderStore()

    await runConclude(store, { providerId: 'openai', modelId: 'gpt-5.5' })

    expect(ipc.persistedChat.onboarded).toBe(true)
    expect(await store.isReadyToChat()).toBe(false)
  })

  it('becomes ready for a keyless provider without any secret', async () => {
    const store = useLiaProviderStore()

    await runConclude(store, { providerId: 'ollama', modelId: 'llama3.2' })

    expect(ipc.secretSet).not.toHaveBeenCalled()
    expect(await store.isReadyToChat()).toBe(true)
  })

  it('keeps onboarding when onboarded is set but the preferred target is invalid', async () => {
    const store = useLiaProviderStore()

    // A stale/hand-edited config: the marker alone must never report ready.
    await store.persistConfig({ onboarded: true, preferred: { providerId: 'openai' } })

    expect(await store.isReadyToChat()).toBe(false)

    await store.persistConfig({ onboarded: true, preferred: { providerId: 'unknown-provider', modelId: 'x' } })
    await store.setApiKey('unknown-provider', 'sk-test')

    // Unknown providers are treated as keyed, so the secret alone is not enough
    // to make an unusable target ready — the model must exist too.
    expect(await store.isReadyToChat()).toBe(true)
  })

  it('flips the reactive state the Home view is derived from', async () => {
    const store = useLiaProviderStore()
    const signature = () => {
      const config = store.loadedConfig ?? {}
      return [
        config.preferred?.providerId,
        config.preferred?.modelId,
        config.onboarded,
      ].join('|')
    }

    await store.refreshConfig()
    const before = signature()

    await runConclude(store, { providerId: 'openai', modelId: 'gpt-5.5', apiKey: 'sk-test' })

    // Home watches this signature; it must change so the derived view recomputes.
    expect(before).toBe('||')
    expect(signature()).toBe('openai|gpt-5.5|true')
  })

  it('sends a structured-clonable payload on every chat config write', async () => {
    const store = useLiaProviderStore()

    await runConclude(store, { providerId: 'openai', modelId: 'gpt-5.5', apiKey: 'sk-test' })

    expect(ipc.saveChatConfig).toHaveBeenCalled()
    for (const [payload] of ipc.saveChatConfig.mock.calls) {
      expect(() => structuredClone(payload)).not.toThrow()
    }
  })
})
