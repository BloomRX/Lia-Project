import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env as nodeEnv, platform as nodePlatform } from 'node:process'

/**
 * AiriStageManager (Phase 7, architecture items 9-10).
 *
 * THE contract for "Conversar com Lia": the user opens the launcher, the
 * launcher starts the stage - always as a SEPARATE child process, never
 * embedded - with the launch facts the Lia/AIRI bridge defines, and owns its
 * lifecycle while Lia is open.
 *
 * Invariants:
 *  - single-flight: concurrent `start()` calls collapse into ONE spawn. A
 *    double click on "Conversar" never produces two stages;
 *  - no auto-start: nothing in the launcher boot path calls `start()`. The
 *    stage only rises from the explicit user action (contract item 11);
 *  - honest states: 'running' means the child exists AND has given its ready
 *    signal (electron-vite reports the dev server / the window is up), not
 *    merely "spawn returned";
 *  - the stop path kills the TREE on Windows (`taskkill /PID /T /F`), because
 *    the `pnpm -> electron-vite -> electron` chain orphans grandchildren
 *    of a plain SIGTERM - the same round-7 lesson the runtime manager
 *    teaches;
 *  - the stopped/error state never invents percentages and never hides the
 *    exit code.
 *
 * Deliberately NOT here (contract items 10/19): updaters, package
 * installers, health probes of the stage UI. Dev launches `pnpm dev:
 * tamagotchi` in the AIRI workspace; production will point at the packaged
 * executable through the same call shape.
 */

export type AiriStagePhase = 'error' | 'running' | 'starting' | 'stopped'

export interface AiriStageState {
  /** Tail of the stage stdout/stderr, for the diagnostics tab. */
  logTail: string[]
  message?: string
  phase: AiriStagePhase
  pid?: number
  /** Exit code observed when the child went away, if any. */
  lastExitCode?: null | number
}

export interface AiriStageManagerDeps {
  /**
   * Extra env for the child (LIA_* launch facts + shared user data),
   * resolved per launch by the host - also overrideable per start() call.
   */
  childEnv?: Record<string, string | undefined>
  /** For tests: overriding spawn/exec keeps this class electron-free. */
  execFileImpl?: typeof execFile
  /** Lines the manager decides are interesting (state transitions only). */
  onLog?: (line: string) => void
  onState?: (state: AiriStageState) => void
  /** Platform override for tests. */
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
  /** Milliseconds before a spawned stage that never says "ready" errors out. */
  startGraceMs?: number
  /**
   * The AIRI monorepo root that holds `apps/stage-tamagotchi`. In dev the
   * launcher resolves this from its own location; in production it will be
   * the packaged stage root. If the folder does not exist the manager is
   * honest about being unavailable instead of spawning into the void.
   */
  workspaceRoot: string
}

const STAGE_PACKAGE = '@proj-airi/stage-tamagotchi'
/** electron-vite dev speaks like Vite: "ready in N ms" when the dev server is listening. */
const READY_SIGNAL = /ready in|Local:.*http|dev server/i
const LOG_TAIL_MAX = 200

export class AiriStageManager {
  private currentState: AiriStageState = { logTail: [], phase: 'stopped' }
  private child: ReturnType<typeof spawn> | undefined
  private starting: Promise<AiriStageState> | undefined

  constructor(private readonly deps: AiriStageManagerDeps) {}

  state(): AiriStageState {
    return { ...this.currentState, logTail: [...this.currentState.logTail] }
  }

  /** The child spawn command, as one inspectable string for diagnostics. */
  command(): string {
    return `pnpm -rF ${STAGE_PACKAGE} run dev`
  }

  isAvailable(): boolean {
    return existsSync(join(this.deps.workspaceRoot, 'apps', 'stage-tamagotchi'))
  }

