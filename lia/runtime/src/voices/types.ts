/**
 * Canonical Lia voice-profile vocabulary.
 *
 * Moved here from the AIRI `shared/eventa` contract when the Lia product left
 * the stage host: these shapes describe Lia's own voice data, and Lia Core -
 * not AIRI - owns them now. The AIRI contract re-exports them verbatim so
 * every consumer keeps one definition; nothing here may grow an AIRI import.
 *
 * The profiles themselves stay canonical on disk under
 * `<lia-user-data>/lia-voices/<id>/` (see `../paths/product-paths`).
 */

/**
 * One file belonging to a custom voice profile.
 *
 * `filename` is a bare name inside the profile's own directory under
 * `userData/lia-voices/<id>/` - never an absolute path and never a separator, so
 * a stored profile cannot point outside its own folder.
 */
export interface LiaCustomVoiceFile {
  /** Stable role within the profile, e.g. `model` or `index`. */
  role: string
  filename: string
  bytes: number
}

/**
 * A user's private, imported voice.
 *
 * Deliberately engine-agnostic: the core knows a voice has an `engine` and some
 * files, not what RVC or XTTS or AllTalk need. Nothing here is a binary or
 * base64 - the bytes stay on disk and only names and sizes are persisted.
 *
 * `voice.tts` references a profile by `voiceId === id`, so no second config
 * writer is needed: the existing `preferred`/`fallback` targets and
 * `saveTtsConfiguration()` remain the only route that selects a voice.
 */
export interface LiaCustomVoiceProfile {
  id: string
  name: string
  engine: string
  /** ISO timestamp. */
  createdAt: string
  files: LiaCustomVoiceFile[]
  /** Free-form, string-valued, UI-displayable. Never credentials. */
  metadata?: Record<string, string>
}

/**
 * Why an import or a load failed, in terms a user can act on. The UI maps these
 * to friendly strings; a stack trace never reaches it.
 */
export type LiaVoiceProfileErrorCode
  = | 'cancelled'
    | 'duplicateId'
    | 'duplicateName'
    | 'emptyName'
    | 'engineUnknown'
    | 'fileMissing'
    | 'invalidExtension'
    | 'notFound'
    | 'pathTraversal'
    | 'tooLarge'

export type LiaVoiceProfileResult<T>
  = | { ok: true, value: T }
    | { error: LiaVoiceProfileErrorCode, message: string, ok: false }

/** A source file the user picked, as handed back by the main-process dialog. */
export interface LiaVoiceProfileSource {
  role: string
  /** Absolute path, validated by the main process against what the dialog returned. */
  path: string
}

export interface LiaVoiceProfileImportRequest {
  name: string
  /**
   * The engine the new profile belongs to. Optional in the request: with no
   * runnable engine registered (Phase 7.8D transition), an import without -
   * or with any unknown - engine id is refused cleanly, so no fake id is
   * written while the real engine (Kokoro first) is absent. A STORED profile
   * always keeps its own id (`LiaCustomVoiceProfile.engine` stays required).
   */
  engine?: string
  sources: LiaVoiceProfileSource[]
  metadata?: Record<string, string>
}
