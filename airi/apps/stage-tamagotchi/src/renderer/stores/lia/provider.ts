import type { LiaProviderChatConfig, LiaProviderChatTarget } from '../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { registerChatFallbackResolver, registerProviderCredentialResolver, registerProviderModelLister } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { registerProviderCredentialConfigPort } from '@proj-airi/stage-ui/stores/providers/credential-config-port'
import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'

import { ProviderError } from '../../../../../../../lia/core/src/providers/index'
import { isTransportRecord } from '../../../../../../../lia/core/src/transports/validation'
import {
  electronLiaProviderChatConfigGet,
  electronLiaProviderChatConfigSet,
  electronLiaSecretAdopt,
  electronLiaSecretDelete,
  electronLiaSecretEncryptionAvailable,
  electronLiaSecretGet,
  electronLiaSecretHas,
  electronLiaSecretSet,
} from '../../../shared/eventa'
import { supportsMainTranscription } from '../../../shared/lia/transcription-transport'
import { removeLegacyApiKey, stripCredentialField } from '../../services/lia/legacy-credential-cleanup'
import { createMainTransportExecution } from '../../services/lia/main-transport-execution'
import { createNativeProviderRuntime } from '../../services/lia/native-provider-runtime'
import { createLiaTransportClient, isNativeTransportDefinition, legacyTransportCandidates, toTransportRecord } from '../../services/lia/transport-config'
import { useLiaProviderActivation } from './provider-activation'
import { isUsableWithoutAiriSession } from './provider-auth-policy'
import { useLiaProviderConfigFacade } from './provider-config-facade'
import { useLiaProviderRuntime } from './provider-runtime'

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

/** A suggestion, never an allowlist or a reason to replace a user's ID. */
export interface LiaModelOption {
  id: string
  label: string
  recommended?: boolean
}

