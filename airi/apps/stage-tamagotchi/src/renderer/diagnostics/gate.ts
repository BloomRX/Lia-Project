/**
 * Gate for the temporary Lia diagnostics.
 *
 * Kept in its own tiny module so the app entry point can consult it with a
 * static import while the observer itself stays a dynamic import: a packaged
 * renderer then never loads the instrumentation module at all.
 *
 * The build mode is the only authorization boundary here. A `lia:diag:*` value
 * lives in user-writable storage, so it cannot be what unlocks request and
 * prompt capture in a packaged build; inside dev it only refines behaviour
 * (`'0'` opts out).
 */
export function shouldInstallRealChatObserver(isDev: boolean, flagValue: string | null | undefined): boolean {
  return isDev && flagValue !== '0'
}
