import { PiniaColada } from '@pinia/colada'
import { resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { createLiaTransportClient } from '../../services/lia/transport-config'
import { setTransportTestVaultResolver } from '../../services/lia/transport-config.fixture'

/**
 * Corte B, Fase 2 — the SHARED model selector lists curated providers through
 * main.
 *
 * `providerStore.fetchModelsForProvider` is the selector every AIRI consumer
 * uses (`consciousness`, `hearing`, `vision`, the voice editor). Before this
 * cut it always took the legacy path: `withResolvedCredential` asked the
 * renderer's vault for the key and `listProviderModels` built a client with it.
 * For a curated provider that meant the credential the chat path had just been
 * denied came back through the model list.
 *
 * The split is explicit and testable:
 *
 *  - a host-registered lister that returns an ARRAY owns the provider, so the
 *    legacy path never runs - not even on failure;
 *  - a lister that returns `undefined` does not own it, and the legacy path
 *    runs exactly as before.
 *
 * Both halves are pinned below, because the second one is the debt: providers
 * outside the catalog still resolve their key in this process.
 */
const ipc = vi.hoisted(() => ({
  chatConfig: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  encryptionAvailable: vi.fn(async () => true),
  saveChatConfig: vi.fn(async (_config: Record<string, unknown>) => {}),
  secretDelete: vi.fn(async () => true),
  vaultGet: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
  secretGet: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
  secretHas: vi.fn(async () => false),
  secretSet: vi.fn(async (_payload: { scope: string, key: string, value: string }) => true),
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
        'eventa:invoke:lia:secret:adopt-receive': createSecretAdoptHandler({ secretHas: ipc.secretHas, secretGet: ipc.secretGet, secretSet: ipc.secretSet }),
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

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const { useLiaProviderStore } = await import('./provider')

const KEY = 'SYNTHETIC_LISTED_KEY_NEVER_OUTPUT'
const ENDPOINT = 'https://openrouter.ai/api/v1/'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultGet)
  resetChatProviderRuntimeExtensionsForTesting()
  // Main holds the key; the renderer channel would hand it over if asked.
  ipc.vaultGet.mockResolvedValue(KEY)
  ipc.secretGet.mockResolvedValue(KEY)
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'custom/Listed:Q4' }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  resetChatProviderRuntimeExtensionsForTesting()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the shared model selector delegates curated providers to main', () => {
  it('lists a curated provider without a saved config and without asking this renderer for a key', async () => {
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: ENDPOINT })
    // What `App.vue` installs in EVERY window: the transport bridge and the
    // listing hook it carries.
    useLiaProviderStore().registerChatTransport()

    const models = await useProviderStore().fetchModelsForProvider('openrouter-ai')

    expect(models.map(model => model.id)).toEqual(['custom/Listed:Q4'])
    expect(useProviderStore().getModelsForProvider('openrouter-ai').map(model => model.id)).toEqual(['custom/Listed:Q4'])
    // The credential came from main's vault, requested by main.
    expect(ipc.vaultGet).toHaveBeenCalledWith({ scope: 'openrouter-ai', key: 'apiKey' })
    // The renderer's own channel was never used, even though it would answer.
    expect(ipc.secretGet).not.toHaveBeenCalled()
    expect(JSON.stringify(useProviderStore().$state)).not.toContain(KEY)
  })

  it('does not fall back to the in-renderer client when the host listing fails', async () => {
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: ENDPOINT })
    useLiaProviderStore().registerChatTransport()
    // Main is unreachable: discovery cannot name a model.
    fetchMock.mockImplementation(async () => {
      throw new Error('network down')
    })

    const models = await useProviderStore().fetchModelsForProvider('openrouter-ai')

    expect(models).toEqual([])
    // The failure never became an authenticated in-renderer request.
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('keeps the legacy path for a provider outside the catalog, which is the remaining debt', async () => {
    useProviderConfigStore().ensureProvider('deepseek', 'deepseek', { baseUrl: 'https://api.deepseek.com/v1/' })
    // The leader installs the renderer credential resolver; the follower does
    // not. Either way, the legacy list below is what still reads a key here.
    useLiaProviderStore().registerRuntimeExtensions()

    const models = await useProviderStore().fetchModelsForProvider('deepseek')

    expect(models.map(model => model.id)).toEqual(['custom/Listed:Q4'])
    // Asserted as CURRENT behaviour, not as a guarantee: this key is resolved
    // and spent inside the renderer, and only the curated ids are migrated.
    expect(ipc.secretGet).toHaveBeenCalledWith({ scope: 'deepseek', key: 'apiKey' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.deepseek.com')
  })

  it('keeps the untouched behaviour when no host registered a lister', async () => {
    useProviderConfigStore().ensureProvider('deepseek', 'deepseek', { baseUrl: 'https://api.deepseek.com/v1/' })

    await useProviderStore().fetchModelsForProvider('deepseek')

    // Unchanged legacy behaviour: the request is issued by this renderer, and
    // nothing is written to the transport repository for a non-curated id.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('api.deepseek.com')
    const records = (await createLiaTransportClient().refresh()).records
    expect(records.some(record => record.providerId === 'deepseek')).toBe(false)
  })
})
