import { describe, expect, it } from 'vitest'

import { claimStartupGreeting, createStartupGreetingLatch } from './startup-greeting'

/**
 * Phase 7.9E, item 3: the duplicate-prevention nucleus. The latch lives one
 * main-process lifetime = one REAL managed launch: the reason a renderer
 * reload/HMR or an internal voice reconnect can never greet twice.
 */
describe('lia startup greeting latch (main half, Phase 7.9E)', () => {
  it('grants exactly once per latch lifetime', () => {
    const latch = createStartupGreetingLatch()
    expect(latch.claim()).toBe(true)
    expect(latch.claim()).toBe(false)
    expect(latch.claim()).toBe(false)
    expect(latch.claimed()).toBe(true)

    // "Renderer reloaded" == asking the SAME latch again: still denied.
    // "New launch" == a NEW latch: granted.
    expect(createStartupGreetingLatch().claim()).toBe(true)
  })

  it('a non-managed launch never greets AND never consumes the latch', () => {
    const latch = createStartupGreetingLatch()
    expect(claimStartupGreeting(latch, false)).toEqual({ granted: false })
    expect(latch.claimed()).toBe(false)
    // The rule is not "used up" by an unmanaged ask.
    expect(claimStartupGreeting(latch, true)).toEqual({ granted: true })
    expect(claimStartupGreeting(latch, true)).toEqual({ granted: false })
  })
})
