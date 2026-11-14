import type { LiaCapabilitySnapshot } from '@proj-airi/stage-ui/libs/capabilities/lia-capability-port'

export type LiaVoiceCapabilityState = 'ready' | 'unavailable' | 'unconfigured' | 'unknown'

/** Presentation only. The main-process capability snapshot stays authoritative. */
export function voiceCapabilityState(snapshot: LiaCapabilitySnapshot | undefined): LiaVoiceCapabilityState {
  if (!snapshot)
    return 'unknown'
  if (snapshot.voice.available)
    return 'ready'
  return snapshot.voice.configured ? 'unavailable' : 'unconfigured'
}

export function voiceCapabilityLedState(snapshot: LiaCapabilitySnapshot | undefined): 'off' | 'on' | 'pending' {
  const state = voiceCapabilityState(snapshot)
  return state === 'ready' ? 'on' : state === 'unavailable' ? 'pending' : 'off'
}
