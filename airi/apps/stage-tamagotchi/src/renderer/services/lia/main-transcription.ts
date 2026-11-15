import type { RecordingTranscriptionExecution, RecordingTranscriptionExecutionResult } from '@proj-airi/stage-ui/stores/modules/hearing'

import type { LiaTranscriptionRunOutcome, LiaTranscriptionRunRequest } from '../../../shared/eventa/lia-transcription'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'

import { electronLiaTranscriptionCancel, electronLiaTranscriptionRun } from '../../../shared/eventa/lia-transcription'

/**
 * Renderer side of the main-process transcription port.
 *
 * Paired with `main/services/lia/transcription-service.ts`. The exchange is:
 * audio and options go up, recognized text or a code comes down. No endpoint, no
 * credential, and nothing that would let this side choose where a stored key is
 * spent.
 */
export interface MainTranscriptionPort {
  run: (request: LiaTranscriptionRunRequest, signal?: AbortSignal) => Promise<LiaTranscriptionRunOutcome>
  dispose?: () => void
}

export function createMainTranscription(): MainTranscriptionPort {
  // Resolved on first use, not at store construction.
  //
  // The port is created while the Lia stores initialise, in every window, but a
  // window that never transcribes should not require the bridge to exist — and a
  // host without it (a unit fixture, the browser build) must keep working
  // untouched rather than fail to boot.
  let invoke: ((request: LiaTranscriptionRunRequest) => Promise<LiaTranscriptionRunOutcome>) | undefined
  let disposed = false
  const active = new Set<() => void>()
  return {
    run(request, signal) {
      if (disposed || signal?.aborted)
        return Promise.resolve({ ok: false, code: 'cancelled' })
      const requestId = crypto.randomUUID()
      return new Promise<LiaTranscriptionRunOutcome>((resolve) => {
        let settled = false
        let dispatched = false
        let cancelled = false
        const finish = (outcome: LiaTranscriptionRunOutcome) => {
          if (settled)
            return
          settled = true
          active.delete(abort)
          signal?.removeEventListener('abort', abort)
          resolve(outcome)
        }
        function abort() {
          if (settled)
            return
          if (dispatched && !cancelled) {
            cancelled = true
            try {
              void useElectronEventaInvoke(electronLiaTranscriptionCancel)({ requestId }).catch(() => {})
            }
            catch { /* Context teardown can make IPC unavailable. Main owns window cleanup. */ }
          }
          finish({ ok: false, code: 'cancelled' })
        }
        active.add(abort)
        signal?.addEventListener('abort', abort, { once: true })
        try {
          invoke ??= useElectronEventaInvoke(electronLiaTranscriptionRun)
          dispatched = true
          void invoke({ ...request, requestId }).then(finish, () => finish({ ok: false, code: 'network' }))
        }
        catch {
          finish({ ok: false, code: 'network' })
        }
      })
    },
    dispose() {
      disposed = true
      for (const abort of active)
        abort()
    },
  }
}

/**
 * Adapts the shared hearing pipeline's request to the main-process port.
 *
 * The `File` the pipeline built is forwarded byte for byte: same bytes, same
 * name, same MIME type, so the upstream receives exactly what it would have
 * received from the in-process client. `providerOptions` is where the pipeline
 * carries `language`; `abortSignal` and anything else non-serializable is
 * dropped rather than smuggled through structured clone.
 */
export async function transcribeThroughMain(
  port: MainTranscriptionPort,
  providerId: string,
  request: RecordingTranscriptionExecution,
): Promise<RecordingTranscriptionExecutionResult> {
  request.signal?.throwIfAborted()
  if (request.file.size === 0 || request.file.size > 24 * 1024 * 1024)
    throw new Error('Transcription failed: configuration')
  const bytes = new Uint8Array(await request.file.arrayBuffer())
  request.signal?.throwIfAborted()
  const options = request.providerOptions ?? {}
  const language = typeof options.language === 'string' ? options.language : undefined
  const prompt = typeof options.prompt === 'string' ? options.prompt : undefined
  const temperature = typeof options.temperature === 'number' ? options.temperature : undefined
  const outcome = await port.run({
    providerId,
    model: request.model,
    fileName: request.file.name,
    mimeType: request.file.type || 'audio/wav',
    bytes,
    ...(request.responseFormat ? { responseFormat: request.responseFormat } : {}),
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
    ...(temperature === undefined ? {} : { temperature }),
  }, request.signal)
  request.signal?.throwIfAborted()
  if (!outcome.ok)
    throw outcome.code === 'cancelled' ? new DOMException('Cancelled', 'AbortError') : new Error(`Transcription failed: ${outcome.code}`)
  return outcome.segments === undefined
    ? { text: outcome.text }
    : { text: outcome.text, segments: outcome.segments }
}
