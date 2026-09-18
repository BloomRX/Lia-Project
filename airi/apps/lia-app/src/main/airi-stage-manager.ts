import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env as nodeEnv, execPath as nodeExecPath, platform as nodePlatform } from 'node:process'

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

export type AiriStagePhase = 'error' | 'running' | 'starting' | 'stopped' | 'stopping'

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
  /**
   * The dev-server entry script the manager launches with `node`. Default:
   * the stage package's own electron-vite bin, resolved as a FILE - never
   * through a package-manager wrapper.
   */
  stageDevEntrypoint?: (stageDir: string) => string
  /** Milliseconds before a spawned stage that never says "ready" errors out. */
  startGraceMs?: number
  /**
   * Milliseconds the stop path waits for the REAL exit after signalling,
   * before the hard fallback. Honest by contract: 'stopped' is reported
   * only after the child's exit was observed.
   */
  stopGraceMs?: number
  /**
   * The AIRI monorepo root that holds `apps/stage-tamagotchi`. In dev the
   * launcher resolves this from its own location; in production it will be
   * the packaged stage root. If the folder does not exist the manager is
   * honest about being unavailable instead of spawning into the void.
   */
  workspaceRoot: string
}

const STAGE_PACKAGE = '@proj-airi/stage-tamagotchi'

/**
 * The dev-server entry as a concrete SCRIPT FILE (node runs it, no shell,
 * no package-manager wrapper). pnpm links the package's bin into
 * `node_modules/electron-vite/bin/`, so this path exists in any installed
 * workspace; missing files surface as an honest child 'error' event.
 */
