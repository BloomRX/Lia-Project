import process from 'node:process'

/**
 * Phase 7.1, item 4 - the ownership switch. LIA_MANAGED=1 means the LIA
 * LAUNCHER spawned this stage and owns the voice runtime's lifecycle: AIRI
 * consumes a running server but must never start, stop, or hook-shutdown
 * it. Pure, electron-free and exported so the contract is unit-testable.
 */
export function isLauncherManaged(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIA_MANAGED === '1'
}
