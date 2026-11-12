import type { LiaSecretVault } from '@lia/core/secrets/vault'

import type { LiaAiProviderDefinition } from '../../../../../lia/core/src/providers/catalog'
import type { TransportMutation, TransportRecord, TransportResult, TransportSnapshot } from '../../../../../lia/core/src/transports/contracts'

import { Buffer } from 'node:buffer'

import { LIA_AI_PROVIDER_CATALOG } from '../../../../../lia/core/src/providers/catalog'

/**
 * The Launcher AI Settings service (PROMPT-39).
 *
 * Main is the ONLY authority for every piece of this feature:
 *   - it owns the provider catalog it exposes to the renderer;
 *   - it validates the endpoint and the host-change confirmation;
 *   - it writes the credential to the existing vault and never returns it;
 *   - it writes the transport record (connection) and the canonical selection
 *     (`provider.chat.preferred`) with the existing revision/rollback rules.
 *
 * The renderer receives non-secret state and typed results only. The IDs are
 * deliberately separate:
 *
 *   definitionId    product identity of the catalog entry (`groq`);
 *   connectionId    the transport record id (`groq` - one connection/provider);
 *   stageProviderId the Stage execution provider id persisted in the product
 *                   document and recognized by the Brain mapping (`groq`);
 *   engineId        the Brain engine id declared by the catalog (`groq`);
 *   credentialRef   the vault scope/key pair, equal to the record's providerId
 *                   because `isTransportRecord` enforces that invariant;
 *   modelId         the selected model, stored in the record and in the
 *                   canonical selection.
 *
 * Endpoint policy (approved decision 3), enforced HERE and not in the UI:
 *   - HTTPS anywhere; HTTP only for loopback (`localhost`, `127.0.0.1`, `::1`);
 *   - no username, password, query or fragment in the URL;
 *   - every request uses `redirect: 'error'` (no silent redirects);
 *   - changing the host requires an explicit confirmation flag AND a newly
 *     supplied credential - a saved key is never forwarded to a new host;
 *   - a failed save leaves the record disabled (fail-closed) and restores the
 *     previous credential/selection when possible.
 */

type FailureCode
  = | 'invalid'
    | 'conflict'
    | 'storage'
    | 'credentials'
    | 'unconfigured'
    | 'network'
    | 'http'
    | 'protocol'
    | 'timeout'
    | 'stage-running'
    | 'unconfirmed-host'
    | 'provider-unavailable'

interface Failure { ok: false, code: FailureCode }

export interface AiConnectionSelection {
  providerId: string
  modelId?: string
}

export interface AiConnectionState {
  /** Catalog identity of the provider this state describes. */
  definitionId: string
  /** Transport record id. Empty while no connection exists yet. */
  connectionId: string
  /** Stage execution provider id, when the definition has one. */
  stageProviderId?: string
  /** Brain engine id declared by the catalog, when one exists. */
  engineId?: string
  availability: 'ready' | 'unavailable'
  label: string
  baseUrl: string
  modelId?: string
  hasKey: boolean
  revision: number
  /** True when the canonical selection points at this provider. */
  selected: boolean
  /** The canonical selection, verbatim; non-secret metadata only. */
  selection?: AiConnectionSelection
}

export interface AiConnectionSaveInput {
  /** Catalog definition id. Required: the renderer never implies a provider. */
  providerId: string
  baseUrl: string
  apiKey?: string
  modelId?: string
  revision: number
  /** Explicit user confirmation for a host that is not the canonical one. */
  confirmHostChange?: boolean
}

export interface AiConnectionServiceDeps {
  repository: { read: () => Promise<TransportSnapshot>, mutate: (input: TransportMutation) => Promise<TransportResult> }
  vault: LiaSecretVault
  readSelection: () => Promise<AiConnectionSelection | undefined>
  saveSelection: (target: AiConnectionSelection) => Promise<void>
  /** Exact rollback, including an originally absent selection. Main-only. */
  backupSelection?: () => Promise<() => Promise<void>>
  /** The host shares this critical section with every managed Stage start. */
  saveExclusively?: (save: () => Promise<AiConnectionResult>) => Promise<AiConnectionResult>
  fetch?: typeof globalThis.fetch
  /** Injectable for tests; defaults to the shipped catalog. */
  definitions?: readonly LiaAiProviderDefinition[]
}
export type AiConnectionResult = { ok: true, state: AiConnectionState } | Failure

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001F\u007F]/.test(value)
}

