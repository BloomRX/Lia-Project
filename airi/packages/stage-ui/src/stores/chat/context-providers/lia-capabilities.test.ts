import type { LiaCapabilitySnapshot } from '../../../libs/capabilities/lia-capability-port'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  resetLiaCapabilitySnapshotForTesting,
  setLiaCapabilitySnapshot,
} from '../../../libs/capabilities/lia-capability-port'
import { createLiaCapabilitiesContext, renderLiaCapabilitiesInstructions } from './lia-capabilities'

/**
 * Phase 7.7, Part 12 (A-F): the persona's capability knowledge must reflect
 * the product's actual state - she spoke the infamous "I still don't have a
 * real voice" WHILE she was speaking, because the LLM had no evidence.
 */

function snapshot(voice: { configured: boolean, available: boolean }, avatarAvailable = false): LiaCapabilitySnapshot {
  return {
    avatar: { available: avatarAvailable },
    voice,
  }
}

beforeEach(() => {
  resetLiaCapabilitySnapshotForTesting()
})

describe('createLiaCapabilitiesContext', () => {
  it('a: configured + available yields a context message saying she CAN speak', () => {
    setLiaCapabilitySnapshot(snapshot({ available: true, configured: true }))
    const message = createLiaCapabilitiesContext()
    expect(message).not.toBeNull()
    expect(message?.contextId).toBe('system:lia-capabilities')
    const text = message?.text ?? ''
    expect(text).toContain('Você TEM uma voz')
  })

  it('b: available explicitly forbids the "I am text-only" family of claims', () => {
    setLiaCapabilitySnapshot(snapshot({ available: true, configured: true }))
    const text = createLiaCapabilitiesContext()?.text ?? ''
    expect(text).toContain('Não diga que você só tem texto')
    expect(text).toContain('copiar suas respostas')
  })

  it('c: configured but unavailable gives TEMPORARY-unavailable semantics', () => {
    setLiaCapabilitySnapshot(snapshot({ available: false, configured: true }))
    const text = createLiaCapabilitiesContext()?.text ?? ''
    expect(text).toContain('temporariamente indisponível')
    expect(text).not.toContain('Você TEM uma voz')
    expect(text).not.toContain('só tem texto')
  })

  it('d: no voice configured yields no voice capability claim at all', () => {
    setLiaCapabilitySnapshot(snapshot({ available: false, configured: false }))
    const text = createLiaCapabilitiesContext()?.text ?? ''
    expect(text).toContain('não tem uma voz configurada')
    expect(text).not.toContain('Você TEM uma voz')
    expect(text).not.toContain('temporariamente indisponível')
  })

  it('e: the context NEVER names backends, ports, paths or process ids', () => {
    for (const voice of [
      { available: true, configured: true },
      { available: false, configured: true },
      { available: false, configured: false },
    ] as const) {
      for (const line of renderLiaCapabilitiesInstructions({ avatar: { available: true }, voice })) {
        expect(line).not.toMatch(/alltalk|xtts|localhost|127\.0\.0\.1/i)
        expect(line).not.toMatch(/\b\d{4,5}\b/) // no ports
        expect(line).not.toMatch(/[A-Z]:\\|\//i) // no filesystem paths
        expect(line).not.toMatch(/pid|process/i)
      }
    }
  })

  it('f: a changed runtime truth changes the NEXT context the chat composes', () => {
    setLiaCapabilitySnapshot(snapshot({ available: true, configured: true }))
    const before = createLiaCapabilitiesContext()?.text ?? ''
    expect(before).toContain('Você TEM uma voz')

    // The runtime dropped: the host installs fresher truth between turns.
    setLiaCapabilitySnapshot(snapshot({ available: false, configured: true }))
    const after = createLiaCapabilitiesContext()?.text ?? ''
    expect(after).toContain('temporariamente indisponível')
    expect(after).not.toContain('Você TEM uma voz')
  })

  it('g-honest: with no installed snapshot (non-desktop build) NOTHING is claimed', () => {
    expect(createLiaCapabilitiesContext()).toBeNull()
  })

  it('avatar presence is reported as a display truth only', () => {
    setLiaCapabilitySnapshot(snapshot({ available: true, configured: true }, true))
    expect(createLiaCapabilitiesContext()?.text).toContain('avatar está visível')
    setLiaCapabilitySnapshot(snapshot({ available: true, configured: true }, false))
    expect(createLiaCapabilitiesContext()?.text).not.toContain('avatar está visível')
  })
})