/** Offline suggestions retained for compatibility; discovery and manual IDs take precedence. */
export const LIA_MODEL_CATALOG: Record<string, LiaModelOption[]> = {
  'openai': [
    { id: 'gpt-5.4', label: 'GPT-5.4', recommended: true },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { id: 'gpt-5', label: 'GPT-5' },
    { id: 'o3', label: 'OpenAI o3' },
    { id: 'o4-mini', label: 'OpenAI o4-mini' },
    { id: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
  ],
  'groq': [
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
  'anthropic': [
    { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', recommended: true },
    { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  'xai': [
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
  'ollama': [
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
 * provider has no curated catalog. A manual ID is always allowed.
 */
export function recommendedModelFor(providerId: string): string | undefined {
  return curatedModelsFor(providerId).find(option => option.recommended)?.id
    ?? curatedModelsFor(providerId)[0]?.id
}

const API_KEY_NAME = 'apiKey'

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: derived Lia provider ids that REUSE an
 * existing vault credential instead of owning one.
 *
 * `lia-groq-transcription` is a derived runtime id projected onto the existing
 * OpenAI-compatible transcription adapter. It has no credential of its own: the
 * user already stored one Groq key for chat, and duplicating it would mean two
 * copies of one secret to rotate. So the resolver reads the `groq` scope.
 *
 * This mapping is READ-ONLY and deliberately total (identity for everything
 * else). It is applied on the resolver's read path ONLY - `secretHas`,
 * `setApiKey` and `deleteApiKey` keep exact identity, so no caller can write a
 * second secret into `groq` under an alias.
 */
export const CREDENTIAL_SCOPE_ALIASES: Readonly<Record<string, string>> = {
  'lia-groq-transcription': 'groq',
}

/** The derived Lia transcription provider id the Launcher writes by default. */
export const LIA_GROQ_TRANSCRIPTION_PROVIDER_ID = 'lia-groq-transcription'

/** Maps a provider id to the vault scope holding its credential. */
export function secretScopeFor(providerId: string): string {
  return CREDENTIAL_SCOPE_ALIASES[providerId] ?? providerId
}

/**
 * Rebuilds a chat config as plain, structured-clonable data.
 *
 * `loadedConfig` is a `ref`, so every value read back out of it — the nested
 * `preferred` / `fallback` objects included — is a Vue reactive `Proxy`. The
 * eventa Electron adapter ships invoke payloads with `ipcRenderer.send(...)`,
 * i.e. the structured clone algorithm, which cannot clone a `Proxy` and throws
 * "An object could not be cloned.". A shallow spread of the loaded config keeps
 * those nested proxies, so it is not enough: the payload has to be rebuilt field
 * by field. Every write goes through `persistConfig`, so normalizing here keeps
 * the whole bridge safe regardless of how a caller built its config.
 */
function toSerializableTarget(target?: LiaProviderChatTarget): LiaProviderChatTarget | undefined {
  if (!target?.providerId)
    return undefined

  return target.modelId === undefined
    ? { providerId: target.providerId }
    : { providerId: target.providerId, modelId: target.modelId }
}

function toSerializableChatConfig(config: LiaProviderChatConfig): LiaProviderChatConfig {
  const fallback = (config.fallback ?? [])
    .map(target => toSerializableTarget(target))
    .filter((target): target is LiaProviderChatTarget => target !== undefined)

  return {
    strategy: config.strategy,
    preferred: toSerializableTarget(config.preferred),
    fallback,
    fallbackEnabled: config.fallbackEnabled,
    onboarded: config.onboarded,
  }
}

/** Shallow recoverability heuristic for the technical log / fallback decision. */
function isRecoverableChatError(error: unknown): boolean {
  const text = errorMessageFrom(error) ?? ''
  const permanentMarkers = [
    '401',
    '403',
    'invalid api key',
    'api key',
    'authentication',
    'unauthorized',
    'not found',
    'model_not_found',
    '404',
    '400',
    'unsupported',
    'invalid config',
    'configuration',
    'no active chat provider',
    'not configured',
    'no credentials',
    'credentials',
    'cors',
    'certificate',
    'blocked',
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
  const providerActivation = useLiaProviderActivation()
  const providerConfig = useLiaProviderConfigFacade()
  const providerRuntime = useLiaProviderRuntime()
  const consciousnessStore = useConsciousnessStore()

  const getChatConfig = useElectronEventaInvoke(electronLiaProviderChatConfigGet)
  const saveChatConfig = useElectronEventaInvoke(electronLiaProviderChatConfigSet)
  const getEncryptionAvailable = useElectronEventaInvoke(electronLiaSecretEncryptionAvailable)
  const secretHas = useElectronEventaInvoke(electronLiaSecretHas)
  const secretSet = useElectronEventaInvoke(electronLiaSecretSet)
  const secretGet = useElectronEventaInvoke(electronLiaSecretGet)
  const secretAdopt = useElectronEventaInvoke(electronLiaSecretAdopt)
  const secretDelete = useElectronEventaInvoke(electronLiaSecretDelete)
  const loadedConfig = ref<LiaProviderChatConfig | undefined>(undefined)

  /**
   * Folds one legacy plaintext key into the vault and reports whether main now
   * holds THAT value.
   *
   * `retry` means "not yet, and the caller must not treat the provider as
   * configured": the platform keychain is unavailable or the write failed. That
   * is the same fail-closed rule the migration already applied with `secretSet`,
   * kept because a provider whose key silently failed to store would send
   * unauthenticated requests instead of surfacing the problem.
   *
   * `conflict` is deliberately NOT a retry and NOT an adoption: the vault holds a
   * different value, which is newer by construction (it was written after the
   * local copy), so the local copy is left alone rather than overwritten.
   */
  async function adoptCredential(providerId: string, encryptionAvailable: boolean, value: string): Promise<'adopted' | 'conflict' | 'retry'> {
    if (!encryptionAvailable)
      return 'retry'
    const outcome = await secretAdopt({ scope: providerId, key: API_KEY_NAME, value })
    if (outcome === 'unavailable')
      return 'retry'
    return outcome === 'conflict' ? 'conflict' : 'adopted'
  }

  /**
   * Deletes the plaintext copy main just confirmed it holds.
   *
   * Best-effort by design: failing to clean `localStorage` must not abort a
   * migration whose important half (the vault write) already succeeded, and the
   * next launch retries because the key is still there to be adopted.
   */
  function clearLegacyCredential(providerId: string) {
    try {
      if (typeof localStorage === 'undefined')
        return
      const changed = removeLegacyApiKey(localStorage, providerId)
      // The shared store's own record is deep-watched and re-serialised on the
      // next provider write, so deleting the field from storage alone would be
      // undone. Keep the reactive copy and the stored copy in step.
      const current = changed.configured ? providerConfig.getConfig(providerId) : undefined
      const withoutKey = stripCredentialField(current)
      if (current && withoutKey)
        providerConfig.replaceConfig(providerId, withoutKey)
    }
    catch {
      // See above: storage access is the best-effort half of this repair.
    }
  }

  const transports = createLiaTransportClient()
  const rejectedTransports = new Set<string>()
  let disposed = false
  let uninstallFactory: (() => void) | undefined
  let uninstallCredentialConfig: (() => void) | undefined
  let migration: Promise<void> | undefined
  async function initializeTransports() {
    if (!migration) {
      migration = (async () => {
        await transports.refresh()
        const readLegacy = (key: string) => {
          try {
            return JSON.parse(localStorage.getItem(key) ?? '{}')
          }
          catch {
            return {}
          }
        }
        const value = readLegacy('settings/providers/configured')
        const configured = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        // Include the already-hydrated store snapshot; never write it here.
        for (const id of ['openai-compatible', 'lm-studio']) {
          const record = providerConfig.get(id)
          if (record)
            configured[id] = record
        }
        const records = []
        let retryCredentialMigration = false
        /** Provider ids whose plaintext key main confirmed it now holds verbatim. */
        const adopted = new Set<string>()
        for (const candidate of legacyTransportCandidates(configured, readLegacy('settings/credentials/providers'))) {
          const key = candidate.config.apiKey
          if (typeof key === 'string' && key) {
            const outcome = await adoptCredential(candidate.id, await getEncryptionAvailable(), key)
            if (outcome === 'retry') {
              rejectedTransports.add(candidate.id)
              retryCredentialMigration = true
              continue
            }
            if (outcome === 'adopted')
              adopted.add(candidate.id)
          }
          if (transports.get(candidate.id) || transports.hasRemoved(candidate.id))
            continue
          const models = [loadedConfig.value?.preferred, ...(loadedConfig.value?.fallback ?? [])]
            .filter(target => target?.providerId === candidate.id)
            .flatMap(target => target?.modelId ? [target.modelId] : [])
          const record = toTransportRecord(candidate.id, candidate.definitionId, candidate.config, models)
          if (!isTransportRecord(record)) {
            if (typeof candidate.config.baseUrl === 'string' && candidate.config.baseUrl.trim())
              rejectedTransports.add(candidate.id)
            continue
          }
          records.push(record)
        }
        if (records.length) {
          // A competing window may have imported first. Migration never overwrites.
          await transports.refresh()
          await transports.migrate(records)
        }
        /**
         * Only after the record migration has actually landed: the vault holds
         * the value and the transport that will use it exists. Cleaning before
         * this point could destroy the only copy of a key whose record then
         * failed to persist.
         */
        for (const providerId of adopted)
          clearLegacyCredential(providerId)
        if (retryCredentialMigration)
          migration = undefined
      })().catch(() => {
        migration = undefined
        throw new Error('Transport migration unavailable')
      })
    }
    await migration
  }

  const nativeRuntime = createNativeProviderRuntime({
    execution: createMainTransportExecution(),
    readConfig: (id) => {
      const record = transports.get(id)
      if (record) {
        if (!record.enabled)
          throw new ProviderError('configuration')
        return { ...record.adapterOptions, baseUrl: record.baseUrl, _liaTransport: true }
      }
      if (transports.hasRemoved(id) || rejectedTransports.has(id))
        throw new ProviderError('configuration')
      return undefined
    },
    beforeRead: async () => {
      if (disposed)
        throw new ProviderError('cancelled')
      await initializeTransports()
      await transports.refresh()
      if (disposed)
        throw new ProviderError('cancelled')
    },
  })
  onScopeDispose(() => {
    disposed = true
    uninstallFactory?.()
    uninstallCredentialConfig?.()
    registerProviderModelLister(undefined)
    nativeRuntime.dispose()
  })

  async function refreshConfig(): Promise<LiaProviderChatConfig> {
    loadedConfig.value = await getChatConfig()
    await initializeTransports()
    await transports.refresh()
    return loadedConfig.value ?? {}
  }

  async function persistConfig(config: LiaProviderChatConfig) {
    const payload = toSerializableChatConfig(config)
    await saveChatConfig(payload)
    loadedConfig.value = payload
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

  /**
   * The inference tasks whose credential this renderer is still allowed to hold.
   *
   * The Lia executes in main every task it can (chat for the ten curated ids,
   * transcription for the derived Groq target, model discovery and probe). What
   * remains here is the AIRI legacy that has not been migrated, and only two of
   * those tasks have any renderer-side consumer left:
   *
   *  - `chat` — a provider outside the curated catalog still builds its client
   *    in this process. Documented debt, deliberately unchanged here.
   *  - speech-to-text — the product document may point STT at any provider;
   *    Groq runs in main, the rest keeps the legacy path.
   *
   * `text-to-speech` is deliberately absent. The voice preview (and the Stage's
   * speech output) synthesise in this renderer, so handing them a vault key is
   * precisely the exposure this policy closes: no TTS consumer in the Lia
   * receives one any more. Local engines (`voicevox`, `app-local-audio-speech`,
   * `index-tts-vllm`, `kokoro-local`, …) declare no credential to begin with, so
   * refusing it changes nothing for them — which is why this is a task-based
   * rule and not a blanket "block every voice provider".
   *
   * Embeddings, image and any future task are excluded for the same reason as
   * TTS: nothing in the Lia executes them in this renderer.
   */
  const RENDERER_CREDENTIAL_TASKS: ReadonlySet<string> = new Set([
    'chat',
    'speech-to-text',
    'automatic-speech-recognition',
    'asr',
    'stt',
  ])

  /**
   * Whether the declared capabilities of a provider allow its credential to
   * exist in this renderer at all.
   *
   * Derived from the provider definition's own `tasks` — never from a Lia-side
   * list — so a provider added upstream is classified without anyone editing
   * this file, and an id with no definition (a derived target, or a typo) fails
   * closed.
   */
  function rendererMayHoldCredential(providerId: string): boolean {
    return providerRuntime.providerTasks(providerId)
      .some(task => RENDERER_CREDENTIAL_TASKS.has(String(task).toLowerCase()))
  }

  /**
   * Resolves the vault apiKey for one provider build. Never persisted/logged.
   *
   * The only path from this renderer to a stored secret, so the capability
   * policy is enforced here rather than at each caller: a provider whose
   * definition declares no renderer-eligible task answers `undefined` without
   * the vault ever being read. Callers see the same "no credential" they see
   * for a provider the user never configured, and the build proceeds without
   * one — never with someone else's.
   */
  async function resolveApiKey(providerId: string): Promise<string | undefined> {
    if (isNativeTransportDefinition(providerId) || supportsMainTranscription(providerConfig.get(providerId)?.definitionId ?? providerId) || !rendererMayHoldCredential(providerId))
      return undefined
    // Derived targets resolve through their alias; everything else is identity.
    return secretGet({ scope: secretScopeFor(providerId), key: API_KEY_NAME })
  }

  function optionFor(providerId: string) {
    const definitionId = transports.get(providerId)?.definitionId ?? providerId
    return LIA_CHAT_PROVIDER_OPTIONS.find(option => option.id === definitionId)
  }

  /** Whether a given provider requires an API key credential (defaults true). */
  function providerNeedsKey(providerId: string): boolean {
    const native = transports.get(providerId)
    if (native?.enabled && native.protocol === 'chat-completions' && native.adapterOptions.allowUnauthenticated === true)
      return false
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
    const definitionId = providerConfig.get(providerId)?.definitionId ?? providerId
    if (isNativeTransportDefinition(providerId) || supportsMainTranscription(definitionId) || transports.get(providerId)) {
      await initializeTransports()
      await transports.refresh()
      const previous = transports.get(providerId)
      /**
       * The endpoint this record will carry, in order of authority:
       *
       *  1. what the caller just typed;
       *  2. what the record already saved;
       *  3. what the user saved for this provider in the shared config —
       *     including a URL migrated from the legacy keys, which is the only
       *     copy an upgrading install has;
       *  4. the endpoint the provider's own schema declares.
       *
       * Step 4 is what makes a curated provider migratable at all: without it,
       * choosing `openai` and typing only a key produced no record, no record
       * meant no native ownership, and chat fell silently back to the legacy
       * path — the one that resolves the vault key inside this renderer.
       * Reading the default from the schema keeps that URL written once.
       */
      const stored = providerConfig.getConfig(providerId)?.baseUrl
      const endpoint = baseUrl
        ?? previous?.baseUrl
        ?? (typeof stored === 'string' && stored.trim() ? stored.trim() : undefined)
        ?? providerRuntime.defaultBaseUrl(providerId)
      if (endpoint) {
        const models = [loadedConfig.value?.preferred, ...(loadedConfig.value?.fallback ?? [])]
          .filter(target => target?.providerId === providerId)
          .flatMap(target => target?.modelId ? [target.modelId] : [])
        const build = (current: typeof previous) => current
          ? { ...current, baseUrl: endpoint, modelIds: [...new Set([...current.modelIds, ...models])] }
          : toTransportRecord(providerId, definitionId, { baseUrl: endpoint }, models)
        // Activation runs before every send, so an unconditional write would
        // bump the revision — and the main process invalidates in-flight jobs on
        // every revision — for a record that did not change.
        const record = build(previous)
        if (!previous || previous.baseUrl !== record.baseUrl || previous.modelIds.join('\u0000') !== record.modelIds.join('\u0000'))
          await putRecord(providerId, endpoint, build)
      }
      // Metadata compatibility for consumers not migrated yet. No endpoint write/PATCH.
      const owned = transports.get(providerId)
      return providerConfig.get(providerId) ?? providerConfig.ensure(providerId, owned?.definitionId ?? providerId, {})
    }
    if (!providerConfig.get(providerId)) {
      providerConfig.ensure(providerId, definitionId, baseUrl ? { baseUrl } : {})
    }
    else if (baseUrl) {
      const current = providerConfig.getConfig(providerId) ?? {}
      // The only Lia configuration write with a remote effect: the shared store
      // still replicates this payload with a PATCH. B0.7 keeps it switched on.
      await providerConfig.updateConfig(providerId, { ...current, baseUrl }, 'unconfigured')
    }
    // The provider config store writes only references/metadata. The resolver
    // below will add the transient apiKey when the instance is actually built.
    return providerConfig.get(providerId)
  }

  /** Metadata read only; never returns the vault key. */
  function providerBaseUrl(providerId: string): string | undefined {
    const record = transports.get(providerId)
    if (record)
      return record.baseUrl
    if (isNativeTransportDefinition(providerId) || transports.hasRemoved(providerId))
      return undefined
    const value = providerConfig.getConfig(providerId)?.baseUrl
    return typeof value === 'string' ? value : undefined
  }

  /** Removal retains the vault entry; deleting a saved key is a separate explicit action. */
  async function removeTransport(providerId: string) {
    await initializeTransports()
    await transports.refresh()
    const record = transports.get(providerId)
    if (record)
      await transports.remove(record.id)
    nativeRuntime.dispose(providerId)
  }

  /**
   * Writes a provider record, converging instead of failing when another window
   * wrote first.
   *
   * `transports.put` is compare-and-swap: a stale revision is rejected, which is
   * right for a user edit ("someone else changed this, show them") but wrong for
   * "ensure this provider has an endpoint". Two windows activating the same
   * provider — or two concurrent preparations of the same unsaved provider —
   * would otherwise turn a benign race into a failed send.
   *
   * So: on a rejected write, refresh and re-decide against the snapshot that
   * won. If that snapshot already carries the same endpoint (and the models this
   * caller wanted are present, or it is the same record), the intent is
   * satisfied and nothing else is written. Only a genuinely different endpoint
   * retries once, and a second rejection is surfaced rather than looped.
   */
  async function putRecord(
    providerId: string,
    endpoint: string,
    build: (current: ReturnType<typeof transports.get>) => ReturnType<typeof transports.get>,
  ) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await transports.put(build(transports.get(providerId))!)
      }
      catch (error) {
        if (attempt === 1)
          throw error
        await transports.refresh()
        const current = transports.get(providerId)
        if (current && current.baseUrl === endpoint)
          return current
      }
    }
  }

  /**
   * Persists the credential and the endpoint a native provider needs before it
   * may be executed, and proves both landed.
   *
   * This is the ordering Corte B requires, expressed once so no caller can skip
   * a step: a secret reaches main only through `secrets:set`, main confirms the
   * vault write, the transport record is persisted WITHOUT the credential, and
   * only then is the provider executable. Before it, "test connection" shipped
   * the typed key inside the execution payload because that was the only way to
   * try a key that was not saved yet.
   *
   * Failures are hard: a key that did not store, or a record that did not
   * persist, must surface as `configuration` rather than degrade into a request
   * that goes out unauthenticated or to an endpoint nobody saved.
   *
   * Idempotent and safe to repeat: `secretSet` overwrites the same address with
   * the same value, and `ensureProviderRecord` writes only when the record
   * actually changed. Two concurrent preparations for the same provider converge
   * because main serialises vault writes and the transport repository rejects a
   * stale revision instead of duplicating the record.
   */
  async function prepareNativeExecution(args: { providerId: string, apiKey?: string, baseUrl?: string }): Promise<void> {
    const record = transports.get(args.providerId)
    if (!record && !isNativeTransportDefinition(args.providerId))
      return
    if (typeof args.apiKey === 'string' && args.apiKey) {
      if (!await secretSet({ scope: args.providerId, key: API_KEY_NAME, value: args.apiKey }))
        throw new ProviderError('credentials')
    }
    await ensureProviderRecord(args.providerId, args.baseUrl)
    const persisted = transports.get(args.providerId)
    if (!persisted || persisted.enabled === false)
      throw new ProviderError('configuration')
  }

  async function draftConfig(args: { providerId: string, apiKey?: string, baseUrl?: string }) {
    await initializeTransports()
    await transports.refresh()
    const record = transports.get(args.providerId)
    if (transports.hasRemoved(args.providerId) || record?.enabled === false)
      throw new ProviderError('configuration')
    const config: Record<string, unknown> = record
      ? { ...record.adapterOptions, baseUrl: record.baseUrl, _liaTransport: true }
      : isNativeTransportDefinition(args.providerId) ? {} : { ...providerConfig.getConfig(args.providerId) }
    // A curated provider never receives a key here: it is executed in main, and
    // a host without that port gets an unauthenticated request rather than a
    // secret in this renderer. Only the legacy, non-curated path still resolves
    // one, and that path is unchanged by this cut.
    const native = Boolean(record) || isNativeTransportDefinition(args.providerId)
    if (!native && !args.apiKey) {
      const apiKey = await resolveApiKey(args.providerId)
      if (apiKey)
        config.apiKey = apiKey
    }
    else if (!native && args.apiKey) {
      config.apiKey = args.apiKey
    }
    if (args.baseUrl !== undefined)
      config.baseUrl = args.baseUrl
    return config
  }

  // In-flight only, never persisted or placed in Pinia state. Also deduplicates
  // primary and backup looking up the same effective draft at the same time.
  const discoveryPending = new Map<string, Promise<Awaited<ReturnType<typeof providerRuntime.discover>>>>()
  async function discoverModels(args: { providerId: string, apiKey?: string, baseUrl?: string }) {
    try {
      await initializeTransports()
      await prepareNativeExecution(args)
      const config = await draftConfig(args)
      const requestKey = JSON.stringify([args.providerId, config])
      const pending = discoveryPending.get(requestKey)
      if (pending)
        return await pending
      const request = nativeRuntime.owns(args.providerId, config)
        ? nativeRuntime.discover(args.providerId, config)
        : providerRuntime.discover(args.providerId, config)
      discoveryPending.set(requestKey, request)
      try {
        return await request
      }
      finally {
        discoveryPending.delete(requestKey)
      }
    }
    catch {
      return { status: 'error' as const, models: [] }
    }
  }

  /** Explicit text probe of the selected model, NOT approval of tools or vision. */
  async function testConnection(args: {
    providerId: string
    modelId?: string
    apiKey?: string
    baseUrl?: string
  }) {
    try {
      await initializeTransports()
      await prepareNativeExecution(args)
      const config = await draftConfig(args)
      const result = nativeRuntime.owns(args.providerId, config)
        ? await nativeRuntime.probe(args.providerId, args.modelId ?? '', config)
        : await providerRuntime.probe(args.providerId, args.modelId ?? '', config)
      return { ...result, message: '' }
    }
    catch {
      return { ok: false, scope: 'text' as const, failure: 'configuration' as const, message: '' }
    }
  }

  /** Makes the shared chat runtime route the next send through the given target. */
  async function activateTarget(target: LiaProviderChatTarget, baseUrl?: string) {
    if (!target?.providerId)
      return
    // Drop any cached provider instance so the next build re-resolves the vault
    // key (in case the user updated it since the last build).
    nativeRuntime.invalidate(target.providerId)
    await providerRuntime.dispose(target.providerId)
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
   * Applies the persisted Lia chat config to the shared AIRI runtime, so the
   * first message can be sent without the user opening any settings screen.
   *
   * Persisting a config (`persistConfig`) only writes `lia-product.json`; it does
   * not touch `consciousness.activeProvider` / `activeModel`, which is what
   * `chat.executeSendAttempt` reads. Without this, a fully configured Lia still
   * failed the first send with "No active chat provider or model configured".
   *
   * Readiness is re-derived from the persisted config on every call, so an
   * incomplete or invalid config is never pushed into the runtime — the caller
   * stays where it is and the onboarding gate keeps showing. Returns `true` only
   * when a target was actually activated. Runtime-only: no secret is written to
   * localStorage or to the product config; the vault resolver supplies the key
   * per provider build.
   */
  async function activateConfiguredProvider(): Promise<boolean> {
    await refreshConfig()
    if (!await isReadyToChat())
      return false

    const preferred = loadedConfig.value?.preferred
    if (!preferred?.providerId || !preferred.modelId)
      return false

    await activateTarget(preferred)
    // `activeProvider` / `activeModel` only say which target the chat should use;
    // the AIRI runtime tracks "is this provider configured" separately, on the
    // provider record's status. `ensureProviderRecord` creates that record as
    // `unconfigured`, so without this the provider is active for sending yet the
    // runtime still reports it as not configured. Same pair the AIRI defaults
    // command uses, and it writes no credential anywhere: the record keeps only
    // references/metadata while the vault resolver supplies the key per build.
    // Through the Lia's own boundary rather than the shared store directly.
    // Same two operations, same order, same implementation underneath: the port
    // exists so this dependency has one address (see provider-activation.ts).
    await providerActivation.activate(preferred.providerId)
    providerActivation.markConfigured(preferred.providerId)
    return true
  }

  /**
   * Whether the persisted config is genuinely ready to have a conversation.
   *
   * Ready requires: a preferred provider + model, the `onboarded` completion
   * marker, and — only when that provider actually needs a credential — an API
   * key stored in the secure vault. A key-less provider (e.g. local Ollama /
   * LM Studio) is ready as soon as its provider + model + onboarded marker are
   * present, with no secret. The explicit marker alone (onboarded=true with an
   * invalid config) never reports ready — readiness is recomputed from the real
   * config every call. No secret is read here, only its presence.
   */
  async function isReadyToChat(): Promise<boolean> {
    const config = loadedConfig.value ?? (await refreshConfig())
    const preferred = config.preferred
    if (!preferred?.providerId || !preferred.modelId)
      return false
    if (config.onboarded !== true)
      return false
    // The Lia has no AIRI account flow, so a provider whose lifecycle belongs to
    // that session can never be ready here — regardless of a stored key. This is
    // a no-op for every provider the Lia curates (all user-owned) and fails
    // closed if one ever is not.
    if (!isUsableWithoutAiriSession(providerConfig.get(preferred.providerId)))
      return false
    if (!providerNeedsKey(preferred.providerId))
      return true
    return secretHas({ scope: preferred.providerId, key: API_KEY_NAME })
  }

  /** Marks the first-run provider setup as complete for the current config. */
  async function markOnboarded(): Promise<void> {
    const config = loadedConfig.value ?? (await refreshConfig())
    await persistConfig({ ...config, onboarded: true })
    // Re-read the authoritative config that main actually persisted so the
    // renderer's reactive state is guaranteed to reflect onboarded=true (no
    // IPC/rendered race window for the launcher gate that runs right after).
    loadedConfig.value = await getChatConfig()
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
   * Installs the chat transport bridge for THIS renderer session.
   *
   * Safe in any window, including a follower-only one, because it resolves no
   * credential and writes no shared state: it only teaches the local Pinia
   * instance to forward a curated provider's request to the main process over
   * IPC. The main process owns the endpoint lookup and the key.
   *
   * It exists separately from {@link registerRuntimeExtensions} because those
   * two responsibilities used to be welded together, and the leader-only gate
   * around them is what left `#/chat` — a follower-only window — with no bridge
   * at all. There, `getChatProviderInstance` was the untouched legacy function,
   * so every send resolved a credential in a window that never registered the
   * resolver and therefore sent no `Authorization` header: a 401, from a window
   * the transport tests never exercised.
   *
   * Idempotent: `installChatFactory` is keyed by the store instance and returns
   * the existing uninstaller.
   */
  /**
   * Creates the curated provider's record if it is missing, and gives a
   * concurrently-starting window one short chance to be the one that wrote it.
   *
   * Throws `configuration` only when the record still cannot be read: the
   * caller must keep failing closed rather than send without an endpoint.
   */
  async function ensureCuratedRecordAvailable(providerId: string) {
    /*
     * Only a provider the user actually configured is recovered. The saved
     * address is the evidence: it is the value the settings screen writes, it is
     * already replicated to every window, and it is what a leader would have used
     * to create the record. Without it this stops at `configuration` instead of
     * inventing an endpoint from the provider schema - sending to a host the
     * user never chose is worse than a visible failure.
     */
    const stored = providerConfig.getConfig(providerId)?.baseUrl
    const endpoint = transports.get(providerId)?.baseUrl
      ?? (typeof stored === 'string' && stored.trim() ? stored.trim() : undefined)
    if (!endpoint)
      throw new ProviderError('configuration')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await ensureProviderRecord(providerId, endpoint)
      }
      catch {
        // Falls through to the read: a failed write may still have been won by
        // the other window, and the repository is the authority either way.
      }
      await transports.refresh()
      if (transports.get(providerId))
        return
      if (attempt === 0)
        await new Promise(resolve => setTimeout(resolve, 150))
    }
    throw new ProviderError('configuration')
  }

  function registerChatTransport() {
    if (disposed || uninstallFactory)
      return
    uninstallFactory = providerRuntime.installChatFactory(async (id) => {
      if (disposed)
        throw new ProviderError('cancelled')
      await initializeTransports()
      await transports.refresh()
      if (transports.hasRemoved(id) || rejectedTransports.has(id))
        throw new ProviderError('configuration')
      // A provider without a record and outside the catalog keeps its previous
      // executor: the Lia does not own that id, so it has nothing to route.
      if (!isNativeTransportDefinition(id) && !transports.get(id))
        return undefined
      /*
       * A curated provider with no record yet is a WINDOW-ORDER problem, not a
       * configuration error.
       *
       * Until this cut the record was only ever created by the leader window
       * (`ensureProviderRecord`, on configuration), so a follower-only window
       * opened first had nothing to read and failed every send with
       * `configuration`. The fix does not introduce a second source of truth:
       * the record is still created by the same idempotent call, into the same
       * main-process repository, with no credential attached. A tombstone was
       * already refused above, so this cannot resurrect a removed provider.
       *
       * One bounded retry covers the other order of events - main still
       * answering an empty snapshot while the leader writes - without turning a
       * real failure into a silent wait.
       */
      if (!transports.get(id))
        await ensureCuratedRecordAvailable(id)
      const native = await nativeRuntime.getChatProvider(id)
      if (native)
        return native
      /**
       * A curated provider must never fall through to the legacy executor.
       *
       * `getChatProvider` returns `undefined` only for a local-compatible record
       * with no address. Returning `undefined` here would hand the send to
       * `providerStore.getChatProviderInstance`, which resolves the vault
       * credential inside this renderer and builds an SDK client with it — the
       * exact exposure this cut exists to close, and silent, because the send
       * would otherwise appear to work. An explicit `configuration` error is
       * visible and keeps the credential in main.
       */
      throw new ProviderError('configuration')
    })

    /*
     * Model listing follows the same split as chat: the transport bridge is
     * installed in EVERY window (it reads no credential), so a follower-only
     * window can list a curated provider's models too. `undefined` means "not
     * mine" and leaves the shared implementation untouched; an array claims the
     * id, including an empty one, so a failure can never fall back to a client
     * built from a renderer credential.
     */
    registerProviderModelLister(async (providerId) => {
      if (disposed)
        return undefined
      await initializeTransports()
      await transports.refresh()
      if (!isNativeTransportDefinition(providerId) && !transports.get(providerId))
        return undefined
      const discovery = await discoverModels({ providerId })
      // Sanitized: the class of failure, never the body or the URL.
      if (discovery.status === 'error')
        throw new ProviderError('network')
      return discovery.models.map(model => ({ id: model.id, name: model.label }))
    })
  }

  /**
   * Installs the runtime extensions for the current renderer session.
   *
   * Leader-only by design: the credential resolver and the fallback chain below
   * serve the consumers that still build an SDK client in the renderer (legacy
   * chat outside the catalog, legacy speech-to-text), and exactly one window
   * should own that. Callers must also call {@link registerChatTransport} — a
   * follower window gets only that, which is precisely what it needs to chat.
   *
   * Idempotent.
   */
  function installCredentialConfig() {
    uninstallCredentialConfig ??= registerProviderCredentialConfigPort({
      owns: id => supportsMainTranscription(providerConfig.get(id)?.definitionId ?? id) && (providerConfig.get(id)?.definitionId ?? id) !== 'app-local-audio-transcription',
      has: hasApiKey,
      async save(id, value) {
        if (!supportsMainTranscription(providerConfig.get(id)?.definitionId ?? id) || !/^[\x21-\x7E]{1,16384}$/.test(value))
          return false
        const endpoint = providerConfig.getConfig(id)?.baseUrl
        await ensureProviderRecord(id, typeof endpoint === 'string' && endpoint.trim() ? endpoint : undefined)
        const saved = await setApiKey(id, value)
        if (saved) {
          clearLegacyCredential(id)
          providerActivation.markConfigured(id)
        }
        return saved
      },
    })
  }

  function registerRuntimeExtensions() {
    registerChatTransport()
    installCredentialConfig()

    // Supply the per-use vault apiKey when the provider runtime builds an
    // instance for a Lia-configured provider. Absent a stored secret it returns
    // undefined and behaviour is unchanged.
    registerProviderCredentialResolver(async (providerId) => {
      /**
       * No curated provider ever receives a credential in this process.
       *
       * Every curated id is executed in main - chat through the transport
       * bridge, discovery and probe through the execution port, transcription
       * through the main-process service. A build asking this resolver for one
       * of them is therefore never the Lia's own path: it is a consumer that
       * still constructs an SDK client here (vision inference, the autonomous
       * artistry director, a transcription branch, a devtool). Handing it the
       * key would rebuild in one call the exposure this cut removed.
       *
       * Refusing is the chokepoint the whole boundary rests on: the consumer
       * degrades to an unauthenticated request or an explicit error, and the key
       * stays where it already was. It also covers `lia-groq-transcription`,
       * which is a derived transcription target rather than a catalog id.
       */
      if (isNativeTransportDefinition(providerId) || supportsMainTranscription(providerConfig.get(providerId)?.definitionId ?? providerId) || providerId === LIA_GROQ_TRANSCRIPTION_PROVIDER_ID)
        return undefined
      /**
       * The same refusal, by capability, for everything else.
       *
       * `resolveApiKey` enforces it too — this early return exists so the audit
       * line below never claims a resolution attempt for a provider whose task
       * the Lia does not run here (a TTS voice, an embedding model). Keeping it
       * at the chokepoint is what makes the policy legible in one place.
       */
      if (!rendererMayHoldCredential(providerId))
        return undefined
      const key = await resolveApiKey(providerId)
      // Phase 7.3 safe bridge evidence (items 7/J): METADATA ONLY. The vault
      // value stays inside the resolver closure - never logged, never in a
      // payload beyond this in-memory build.
      // Phase 8.0D-10B-4D4C4-SHELL-B1: wording generalized - this resolver now
      // also serves derived transcription targets, not just chat providers.
      console.info(
        `[lia] provider credential resolved: providerId=${providerId}`
        + ` scope=${secretScopeFor(providerId)}`
        + ` secretSource=${key ? 'lia-vault' : 'missing'} hasApiKey=${String(Boolean(key))}`,
      )
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

  // Install before child components render, including follower settings windows.
  installCredentialConfig()

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
    prepareNativeExecution,
    discoverModels,
    providerBaseUrl,
    ensureProviderRecord,
    removeTransport,
    activateTarget,
    activatePreferred,
    activateConfiguredProvider,
    isReadyToChat,
    markOnboarded,
    isFallbackConfigured,
    providerNeedsKey,
    providerApiKeyUrl,
    curatedModelsFor,
    isModelInCatalog,
    recommendedModelFor,
    registerChatTransport,
    registerRuntimeExtensions,
  }
})
