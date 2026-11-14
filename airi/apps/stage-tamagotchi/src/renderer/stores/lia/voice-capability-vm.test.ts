import type { LiaCapabilitySnapshot } from '@proj-airi/stage-ui/libs/capabilities/lia-capability-port'

import { describe, expect, it } from 'vitest'

import { voiceCapabilityLedState, voiceCapabilityState } from './voice-capability-vm'

// Internal report: docs/reports/LIA-UI-UX-AUDIT-2026-11-14.md (UI-L03/AC-08).
function snapshot(configured: boolean, available: boolean): LiaCapabilitySnapshot {
  return { voice: { configured, available }, avatar: { available: false } }
}

describe('voice capability projection', () => {
  it('keeps unknown, unconfigured, configured-but-unavailable and ready distinct', () => {
    expect(voiceCapabilityState(undefined)).toBe('unknown')
    expect(voiceCapabilityState(snapshot(false, false))).toBe('unconfigured')
    expect(voiceCapabilityState(snapshot(true, false))).toBe('unavailable')
    expect(voiceCapabilityState(snapshot(true, true))).toBe('ready')
  })

  it('never shows an unavailable voice as ready', () => {
    expect(voiceCapabilityLedState(undefined)).toBe('off')
    expect(voiceCapabilityLedState(snapshot(false, false))).toBe('off')
    expect(voiceCapabilityLedState(snapshot(true, false))).toBe('pending')
    expect(voiceCapabilityLedState(snapshot(true, true))).toBe('on')
  })
})