/**
 * HTTPS anywhere; HTTP only for loopback. No credential, query or fragment may
 * ride the URL - the user could otherwise smuggle a secret past the vault.
 */
function validAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || value.trim() !== value)
    return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) && !url.username && !url.password && !url.search && !url.hash
  }
  catch { return false }
}

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).hostname
  }
  catch { return undefined }
}

function manageable(definition: LiaAiProviderDefinition): boolean {
  return definition.availability === 'ready' && typeof definition.stageProviderId === 'string' && definition.stageProviderId.length > 0
}

/** Main-only owner. Raw transport errors, remote bodies and secrets never cross IPC. */
export function createAiConnectionService(deps: AiConnectionServiceDeps) {
  const catalog = deps.definitions ?? LIA_AI_PROVIDER_CATALOG
  let queue: Promise<unknown> = Promise.resolve()
  let configurationSafe = true
  const fetchImpl = deps.fetch ?? globalThis.fetch

  const definitionById = (definitionId: string) => catalog.find(definition => definition.definitionId === definitionId)
  const definitionByStageProvider = (providerId: string) => catalog.find(definition => definition.stageProviderId === providerId)

  function recordFrom(snapshot: TransportSnapshot, definition: LiaAiProviderDefinition): TransportRecord | undefined {
    if (!definition.stageProviderId)
      return undefined
    const records = snapshot.records.filter(row => row.providerId === definition.stageProviderId)
    if (records.length > 1 || (records[0] && records[0].protocol !== 'chat-completions'))
      throw new Error('storage')
    return records[0]
  }

  /** Fail-closed guard shared with `Stage.start` and `conversar`. */
  async function isSafeToStart(): Promise<boolean> {
    if (!configurationSafe)
      return false
    try {
      const snapshot = await deps.repository.read()
      const selection = await deps.readSelection()
      const definition = selection ? definitionByStageProvider(selection.providerId) : undefined
      // A legacy selection the catalog does not manage keeps its previous
      // behaviour: this service never claimed authority over that row.
      if (!definition)
        return true
      const record = recordFrom(snapshot, definition)
      return record?.enabled !== false
    }
    catch { return false }
  }

  /** The catalog exactly as the renderer may see it: metadata only, no secrets. */
  function listDefinitions() {
    return catalog.map(definition => ({
      availability: definition.availability,
      baseUrl: definition.baseUrl,
      definitionId: definition.definitionId,
      description: definition.description,
      engineId: definition.engineId,
      label: definition.label,
      models: definition.models.map(model => ({ ...model })),
      requiresApiKey: definition.requiresApiKey,
      stageProviderId: definition.stageProviderId,
      ...(definition.unavailableReason ? { unavailableReason: definition.unavailableReason } : {}),
    }))
  }

  async function readInternal(definitionId?: string): Promise<AiConnectionState> {
    const snapshot = await deps.repository.read()
    const selection = await deps.readSelection()
    const definition = definitionId === undefined
      ? (selection ? definitionByStageProvider(selection.providerId) : undefined) ?? catalog.find(item => item.availability === 'ready')
      : definitionById(definitionId)
    if (!definition)
      throw new Error('invalid')
    const record = recordFrom(snapshot, definition)
    const selected = definition.stageProviderId !== undefined && selection?.providerId === definition.stageProviderId
    return {
      availability: definition.availability,
      baseUrl: record?.baseUrl ?? definition.baseUrl,
      connectionId: record?.id ?? '',
      definitionId: definition.definitionId,
      ...(definition.engineId ? { engineId: definition.engineId } : {}),
      hasKey: definition.stageProviderId ? deps.vault.hasSecret(definition.stageProviderId, 'apiKey') : false,
      label: definition.label,
      modelId: selected ? selection?.modelId : record?.modelIds[0],
      revision: snapshot.revision,
      selected,
      ...(selection ? { selection: { ...selection } } : {}),
      ...(definition.stageProviderId ? { stageProviderId: definition.stageProviderId } : {}),
    }
  }

  async function read(definitionId?: string): Promise<AiConnectionState> {
    await queue
    return readInternal(definitionId)
  }

  async function apply(input: AiConnectionSaveInput, expectedKeyRevision: string | undefined): Promise<AiConnectionResult> {
    if (!input || typeof input !== 'object' || !Object.keys(input).every(key => ['providerId', 'baseUrl', 'apiKey', 'modelId', 'revision', 'confirmHostChange'].includes(key))
      || !validId(input.providerId) || !validAddress(input.baseUrl) || !Number.isSafeInteger(input.revision) || input.revision < 0
      || (input.modelId !== undefined && !validId(input.modelId))
      || (input.confirmHostChange !== undefined && typeof input.confirmHostChange !== 'boolean')
      || (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 16384 || /[\r\n\0]/.test(input.apiKey)))) {
      return { ok: false, code: 'invalid' }
    }
    const definition = definitionById(input.providerId)
    if (!definition)
      return { ok: false, code: 'invalid' }
    // The catalog gate is enforced here, not only by a disabled button.
    if (!manageable(definition) || !definition.stageProviderId)
      return { ok: false, code: 'provider-unavailable' }
    // Alias keeps the resolved catalog entry available inside the rollback
    // closures below without re-reading the catalog or trusting the input.
    const providerDefinition = definition

    let keyWriteUncertain = false
    let restoreOpaqueKey: (() => Promise<boolean>) | undefined
    let restoreSelection: (() => Promise<void>) | undefined
    let changedSelection = false
    let disabledRevision: number | undefined
    let previous: TransportRecord | undefined
    const previouslySafe = configurationSafe
    async function restoreKey(): Promise<boolean> {
      try {
        return restoreOpaqueKey ? await restoreOpaqueKey() : !keyWriteUncertain
      }
      catch { return false }
    }
    async function recover(): Promise<boolean> {
      if (!await restoreKey())
        return false
      if (changedSelection) {
        if (!restoreSelection)
          return false
        try {
          await restoreSelection()
        }
        catch { return false }
      }
      if (disabledRevision === undefined)
        return previouslySafe
      try {
        const restored = await deps.repository.mutate(previous
          ? { kind: 'put', expectedRevision: disabledRevision, record: previous }
          : { kind: 'remove', expectedRevision: disabledRevision, id: providerDefinition.definitionId })
        return restored.ok && previouslySafe
      }
      catch { return false }
    }
    try {
      const snapshot = await deps.repository.read()
      if (snapshot.revision !== input.revision)
        return { ok: false, code: 'conflict' }
      previous = recordFrom(snapshot, definition)
      const originalSelection = await deps.readSelection()

      // Approved decision 3: a host that is not the canonical one, or that
      // differs from the saved one, needs an explicit confirmation AND a
      // credential supplied in THIS save. A stored key is never forwarded.
      const requestedHost = hostOf(input.baseUrl)
      const canonicalHost = definition.baseUrl ? hostOf(definition.baseUrl) : undefined
      const previousHost = previous ? hostOf(previous.baseUrl) : undefined
      const hostChanged = (canonicalHost !== undefined && requestedHost !== canonicalHost)
        || (previousHost !== undefined && requestedHost !== previousHost)
      if (hostChanged && input.confirmHostChange !== true)
        return { ok: false, code: 'unconfirmed-host' }

      restoreSelection = deps.backupSelection
        ? await deps.backupSelection()
        : originalSelection ? () => deps.saveSelection(originalSelection) : undefined

      // Never silently forward a saved credential to a newly supplied host.
      // Any URL change - even same host, different path - requires the key.
      if (previous?.baseUrl !== input.baseUrl && input.apiKey === undefined && deps.vault.hasSecret(definition.stageProviderId, 'apiKey'))
        return { ok: false, code: 'credentials' }
      // A failed recovery must never re-enable a row without an explicit key.
      if ((!configurationSafe || previous?.enabled === false) && input.apiKey === undefined)
        return { ok: false, code: 'credentials' }

      // Preserve an existing model when the caller is only rotating the key;
      // never invent one. The canonical selection is written only when this
      // provider either already holds it or the user chose a model now.
      const selectionModel = input.modelId ?? (originalSelection?.providerId === definition.stageProviderId ? originalSelection.modelId : undefined)
      const shouldSaveSelection = input.modelId !== undefined || originalSelection?.providerId === definition.stageProviderId

      const adapterOptions = { ...previous?.adapterOptions, allowUnauthenticated: input.apiKey === '' || (input.apiKey === undefined && previous?.adapterOptions.allowUnauthenticated === true) }
      const record: TransportRecord = {
        id: previous?.id ?? definition.definitionId,
        providerId: definition.stageProviderId,
        definitionId: definition.definitionId,
        type: 'http',
        protocol: 'chat-completions',
        baseUrl: input.baseUrl,
        enabled: true,
        adapterOptions,
        modelIds: input.modelId ? [input.modelId] : (previous?.modelIds ?? []),
        metadata: { ...previous?.metadata, label: definition.label },
        credentialRef: { scope: definition.stageProviderId, key: 'apiKey' },
      }
      // Durable fail-closed boundary BEFORE changing credentials. If the
      // launcher exits or rollback fails, every later reader sees disabled.
      const disabled = await deps.repository.mutate({ kind: 'put', expectedRevision: snapshot.revision, record: { ...(previous ?? record), enabled: false } })
      if (!disabled.ok)
        return { ok: false, code: disabled.code }
      disabledRevision = disabled.snapshot.revision
      configurationSafe = false
      if (input.apiKey !== undefined) {
        keyWriteUncertain = true
        const change = expectedKeyRevision === undefined ? undefined : await deps.vault.changeSecret?.(definition.stageProviderId, 'apiKey', input.apiKey || undefined, { expectedRevision: expectedKeyRevision })
        keyWriteUncertain = false
        if (!change) {
          configurationSafe = await recover()
          return { ok: false, code: configurationSafe ? 'credentials' : 'storage' }
        }
        restoreOpaqueKey = change.rollback
      }
      if (shouldSaveSelection) {
        changedSelection = true
        await deps.saveSelection({ providerId: definition.stageProviderId, ...(selectionModel ? { modelId: selectionModel } : {}) })
      }
      const saved = await deps.repository.mutate({ kind: 'put', expectedRevision: disabledRevision, record })
      if (!saved.ok) {
        configurationSafe = await recover()
        return { ok: false, code: configurationSafe ? saved.code : 'storage' }
      }
      configurationSafe = true
      const state = await readInternal(definition.definitionId)
      return { ok: true, state }
    }
    catch {
      configurationSafe = await recover()
      return { ok: false, code: 'storage' }
    }
  }

  function save(input: unknown): Promise<AiConnectionResult> {
    // Capture the IPC envelope before queueing; it contains a transient secret.
    let copy: AiConnectionSaveInput
    try {
      copy = structuredClone(input) as AiConnectionSaveInput
    }
    catch { return Promise.resolve({ ok: false, code: 'invalid' }) }
    let expectedKeyRevision: string | undefined
    const definition = copy && typeof copy === 'object' ? definitionById(copy.providerId) : undefined
    if (definition && definition.stageProviderId) {
      try {
        expectedKeyRevision = deps.vault.secretRevision?.(definition.stageProviderId, 'apiKey')
      }
      catch { return Promise.resolve({ ok: false, code: 'storage' }) }
    }
    const previousQueue = queue
    const saveAfterQueue = () => previousQueue.then(() => apply(copy, expectedKeyRevision))
    const result = deps.saveExclusively ? deps.saveExclusively(saveAfterQueue) : saveAfterQueue()
    queue = result.catch(() => {})
    return result
  }

  function definitionForOperation(providerId: unknown): LiaAiProviderDefinition | undefined {
    if (!validId(providerId))
      return undefined
    const definition = definitionById(providerId)
    return definition && manageable(definition) ? definition : undefined
  }

  function execute<T>(providerId: unknown, operation: (request: (path: string, body?: unknown) => Promise<any>, state: AiConnectionState) => Promise<T>): Promise<{ ok: true } & T | Failure> {
    const definition = definitionForOperation(providerId)
    if (!definition)
      return Promise.resolve({ ok: false, code: 'invalid' })
    const previousQueue = queue
    const resultPromise = (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      try {
        const work = async () => {
          await previousQueue
          if (!await isSafeToStart())
            throw new Error('unconfigured')
          const snapshot = await deps.repository.read()
          // A corrupted or duplicated managed row is not a usable connection.
          // Report it with the same safe code the rest of the launcher uses.
          let record: TransportRecord | undefined
          try {
            record = recordFrom(snapshot, definition)
          }
          catch { throw new Error('unconfigured') }
          if (!record?.enabled || !validAddress(record.baseUrl))
            throw new Error('unconfigured')
          const state = await readInternal(definition.definitionId)
          if (controller.signal.aborted)
            throw new Error('timeout')
          const key = deps.vault.getSecret(definition.stageProviderId!, 'apiKey')
          const request = async (path: string, body?: unknown) => {
            const response = await fetchImpl(`${record.baseUrl.replace(/\/+$/, '')}/${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
            if (!response.ok)
              throw new Error('http')
            const reader = response.body?.getReader()
            if (!reader)
              throw new Error('protocol')
            const chunks: Uint8Array[] = []
            let size = 0
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done)
                  break
                size += value.byteLength
                if (size > 1024 * 1024)
                  throw new Error('protocol')
                chunks.push(value)
              }
            }
            finally { await reader.cancel().catch(() => {}) }
            try {
              return JSON.parse(Buffer.concat(chunks).toString('utf8'))
            }
            catch { throw new Error('protocol') }
          }
          return operation(request, state)
        }
        // Includes queue, repository reads and bodies, even when a dependency ignores signal.
        const result = await Promise.race([work(), new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))])
        return { ok: true as const, ...result }
      }
      catch (error) {
        const code = controller.signal.aborted ? 'timeout' : error instanceof Error && ['http', 'protocol', 'unconfigured'].includes(error.message) ? error.message as FailureCode : 'network'
        return { ok: false as const, code }
      }
      finally { clearTimeout(timer) }
    })()
    queue = resultPromise.catch(() => {})
    return resultPromise
  }

  function discover(providerId: unknown) {
    return execute(providerId, async (request) => {
      const body = await request('models')
      if (!Array.isArray(body?.data) || body.data.length > 1000 || !body.data.every((row: any) => validId(row?.id)))
        throw new Error('protocol')
      const ids = [...new Set<string>(body.data.map((row: any) => row.id))]
      return { models: ids.map(id => ({ id, label: id })) }
    })
  }

  function probe(providerId: unknown) {
    return execute(providerId, async (request, state) => {
      if (!state.modelId)
        throw new Error('unconfigured')
      const tools = [{ type: 'function', function: { name: 'lia_connection_check', description: 'Return the connection check result.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }]
      const messages: any[] = [{ role: 'user', content: 'Call lia_connection_check once, then reply with the exact result it returns.' }]
      const first = await request('chat/completions', { model: state.modelId, messages, tools, tool_choice: { type: 'function', function: { name: 'lia_connection_check' } }, stream: false })
      const message = first?.choices?.[0]?.message
      const calls = message?.tool_calls
      if (!Array.isArray(calls) || calls.length !== 1 || !validId(calls[0]?.id) || calls[0]?.type !== 'function' || calls[0]?.function?.name !== 'lia_connection_check')
        throw new Error('protocol')
      try {
        if (JSON.stringify(JSON.parse(calls[0].function.arguments)) !== '{}')
          throw new Error('protocol')
      }
      catch { throw new Error('protocol') }
      const marker = `lia-check-${crypto.randomUUID()}`
      messages.push({ role: 'assistant', content: typeof message.content === 'string' ? message.content : null, tool_calls: calls }, { role: 'tool', tool_call_id: calls[0].id, content: marker })
      const final = await request('chat/completions', { model: state.modelId, messages, tools, tool_choice: 'none', stream: false })
      const reply = final?.choices?.[0]?.message
      if (typeof reply?.content !== 'string' || !reply.content.includes(marker) || (reply.tool_calls?.length ?? 0) !== 0)
        throw new Error('protocol')
      return {}
    })
  }
  return { catalog: listDefinitions, discover, isSafeToStart, probe, read, save }
}
