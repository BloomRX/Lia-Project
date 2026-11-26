export const allTalkSpeechProvider = 'alltalk-local-speech'

export function isAllTalkVoiceFile(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,119}\.wav$/iu.test(value)
}
