/**
 * The AI provider definitions the Launcher AI Settings may offer.
 *
 * This module is DATA, not runtime: it names the providers the product ships,
 * the endpoint each one uses by default, and - explicitly - which Brain engine
 * and which Stage execution provider that definition resolves to. Nothing here
 * reads a credential, opens a socket or depends on Electron.
 *
 * Why the three ids are separate:
 *
 *   definitionId    product identity of THIS catalog entry (`groq`);
 *   stageProviderId the chat provider id the Stage runtime knows (`groq`);
 *   engineId        the Brain engine id the routing catalog knows (`groq`).
 *
 * They happen to be equal for Groq today. They are still three fields because
 * the equality is an audited product fact, not a rule: a future provider may
 * reuse an engine under a different definition id, and the UI must never infer
 * the mapping from string equality.
 *
 * `availability` is the product gate. `'ready'` means the full chain exists in
 * this build (Launcher -> transport -> Stage provider -> Brain engine) and was
 * reviewed; `'unavailable'` means the provider may be listed for transparency
 * but MUST NOT be selectable. The generic OpenAI-compatible entry stays
 * unavailable until a complete, tested resolution to the Stage exists.
 */

export type LiaAiProviderAvailability = 'ready' | 'unavailable'

export interface LiaAiProviderModelSuggestion {
  /** Model id sent to the API verbatim. */
  id: string
  /** Human label for the picker. */
  label: string
  /** Marks the model the product recommends for a plain chat turn. */
  recommended?: boolean
}

export interface LiaAiProviderDefinition {
  /** Stable product identity of this definition. */
  definitionId: string
  /** Stage execution provider id. Absent until the Stage integration exists. */
  stageProviderId?: string
  /** Brain engine id. Absent until a Brain adapter exists. */
  engineId?: string
  /** Brand name; never translated. */
  label: string
  /** One line for the provider card. */
  description: string
  /** Canonical endpoint. Empty when the user must supply one. */
  baseUrl: string
  /** Whether the endpoint may be edited in the advanced surface. */
  allowCustomEndpoint: boolean
  /** Whether an API key is required to use the provider. */
  requiresApiKey: boolean
  /** Model suggestions only - discovery and a manual id always take precedence. */
  models: readonly LiaAiProviderModelSuggestion[]
  availability: LiaAiProviderAvailability
  /** Why the provider is not selectable. Absent when availability is 'ready'. */
  unavailableReason?: string
}

/**
 * Groq is the one provider with a complete chain in this build:
 *   - Stage chat provider `groq` (curated provider catalog);
 *   - Brain engine `groq` (`GROQ_BRAIN_ENGINE_ID`);
 *   - the chat/vision model ids below are the ones Lia Core's adapter declares.
 *
 * Only model ids that already exist in Lia's own Brain adapter are suggested
 * here. Anything else is discovered live or typed by the user.
 */
const GROQ: LiaAiProviderDefinition = Object.freeze({
  definitionId: 'groq',
  stageProviderId: 'groq',
  engineId: 'groq',
  label: 'Groq',
  description: 'Respostas rápidas na nuvem, com conversa e uso de ferramentas.',
  baseUrl: 'https://api.groq.com/openai/v1',
  allowCustomEndpoint: true,
  requiresApiKey: true,
  models: Object.freeze([
    Object.freeze({ id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', recommended: true }),
    Object.freeze({ id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (visão)' }),
  ]),
  availability: 'ready',
})

/**
 * The generic OpenAI-compatible provider. It is listed so the product does not
 * hide a capability it talks about, but it is NOT selectable: the full
 * resolution Launcher -> transport -> Stage was never demonstrated end to end,
 * and the approved architecture forbids selecting it before that proof.
 */
const OPENAI_COMPATIBLE: LiaAiProviderDefinition = Object.freeze({
  definitionId: 'openai-compatible',
  label: 'OpenAI-compatível',
  description: 'Qualquer serviço compatível com a API de conversa da OpenAI.',
  baseUrl: '',
  allowCustomEndpoint: true,
  requiresApiKey: false,
  models: Object.freeze([]),
  availability: 'unavailable',
  unavailableReason: 'A resolução completa até o Stage ainda não foi implementada e testada nesta versão.',
})

/** The single canonical list. Order is presentation order, not precedence. */
export const LIA_AI_PROVIDER_CATALOG: readonly LiaAiProviderDefinition[] = Object.freeze([
  GROQ,
  OPENAI_COMPATIBLE,
])

/** Lookup by definition id. Returns undefined for unknown ids - never throws. */
export function findLiaAiProviderDefinition(definitionId: string): LiaAiProviderDefinition | undefined {
  return LIA_AI_PROVIDER_CATALOG.find(definition => definition.definitionId === definitionId)
}

/**
 * Lookup by the Stage execution provider id. This is what a persisted
 * `provider.chat.preferred.providerId` is compared against.
 */
export function findLiaAiProviderByStageProviderId(stageProviderId: string): LiaAiProviderDefinition | undefined {
  return LIA_AI_PROVIDER_CATALOG.find(definition => definition.stageProviderId === stageProviderId)
}

/**
 * Lookup by Brain engine id. Used by diagnostics and by the cross-process
 * mapping test; the Brain itself never imports the Launcher catalog.
 */
export function findLiaAiProviderByEngineId(engineId: string): LiaAiProviderDefinition | undefined {
  return LIA_AI_PROVIDER_CATALOG.find(definition => definition.engineId === engineId)
}
