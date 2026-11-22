/**
 * Startup instrumentation (Phase 7, architecture item 15).
 *
 * The four milestones the architecture asks for - `lia-app.start`,
 * `lia-app.window-created`, `lia-app.renderer-ready`, `lia-core.ready` -
 * are stamped against process start and LOGGED. The launcher must present
 * real evidence that it no longer waits for AIRI: these marks are that
 * evidence, never a faked target.
 */

export interface LiaBootMark {
  ms: number
  name: string
}

export interface LiaBootTimer {
  mark: (name: LiaBootMarkName) => void
  marks: () => LiaBootMark[]
}

export type LiaBootMarkName
  = | 'lia-app.start'
    | 'lia-app.window-created'
    | 'lia-app.renderer-ready'
    | 'lia-core.ready'

export function createLiaBootTimer(deps: {
  log?: (line: string) => void
  now?: () => number
} = {}): LiaBootTimer {
  const now = deps.now ?? (() => performance.now())
  const log = deps.log ?? ((line: string) => console.info(line))
  const marks: LiaBootMark[] = []

  return {
    mark(name) {
      const ms = Math.round(now())
      marks.push({ ms, name })
      log(`[lia:boot] ${name} at +${ms}ms`)
    },
    marks: () => [...marks],
  }
}
