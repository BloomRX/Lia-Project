/** Existing persisted adapter identities, not a service/model catalogue. */
export const NATIVE_RECORDING_TRANSCRIPTION_IDS = [
  'openai-audio-transcription',
  'openai-compatible-audio-transcription',
  'comet-api-transcription',
  'app-local-audio-transcription',
  'mimo-audio-transcription',
] as const

export function supportsMainTranscription(id: string): boolean {
  return (NATIVE_RECORDING_TRANSCRIPTION_IDS as readonly string[]).includes(id)
}
