import type { LiaAllTalkRuntimeConfig } from '../../../shared/eventa'
import type { LiaVoiceProfileStore } from './voice-profiles'

import { createAllTalkClient, toAllTalkLanguage } from './alltalk-client'
import { createAllTalkSyncService } from './alltalk-voices-sync'

/**
 * One utterance, end to end: profile id in, audio out.
 *
 * ```
 * profile id
 *   -> ensureProfileAvailableToAllTalk()   publish the reference WAV if needed
 *   -> managed filename                    lia-<profile-id>.wav
 *   -> POST /api/tts-generate              answers with JSON, not audio
 *   -> GET  output_file_url                the actual bytes
 * ```
 *
 * Kept out of the IPC bridge so the whole chain - including the second HTTP hop
 * - can be driven against a local test server. The bridge is then just a thin
 * wrapper that reads the runtime config and forwards.
 *
 * The caller supplies a `profileId`, never a filename. The name AllTalk receives
 * as `character_voice_gen` is derived inside the sync service from that id, so
 * there is no path by which a caller can point a request at an arbitrary file in
 * AllTalk's folder.
 */
export interface SynthesizeProfileParams {
  profileId: string
  text: string
  /** BCP-47 tag, e.g. `pt-BR`; normalized to AllTalk's `pt` by the client. */
  language?: string
  runtime: LiaAllTalkRuntimeConfig
  store: LiaVoiceProfileStore
  fetchImpl?: typeof fetch
}

export async function synthesizeProfileWithAllTalk(params: SynthesizeProfileParams): Promise<ArrayBuffer> {
  const { profileId, text, language, runtime, store } = params

  const published = await createAllTalkSyncService({ store, voicesDir: runtime.voicesDir })
    .ensureProfileAvailableToAllTalk(profileId)

  if (!published.ok)
    throw new Error(published.message)

  return createAllTalkClient(runtime, params.fetchImpl).synthesize({
    text,
    characterVoiceGen: published.filename,
    // The provider passes a BCP-47 tag through; AllTalk only accepts `pt`.
    language: toAllTalkLanguage(language),
  })
}
