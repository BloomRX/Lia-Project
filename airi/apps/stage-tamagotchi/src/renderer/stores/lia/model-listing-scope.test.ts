import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { CURATED_CHAT_PROVIDER_IDS } from '../../../shared/lia/provider-catalog'
import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { createLiaTransportClient } from '../../services/lia/transport-config'
import { setTransportTestVaultResolver } from '../../services/lia/transport-config.fixture'

/**
 * Corte B, Fase 4 — who resolves the credential for `listModels`.
 *
 * The dynamic model list is deliberate (a curated provider's catalogue changes
 * without a release), so it is not removed and not replaced by a static table.
 * What this file pins is the CHANNEL: for a curated provider, discovery must be
 * executed by main with the vault key main already owns, and the renderer's own
 * credential channel (`secretGet`) must stay unused. The legacy, non-curated
 * provider still resolves in this renderer — that path is unchanged and is
 * pinned here as debt, not as a guarantee.
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

const KEY = 'SYNTHETIC_MODEL_LIST_KEY'

/**
 * The endpoint each curated provider declares in its own schema. Written here
 * only because the harness does not load the async provider-metadata state;
 * the application reads the same value from `defaultBaseUrl()`.
 */
const ENDPOINTS: Record<string, string> = {
  'openai': 'https://api.openai.com/v1/',
  'groq': 'https://api.groq.com/openai/v1/',
  'cerebras-ai': 'https://api.cerebras.ai/v1/',
  'anthropic': 'https://api.anthropic.com/v1/',
  'xai': 'https://api.x.ai/v1/',
  'mistral-ai': 'https://api.mistral.ai/v1/',
  'openrouter-ai': 'https://openrouter.ai/api/v1/',
  'openai-compatible': 'https://api.openai.com/v1/',
  'lm-studio': 'http://localhost:1234/v1/',
  'ollama': 'http://localhost:11434/v1/',
}
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultGet)
  // Main's vault holds the key; the renderer channel would return it only if a
  // caller asked, which is exactly what the assertions below forbid.
  ipc.vaultGet.mockResolvedValue(KEY)
  ipc.secretGet.mockResolvedValue(KEY)
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'custom/Listed:Q4' }] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('model listing keeps curated credentials in main', () => {
  it.each(CURATED_CHAT_PROVIDER_IDS)('executes %s discovery through main without a renderer credential', async (providerId) => {
    // The address is the one the user's configuration already carries; no key
    // is passed at all, so any credential on the wire can only have come from
    // main's vault.
    useProviderConfigStore().ensureProvider(providerId, providerId, { baseUrl: ENDPOINTS[providerId] })
    const result = await useLiaProviderStore().discoverModels({ providerId })
    expect(result.status).toBe('ready')
    expect(result.models.some(model => model.id === 'custom/Listed:Q4')).toBe(true)

    // The renderer never asked its own vault channel…
    expect(ipc.secretGet).not.toHaveBeenCalled()
    // …main read the credential it stores, under the record's own scope…
    expect(ipc.vaultGet).toHaveBeenCalledWith({ scope: providerId, key: 'apiKey' })
    // …and the request that went out carried it, proving it was resolved
    // somewhere, just not here.
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe(`Bearer ${KEY}`)

    const records = (await createLiaTransportClient().refresh()).records
    const record = records.find(entry => entry.providerId === providerId)
    expect(record?.enabled).toBe(true)
    expect(record?.baseUrl).toBe(ENDPOINTS[providerId])
    expect(JSON.stringify(records)).not.toContain(KEY)
  })

  /**
   * Debt, pinned so it cannot be forgotten: a provider outside the curated
   * catalogue keeps the historical renderer path. Closing it is a separate cut
   * — the credential it reads is not one of the ten Lia executes.
   */
  it('still resolves a non-curated provider in the renderer, which is the remaining debt', async () => {
    useProviderConfigStore().ensureProvider('deepseek', 'deepseek', {})
    const result = await useLiaProviderStore().discoverModels({ providerId: 'deepseek' })
    expect(result.status).toBe('ready')
    expect(ipc.secretGet).toHaveBeenCalledWith({ scope: 'deepseek', key: 'apiKey' })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe(`Bearer ${KEY}`)
  })
})
