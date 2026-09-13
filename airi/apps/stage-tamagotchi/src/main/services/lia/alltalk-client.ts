/**
 * Client for a locally running AllTalk server (v2 API).
 *
 * Every endpoint, parameter and response shape below is taken from the AllTalk
 * wiki, not from memory:
 * - Standard TTS Generation API
 *   https://github.com/erew123/alltalk_tts/wiki/API-%E2%80%90-Standard-TTS-Generation-API
 * - Control and Configuration API
 *   https://github.com/erew123/alltalk_tts/wiki/API-%E2%80%90-Control-and-Configuration-API
 *
 * Three facts from that documentation shape this whole file:
 *
 * 1. **The generation endpoint returns JSON, not audio.** `/api/tts-generate`
 *    answers with `{ status, output_file_path, output_file_url, output_cache_url }`
 *    and the bytes have to be fetched from `output_file_url` afterwards. A client
 *    that treats the first response as audio gets a JSON document it then tries
 *    to decode as WAV.
 * 2. **`character_voice_gen` is a filename inside AllTalk's own voices folder**,
 *    not a path and not a payload. AllTalk cannot be handed reference audio over
 *    this API, so the file has to already be present in that folder - which is
 *    why the Lia runtime config carries a `voicesDir` and why publishing a
 *    profile means copying into it.
 * 3. **Portuguese is `pt`, not `pt-BR`.** The documented language table has no
 *    region variants, so a BCP-47 tag has to be reduced to its primary subtag or
 *    the request is rejected.
 */

export interface AllTalkRuntimeConfig {
  /** Base URL of the server, no trailing slash. AllTalk's default port is 7851. */
  baseUrl: string
  /** Per-request timeout in milliseconds. */
  timeoutMs: number
  /**
   * AllTalk's own voices folder. Reference audio has to live here for
   * `character_voice_gen` to resolve; see the note above.
   */
  voicesDir?: string
  /**
   * Where AllTalk is installed, so the Lia can start and stop it. Only ever
   * written by the main process's own directory picker.
   */
  installDir?: string
}

export const DEFAULT_ALLTALK_BASE_URL = 'http://127.0.0.1:7851'
export const DEFAULT_ALLTALK_TIMEOUT_MS = 60_000

/** AllTalk's documented language codes. Portuguese is `pt`; there is no `pt-BR`. */
export const ALLTALK_LANGUAGES = [
  'auto',
  'ar',
  'zh-cn',
  'cs',
  'nl',
  'en',
  'fr',
  'de',
  'hi',
  'hu',
  'it',
  'ja',
  'ko',
  'pl',
  'pt',
  'ru',
  'es',
  'tr',
] as const

export type AllTalkLanguage = typeof ALLTALK_LANGUAGES[number]

/**
 * Reduces a BCP-47 tag to the code AllTalk accepts.
 *
 * `pt-BR` -> `pt`. An unknown primary subtag falls back to `auto`, which the
 * documented API supports, rather than sending something the server rejects.
 */
export function toAllTalkLanguage(tag: string | undefined): AllTalkLanguage {
  const primary = String(tag ?? '').toLowerCase().split('-')[0] ?? ''
  return (ALLTALK_LANGUAGES as readonly string[]).includes(primary)
    ? primary as AllTalkLanguage
    : 'auto'
}

export interface AllTalkGenerateParams {
  text: string
  /** Filename inside AllTalk's voices folder, e.g. `lia.wav`. */
  characterVoiceGen: string
  language: AllTalkLanguage
  outputFileName?: string
  speed?: number
  pitch?: number
  temperature?: number
  repetitionPenalty?: number
}

export interface AllTalkGenerateResponse {
  status: string
  output_file_path?: string
  output_file_url?: string
  output_cache_url?: string
}

export type AllTalkStatus
  = | { ok: true, state: 'connected', voices: string[] }
    | { error: string, ok: false, state: 'error' }
    | { ok: false, state: 'offline' }

export interface AllTalkClient {
  /** GET /api/voices - doubles as the health check. */
  status: () => Promise<AllTalkStatus>
  /** POST /api/tts-generate, then fetch the WAV from `output_file_url`. */
  synthesize: (params: AllTalkGenerateParams) => Promise<ArrayBuffer>
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

/**
 * Builds a client. `fetchImpl` is injectable so tests can drive it against a
 * local mock server without touching the network.
 */
export function createAllTalkClient(
  config: AllTalkRuntimeConfig,
  fetchImpl: typeof fetch = fetch,
): AllTalkClient {
  const base = config.baseUrl?.trim() || DEFAULT_ALLTALK_BASE_URL
  const timeoutMs = config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_ALLTALK_TIMEOUT_MS

  async function request(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal })
    }
    finally {
      clearTimeout(timer)
    }
  }

  return {
    async status() {
      try {
        const response = await request(joinUrl(base, '/api/voices'))
        if (!response.ok)
          return { error: `AllTalk answered ${response.status}`, ok: false, state: 'error' }

        const body = await response.json() as { voices?: unknown }
        const voices = Array.isArray(body?.voices)
          ? body.voices.filter((voice): voice is string => typeof voice === 'string')
          : []
        return { ok: true, state: 'connected', voices }
      }
      catch {
        // A refused connection is the normal "AllTalk is not running" case, not
        // a fault to report as an error.
        return { ok: false, state: 'offline' }
      }
    },

    async synthesize(params) {
      if (!params.text?.trim())
        throw new Error('Nothing to synthesize.')
      if (!params.characterVoiceGen)
        throw new Error('This voice has no reference audio registered with AllTalk.')

      // Only the documented fields are sent; everything else is left to the
      // server's Global API defaults, which the wiki says is the intended way to
      // omit a setting.
      const form = new URLSearchParams({
        text_input: params.text,
        character_voice_gen: params.characterVoiceGen,
        language: params.language,
        narrator_enabled: 'false',
        text_filtering: 'standard',
        // Timestamped so concurrent requests cannot overwrite one another's file.
        output_file_timestamp: 'true',
        autoplay: 'false',
        ...(params.outputFileName ? { output_file_name: params.outputFileName } : {}),
        ...(params.speed !== undefined ? { speed: String(params.speed) } : {}),
        ...(params.pitch !== undefined ? { pitch: String(params.pitch) } : {}),
        ...(params.temperature !== undefined ? { temperature: String(params.temperature) } : {}),
        ...(params.repetitionPenalty !== undefined ? { repetition_penalty: String(params.repetitionPenalty) } : {}),
      })

      const response = await request(joinUrl(base, '/api/tts-generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      })

      if (!response.ok)
        throw new Error(`AllTalk generation failed (${response.status}).`)

      const body = await response.json() as AllTalkGenerateResponse
      if (body.status !== 'generate-success')
        throw new Error(`AllTalk reported "${body.status ?? 'unknown'}" for this generation.`)

      const audioUrl = body.output_file_url
      if (!audioUrl)
        throw new Error('AllTalk returned success but no audio location.')

      // Second hop: the generation endpoint returns a pointer, not the bytes.
      const audio = await request(new URL(audioUrl, base).toString())
      if (!audio.ok)
        throw new Error(`Could not fetch the generated audio (${audio.status}).`)

      const buffer = await audio.arrayBuffer()
      if (buffer.byteLength === 0)
        throw new Error('AllTalk returned an empty audio file.')

      return buffer
    },
  }
}
