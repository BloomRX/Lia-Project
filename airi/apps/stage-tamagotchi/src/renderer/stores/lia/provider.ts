import type { LiaProviderChatConfig, LiaProviderChatTarget } from '../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { registerChatFallbackResolver, registerProviderCredentialResolver } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { errorMessageFrom } from '@moeru/std'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  electronLiaProviderChatConfigGet,
  electronLiaProviderChatConfigSet,
  electronLiaSecretDelete,
  electronLiaSecretEncryptionAvailable,
  electronLiaSecretGet,
  electronLiaSecretHas,
  electronLiaSecretSet,
} from '../../../shared/eventa'

/**
 * Curated chat provider choices surfaced to the user (real AIRI catalog ids —
 * no new provider integration). Labels are brand names, not translatable UI text.
 */
export const LIA_CHAT_PROVIDER_OPTIONS: Array<{ id: string, label: string, requiresBaseUrl?: boolean, needsApiKey?: boolean }> = [
  { id: 'openai', label: 'OpenAI', needsApiKey: true },
  { id: 'groq', label: 'Groq', needsApiKey: true },
  { id: 'cerebras-ai', label: 'Cerebras', needsApiKey: true },
  { id: 'anthropic', label: 'Anthropic', needsApiKey: true },
  { id: 'xai', label: 'xAI', needsApiKey: true },
  { id: 'mistral-ai', label: 'Mistral', needsApiKey: true },
  { id: 'openrouter-ai', label: 'OpenRouter', needsApiKey: true },
  { id: 'openai-compatible', label: 'OpenAI-compatible', requiresBaseUrl: true },
  { id: 'lm-studio', label: 'LM Studio', requiresBaseUrl: true, needsApiKey: false },
  { id: 'ollama', label: 'Ollama', requiresBaseUrl: true, needsApiKey: false },
]

const API_KEY_NAME = 'apiKey'

/** Shallow recoverability heuristic for the technical log / fallback decision. */
function isRecoverableChatError(error: unknown): boolean {
  const text = errorMessageFrom(error) ?? ''
  const permanentMarkers = [
    '401', '403', 'invalid api key', 'api key', 'authentication', 'unauthorized',
    'not found', 'model_not_found', '404', '400', 'unsupported', 'invalid config',
    'configuration', 'no active chat provider', 'not configured', 'no credentials',
    'credentials', 'cors', 'certificate', 'blocked',
  ]
  return !permanentMarkers.some(marker => text.toLowerCase().includes(marker.toLowerCase()))
}

/**
 * Lia chat-provider setup + activation (M1 Phase 4C), Electron desktop only.
 *
 * - References/metadata (provider/model) persist in `lia/product.json`.
 * - The API key lives ONLY in the main-process safeStorage vault (fetched on
 *   demand for one provider build; never in localStorage, product.json, or logs).
 * - Registers the inert-by-default runtime hooks that let the existing AIRI chat
 *   stream with the vault key and fail over to a fallback provider on recoverable
 *   errors.
 */
