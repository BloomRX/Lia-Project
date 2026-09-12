/**
 * Temporary DEV-only trace of the `voice.tts` hydration chain.
 *
 * Added to answer a specific question on a real machine: the Voice tab of
 * "Configurar Lia" showed every field as "Não definido", and the chain had to be
 * measured stage by stage instead of assumed -
 *
 *   lia-product.json -> IPC electronLiaVoiceConfigGet -> refreshConfig()
 *   -> applyTtsState() -> VoiceSection.vue
 *
 * Authorization is the build mode alone, exactly like `./gate`: a packaged
 * renderer never prints this, and no user-writable flag can turn it on.
 *
 * References only. `providerId`/`modelId`/`voiceId` are identifiers, not
 * credentials; nothing here touches the vault, and no API key, secret or
 * Authorization value is ever read or printed.
 */

export interface VoiceConfigDiag {
  /** Which stage produced this line. */
  stage: 'store' | 'component'
  /** The IPC invoke resolved at all (did not throw). */
  ipcGetReturned: boolean
  /** The resolved payload carried a `tts` key. */
  ipcTtsExists: boolean
  /** That `tts` slice actually held something, i.e. a voice was persisted. */
  persistedVoiceTts: boolean
  /** Normalized state: a preferred target survived normalization. */
  preferredExists: boolean
  fallbackCount: number
  /** The same, read back from the store refs after they were applied. */
  storePreferredExists: boolean
  storeFallbackCount: number
  hasConfiguration: boolean
  /** Identifiers of the preferred target, when there is one. */
  providerId: string | null
  modelId: string | null
  voiceId: string | null
}

/** The only authorization boundary: the build mode. */
export function shouldLogVoiceConfigDiag(isDev: boolean): boolean {
  return isDev
}

export function logVoiceConfigDiag(isDev: boolean, diag: VoiceConfigDiag): void {
  if (!shouldLogVoiceConfigDiag(isDev))
    return

  // console.info (not warn/error) so the line is easy to filter and never reads
  // as a failure. The stage prefix makes the order of the chain obvious.
  console.info(`[VOICE-CONFIG-DIAG] ${diag.stage}`, diag)
}
