import type { LiaSecretVault } from '@lia/core/secrets/vault'

import type { TransportMutation, TransportRecord, TransportResult, TransportSnapshot } from '../../../../../lia/core/src/transports/contracts'

import { Buffer } from 'node:buffer'

const PROVIDER_ID = 'openai-compatible'
const TRANSPORT_ID = 'launcher-ai-chat'
type FailureCode = 'invalid' | 'conflict' | 'storage' | 'credentials' | 'unconfigured' | 'network' | 'http' | 'protocol' | 'timeout' | 'stage-running'
interface Failure { ok: false, code: FailureCode }
export interface AiConnectionState { providerId: string, baseUrl: string, modelId?: string, hasKey: boolean, revision: number }
export interface AiConnectionSaveInput { baseUrl: string, apiKey?: string, modelId?: string, revision: number }
export interface AiConnectionServiceDeps {
  repository: { read: () => Promise<TransportSnapshot>, mutate: (input: TransportMutation) => Promise<TransportResult> }
  vault: LiaSecretVault
  readSelection: () => Promise<{ providerId: string, modelId?: string } | undefined>
  saveSelection: (target: { providerId: string, modelId?: string }) => Promise<void>
  /** The host shares this critical section with every managed Stage start. */
  saveExclusively?: (save: () => Promise<AiConnectionResult>) => Promise<AiConnectionResult>
  fetch?: typeof globalThis.fetch
}
export type AiConnectionResult = { ok: true, state: AiConnectionState } | Failure

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001F\u007F]/.test(value)
}
function validAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || value.trim() !== value)
    return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) && !url.username && !url.password && !url.search && !url.hash
  }
  catch { return false }
}

