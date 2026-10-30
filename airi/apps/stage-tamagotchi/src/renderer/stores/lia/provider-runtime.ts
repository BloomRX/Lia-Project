import type { ComposerTranslation } from 'vue-i18n'

import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { generateText } from '@xsai/generate-text'
import { listModels as queryModels } from '@xsai/model'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'

/**
 * Lia runtime boundary. The four E2 lifecycle/cache operations still delegate
 * unchanged (pinned by provider-runtime-semantics and provider-runtime tests).
 *
 * Draft discovery and the explicit selected-model text probe below use temporary
 * instances, provider schemas and existing SDK operations. They never write the
 * draft or credentials to the shared store, nor reuse its credential-blind list
 * cache. The shared Stage implementation remains untouched. This is the only
 * address for its definitions in the Lia model-selection flow.
 */

/**
 * The store instance type is derived from the real definition rather than
 * re-declared, so these signatures cannot drift from the runtime they delegate
 * to. Nothing here invents a return type.
 */
type SharedProviderRuntimeStore = ReturnType<typeof useProviderStore>

/**
 * The slice of the shared provider runtime store this port needs.
 *
 * Declared structurally, the same way the activation port declares its source,
 * so a test can substitute a double and observe the delegation with no Pinia
 * and no Stage store involved.
 */
export interface LiaProviderRuntimeSource {
  getProviderInstance: SharedProviderRuntimeStore['getProviderInstance']
  disposeProviderInstance: SharedProviderRuntimeStore['disposeProviderInstance']
  supportsModelListing: SharedProviderRuntimeStore['supportsModelListing']
  getModelsForProvider: SharedProviderRuntimeStore['getModelsForProvider']
}

/** The four operations the Lia's runtime access is allowed to use. */
export interface LiaProviderRuntime {
  /**
   * The cached instance for a provider, built on first use.
   *
   * Everything the shared implementation does on that path is preserved:
   * credential lookup, the record it may create for a credential-free
   * definition, the resolved secret, the schema defaults applied afterwards,
   * the cache, and the error when a required credential is missing.
   */
  getInstance: SharedProviderRuntimeStore['getProviderInstance']
  /** Releases the cached instance so the next build re-resolves the credential. */
  dispose: SharedProviderRuntimeStore['disposeProviderInstance']
  /** Whether the provider has a definition that can list models at all. */
  canListModels: SharedProviderRuntimeStore['supportsModelListing']
  /** The model catalog already loaded for a provider, empty until it is. */
  listModels: SharedProviderRuntimeStore['getModelsForProvider']
}

/**
 * Builds the port over any structurally compatible source.
 *
 * Kept separate from {@link useLiaProviderRuntime} so tests can pass a double
 * and observe the delegation itself.
 */
export function createLiaProviderRuntime(
  source: LiaProviderRuntimeSource,
): LiaProviderRuntime {
  return {
    canListModels: providerId => source.supportsModelListing(providerId),
    dispose: providerId => source.disposeProviderInstance(providerId),
    getInstance: providerId => source.getProviderInstance(providerId),
    listModels: providerId => source.getModelsForProvider(providerId),
  }
}

/**
 * The port bound to the shared Stage provider runtime, which remains the
 * implementation.
 *
 * The import of the shared store lives here and only here for these four
 * operations.
 */
export function useLiaProviderRuntime(): LiaProviderRuntime & ReturnType<typeof createLiaDraftProviderRuntime> {
  const source = useProviderStore()
  const { t } = useI18n()
  return { ...createLiaProviderRuntime(source), ...createLiaDraftProviderRuntime(source, t) }
}

export interface LiaModelDiscoveryResult {
  status: 'ready' | 'unsupported' | 'error'
  models: Array<{ id: string, label: string }>
}

export interface LiaModelProbeResult {
  ok: boolean
  scope: 'text'
  failure?: 'configuration' | 'endpoint' | 'request' | 'empty' | 'unsupported'
}

/** Draft-only operations: no shared cache, configuration write or secret-bearing error. */
export function createLiaDraftProviderRuntime(
  source: Pick<SharedProviderRuntimeStore, 'findProviderDefinition'>,
  t: ComposerTranslation,
) {
  async function draft(providerId: string, config: Record<string, unknown>) {
    const definition = source.findProviderDefinition(providerId)
    if (!definition)
      throw new Error('Unknown service')
    const schema = await definition.createProviderConfig({ t, config })
    const effective = await z.parseAsync(schema, config)
    if (effective.baseUrl) {
      const url = new URL(effective.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Invalid service address')
    }
    return { definition, effective, provider: await definition.createProvider(effective) }
  }

  async function discover(providerId: string, config: Record<string, unknown>): Promise<LiaModelDiscoveryResult> {
    try {
      const { definition, effective, provider } = await draft(providerId, config)
      try {
        let models
        if (definition.extraMethods?.listModels)
          models = await definition.extraMethods.listModels(effective, provider, { t })
        else if ('model' in provider && typeof provider.model === 'function')
          models = await queryModels({ ...provider.model(), abortSignal: AbortSignal.timeout(15000) })
        else
          return { status: 'unsupported', models: [] }
        const seen = new Set<string>()
        return {
          status: 'ready',
          models: models.filter((model) => {
            if (typeof model.id !== 'string' || !model.id.trim() || seen.has(model.id))
              return false
            seen.add(model.id)
            return true
          }).map(model => ({ id: model.id, label: ('name' in model && typeof model.name === 'string') ? model.name : model.id })),
        }
      }
      finally {
        await dispose(provider)
      }
    }
    catch {
      // Includes cleanup failure; neither a successful catalog nor the raw error escapes.
      return { status: 'error', models: [] }
    }
  }

  async function dispose(provider: object) {
    await (provider as { dispose?: () => Promise<void> | void }).dispose?.()
  }

  async function probe(providerId: string, modelId: string, config: Record<string, unknown>): Promise<LiaModelProbeResult> {
    if (!modelId.trim())
      return { ok: false, scope: 'text', failure: 'configuration' }
    let instance: Awaited<ReturnType<typeof draft>>
    try {
      instance = await draft(providerId, config)
    }
    catch {
      return { ok: false, scope: 'text', failure: 'configuration' }
    }
    try {
      try {
        if (!('chat' in instance.provider) || typeof instance.provider.chat !== 'function')
          return { ok: false, scope: 'text', failure: 'unsupported' }
        const response = await generateText({
          ...instance.provider.chat(modelId),
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          // Token-limit parameter names vary between services. Let the adapter
          // choose its defaults rather than rejecting a valid custom model.
          abortSignal: AbortSignal.timeout(15000),
        })
        return response.text?.trim()
          ? { ok: true, scope: 'text' }
          : { ok: false, scope: 'text', failure: 'empty' }
      }
      finally {
        await dispose(instance.provider)
      }
    }
    catch (error) {
      // Rejection can mean address, credential OR model: never guess from a body.
      return { ok: false, scope: 'text', failure: error instanceof TypeError ? 'endpoint' : 'request' }
    }
  }

  return { discover, probe }
}
