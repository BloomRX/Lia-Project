/**
 * Voice facts that both processes need.
 *
 * Lives in `shared/` because the main process has to answer "does the active
 * voice need the local runtime?" without importing renderer code - the renderer
 * store pulls in Vue, which has no business loading in the main process.
 *
 * The renderer keeps re-exporting this so existing imports stay valid and there
 * is still exactly one definition of the id.
 */

/**
 * The provider id a custom voice is selected under.
 *
 * A custom voice fits the existing target schema exactly - `providerId` plus a
 * `voiceId` that is the profile id - so no new configuration shape and no second
 * source of truth is needed.
 */
export const CUSTOM_VOICE_PROVIDER_ID = 'custom-local-voice'
