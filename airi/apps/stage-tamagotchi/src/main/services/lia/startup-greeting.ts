import type { LiaStartupGreetingClaim } from '../../../shared/eventa'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronLiaVoiceStartupGreetingClaim } from '../../../shared/eventa'

/**
 * Context typing, version-accurate on purpose: `createContext` (electron
 * main adapter) is what `src/main/index.ts` builds, while
 * `defineInvokeHandler` declares a wider invocable-context generic that
 * the 1.x adapter no longer satisfies nominally. The single cast nexus
 * below keeps both statements honest - and unlike the repo's older
 * `MainContext` ghost import, this type can never silently rot into `any`.
 */
type LiaMainEventaContext = ReturnType<typeof import('@moeru/eventa/adapters/electron/main').createContext>['context']
type LiaInvocableContext = Parameters<typeof defineInvokeHandler>[0]

/**
 * Phase 7.9E, items 3/4 (main half): the per-launch greeting LATCH.
 *
 * The renderer orchestrates the greeting (pool choice, pipeline timing);
 * what it CANNOT own is the "exactly once per real managed Stage launch"
 * guarantee, because a renderer reload (dev HMR, manual refresh) rebuilds
 * all of its module state. The latch therefore lives in the MAIN process:
 * its lifetime IS the launch's lifetime - first claim wins, every later
 * claim of the same launch is honestly denied, and a genuinely new launch
 * gets a fresh latch because the main process itself is fresh.
 *
 * This module is deliberately engine-blind: it grants a greeting slot, it
 * never knows which voice will speak it. Kokoro (or any future engine)
 * stays unaware that "startup greetings" exist at all.
 */

export interface StartupGreetingLatch {
  /** True exactly once per latch lifetime. */
  claim: () => boolean
  claimed: () => boolean
}

export function createStartupGreetingLatch(): StartupGreetingLatch {
  let claimed = false
  return {
    claim: () => {
      if (claimed)
        return false
      claimed = true
      return true
    },
    claimed: () => claimed,
  }
}

/**
 * The engine-neutral, renderer-agnostic rule (pure): a non-managed launch
 * never greets AND never consumes the latch - the latch is not even a
 * concept for standalone stages.
 */
export function claimStartupGreeting(latch: Pick<StartupGreetingLatch, 'claim'>, managedLaunch: boolean): LiaStartupGreetingClaim {
  if (!managedLaunch)
    return { granted: false }
  return { granted: latch.claim() }
}

/**
 * Registers the claim IPC. One latch per registration = one latch per
 * process, since the host registers the bridge exactly once at boot.
 */
export function registerLiaStartupGreetingBridge(params: {
  context: LiaMainEventaContext
  managedLaunch: boolean
}): void {
  const latch = createStartupGreetingLatch()
  defineInvokeHandler(params.context as unknown as LiaInvocableContext, electronLiaVoiceStartupGreetingClaim, async () => claimStartupGreeting(latch, params.managedLaunch))
}
