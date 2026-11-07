/** Existing provider definitions that speak the same HTTP audio/speech protocol. */
export function supportsMainSpeech(definitionId: string) {
  return definitionId === 'openai-audio-speech' || definitionId === 'openai-compatible-audio-speech'
}
