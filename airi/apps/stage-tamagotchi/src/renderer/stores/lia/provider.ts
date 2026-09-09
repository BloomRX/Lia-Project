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
/**
 * Curated chat provider choices surfaced to the user (real AIRI catalog ids — no
 * new provider integration). Labels are brand names, not translatable UI text.
 *
 * `apiKeyUrl` is the official page where the user can create/manage an API key for
 * that provider. It is defined centrally here so the UI never hardcodes provider
 * URLs. Providers without a known page leave it undefined (the "get key" button is
 * then not shown).
 */
export interface LiaChatProviderOption {
  id: string
  label: string
  requiresBaseUrl?: boolean
  needsApiKey?: boolean
  /** Official API-key management page (external, opened in the system browser). */
  apiKeyUrl?: string
}

export const LIA_CHAT_PROVIDER_OPTIONS: LiaChatProviderOption[] = [
  { id: 'openai', label: 'OpenAI', needsApiKey: true, apiKeyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'groq', label: 'Groq', needsApiKey: true, apiKeyUrl: 'https://console.groq.com/keys' },
  { id: 'cerebras-ai', label: 'Cerebras', needsApiKey: true, apiKeyUrl: 'https://cloud.cerebras.ai/platform/api-keys' },
  { id: 'anthropic', label: 'Anthropic', needsApiKey: true, apiKeyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'xai', label: 'xAI', needsApiKey: true, apiKeyUrl: 'https://console.x.ai/' },
  { id: 'mistral-ai', label: 'Mistral', needsApiKey: true, apiKeyUrl: 'https://console.mistral.ai/api-keys/' },
  { id: 'openrouter-ai', label: 'OpenRouter', needsApiKey: true, apiKeyUrl: 'https://openrouter.ai/keys' },
  { id: 'openai-compatible', label: 'OpenAI-compatible', requiresBaseUrl: true },
  { id: 'lm-studio', label: 'LM Studio', requiresBaseUrl: true, needsApiKey: false },
  { id: 'ollama', label: 'Ollama', requiresBaseUrl: true, needsApiKey: false },
]

/**
 * One selectable chat model for a provider. `id` is the technical id that is
 * persisted and sent to the API; `label` is the human-friendly name shown in
 * the dropdown (never shown to the user to type). `recommended` flags the
 * default to auto-select when the user first picks the provider (or when the
 * previously chosen model is no longer offered for it).
 */
export interface LiaModelOption {
  id: string
  label: string
  recommended?: boolean
}

/**
 * Curated chat model choices per provider (real model ids — not invented).
 *
 * Source notes:
 * - The Anthropic entries are copied verbatim from the real AIRI provider
 *   catalog (`stage-ui/.../providers/anthropic` `extraMethods.listModels`).
 * - The other cloud providers (OpenAI, Groq, Cerebras, xAI, Mistral,
 *   OpenRouter) ship NO static catalog in AIRI — their models are fetched live
 *   from the provider API once a key exists. Because the Lia API key lives only
 *   in the main-process vault (never in the provider-config store that AIRI's
 *   live fetcher reads), those providers can't be live-listed from the vault
 *   here. So we keep a small, current set of real ids as the always-available
 *   dropdown source; the "Test connection" step validates the chosen one.
 * - Local/self-hosted providers (Ollama, LM Studio, OpenAI-compatible) expose
 *   whatever the user has loaded/serves, so we offer a small set of common
 *   known models rather than forcing the user to type an id. Providers without
 *   a curated entry degrade to a single controlled option instead of a free
 *   field.
 *
 * These ids can drift as providers deprecate/rename models; that is handled at
 * the "Test connection" step (friendly error, model stays selectable/switchable)
 * and never by asking the user to type an id.
 */