export const useLiaProviderStore = defineStore('lia-provider', () => {
  const providersStore = useProviderStore()
  const providerConfigStore = useProviderConfigStore()
  const consciousnessStore = useConsciousnessStore()

  const getChatConfig = useElectronEventaInvoke(electronLiaProviderChatConfigGet)
  const saveChatConfig = useElectronEventaInvoke(electronLiaProviderChatConfigSet)
  const getEncryptionAvailable = useElectronEventaInvoke(electronLiaSecretEncryptionAvailable)
  const secretHas = useElectronEventaInvoke(electronLiaSecretHas)
  const secretSet = useElectronEventaInvoke(electronLiaSecretSet)
  const secretGet = useElectronEventaInvoke(electronLiaSecretGet)
  const secretDelete = useElectronEventaInvoke(electronLiaSecretDelete)

  const loadedConfig = ref<LiaProviderChatConfig | undefined>(undefined)

  async function refreshConfig(): Promise<LiaProviderChatConfig> {
    loadedConfig.value = await getChatConfig()
    return loadedConfig.value ?? {}
  }

  async function persistConfig(config: LiaProviderChatConfig) {
    await saveChatConfig(config)
    loadedConfig.value = config
  }

  async function isKeyStoreAvailable(): Promise<boolean> {
    return getEncryptionAvailable()
  }

  async function hasApiKey(providerId: string): Promise<boolean> {
    return secretHas({ scope: providerId, key: API_KEY_NAME })
  }

  async function setApiKey(providerId: string, value: string): Promise<boolean> {
    return secretSet({ scope: providerId, key: API_KEY_NAME, value })
  }

  async function deleteApiKey(providerId: string): Promise<boolean> {
    return secretDelete({ scope: providerId, key: API_KEY_NAME })
  }

  /** Resolves the vault apiKey for one provider build. Never persisted/logged. */
  async function resolveApiKey(providerId: string): Promise<string | undefined> {
    return secretGet({ scope: providerId, key: API_KEY_NAME })
  }

  function optionFor(providerId: string) {
    return LIA_CHAT_PROVIDER_OPTIONS.find(option => option.id === providerId)
  }

  /**
   * Ensures a keyless provider record exists (so the shared provider runtime can
   * build an instance) and records any custom base URL. The apiKey is NOT stored
   * here — the registered credential resolver supplies it in memory.
   */
  async function ensureProviderRecord(providerId: string, baseUrl?: string) {
    const definitionId = providerId
    if (!providerConfigStore.getProvider(providerId)) {
      providerConfigStore.ensureProvider(providerId, definitionId, baseUrl ? { baseUrl } : {})
    }
    else if (baseUrl) {
      const current = providerConfigStore.getProviderConfig(providerId) ?? {}
      await providerConfigStore.updateProviderConfig(providerId, { ...current, baseUrl }, 'unconfigured')
    }
    // The provider config store writes only references/metadata. The resolver
    // below will add the transient apiKey when the instance is actually built.
    return providerConfigStore.getProvider(providerId)
  }

  /** Test the configured provider/model + endpoint using the vault key on demand. */
  async function testConnection(args: {
    providerId: string
    modelId?: string
    apiKey?: string
    baseUrl?: string
  }): Promise<{ ok: boolean, message: string }> {
    const { providerId, baseUrl } = args
    const apiKey = args.apiKey ?? (await resolveApiKey(providerId))
    const config: Record<string, unknown> = {}
    if (baseUrl)
      config.baseUrl = baseUrl
    if (apiKey)
      config.apiKey = apiKey

    try {
      const result = await providersStore.validateProviderConfig(providerId, config)
      return {
        ok: result.valid,
        message: result.valid ? '' : (result.reason || 'Connection failed'),
      }
    }
    catch (error) {
      // Friendly, sanitized message — no stack trace, no secret material.
      return { ok: false, message: errorMessageFrom(error) ?? 'Connection failed' }
    }
  }

  /** Makes the shared chat runtime route the next send through the given target. */
  async function activateTarget(target: LiaProviderChatTarget, baseUrl?: string) {
    if (!target?.providerId)
      return
    // Drop any cached provider instance so the next build re-resolves the vault
    // key (in case the user updated it since the last build).
    await providersStore.disposeProviderInstance(target.providerId)
    await ensureProviderRecord(target.providerId, baseUrl)
    // Watcher flushes synchronously on provider change and clears the model, so
    // set provider first, then model (safe, ordered operation).
    consciousnessStore.activeProvider = target.providerId
    if (target.modelId) {
      consciousnessStore.activeModel = target.modelId
    }
  }

  /** Activates the user's preferred Lia chat provider/model for conversation. */
  async function activatePreferred(): Promise<boolean> {
    const config = loadedConfig.value ?? (await refreshConfig())
    const preferred = config.preferred
    if (!preferred?.providerId) {
      return false
    }
    await activateTarget(preferred)
    return true
  }

  /**
   * Installs the inert-by-default runtime hooks for the current renderer session.
   * Called once by the Lia Home (main window). Idempotent.
   */
  function registerRuntimeExtensions() {
    // Supply the per-use vault apiKey when the provider runtime builds an
    // instance for a Lia-configured provider. Absent a stored secret it returns
    // undefined and behaviour is unchanged.
    registerProviderCredentialResolver(async (providerId) => {
      const key = await resolveApiKey(providerId)
      return key ? { apiKey: key } : undefined
    })

    // Fail over along the Lia configured chain on recoverable errors, bounded by
    // the runtime's hard attempt ceiling.
    registerChatFallbackResolver(async (ctx) => {
      const config = loadedConfig.value ?? (await refreshConfig())
      if (config.fallbackEnabled === false)
        return undefined
      if (!isRecoverableChatError(ctx.error))
        return undefined

      const chain: LiaProviderChatTarget[] = [config.preferred, ...(config.fallback ?? [])]
        .filter((target): target is LiaProviderChatTarget => Boolean(target?.providerId))
      if (chain.length < 2)
        return undefined

      const currentIndex = chain.findIndex(target => target.providerId === ctx.providerId)
      if (currentIndex < 0)
        return undefined
      const next = chain[currentIndex + 1]
      return next ? { providerId: next.providerId, modelId: next.modelId } : undefined
    })
  }

  return {
    loadedConfig,
    refreshConfig,
    persistConfig,
    isKeyStoreAvailable,
    hasApiKey,
    setApiKey,
    deleteApiKey,
    resolveApiKey,
    testConnection,
    ensureProviderRecord,
    activateTarget,
    activatePreferred,
    registerRuntimeExtensions,
  }
})
