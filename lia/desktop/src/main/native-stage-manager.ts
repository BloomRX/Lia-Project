import type { StdioOptions } from 'node:child_process'

import { execFile, spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { env as nodeEnv, platform as nodePlatform } from 'node:process'

/** Owns the native Stage process from launch through observed exit. */
export type NativeStagePhase = 'error' | 'running' | 'starting' | 'stopped' | 'stopping'

export interface NativeStageState {
  /** Tail of the stage stdout/stderr, for the diagnostics tab. */
  logTail: string[]
  message?: string
  phase: NativeStagePhase
  pid?: number
  /** Exit code observed when the child went away, if any. */
  lastExitCode?: null | number
}

export interface NativeStageManagerDeps {
  packagedStage?: () => { command: string, args: string[], cwd: string }
  /**
   * Extra env for the child (LIA_* launch facts + shared user data),
   * resolved per launch by the host - also overrideable per start() call.
   */
  childEnv?: Record<string, string | undefined>
  /** For tests: overriding spawn/exec keeps this class electron-free. */
  execFileImpl?: typeof execFile
  /** Lines the manager decides are interesting (state transitions only). */
  onLog?: (line: string) => void
  onState?: (state: NativeStageState) => void
  /** Platform override for tests. */
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
  /**
   * 'detached' transforma o Stage em Runtime independente: o processo nasce em
   * um grupo próprio, sem pipes de stdout (que morreriam junto com este
   * processo e fariam o filho quebrar no primeiro log), e NÃO é encerrado
   * quando o Launcher fecha. O padrão 'attached' preserva o comportamento de
   * desenvolvimento e os testes existentes.
   */
  mode?: 'attached' | 'detached'
  /** Arquivo de log do Runtime destacado. Obrigatório no modo 'detached'. */
  logFile?: string
  /**
   * Prontidão do Runtime destacado: o stdout não existe mais, então "pronto" é
   * o canal de controle respondendo — a mesma prova que o Launcher usa depois
   * para reencontrar o processo.
   */
  probeReady?: () => Promise<boolean>
  /**
   * Encerramento cooperativo (canal de controle). Quando presente, roda ANTES
   * de qualquer força — `taskkill /T /F` deixa de ser o primeiro gesto.
   */
  requestStop?: () => Promise<unknown>
  /** Milliseconds before a spawned stage that never says "ready" errors out. */
  startGraceMs?: number
  /**
   * Milliseconds the stop path waits for the REAL exit after signalling,
   * before the hard fallback. Honest by contract: 'stopped' is reported
   * only after the child's exit was observed.
   */
  stopGraceMs?: number
}

const LOG_TAIL_MAX = 200

export class NativeStageManager {
  private currentState: NativeStageState = { logTail: [], phase: 'stopped' }
  private child: ReturnType<typeof spawn> | undefined
  private starting: Promise<NativeStageState> | undefined
  private stopping: Promise<void> | undefined

  constructor(private readonly deps: NativeStageManagerDeps) {}

  state(): NativeStageState {
    return { ...this.currentState, logTail: [...this.currentState.logTail] }
  }

  /** The child spawn command, as one inspectable string for diagnostics. */
  command(): string {
    if (this.deps.packagedStage) {
      try {
        return basename(this.deps.packagedStage().command)
      }
      catch {
        return 'Stage indisponível'
      }
    }
    return 'Stage indispon�vel'
  }

  isAvailable(): boolean {
    try {
      return Boolean(this.deps.packagedStage?.())
    }
    catch { return false }
  }

  async start(options: { env?: Record<string, string | undefined> } = {}): Promise<NativeStageState> {
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

    // Encerramento cooperativo primeiro: o Runtime fecha logs, áudio e
    // recursos, e o Launcher só espera. A força continua existindo, mas como
    // último recurso — nunca como primeiro gesto.
    if (this.deps.requestStop) {
      await Promise.resolve(this.deps.requestStop()).catch(() => {})
      if (await waitForExit(exited, this.deps.stopGraceMs ?? 15_000)) {
        this.child = undefined
        this.setState({ phase: 'stopped' })
        return
      }
      this.deps.onLog?.('cooperative stop timed out - escalating')
    }

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

  private async spawnStage(passEnv?: Record<string, string | undefined>): Promise<NativeStageState> {
    let packaged: ReturnType<NonNullable<NativeStageManagerDeps['packagedStage']>> | undefined
    try {
      packaged = this.deps.packagedStage?.()
    }
    catch {
      // A missing executable is a public availability error, not a fallback.
    }
    if (!packaged) {
      this.setState({
        message: 'The Lia stage could not be found on this machine.',
        phase: 'error',
      })
      return this.state()
    }

    this.setState({ phase: 'starting' })

    const stageEnv = { ...nodeEnv, ...this.deps.childEnv, ...passEnv }
    delete stageEnv.ELECTRON_RUN_AS_NODE

    const detached = this.deps.mode === 'detached'
    const { command, args, cwd } = packaged
    const spawnImpl = this.deps.spawnImpl ?? spawn
    let child: ReturnType<typeof spawn>
    if (detached) {
      // Sem arquivo de log não há diagnóstico, e um pipe fechado mataria o
      // filho no primeiro `console.log`. O arquivo, não o pipe, é o canal.
      let stdio: StdioOptions = 'ignore'
      if (this.deps.logFile) {
        mkdirSync(dirname(this.deps.logFile), { recursive: true })
        stdio = ['ignore', openSync(this.deps.logFile, 'a'), openSync(this.deps.logFile, 'a')]
      }
      child = spawnImpl(command, args, { cwd, detached: true, env: stageEnv, stdio })
    }
    else {
      child = spawnImpl(command, args, { cwd, env: stageEnv })
    }
    // Destacado: o Launcher não espera por ele nem o leva junto ao sair.
    if (detached)
      child.unref()
    this.child = child
    this.setState({ phase: 'starting', pid: child.pid })
    this.deps.onLog?.(`spawn: ${basename(command)} (pid ${String(child.pid)})`)

    if (this.deps.mode === 'detached' && this.deps.probeReady) {
      return await new Promise<NativeStageState>((resolve) => {
        const grace = this.deps.startGraceMs ?? 180_000
        const startedAt = Date.now()
        let readySeen = false
        const timer = setInterval(() => {
          void (async () => {
            if (readySeen)
              return
            if (child.exitCode !== null) {
              clearInterval(timer)
              this.child = undefined
              this.setState({ lastExitCode: child.exitCode, message: 'The stage closed while starting.', phase: 'error' })
              resolve(this.state())
              return
            }
            let ready = false
            try {
              ready = await this.deps.probeReady!()
            }
            catch { ready = false }
            if (ready && !readySeen) {
              readySeen = true
              clearInterval(timer)
              this.setState({ phase: 'running', pid: child.pid })
              this.deps.onLog?.(`ready (pid ${String(child.pid)})`)
              this.deps.onState?.(this.state())
              resolve(this.state())
            }
            else if (Date.now() - startedAt > grace) {
              clearInterval(timer)
              this.setState({ message: 'The stage is taking longer than usual to start.', phase: 'error' })
              resolve(this.state())
            }
          })()
        }, 400)
        timer.unref?.()

        child.on('error', (err) => {
          clearInterval(timer)
          this.setState({ message: 'The stage process could not be started.', phase: 'error' })
          appendLine(this.currentState, String(err))
          resolve(this.state())
        })
        child.on('exit', (code, signal) => {
          this.child = undefined
          this.deps.onLog?.(`exit: code ${String(code)} signal ${String(signal)}`)
          if (!readySeen) {
            clearInterval(timer)
            this.setState({ lastExitCode: code, message: 'The stage closed while starting.', phase: 'error' })
            resolve(this.state())
            return
          }
          this.setState({ lastExitCode: code, phase: 'stopped' })
          this.deps.onState?.(this.state())
        })
      })
    }

    return await new Promise<NativeStageState>((resolve) => {
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

      const finish = (state: NativeStageState) => {
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
        if (text.includes('[lia-stage] window-ready') && !readySeen) {
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

  private setState(partial: Partial<NativeStageState>): void {
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

function appendLine(state: NativeStageState, line: string): void {
  state.logTail.push(line)
  if (state.logTail.length > LOG_TAIL_MAX)
    state.logTail.splice(0, state.logTail.length - LOG_TAIL_MAX)
}
