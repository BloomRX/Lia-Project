import type { LiaSecretVault } from '@lia/core/secrets/vault'
import type { createTransportRepository } from '@lia/contracts/transports/repository'
import type { RemoteTranscriptionApproval } from '@lia/contracts/transcription/service'
import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { WebContents } from 'electron'

import { ProviderError } from '@lia/contracts/providers'
import {
  createLiaTranscriptionService as createService,
  isTranscriptionObject,
  isTranscriptionRequestId,
  transcriptionFailure,
  validateTranscriptionRequest,
} from '@lia/contracts/transcription/service'
import { defineInvokeHandler } from '@moeru/eventa'

import { electronLiaTranscriptionCancel, electronLiaTranscriptionRun } from '../../../shared/eventa/lia-transcription'
import { isCuratedChatProvider } from '../../../shared/lia/provider-catalog'
import { resolveMainCredential } from './credential-owner-access'
import { withLiaProviderHeaders } from './provider-request-headers'

type Repository = Pick<ReturnType<typeof createTransportRepository>, 'read'>

export interface LiaTranscriptionServiceOptions {
  repository: Repository
  vault: LiaSecretVault
  fetch?: typeof globalThis.fetch
}

export function createLiaTranscriptionService(options: LiaTranscriptionServiceOptions) {
  return createService({
    repository: options.repository,
    resolveCredential: (scope, key, signal) => resolveMainCredential(options.vault, scope, key, signal),
    supportsLegacy: isCuratedChatProvider,
    fetchForProvider: providerId => withLiaProviderHeaders(options.fetch ?? globalThis.fetch, providerId),
  })
}

/** One main-process bridge; the renderer only ever receives text or a code. */
export function registerLiaTranscriptionBridge(params: {
  context: ReturnType<typeof createContext>['context']
  isAllowedSender: (event: Electron.IpcMainEvent) => boolean
  approveRemote?: (owner: WebContents, ...args: Parameters<RemoteTranscriptionApproval>) => Promise<boolean>
  repository: Repository
  vault: LiaSecretVault
  fetch?: typeof globalThis.fetch
}) {
  const service = createLiaTranscriptionService({ fetch: params.fetch, repository: params.repository, vault: params.vault })
  type Owner = WebContents
  const pending = new Map<string, {
    owner: Owner
    frame: Electron.IpcMainEvent['senderFrame']
    controller: AbortController
    detach: () => void
  }>()
  let disposed = false
  defineInvokeHandler(params.context, electronLiaTranscriptionRun, async (payload, options) => {
    try {
      const request = validateTranscriptionRequest(payload)
      const event = options?.raw?.ipcMainEvent
      const owner = event?.sender
      if (disposed || !owner || owner.isDestroyed() || !params.isAllowedSender(event) || !isTranscriptionRequestId(request.requestId))
        throw new ProviderError('configuration')
      if (pending.has(request.requestId) || pending.size >= 32 || [...pending.values()].filter(job => job.owner === owner).length >= 8)
        throw new ProviderError('configuration')
      const controller = new AbortController()
      const cleanup = () => controller.abort()
      const cancelOnNavigation = (details: Electron.WebContentsDidStartNavigationEventParams) => {
        if (details.isMainFrame && !details.isSameDocument)
          cleanup()
      }
      const detach = () => {
        owner.removeListener('destroyed', cleanup)
        owner.removeListener('render-process-gone', cleanup)
        owner.removeListener('did-start-navigation', cancelOnNavigation)
      }
      const job = { owner, frame: event.senderFrame, controller, detach }
      pending.set(request.requestId, job)
      owner.once('destroyed', cleanup)
      owner.once('render-process-gone', cleanup)
      owner.on('did-start-navigation', cancelOnNavigation)
      try {
        const approve = params.approveRemote
        return await service.transcribe(request, controller.signal, approve && (async (...args) =>
          params.isAllowedSender(event) && await approve(owner, ...args) && params.isAllowedSender(event)))
      }
      finally {
        if (pending.get(request.requestId) === job)
          pending.delete(request.requestId)
        detach()
      }
    }
    catch (error) {
      return transcriptionFailure(error)
    }
  })
  defineInvokeHandler(params.context, electronLiaTranscriptionCancel, (payload, options) => {
    if (!isTranscriptionObject(payload) || Object.keys(payload).length !== 1 || !isTranscriptionRequestId(payload.requestId))
      return { ok: false }
    const job = pending.get(payload.requestId)
    const event = options?.raw?.ipcMainEvent
    // A preview leaving its allowed route can still cancel its own in-flight
    // request during teardown. Starting a new one still requires route approval.
    if (!event || !job || job.owner !== event.sender || job.frame !== event.senderFrame)
      return { ok: false }
    job.controller.abort()
    return { ok: true }
  })
  return {
    ...service,
    dispose() {
      disposed = true
      for (const job of pending.values()) {
        job.controller.abort()
        job.detach()
      }
      pending.clear()
      service.dispose()
    },
  }
}
