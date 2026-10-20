import type { RunAsNodeFuseState } from './node-runtime'
import type { StageBuildPrerequisite, StagePrerequisiteOutcome } from './stage-build-prerequisite'

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { env as nodeEnv, platform as nodePlatform } from 'node:process'

import { resolveNodeInvocation } from './node-runtime'
import { createCoreAgentBuildPrerequisite } from './stage-build-prerequisite'

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
 * installers, health probes of the stage UI. Dev launches the stage's
 * electron-vite entrypoint DIRECTLY with `node` inside the AIRI workspace -
 * it does NOT run `pnpm dev:tamagotchi` and never reads the stage's
 * `package.json`, which is why the Phase 8.0D-M3.0b build prerequisite lives
 * here rather than in that script. Production will point at the packaged
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
  /**
   * Dev-only build prerequisite that must SUCCEED before the stage child is
   * spawned (Phase 8.0D-M3.0b). Default: rebuild `@proj-airi/core-agent`,
   * whose gitignored `dist/` the stage renderer imports and which nothing on
   * the managed launch path used to compile. It runs INSIDE `start()`'s
   * single-flight promise, so a double click cannot start two builds, and a
   * failure aborts the launch instead of serving a stale renderer.
   *
   * It is a prerequisite, NOT the owned process: the stage child stays
   * `node electron-vite.js dev` exactly as Phase 7.2 requires.
   */
  prerequisite?: StageBuildPrerequisite
  spawnImpl?: typeof spawn
  /** For tests: resolving the Node runtime without touching the disk. */
  existsImpl?: (path: string) => boolean
  /** For tests: answering the runAsNode fuse read without a real binary. */
  fuseImpl?: (execPath: string) => RunAsNodeFuseState
  /** For tests: the environment the PATH scan reads, instead of `process.env`. */
  runtimeEnv?: Record<string, string | undefined>
  /**
   * For tests: the runtime facts behind the executable decision. Under Vitest
   * `process.versions` is plain Node, which is the blind spot that shipped the
   * M3.0b defect, so tests inject an Electron-shaped value.
   */
  runtimeVersions?: { electron?: string }
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

    this.setState({ phase: 'starting' })

    // Phase 8.0D-M3.0b: the managed launch compiles the stage's workspace
    // dependencies BEFORE the renderer is served, because the renderer imports
    // them from their built `dist/` and a stale artifact fails at ESM link time
    // - a transparent window with nothing in it and nothing in the log.
    //
    // `applies()` is checked first and is synchronous on purpose: when there is
    // no source workspace (packaged production) nothing is awaited, so the
    // spawn below still happens in the same tick and the Phase 7.2 ownership
    // semantics the tests pin are byte-for-byte unchanged.
    const prerequisite = this.deps.prerequisite
      ?? createCoreAgentBuildPrerequisite({ workspaceRoot: this.deps.workspaceRoot })
    if (prerequisite.applies()) {
      this.deps.onLog?.(`stage-prerequisite name=${prerequisite.name} state=starting`)
      let outcome: StagePrerequisiteOutcome
      try {
        outcome = await prerequisite.run()
      }
      catch {
        // A rejected build must leave starting and release the single-flight
        // launch for retry. Exception bodies can contain private build output.
        outcome = { ok: false, reason: 'unexpected-error' }
      }
      if (!outcome.ok) {
        this.deps.onLog?.(
          `stage-prerequisite name=${prerequisite.name} state=failed reason=${outcome.reason ?? 'unknown'}`,
        )
        // Honest error, no invented cause and no launch: starting the stage
        // against a known-stale artifact is the bug this prevents.
        this.setState({
          message: 'The Lia stage could not be prepared: its build did not succeed.',
          phase: 'error',
        })
        return this.state()
      }
      this.deps.onLog?.(
        `stage-prerequisite name=${prerequisite.name} state=${outcome.skipped ? 'skipped' : 'succeeded'}`
        + `${outcome.reason ? ` reason=${outcome.reason}` : ''}`,
      )
    }

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
    // This is the one child that must never be given `ELECTRON_RUN_AS_NODE`:
    // `electron-vite` launches the window with
    // `spawn(electronPath, [entry], { stdio: 'inherit' })` - no `env` option -
    // so the child's environment reaches the Electron app verbatim, and a
    // leaked variable would start the WINDOW as plain Node: no window at all.
    // `resolveNodeInvocation` therefore refuses here rather than falling back
    // to Electron-as-Node, and we fail closed instead of spawning an Electron
    // app that would parent nothing. Ownership is unchanged: the build stays an
    // awaited prerequisite, never the owned Stage process.
    const runtime = resolveNodeInvocation({
      childLaunchesElectron: true,
      env: this.deps.runtimeEnv,
      existsImpl: this.deps.existsImpl,
      fuseImpl: this.deps.fuseImpl,
      platform: this.deps.platform ?? nodePlatform,
      versions: this.deps.runtimeVersions,
    })
    if (runtime.kind === 'unavailable') {
      // The reason is a static string from node-runtime.ts: no PATH entries,
      // no environment values, no secrets.
      this.deps.onLog?.(`stage-runtime state=unavailable reason=${runtime.reason}`)
      this.setState({
        message: 'The Lia stage could not start: no Node runtime was available to run it.',
        phase: 'error',
      })
      return this.state()
    }
    this.deps.onLog?.(`stage-runtime kind=${runtime.kind}`)
    const stageEnv = { ...nodeEnv, ...this.deps.childEnv, ...passEnv }
    delete stageEnv.ELECTRON_RUN_AS_NODE

    const child = spawnImpl(runtime.command, [entrypoint, 'dev'], {
      cwd: stageDir,
      env: stageEnv,
    })
    this.child = child
    this.setState({ phase: 'starting', pid: child.pid })
    // The real executable, never a hardcoded "node": this line is the only
    // evidence of what was actually spawned, and printing a word that is only
    // sometimes true is how an Electron executable stayed invisible in the
    // Windows logs.
    this.deps.onLog?.(`spawn: ${basename(runtime.command)} ${entrypoint} dev (pid ${String(child.pid)})`)

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
