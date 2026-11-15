/**
 * DEVFLOW-ONLY autorun: replaces the human "click Conversar com Lia" step.
 *
 * The M3.0b round exists to validate the REAL launch chain
 * `Lia.bat -> Launcher -> AiriStageManager -> Stage`. A DevFlow that bypassed
 * any link of it would be validating something the user never runs. So this
 * module does exactly one thing: when the launcher was started with
 * `LIA_DEVFLOW_AUTORUN=conversar`, it invokes the SAME `host.conversar()` that
 * the renderer's button reaches through the `lia:stage:start` IPC handler. No
 * alternate stage path, no synthetic spawn, no shortcut around the prerequisite
 * or the single-flight promise.
 *
 * Outside that exact flag value nothing happens: `applies()` is false, no call
 * is made, and normal launcher behaviour is unchanged. A normal user launch
 * still requires the explicit click (contract item 11: no auto-start).
 */
import process from 'node:process'

export const LIA_DEVFLOW_AUTORUN_ENV = 'LIA_DEVFLOW_AUTORUN'
export const LIA_DEVFLOW_AUTORUN_CONVERSAR = 'conversar'

export interface LiaDevflowAutorunDeps {
  /** The canonical Conversar pipeline - the very one the button's IPC calls. */
  conversar: () => Promise<unknown>
  env?: NodeJS.ProcessEnv
  log: (line: string) => void
}

export interface LiaDevflowAutorun {
  applies: () => boolean
  run: () => Promise<'duplicate' | 'invoked' | 'skipped'>
}

export function createLiaDevflowAutorun(deps: LiaDevflowAutorunDeps): LiaDevflowAutorun {
  let started = false

  function applies(): boolean {
    const env = deps.env ?? process.env
    return env[LIA_DEVFLOW_AUTORUN_ENV] === LIA_DEVFLOW_AUTORUN_CONVERSAR
  }

  return {
    applies,
    async run() {
      if (!applies()) {
        deps.log('lia-devflow autorun=skipped reason=flag-absent')
        return 'skipped'
      }
      // Single-flight at this layer too: the stage manager already collapses
      // concurrent start() calls, and a repeated autorun must not even reach it.
      if (started) {
        deps.log('lia-devflow autorun=duplicate')
        return 'duplicate'
      }
      started = true
      deps.log('lia-devflow autorun=invoked action=conversar')
      await deps.conversar()
      deps.log('lia-devflow autorun=completed')
      return 'invoked'
    },
  }
}
