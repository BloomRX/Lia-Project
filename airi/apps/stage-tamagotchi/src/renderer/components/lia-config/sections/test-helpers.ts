/**
 * The channels `useLiaRuntimeStore` opens merely by being constructed.
 *
 * Every harness that renders the voice UI mocks `useElectronEventaInvoke` by
 * channel id and throws on an unknown one - the throw is deliberate, so a
 * component silently asking main for something new is a test failure, not a
 * silent undefined. The runtime store is now part of the voice panel, so its
 * channels belong in every harness too. This helper answers them with the
 * healthy-machine defaults each harness can override through `cols`.
 */
export interface LiaRuntimeChannelColumns {
  runtimeState?: { current: unknown }
  bootstrap?: { current: unknown }
  customVoiceEngine?: { current: unknown }
}

export function liaRuntimeChannelAnswer(
  id: string | undefined,
  cols: LiaRuntimeChannelColumns,
): (() => Promise<unknown>) | undefined {
  if (id === 'eventa:invoke:lia:runtime:state-receive')
    return async () => cols.runtimeState?.current ?? { state: 'notInstalled' }
  if (id === 'eventa:invoke:lia:runtime:start-receive')
    return async () => null
  if (id === 'eventa:invoke:lia:runtime:stop-receive')
    return async () => null
  if (id === 'eventa:invoke:lia:runtime:install-dir:pick-receive')
    return async () => null
  if (id === 'eventa:invoke:lia:runtime:install-steps-receive')
    return async () => []
  if (id === 'eventa:invoke:lia:bootstrap:state-receive')
    return async () => cols.bootstrap?.current ?? { phase: 'not-installed', steps: [] }
  if (id === 'eventa:invoke:lia:bootstrap:run-receive')
    return async () => cols.bootstrap?.current ?? { phase: 'ready', steps: [] }
  if (id === 'eventa:invoke:lia:bootstrap:cancel-receive')
    return async () => null
  if (id === 'eventa:invoke:lia:bootstrap:remove-receive')
    return async () => null
  if (id === 'eventa:invoke:lia:custom-voice:engine-state-receive')
    return async () => cols.customVoiceEngine?.current ?? { firstRunPending: false, missingModelFiles: 0, modelComplete: true, ready: true }
  if (id === 'eventa:invoke:lia:custom-voice:prepare-receive')
    return async () => ({ phase: 'ready' })
  if (id === 'eventa:invoke:lia:custom-voice:cancel-receive')
    return async () => null
  return undefined
}
