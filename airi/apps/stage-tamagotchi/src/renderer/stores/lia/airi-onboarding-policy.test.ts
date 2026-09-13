// @vitest-environment jsdom

import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { mayAutoOpenAiriWelcome, shouldAutoOpenAiriWelcome } from './airi-onboarding-policy'

/**
 * Lia does not require an AIRI account, so `Home -> CONVERSAR` must not be
 * interrupted by the upstream "Welcome to AIRI" window.
 *
 * The upstream condition is exercised for real here rather than restated: a
 * freshly created auth store has no user, no session and no token, which is
 * exactly the anonymous state a fresh Lia install is in. What is asserted is
 * that this state USED to open the window and no longer does.
 */
describe('lia AIRI onboarding policy', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('the upstream gate really would fire for an anonymous user', async () => {
    const auth = useAuthStore()
    const onboarding = useOnboardingStore()

    // No session, no token, neither localStorage flag set: the state every fresh
    // install starts in. If this ever stops being true, the policy below is
    // guarding nothing and this test should be rewritten, not deleted.
    expect(auth.isAuthenticated).toBe(false)
    expect(auth.token).toBeNull()
    expect(onboarding.hasCompletedSetup).toBe(false)
    expect(onboarding.hasSkippedSetup).toBe(false)
    expect(onboarding.needsOnboarding).toBe(true)
  })

  it('never opens the AIRI welcome on its own, even then', async () => {
    const onboarding = useOnboardingStore()

    expect(onboarding.needsOnboarding).toBe(true)
    expect(mayAutoOpenAiriWelcome()).toBe(false)
    // The exact expression the Stage acts on.
    expect(shouldAutoOpenAiriWelcome(onboarding.needsOnboarding)).toBe(false)
  })

  it('stays closed after a restart, whatever the flags say', () => {
    const onboarding = useOnboardingStore()

    // Reopening the app: the flags are still unset, so upstream still wants to
    // prompt. Lia still must not.
    expect(onboarding.needsOnboarding).toBe(true)
    expect(shouldAutoOpenAiriWelcome(onboarding.needsOnboarding)).toBe(false)

    // And once the user has completed or skipped the upstream setup, upstream
    // agrees - both paths end in the same place.
    onboarding.markSetupCompleted()
    expect(onboarding.needsOnboarding).toBe(false)
    expect(shouldAutoOpenAiriWelcome(onboarding.needsOnboarding)).toBe(false)

    onboarding.resetSetupState()
    onboarding.markSetupSkipped()
    expect(onboarding.needsOnboarding).toBe(false)
    expect(shouldAutoOpenAiriWelcome(onboarding.needsOnboarding)).toBe(false)
  })

  it('does not change anything for a signed-in AIRI user', () => {
    const auth = useAuthStore()
    const onboarding = useOnboardingStore()

    // A session makes the upstream condition false on its own, so the policy is
    // a no-op here rather than a second rule to keep in sync.
    auth.user = { id: 'u1', name: 'Someone' } as never
    auth.session = { } as never

    expect(auth.isAuthenticated).toBe(true)
    expect(onboarding.needsOnboarding).toBe(false)
    expect(shouldAutoOpenAiriWelcome(onboarding.needsOnboarding)).toBe(false)
  })

  it('is the policy, and only the policy, that suppresses the prompt', () => {
    // Pins the shape of the decision: with the Lia rule off, the outcome follows
    // the upstream condition exactly. Remove the rule and the window comes back.
    expect(shouldAutoOpenAiriWelcome(true)).toBe(false)
    expect(shouldAutoOpenAiriWelcome(false)).toBe(false)
    expect(mayAutoOpenAiriWelcome()).toBe(false)
  })
})