/** Main-only owner. Raw transport errors and remote bodies never cross IPC. */
export function createAiConnectionService(deps: AiConnectionServiceDeps) {
  let queue: Promise<unknown> = Promise.resolve()
  let configurationSafe = true
  const fetchImpl = deps.fetch ?? globalThis.fetch
  const recordFrom = (snapshot: TransportSnapshot) => {
    const records = snapshot.records.filter(row => row.providerId === PROVIDER_ID)
    if (records.length > 1 || (records[0] && records[0].protocol !== 'chat-completions'))
      throw new Error('storage')
    return records[0]
  }
  async function isSafeToStart(): Promise<boolean> {
    if (!configurationSafe)
      return false
    try {
      return recordFrom(await deps.repository.read())?.enabled !== false
    }
    catch { return false }
  }
  async function readInternal(): Promise<AiConnectionState> {
    const snapshot = await deps.repository.read()
    const record = recordFrom(snapshot)
    const selected = await deps.readSelection()
    return { providerId: PROVIDER_ID, baseUrl: validAddress(record?.baseUrl) ? record!.baseUrl : '', modelId: selected?.providerId === PROVIDER_ID ? selected.modelId : undefined, hasKey: deps.vault.hasSecret(PROVIDER_ID, 'apiKey'), revision: snapshot.revision }
  }

  async function read(): Promise<AiConnectionState> {
    await queue
    return readInternal()
  }

  async function apply(input: AiConnectionSaveInput): Promise<AiConnectionResult> {
    if (!input || typeof input !== 'object' || !Object.keys(input).every(key => ['baseUrl', 'apiKey', 'modelId', 'revision'].includes(key))
      || !validAddress(input.baseUrl) || !Number.isSafeInteger(input.revision) || input.revision < 0
      || (input.modelId !== undefined && !validId(input.modelId))
      || (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 16384 || /[\r\n\0]/.test(input.apiKey)))) {
      return { ok: false, code: 'invalid' }
    }
    let changedKey = false
    let oldKey: string | undefined
    let disabledRevision: number | undefined
    let previous: TransportRecord | undefined
    const previouslySafe = configurationSafe
    async function restoreKey(): Promise<boolean> {
      if (!changedKey)
        return true
      try {
        return oldKey !== undefined ? await deps.vault.setSecret(PROVIDER_ID, 'apiKey', oldKey) : await deps.vault.deleteSecret(PROVIDER_ID, 'apiKey')
      }
      catch { return false }
    }
    async function recover(): Promise<boolean> {
      if (!await restoreKey())
        return false
      if (disabledRevision === undefined)
        return previouslySafe
      try {
        const restored = await deps.repository.mutate(previous
          ? { kind: 'put', expectedRevision: disabledRevision, record: previous }
          : { kind: 'remove', expectedRevision: disabledRevision, id: TRANSPORT_ID })
        return restored.ok && previouslySafe
      }
      catch { return false }
    }
    try {
      const snapshot = await deps.repository.read()
      if (snapshot.revision !== input.revision)
        return { ok: false, code: 'conflict' }
      previous = recordFrom(snapshot)
      // Never silently forward a saved credential to a newly supplied host.
      if (previous?.baseUrl !== input.baseUrl && input.apiKey === undefined && deps.vault.hasSecret(PROVIDER_ID, 'apiKey'))
        return { ok: false, code: 'credentials' }
      // A failed recovery must never re-enable a row without an explicit key.
      if ((!configurationSafe || previous?.enabled === false) && input.apiKey === undefined)
        return { ok: false, code: 'credentials' }
      const adapterOptions = { ...previous?.adapterOptions, allowUnauthenticated: input.apiKey === '' || (input.apiKey === undefined && previous?.adapterOptions.allowUnauthenticated === true) }
      const record: TransportRecord = { id: previous?.id ?? TRANSPORT_ID, providerId: PROVIDER_ID, definitionId: previous?.definitionId ?? PROVIDER_ID, type: 'http', protocol: 'chat-completions', baseUrl: input.baseUrl, enabled: true, adapterOptions, modelIds: input.modelId ? [input.modelId] : [], metadata: previous?.metadata ?? {}, credentialRef: { scope: PROVIDER_ID, key: 'apiKey' } }
      // Durable fail-closed boundary BEFORE changing credentials. If the
      // launcher exits or rollback fails, every later reader sees disabled.
      const disabled = await deps.repository.mutate({ kind: 'put', expectedRevision: snapshot.revision, record: { ...(previous ?? record), enabled: false } })
      if (!disabled.ok)
        return { ok: false, code: disabled.code }
      disabledRevision = disabled.snapshot.revision
      configurationSafe = false
      if (input.apiKey !== undefined) {
        oldKey = deps.vault.getSecret(PROVIDER_ID, 'apiKey')
        changedKey = true
        const stored = input.apiKey ? await deps.vault.setSecret(PROVIDER_ID, 'apiKey', input.apiKey) : await deps.vault.deleteSecret(PROVIDER_ID, 'apiKey')
        if (!stored) {
          configurationSafe = await recover()
          return { ok: false, code: configurationSafe ? 'credentials' : 'storage' }
        }
      }
      await deps.saveSelection({ providerId: PROVIDER_ID, ...(input.modelId ? { modelId: input.modelId } : {}) })
      const saved = await deps.repository.mutate({ kind: 'put', expectedRevision: disabledRevision, record })
      if (!saved.ok) {
        configurationSafe = await recover()
        return { ok: false, code: configurationSafe ? saved.code : 'storage' }
      }
      configurationSafe = true
      return { ok: true, state: { providerId: PROVIDER_ID, baseUrl: record.baseUrl, modelId: input.modelId, hasKey: deps.vault.hasSecret(PROVIDER_ID, 'apiKey'), revision: saved.snapshot.revision } }
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
    const previousQueue = queue
    const saveAfterQueue = () => previousQueue.then(() => apply(copy))
    const result = deps.saveExclusively ? deps.saveExclusively(saveAfterQueue) : saveAfterQueue()
    queue = result.catch(() => {})
    return result
  }

  function execute<T>(operation: (request: (path: string, body?: unknown) => Promise<any>, state: AiConnectionState) => Promise<T>): Promise<{ ok: true } & T | Failure> {
    const previousQueue = queue
    const resultPromise = (async () => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      try {
        const work = async () => {
          await previousQueue
          if (!await isSafeToStart())
            throw new Error('unconfigured')
          const state = await readInternal()
          if (!state.baseUrl || !recordFrom(await deps.repository.read())?.enabled)
            throw new Error('unconfigured')
          if (controller.signal.aborted)
            throw new Error('timeout')
          const key = deps.vault.getSecret(PROVIDER_ID, 'apiKey')
          const request = async (path: string, body?: unknown) => {
            const response = await fetchImpl(`${state.baseUrl.replace(/\/+$/, '')}/${path}`, { method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
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

  function discover() {
    return execute(async (request) => {
      const body = await request('models')
      if (!Array.isArray(body?.data) || body.data.length > 1000 || !body.data.every((row: any) => validId(row?.id)))
        throw new Error('protocol')
      const ids = [...new Set<string>(body.data.map((row: any) => row.id))]
      return { models: ids.map(id => ({ id, label: id })) }
    })
  }

  function probe() {
    return execute(async (request, state) => {
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
  return { read, save, discover, probe, isSafeToStart }
}
