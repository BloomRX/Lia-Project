import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import { isAllTalkVoiceFile } from '../../../core/src/providers/alltalk-speech.ts'

/** AllTalk is an optional local service. A voice name refers to the service's own WAV library. */
export function createLocalAllTalk(base: URL, request: typeof fetch = fetch) {
  const { protocol, hostname, username, password, pathname, search, hash, origin } = base
  if (protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(hostname)
    || username || password || pathname !== '/' || search || hash)
    throw new Error('Invalid local voice service')

  return async (input: { text: string, voice: string, language?: string }, signal: AbortSignal) => {
    if (!input.text.trim() || input.text.length > 8_000
      || !isAllTalkVoiceFile(input.voice))
      return { ok: false, code: 'unavailable' } as const
    const active = AbortSignal.any([signal, AbortSignal.timeout(60_000)])
    const sameOrigin = { redirect: 'error', credentials: 'omit', signal: active } as const
    try {
      active.throwIfAborted()
      const generated = await request(new URL('/api/tts-generate', origin), {
        ...sameOrigin,
        method: 'POST',
        body: new URLSearchParams({
          text_input: input.text,
          character_voice_gen: input.voice,
          narrator_enabled: 'false',
          autoplay: 'false',
          output_file: `lia-${randomUUID()}`,
          language: languageCode(input.language),
        }),
      })
      const output = JSON.parse((await readResponse(generated, active, 64 * 1024)).toString('utf8'))
      if (output?.status !== 'generate-success' || typeof output.output_file_url !== 'string'
        || !/^\/audio\/[\w.-]{1,240}\.wav$/i.test(output.output_file_url))
        return { ok: false, code: 'unavailable' } as const
      active.throwIfAborted()
      const response = await request(new URL(output.output_file_url, origin), sameOrigin)
      const audio = await readResponse(response, active, 32 * 1024 * 1024)
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE'
        || audio.readUInt32LE(4) !== audio.length - 8)
        return { ok: false, code: 'unavailable' } as const
      return { ok: true, audio: new Uint8Array(audio).buffer } as const
    }
    catch {
      return { ok: false, code: signal.aborted ? 'cancelled' : 'unavailable' } as const
    }
  }
}

const languages = new Set(['ar', 'zh-cn', 'cs', 'nl', 'en', 'fr', 'de', 'hi', 'hu', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'es', 'tr'])

function languageCode(locale: string | undefined) {
  const tag = locale?.toLowerCase()
  const language = tag?.startsWith('zh') ? 'zh-cn' : tag?.split('-')[0]
  return language && languages.has(language) ? language : 'auto'
}

async function readResponse(response: Response, signal: AbortSignal, limit: number) {
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => {})
    throw new Error('Local voice response unavailable')
  }
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      if (done)
        return Buffer.concat(chunks, size)
      size += value.byteLength
      if (size > limit)
        throw new Error('Local voice response too large')
      chunks.push(value)
    }
  }
  finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
