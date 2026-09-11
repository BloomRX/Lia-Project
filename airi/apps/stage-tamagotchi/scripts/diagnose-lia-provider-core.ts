/**
 * Pure helpers behind `DiagnoseLiaProvider.ps1`.
 *
 * Everything here is side-effect free and secret-free: inputs are already-read
 * file contents or captured metadata, outputs are booleans, ids and lengths. No
 * function in this module ever receives or returns a secret value, and none of
 * them touches the network, the vault or the persisted configuration.
 *
 * Split out from the orchestrator so the classification rules — the part that
 * decides where the credential chain breaks — are covered by tests.
 */

/** Providers the Lia onboarding offers that need no credential at all. */
const KEYLESS_PROVIDER_IDS = new Set(['lm-studio', 'ollama'])

/**
 * The AIRI native provider authenticates with the AIRI session token, not with a
 * provider API key, so the Lia vault is not the credential source for it.
 */
export const OFFICIAL_PROVIDER_ID = 'official-provider'

export function providerNeedsKey(providerId: string): boolean {
  return !KEYLESS_PROVIDER_IDS.has(providerId)
}

export interface LiaProductSummary {
  found: boolean
  path: string | null
  parseError: string | null
  onboarded: boolean
  preferredProvider: string | null
  preferredModel: string | null
  fallbackEnabled: boolean
  fallbackProvider: string | null
  fallbackModel: string | null
  /** True when the raw document mentions anything that looks like a credential. */
  documentMentionsApiKey: boolean
}

export function summarizeLiaProductConfig(raw: string | null, path: string | null): LiaProductSummary {
  const empty: LiaProductSummary = {
    found: raw !== null,
    path,
    parseError: null,
    onboarded: false,
    preferredProvider: null,
    preferredModel: null,
    fallbackEnabled: false,
    fallbackProvider: null,
    fallbackModel: null,
    documentMentionsApiKey: false,
  }

  if (raw === null)
    return empty

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch (error) {
    return { ...empty, parseError: error instanceof Error ? error.name : 'unknown' }
  }

  const chat = (parsed as { provider?: { chat?: Record<string, unknown> } })?.provider?.chat ?? {}
  const preferred = chat.preferred as { providerId?: string, modelId?: string } | undefined
  const fallback = Array.isArray(chat.fallback) ? chat.fallback[0] as { providerId?: string, modelId?: string } | undefined : undefined

  return {
    found: true,
    path,
    parseError: null,
    onboarded: chat.onboarded === true,
    preferredProvider: typeof preferred?.providerId === 'string' && preferred.providerId ? preferred.providerId : null,
    preferredModel: typeof preferred?.modelId === 'string' && preferred.modelId ? preferred.modelId : null,
    fallbackEnabled: chat.fallbackEnabled !== false,
    fallbackProvider: typeof fallback?.providerId === 'string' && fallback.providerId ? fallback.providerId : null,
    fallbackModel: typeof fallback?.modelId === 'string' && fallback.modelId ? fallback.modelId : null,
    // Only a boolean: the product config must never hold a key, so this is a
    // leak detector rather than a reader.
    documentMentionsApiKey: /"apiKey"\s*:\s*"[^"]+"/.test(raw),
  }
}

export interface VaultSummary {
  found: boolean
  path: string | null
  parseError: string | null
  entryCount: number
  scopes: string[]
  primarySecretExists: boolean
  fallbackSecretExists: boolean
  /** Ciphertext lengths only. Values are never read. */
  ciphertextLengths: Record<string, number>
}

/**
 * Reads the vault file's shape without decrypting anything. Entries are keyed by
 * `scope\u0000key`; only the scope and the ciphertext length are reported.
 */
