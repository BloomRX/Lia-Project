import type { ChatProvider } from '@xsai-ext/providers/utils'

import { PiniaColada } from '@pinia/colada'
import { resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { generateText } from '@xsai/generate-text'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { CURATED_CHAT_PROVIDER_IDS } from '../../../shared/lia/provider-catalog'
import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { createLiaTransportClient } from '../../services/lia/transport-config'
import { setTransportTestVaultResolver } from '../../services/lia/transport-config.fixture'

/**
 * PROMPT-26 — the AIRI consumers that build a chat client in the renderer.
 *
 * The chat path was migrated in Corte B, but three shared-AIRI consumers kept
 * calling `providerStore.getProviderInstance`, which resolves the vault key in
 * THIS process and builds an xsai client around it:
 *
 *  - `composables/vision/use-vision-inference.ts` (vision inference);
 *  - `stores/modules/artistry-autonomous.ts` (the autonomous artistry director,
 *    triggered from the chat store when a card enables it);
 *  - `stores/markdown-stress.ts` (devtools, opened from
 *    settings → system → developer).
 *
 * The fix has two halves, both asserted here:
 *
 *  1. the native chat factory now also wraps `getProviderInstance`, so a
 *     curated id returns the main-forwarding shim and never a key-bearing
 *     client;
 *  2. the leadership credential resolver refuses EVERY curated id, so anything
 *     that somehow bypasses (1) still cannot obtain the key.
 *
 * Both are needed: (1) keeps the features working, (2) is the chokepoint.
 */
const ipc = vi.hoisted(() => ({
  chatConfig: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  encryptionAvailable: vi.fn(async () => true),
  saveChatConfig: vi.fn(async (_config: Record<string, unknown>) => {}),
  secretDelete: vi.fn(async () => true),
  vaultRead: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
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

const { useLiaProviderStore, LIA_GROQ_TRANSCRIPTION_PROVIDER_ID } = await import('./provider')

const SECRET = 'SYNTHETIC_AIRI_CONSUMER_SECRET'
const MODEL = 'openai/gpt-oss-120b'
const ENDPOINT = 'https://openrouter.ai/api/v1/'
let fetchMock: ReturnType<typeof vi.fn>

function chatConfig() {
  return {
    onboarded: true,
    strategy: 'manual' as const,
    preferred: { providerId: 'openrouter-ai', modelId: MODEL },
    fallback: [],
    fallbackEnabled: true,
  }
}

function completion(text = 'AIRI consumer OK') {
  return new Response(JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200 })
}

beforeEach(() => {
  vi.clearAllMocks()
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultRead)
  resetChatProviderRuntimeExtensionsForTesting()
  // Main holds the key; this renderer's channel would hand it over if asked.
  ipc.vaultRead.mockResolvedValue(SECRET)
  ipc.secretGet.mockResolvedValue(SECRET)
  fetchMock = vi.fn(async () => completion())
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  resetChatProviderRuntimeExtensionsForTesting()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the renderer credential resolver is the chokepoint', () => {
  it.each(CURATED_CHAT_PROVIDER_IDS)('refuses %s without touching the vault channel', async (providerId) => {
    useLiaProviderStore().registerRuntimeExtensions()
    const { getProviderCredentialResolver } = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')
    const resolver = getProviderCredentialResolver()
    expect(resolver).toBeTypeOf('function')

    expect(await resolver!(providerId)).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('also refuses the derived transcription target, and still serves a non-curated id', async () => {
    useLiaProviderStore().registerRuntimeExtensions()
    const { getProviderCredentialResolver } = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')
    const resolver = getProviderCredentialResolver()!

    expect(await resolver(LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)).toBeUndefined()
    expect(ipc.secretGet).not.toHaveBeenCalled()

    // The remaining debt, pinned: an id outside the catalog still resolves here
    // until its consumers are migrated. This is NOT a claim of a safe boundary.
    expect(await resolver('deepseek')).toEqual({ apiKey: SECRET })
    expect(ipc.secretGet).toHaveBeenCalledWith({ scope: 'deepseek', key: 'apiKey' })
  })
})

describe('chat-shaped AIRI consumers reach main instead of the vault', () => {
  it('serves `getProviderInstance` for a curated id with the main-forwarding shim', async () => {
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: ENDPOINT })
    ipc.chatConfig.mockResolvedValue(chatConfig())
    useLiaProviderStore().registerChatTransport()

    const provider = await useProviderStore().getProviderInstance<ChatProvider>('openrouter-ai')
    const response = await provider!.chat(MODEL).fetch!(new URL('https://ignored.invalid'), {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'vision-shaped call' }] }),
    })
    await response.text()

    // Main executed it, against the endpoint the record carries…
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${ENDPOINT}chat/completions`)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).model).toBe(MODEL)
    // …with the key read from its own vault, never from this renderer.
    expect(ipc.vaultRead).toHaveBeenCalledWith({ scope: 'openrouter-ai', key: 'apiKey' })
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('keeps the autonomous artistry director (generateText over getProviderInstance) working through main', async () => {
    useProviderConfigStore().ensureProvider('openrouter-ai', 'openrouter-ai', { baseUrl: ENDPOINT })
    ipc.chatConfig.mockResolvedValue(chatConfig())
    useLiaProviderStore().registerChatTransport()

    // Exactly what `artistry-autonomous.ts` does: build through the generic
    // accessor, then call `chat(model)` and hand the result to generateText.
    const chatProvider = await useProviderStore().getProviderInstance<ChatProvider>('openrouter-ai')
    const result = await generateText({
      ...chatProvider!.chat(MODEL),
      messages: [{ role: 'user', content: 'analyze this scene' }],
    })

    expect(result.text).toBe('AIRI consumer OK')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(ipc.secretGet).not.toHaveBeenCalled()
    expect(ipc.vaultRead).toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  it('fails closed for a curated id with no record, instead of building a keyless client', async () => {
    // No saved endpoint anywhere: there is no safe address to create.
    useLiaProviderStore().registerChatTransport()

    await expect(useProviderStore().getProviderInstance('openrouter-ai'))
      .rejects
      .toThrowError(/configuration/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ipc.secretGet).not.toHaveBeenCalled()
  })

  it('leaves a non-curated provider on the untouched path, credentials included', async () => {
    useProviderConfigStore().ensureProvider('deepseek', 'deepseek', { baseUrl: 'https://api.deepseek.com/v1/' })
    useLiaProviderStore().registerRuntimeExtensions()

    const provider = await useProviderStore().getProviderInstance<ChatProvider>('deepseek')
    const chat = provider!.chat('deepseek-chat')

    // Documented debt, asserted as CURRENT behaviour: this build resolved the
    // key in THIS process and baked it into the client config, exactly like
    // every non-migrated provider. Closing it needs those consumers migrated.
    expect(ipc.secretGet).toHaveBeenCalledWith({ scope: 'deepseek', key: 'apiKey' })
    expect(chat.apiKey).toBe(SECRET)
    // And nothing about it enters the Lia transport repository.
    const records = (await createLiaTransportClient().refresh()).records
    expect(records.some(record => record.providerId === 'deepseek')).toBe(false)
  })
})