function stageDevEntrypointFor(stageDir: string, deps: AiriStageManagerDeps): string {
  return deps.stageDevEntrypoint?.(stageDir)
    ?? join(stageDir, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
}

/** electron-vite dev speaks like Vite: "ready in N ms" when the dev server is listening. */
const READY_SIGNAL = /ready in|Local:.*http|dev server/i
const LOG_TAIL_MAX = 200

export class AiriStageManager {
  private currentState: AiriStageState = { logTail: [], phase: 'stopped' }
  private child: ReturnType<typeof spawn> | undefined
  private starting: Promise<AiriStageState> | undefined
  private stopping: Promise<void> | undefined

  constructor(private readonly deps: AiriStageManagerDeps) {}

  state(): AiriStageState {
    return { ...this.currentState, logTail: [...this.currentState.logTail] }
  }

  /** The child spawn command, as one inspectable string for diagnostics. */
  command(): string {
    return `node ${stageDevEntrypointFor(this.stageDir(), this.deps)} dev`
  }

  private stageDir(): string {
    return join(this.deps.workspaceRoot, 'apps', 'stage-tamagotchi')
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

  /**
   * Stops the stage the launcher spawned THIS session. Single-flight and
   * idempotent: concurrent stops join one teardown, repeated stops after
   * teardown are no-ops. A stage this manager never spawned is invisible
   * to it - nothing to find, nothing to kill (contract test C).
   *
   * State honesty: 'stopping' while the kill signal travels, 'stopped'
   * ONLY after the child's exit was observed, 'error' when even the hard
   * fallback could not confirm the death.
   */
  async stop(): Promise<void> {
    this.stopping ??= this.doStop()
    try {
      await this.stopping
    }
    finally {
      this.stopping = undefined
    }
  }

  /** True while this manager holds a live child IT spawned (ownership). */
  holdsOwnedStage(): boolean {
    return this.child !== undefined && this.child.exitCode === null
  }

  private async doStop(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) {
      this.child = undefined
      if (this.currentState.phase !== 'error')
        this.setState({ phase: 'stopped' })
      return
    }

    const pid = child.pid
    this.setState({ phase: 'stopping', pid })
    this.deps.onLog?.(`stop requested (pid ${String(pid)})`)

    const exited = new Promise<null | number>((resolve) => {
      child.once('exit', code => resolve(code))
    })
    const platform = this.deps.platform ?? nodePlatform

    if (platform === 'win32' && pid !== undefined) {
      // The launcher owns this stage: we spawned it this session, so the
      // whole tree goes down. taskkill needs the target ALIVE to walk the
      // tree (round 7), and its exit code proves nothing either way -
      // only the child's own exit below closes the question.
      await new Promise<void>((resolve) => {
        const execFileImpl = this.deps.execFileImpl ?? execFile
        execFileImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 30_000 }, () => resolve())
      })
    }
    else {
      child.kill('SIGTERM')
    }

    if (await waitForExit(exited, this.deps.stopGraceMs ?? 15_000)) {
      this.child = undefined
      this.setState({ phase: 'stopped' })
      return
    }

    // Hard fallback, once. POSIX gets SIGKILL; Windows gets one more
    // tree-kill attempt (the first can arrive while the tree was mid-form).
    if (platform === 'win32' && pid !== undefined) {
      await new Promise<void>((resolve) => {
        const execFileImpl = this.deps.execFileImpl ?? execFile
        execFileImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 30_000 }, () => resolve())
      })
    }
    else if (child.exitCode === null) {
      child.kill('SIGKILL')
    }

    if (await waitForExit(exited, 5_000)) {
      this.child = undefined
      this.setState({ phase: 'stopped' })
      return
    }

    // We could not prove the stage died. Say so - the worst shutdown bug
    // is a lying 'stopped'.
    this.setState({
      message: 'The stage did not confirm it has closed. It may still be shutting down.',
      phase: 'error',
      pid,
    })
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

    /**
     * THE ownership fix (QA items 5-7). The old chain was
     * `pnpm -> cmd shim -> install-electron -> electron-vite -> electron`:
     * a WRAPPER could exit while the Electron grandchild kept living, and
     * this manager - holding only the wrapper's dead PID - reported
     * "nothing this session started" while a window was visibly open.
     *
     * The fix is to spawn the dev-server executable DIRECTLY: our child is
     * `node electron-vite.js dev`, the exact process that parents the
     * Electron window. It lives for the whole session (its exit IS the
     * stage's exit), `holdsOwnedStage` stays truthful, and taskkill /T
     * walks the real tree. As a bonus the Windows DEP0190 route is gone:
     * no `shell` option, no cmd intermediary, arguments stay an array.
     */
    const stageDir = this.stageDir()
    const entrypoint = stageDevEntrypointFor(stageDir, this.deps)
    const spawnImpl = this.deps.spawnImpl ?? spawn
    const child = spawnImpl(nodeExecPath, [entrypoint, 'dev'], {
      cwd: stageDir,
      env: { ...nodeEnv, ...this.deps.childEnv, ...passEnv },
    })
    this.child = child
    this.setState({ phase: 'starting', pid: child.pid })
    this.deps.onLog?.(`spawn: node ${entrypoint} dev (pid ${String(child.pid)})`)

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
        // The managed stage's own words stay observable on the Lia
        // terminal (item 8): every line forwards with the stage prefix;
        // the tail stays bounded by appendLine.
        for (const line of text.split(/\r?\n/)) {
          if (line.trim())
            this.deps.onLog?.(line)
        }
        if (READY_SIGNAL.test(text) && !readySeen) {
          readySeen = true
          this.setState({ phase: 'running', pid: child.pid })
          this.deps.onLog?.(`ready (pid ${String(child.pid)})`)
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

      child.on('exit', (code, signal) => {
        this.child = undefined
        this.deps.onLog?.(`exit: code ${String(code)} signal ${String(signal)}`)
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

/**
 * Awaits the child's exit promise for up to `ms`. Returns true when the
 * exit was observed. The exit promise itself never settles twice (Event
 * semantics), so racing it repeatedly is safe.
 */
function waitForExit(exited: Promise<null | number>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(resolve, ms, false)
    timer.unref?.()
    exited.then(() => {
      clearTimeout(timer)
      resolve(true)
    }, () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

function appendLine(state: AiriStageState, line: string): void {
  state.logTail.push(line)
  if (state.logTail.length > LOG_TAIL_MAX)
    state.logTail.splice(0, state.logTail.length - LOG_TAIL_MAX)
}