  async start(options: { env?: Record<string, string | undefined> } = {}): Promise<AiriStageState> {
    // Single-flight: the second click joins the first launch. There is no
    // "start while starting" path, and therefore no duplicate stage.
    if (this.starting)
      return await this.starting
    if (this.child && this.child.exitCode === null)
      return this.state()

    this.starting = this.spawnStage(options.env)
    try {
      return await this.starting
    }
    finally {
      this.starting = undefined
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null) {
      if (this.currentState.phase !== 'error')
        this.setState({ phase: 'stopped' })
      return
    }

    const pid = child.pid
    const platform = this.deps.platform ?? nodePlatform
    if (platform === 'win32' && pid !== undefined) {
      // The launcher owns this stage: we spawned it this session, so the
      // whole tree goes down - the round-7 ownership axiom, child clause.
      await new Promise<void>((resolve) => {
        const execFileImpl = this.deps.execFileImpl ?? execFile
        execFileImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 30_000 }, () => resolve())
      })
    }
    else {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null)
            child.kill('SIGKILL')
          resolve()
        }, 5_000)
        timer.unref?.()
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    this.setState({ phase: 'stopped' })
  }

  private async spawnStage(passEnv?: Record<string, string | undefined>): Promise<AiriStageState> {
    if (!this.isAvailable()) {
      this.setState({
        message: 'The Lia stage could not be found on this machine.',
        phase: 'error',
      })
      return this.state()
    }

    const platform = this.deps.platform ?? nodePlatform
    this.setState({ phase: 'starting' })

    const spawnImpl = this.deps.spawnImpl ?? spawn
    const child = spawnImpl('pnpm', ['-rF', STAGE_PACKAGE, 'run', 'dev'], {
      cwd: this.deps.workspaceRoot,
      env: { ...nodeEnv, ...this.deps.childEnv, ...passEnv },
      // No detached group: on POSIX we signal the child directly; on Windows
      // taskkill walks the tree by PID anyway.
      shell: platform === 'win32',
    })
    this.child = child
    this.setState({ phase: 'starting', pid: child.pid })

    return await new Promise<AiriStageState>((resolve) => {
      const grace = this.deps.startGraceMs ?? 180_000
      let readySeen = false

      const timer = setTimeout(() => {
        if (!readySeen && child.exitCode === null) {
          appendLine(this.currentState, 'The stage did not finish starting in the expected time.')
          this.setState({ message: 'The stage is taking longer than usual to start.', phase: 'error' })
          resolve(this.state())
        }
      }, grace)
      timer.unref?.()

      const finish = (state: AiriStageState) => {
        clearTimeout(timer)
        resolve(state)
      }

      const onData = (data: unknown) => {
        const text = String(data)
        appendLine(this.currentState, text)
        if (READY_SIGNAL.test(text) && !readySeen) {
          readySeen = true
          this.setState({ phase: 'running', pid: child.pid })
          this.deps.onState?.(this.state())
          finish(this.state())
        }
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)

      child.on('error', (err) => {
        appendLine(this.currentState, String(err))
        this.setState({ message: 'The stage process could not be started.', phase: 'error' })
        finish(this.state())
      })

      child.on('exit', (code) => {
        this.child = undefined
        if (!readySeen) {
          this.setState({ lastExitCode: code, message: 'The stage closed while starting.', phase: 'error' })
          finish(this.state())
          return
        }
        // Unexpected exit AFTER the stage was running: report it, honestly.
        this.setState({ lastExitCode: code, phase: 'stopped' })
        this.deps.onState?.(this.state())
      })
    })
  }

  private setState(partial: Partial<AiriStageState>): void {
    this.currentState = { ...this.currentState, ...partial }
    this.deps.onState?.(this.state())
  }
}

function appendLine(state: AiriStageState, line: string): void {
  state.logTail.push(line)
  if (state.logTail.length > LOG_TAIL_MAX)
    state.logTail.splice(0, state.logTail.length - LOG_TAIL_MAX)
}
