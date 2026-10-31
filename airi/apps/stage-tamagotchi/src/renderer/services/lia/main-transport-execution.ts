import type { ChatRequest, ProviderConfig } from '../../../../../../../lia/core/src/providers/index'
import type { TransportStartRequest } from '../../../shared/eventa/lia-transport-execution'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { ProviderError } from '../../../../../../../lia/core/src/providers/index'
import { electronLiaTransportCancel, electronLiaTransportPull, electronLiaTransportStart } from '../../../shared/eventa/lia-transport-execution'

/** Only response bytes cross this port. Stored credentials stay in main. */
export function createMainTransportExecution() {
  const active = new Set<{ providerId: string, cancel: () => void }>()
  const disposedProviders = new Set<string>()
  let disposed = false
  async function execute(payload: TransportStartRequest, signal?: AbortSignal): Promise<Response> {
    if (disposed || disposedProviders.has(payload.providerId) || signal?.aborted)
      throw new ProviderError('cancelled')
    let id: string | undefined
    let cancelSent = false
    const controller = new AbortController()
    let responseController: ReadableStreamDefaultController<Uint8Array> | undefined
    let rejectAbort: (reason: ProviderError) => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject
    })
    const entry = { providerId: payload.providerId, cancel: abort }
    const cancelMain = () => {
      if (!id || cancelSent)
        return
      cancelSent = true
      void useElectronEventaInvoke(electronLiaTransportCancel)({ id }).catch(() => {})
    }
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      active.delete(entry)
      responseController = undefined
    }
    function abort() {
      if (controller.signal.aborted)
        return
      controller.abort()
      rejectAbort(new ProviderError('cancelled'))
      responseController?.error(new ProviderError('cancelled'))
      cancelMain()
      cleanup()
    }
    active.add(entry)
    signal?.addEventListener('abort', abort, { once: true })
    // Observe an abort even while the SDK is not consuming the body.
    void aborted.catch(() => {})
    if (signal?.aborted)
      abort()
    const pull = async (action: 'head' | 'read') => {
      if (controller.signal.aborted || !id)
        throw new ProviderError('cancelled')
      const result = await Promise.race([useElectronEventaInvoke(electronLiaTransportPull)({ id, action }), aborted])
      if (controller.signal.aborted)
        throw new ProviderError('cancelled')
      if (!result.ok)
        throw new ProviderError(result.code, result.status)
      return result
    }
    try {
      const starting = useElectronEventaInvoke(electronLiaTransportStart)(payload).then((start) => {
        if (!start.ok)
          throw new ProviderError(start.code, start.status)
        id = start.id
        // A disposed execution may already have rejected before main returns its ID.
        if (controller.signal.aborted)
          cancelMain()
      })
      await Promise.race([starting, aborted])
      const head = await pull('head')
      if (controller.signal.aborted)
        throw new ProviderError('cancelled')
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          responseController = stream
        },
        async pull(stream) {
          try {
            const chunk = await pull('read')
            if (controller.signal.aborted)
              throw new ProviderError('cancelled')
            if (chunk.bytes?.length)
              stream.enqueue(Uint8Array.from(chunk.bytes))
            if (chunk.done) {
              cleanup()
              stream.close()
            }
          }
          catch (error) {
            cleanup()
            cancelMain()
            stream.error(error instanceof ProviderError ? error : new ProviderError('network'))
          }
        },
        cancel() {
          abort()
        },
      })
      return new Response(body, { status: head.status ?? 200, headers: { 'content-type': head.contentType ?? 'application/json' } })
    }
    catch (error) {
      cleanup()
      cancelMain()
      throw error instanceof ProviderError ? error : new ProviderError('network')
    }
  }
  const draft = (value: Record<string, unknown>) => ({
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    ...(typeof value.apiKey === 'string' ? { apiKey: value.apiKey } : {}),
  })
  return {
    dispatch: (config: ProviderConfig, body: ChatRequest, signal?: AbortSignal) => execute({ providerId: config.providerId, expectedBaseUrl: config.baseUrl, operation: 'chat', body }, signal),
    async discover(providerId: string, value: Record<string, unknown>) {
      try {
        const response = await execute({ providerId, operation: 'models', draft: draft(value) })
        const json = await response.json() as { data?: Array<{ id: string, label?: string }> }
        if (!Array.isArray(json.data))
          throw new ProviderError('protocol')
        return { status: 'ready' as const, models: json.data.map(item => ({ id: item.id, label: item.label ?? item.id })) }
      }
      catch {
        return { status: 'error' as const, models: [] }
      }
    },
    async probe(providerId: string, model: string, value: Record<string, unknown>) {
      try {
        const response = await execute({ providerId, operation: 'chat', draft: draft(value), body: { model, messages: [{ role: 'user', content: 'Reply with OK.' }] } })
        const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        if (!json.choices?.[0]?.message?.content?.trim())
          throw new ProviderError('empty')
        return { ok: true, scope: 'text' as const }
      }
      catch (error) {
        const code = error instanceof ProviderError ? error.code : undefined
        return { ok: false, scope: 'text' as const, failure: code === 'configuration' ? 'configuration' : code === 'empty' ? 'empty' : code === 'network' ? 'endpoint' : 'request' }
      }
    },
    dispose(providerId?: string) {
      if (providerId)
        disposedProviders.add(providerId)
      else
        disposed = true
      for (const entry of active) {
        if (!providerId || entry.providerId === providerId)
          entry.cancel()
      }
    },
  }
}
