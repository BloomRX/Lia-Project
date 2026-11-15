import type { ChatRequest } from '../../../../../../lia/core/src/providers/contracts'

export type OidcHttpRequest
  = | { kind: 'chat', body: ChatRequest, chatSessionId?: string }
    | { kind: 'speech', model: string, voice: string, input: string, responseFormat?: string, speed?: number, extraBody?: Record<string, unknown> }
    | { kind: 'transcription' }
    | { kind: 'list-chats' }
    | { kind: 'create-chat', chat: { id?: string, type?: 'private' | 'bot' | 'group' | 'channel', title?: string, members?: { type: 'user' | 'character' | 'bot', userId?: string, characterId?: string }[] } }
    | { kind: 'delete-chat', chatId: string }

export interface OidcHttpFailure { ok: false, code: 'invalid-request' | 'unauthenticated' | 'cancelled' | 'timeout' | 'unavailable' | 'rejected' | 'busy', status?: number }
export type OidcHttpOpenResult = { ok: true, id: string } | OidcHttpFailure
export type OidcHttpPullResult = { ok: true, done: boolean, contentType: 'text/event-stream' | 'application/json' | 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/pcm' | 'audio/opus' | 'audio/flac' | 'audio/aac', bytes: number[] } | OidcHttpFailure

/** Prepared contract. A Main handler must bind this port to its sender window. */
export interface OidcHttpPort {
  open: (request: unknown, signal?: AbortSignal) => OidcHttpOpenResult
  pull: (id: string) => Promise<OidcHttpPullResult>
  write: (id: string, chunk: Uint8Array | null) => Promise<{ ok: true } | OidcHttpFailure>
  cancel: (id: string) => boolean
  dispose: () => void
}