export const LIA_MODEL_CATALOG: Record<string, LiaModelOption[]> = {
  openai: [
    { id: 'gpt-5.4', label: 'GPT-5.4', recommended: true },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'o3', label: 'OpenAI o3' },
    { id: 'o4-mini', label: 'OpenAI o4-mini' },
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', recommended: true },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
    { id: 'qwen/qwen3-32b', label: 'Qwen3 32B' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
  ],
  'cerebras-ai': [
    { id: 'llama-3.3-70b', label: 'Llama 3.3 70B', recommended: true },
    { id: 'llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
    { id: 'qwen-3-32b', label: 'Qwen3 32B' },
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
    { id: 'llama3.1-8b', label: 'Llama 3.1 8B' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', recommended: true },
    { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  xai: [
    { id: 'grok-4.5', label: 'Grok 4.5', recommended: true },
    { id: 'grok-4', label: 'Grok 4' },
    { id: 'grok-3-mini', label: 'Grok 3 mini' },
  ],
  'mistral-ai': [
    { id: 'mistral-large-latest', label: 'Mistral Large', recommended: true },
    { id: 'mistral-medium', label: 'Mistral Medium' },
    { id: 'codestral-latest', label: 'Codestral' },
  ],
  'openrouter-ai': [
    { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', recommended: true },
    { id: 'openai/gpt-5', label: 'OpenAI GPT-5' },
    { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o mini' },
    { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  ],
  ollama: [
    { id: 'llama3.1', label: 'Llama 3.1', recommended: true },
    { id: 'llama3.3', label: 'Llama 3.3' },
    { id: 'qwen2.5', label: 'Qwen 2.5' },
    { id: 'mistral', label: 'Mistral' },
    { id: 'gemma2', label: 'Gemma 2' },
  ],
  'lm-studio': [
    { id: 'llama-3.1-8b-instruct', label: 'Llama 3.1 8B', recommended: true },
    { id: 'qwen2.5-7b-instruct', label: 'Qwen 2.5 7B' },
    { id: 'mistral-7b-instruct', label: 'Mistral 7B' },
  ],
  'openai-compatible': [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini (compatible)', recommended: true },
    { id: 'gpt-4o', label: 'GPT-4o (compatible)' },
  ],
}

/** Human models selectable for a provider (falls back to an empty list). */
export function curatedModelsFor(providerId: string): LiaModelOption[] {
  return LIA_MODEL_CATALOG[providerId] ?? []
}

/** Whether `modelId` is offered by the current curated catalog for provider. */
export function isModelInCatalog(providerId: string, modelId?: string): boolean {
  if (!modelId)
    return false
  return curatedModelsFor(providerId).some(option => option.id === modelId)
}

/**
 * The model to auto-select for a provider: its `recommended` entry when one is
 * flagged, otherwise the first curated entry. Returns undefined only when the
 * provider has no curated catalog (callers must not open a free field then).
 */
export function recommendedModelFor(providerId: string): string | undefined {
  return curatedModelsFor(providerId).find(option => option.recommended)?.id
    ?? curatedModelsFor(providerId)[0]?.id
}

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

  /** Whether a given provider requires an API key credential (defaults true). */
  function providerNeedsKey(providerId: string): boolean {
    return optionFor(providerId)?.needsApiKey !== false
  }

  /** Official API-key management page for a provider, if one is configured. */
  function providerApiKeyUrl(providerId: string): string | undefined {
    return optionFor(providerId)?.apiKeyUrl
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
   * Whether the persisted config is genuinely ready to have a conversation.
   *
   * Ready requires: a preferred provider + model, the `onboarded` completion
   * marker, and an API key stored in the secure vault for that provider. The
   * explicit marker alone (onboarded=true with an invalid config) never reports
   * ready — readiness is recomputed from the real config every call. No secret
   * is read here, only its presence.
   */
  async function isReadyToChat(): Promise<boolean> {
    const config = loadedConfig.value ?? (await refreshConfig())
    const preferred = config.preferred
    if (!preferred?.providerId || !preferred.modelId)
      return false
    if (config.onboarded !== true)
      return false
    return secretHas({ scope: preferred.providerId, key: API_KEY_NAME })
  }

  /** Marks the first-run provider setup as complete for the current config. */
  async function markOnboarded(): Promise<void> {
    const config = loadedConfig.value ?? (await refreshConfig())
    await persistConfig({ ...config, onboarded: true })
  }

  /**
   * Whether the configured fallback is genuinely usable: a fallback provider +
   * model is present AND the credential it needs exists in the vault.
   *
   * Credential resolution follows the per-provider secret rule:
   * - a fallback that does not require a key (e.g. local/no-endpoint) is ready
   *   as soon as its provider+model exist;
   * - a fallback on the SAME provider as the primary shares the primary's
   *   scope/key (no duplicate secret);
   * - a fallback on a DIFFERENT provider must have its own key stored.
   */
  async function isFallbackConfigured(): Promise<boolean> {
    const config = loadedConfig.value ?? (await refreshConfig())
    const fb = config.fallback?.[0]
    if (!fb?.providerId || !fb.modelId)
      return false
    if (!providerNeedsKey(fb.providerId))
      return true
    const primary = config.preferred
    const scope = primary?.providerId === fb.providerId
      ? primary!.providerId
      : fb.providerId
    return secretHas({ scope, key: API_KEY_NAME })
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
    isReadyToChat,
    markOnboarded,
    isFallbackConfigured,
    providerNeedsKey,
    providerApiKeyUrl,
    curatedModelsFor,
    isModelInCatalog,
    recommendedModelFor,
    registerRuntimeExtensions,
  }
})