export function summarizeVaultFile(
  raw: string | null,
  path: string | null,
  primaryProviderId: string | null,
  fallbackProviderId: string | null,
): VaultSummary {
  const empty: VaultSummary = {
    found: raw !== null,
    path,
    parseError: null,
    entryCount: 0,
    scopes: [],
    primarySecretExists: false,
    fallbackSecretExists: false,
    ciphertextLengths: {},
  }

  if (raw === null)
    return empty

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch (error) {
    return { ...empty, parseError: error instanceof Error ? error.name : 'unknown' }
  }

  if (!parsed || typeof parsed !== 'object')
    return { ...empty, parseError: 'unexpected-shape' }

  const ciphertextLengths: Record<string, number> = {}
  const scopes = new Set<string>()
  for (const [compositeKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    const scope = compositeKey.split('\u0000')[0] ?? compositeKey
    scopes.add(scope)
    ciphertextLengths[scope] = typeof value === 'string' ? value.length : 0
  }

  return {
    found: true,
    path,
    parseError: null,
    entryCount: Object.keys(parsed as Record<string, unknown>).length,
    scopes: [...scopes].sort(),
    primarySecretExists: primaryProviderId !== null && scopes.has(primaryProviderId),
    fallbackSecretExists: fallbackProviderId !== null && scopes.has(fallbackProviderId),
    ciphertextLengths,
  }
}

export interface RuntimeStateSummary {
  /** Whether the localStorage files were readable at all. */
  readable: boolean
  activeProvider: string | null
  activeModel: string | null
  /** Provider ids whose persisted record has status "configured". */
  configuredProviderIds: string[]
}

/**
 * Best-effort read of the renderer's Chromium localStorage.
 *
 * The values live in a leveldb log, not in JSON, so this scans the raw bytes for
 * a key and takes the printable run that follows it. It is good enough to read
 * short ids such as `openrouter-ai` or `official-provider`, and it can surface a
 * stale entry, so every consumer treats a `null` as "unknown" rather than
 * "absent". It never reads anything resembling a secret: the Lia renderer keeps
 * none, by design.
 */
export function scanLocalStorageValue(blobs: string[], key: string): string | null {
  for (const blob of blobs) {
    const at = blob.indexOf(key)
    if (at < 0)
      continue

    // Chromium stores the value right after the key, prefixed by a one-byte
    // encoding marker. Skip non-printables, then take the printable run.
    let cursor = at + key.length
    while (cursor < blob.length && (blob.charCodeAt(cursor) < 0x20 || blob.charCodeAt(cursor) > 0x7E))
      cursor += 1

    let end = cursor
    while (end < blob.length && blob.charCodeAt(end) >= 0x20 && blob.charCodeAt(end) <= 0x7E)
      end += 1

    const value = blob.slice(cursor, end)
    if (value)
      return value
  }

  return null
}

export interface RuntimeDiagnosisInput {
  providerId: string
  modelId: string
  providerExists: boolean
  providerStatus: string | null
  providerConfigExists: boolean
  resolverRegistered: boolean
  resolverCalledForChat: boolean
  resolverCalledForModelListing: boolean
  resolvedCredentialAvailable: boolean
  instanceCreated: boolean
  instanceProvider: string | null
  instanceModel: string | null
  factorySawCredential: boolean
  listModelsCalled: boolean
  credentialReachedListModels: boolean
  getChatProviderInstanceCalled: boolean
  credentialReachedChat: boolean
  requests: Array<{
    method: string
    endpoint: string
    hasAuthorizationHeader: boolean
    authorizationHeaderLength: number
  }>
  notes: string[]
}

export interface Verdict {
  status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  firstFailure: string | null
  /** Hypothesis label from the investigation list, when one applies. */
  hypothesis: string | null
  reason: string
}

/**
 * Walks the credential chain in order and reports the FIRST link that does not
 * hold, so the output points at one place instead of listing every symptom.
 */
export function classify(args: {
  product: LiaProductSummary
  vault: VaultSummary
  runtimeState: RuntimeStateSummary
  runtime: RuntimeDiagnosisInput | null
}): Verdict {
  const { product, vault, runtimeState, runtime } = args

  const fail = (firstFailure: string, hypothesis: string, reason: string): Verdict =>
    ({ status: 'FAIL', firstFailure, hypothesis, reason })

  if (!product.found)
    return fail('lia product config not found', 'config', 'lia-product.json was not found in any candidate userData directory')
  if (product.parseError)
    return fail('lia product config unreadable', 'config', `lia-product.json failed to parse (${product.parseError})`)
  if (!product.onboarded)
    return fail('onboarding not complete', 'config', 'provider.chat.onboarded is not true')
  if (!product.preferredProvider || !product.preferredModel)
    return fail('preferred provider/model missing', 'config', 'provider.chat.preferred has no providerId or no modelId')

  if (product.documentMentionsApiKey)
    return fail('credential leaked into lia-product.json', 'leak', 'the product config contains an apiKey value; it must only live in the vault')

  const needsKey = providerNeedsKey(product.preferredProvider)
  if (needsKey && !vault.primarySecretExists)
    return fail('vault secret missing', 'A', `no vault entry for scope "${product.preferredProvider}"`)

  if (product.preferredProvider === OFFICIAL_PROVIDER_ID) {
    return fail(
      'preferred provider is the AIRI native provider',
      'I',
      'the AIRI native provider authenticates with the AIRI session token, not with the Lia vault key',
    )
  }

  if (runtimeState.readable) {
    if (!runtimeState.activeProvider) {
      return fail('runtime active provider not set', 'I', 'consciousness.activeProvider is empty in the renderer storage')
    }
    if (runtimeState.activeProvider === OFFICIAL_PROVIDER_ID) {
      return fail(
        'runtime is using the AIRI native provider',
        'I',
        `consciousness.activeProvider is "${OFFICIAL_PROVIDER_ID}" while the Lia config prefers "${product.preferredProvider}"`,
      )
    }
    if (runtimeState.activeProvider !== product.preferredProvider) {
      return fail(
        'runtime provider mismatch',
        'I',
        `consciousness.activeProvider is "${runtimeState.activeProvider}" but the Lia config prefers "${product.preferredProvider}"`,
      )
    }
    if (runtimeState.activeModel !== product.preferredModel) {
      return fail(
        'runtime model mismatch',
        'I',
        `consciousness.activeModel is "${runtimeState.activeModel ?? ''}" but the Lia config prefers "${product.preferredModel}"`,
      )
    }
  }

  if (!runtime)
    return { status: 'INCONCLUSIVE', firstFailure: null, hypothesis: null, reason: 'the runtime probe did not produce a result' }

  if (!runtime.resolverRegistered)
    return fail('credential resolver not registered', 'B', 'registerProviderCredentialResolver was never called')
  if (!runtime.credentialReachedChat)
    return fail('resolver not called for chat', 'C', 'the chat instance path never consulted the resolver')
  if (!runtime.resolvedCredentialAvailable)
    return fail('resolver returned no credential', 'D', 'the resolver did not return a usable apiKey')
  if (!runtime.instanceCreated)
    return fail('provider instance not created', 'E', 'getChatProviderInstance did not return an instance')
  if (!runtime.factorySawCredential)
    return fail('createProvider did not receive the credential', 'E', 'the provider factory was called without an apiKey')

  const unauthorized = runtime.requests.filter(request => !request.hasAuthorizationHeader)
  if (unauthorized.length > 0) {
    return fail(
      'request authorization missing',
      'G',
      `${unauthorized.length} intercepted request(s) carried no Authorization header, e.g. ${unauthorized[0].method} ${unauthorized[0].endpoint}`,
    )
  }

  if (runtime.listModelsCalled && !runtime.credentialReachedListModels)
    return fail('model-listing credential missing', 'F', 'fetchModelsForProvider did not consult the resolver')

  return {
    status: 'PASS',
    firstFailure: null,
    hypothesis: null,
    reason: 'provider, runtime and request all carry the expected credential path',
  }
}
