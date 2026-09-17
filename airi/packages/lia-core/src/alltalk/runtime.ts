import type { Buffer } from 'node:buffer'
import type { ChildProcess, SpawnOptions } from 'node:child_process'

import type { PortOwnerRecord, ProcessInspection } from './port-diagnostics'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { isBenignAncestor, isSupervisedLauncher, isUnderInstallRoot } from './port-diagnostics'

/**
 * The speech runtime as a process the Lia owns.
 *
 * Before this, using a custom voice meant the user had to open a terminal,
 * `cd` somewhere, and run a `.bat` file - and remember to do it every time.
 * This module is what removes that: the Lia detects the install, starts it
 * hidden, waits until it actually answers, and shuts it down when the app
 * closes.
 *
 * ## What it deliberately does NOT do
 *
 * **It never installs.** AllTalk's `atsetup.bat` is interactive (it asks the
 * user to pick "Standalone Installation" then option 1) and its prerequisites -
 * Git, Microsoft C++ Build Tools with the Windows SDK, and espeak-ng - are
 * separate multi-gigabyte installs that need an administrator. There is no
 * versioned, checksummed artifact to fetch. Automating that would mean building
 * a fragile downloader around an installer that was never designed to be driven,
 * so installation stays a guided wizard and this module starts from "already
 * installed".
 *
 * ## Process safety
 *
 * - Arguments are an explicit array and `shell` is left `false`. On Windows a
 *   `.bat` still needs an interpreter, so `cmd.exe` is invoked *as the program*
 *   with `/c` and the script name as a separate argument - the install directory
 *   is passed as `cwd`, never interpolated into a command string.
 * - `windowsHide: true`, so no console window flashes on the user's desktop.
 * - One child at a time: `start()` while starting or running is a no-op, so a
 *   double click cannot leave two servers fighting over port 7851.
 * - `stop()` on app quit, and the child is unref'd from nothing - we keep the
 *   handle so an orphan cannot outlive us.
 */

/** Files that must exist for a folder to count as an AllTalk install. */
export const INSTALL_MARKERS = ['script.py', 'system', 'voices'] as const

/**
 * The Python environment `atsetup.bat` builds, without which the folder is source
 * code rather than a working runtime.
 *
 * Checked by the runtime manager and by the bootstrap's verify step alike. Two
 * separate lists drift: the manager would call an install usable that the bootstrap
 * still considers missing, and the user gets a started-but-broken state with no
 * explanation.
 */
export const ENVIRONMENT_MARKERS = ['alltalk_environment/conda', 'alltalk_environment/env'] as const

/** The launcher `atsetup.bat` generates. Windows only. */
export const WINDOWS_START_SCRIPT = 'start_alltalk.bat'

/** How long to wait for the server to answer after spawning it. */
export const DEFAULT_START_TIMEOUT_MS = 180_000

/**
 * A validated root of the AllTalk process tree (round-6 ownership model).
 *
 * `created` + `exe` are recorded at validation time and rechecked before any
 * kill: a recycled PID must never inherit last session's death sentence.
 */
export interface ProvenProcessRoot {
  pid: number
  created?: string
  /** Creation ticks (Int64 as string) - the canonical kill-revalidation key. */
  createdTicks?: string
  exe?: string
}

/**
 * Who the ready instance ACTUALLY is (round 6, decision of product):
 *
 * The runtime inside the Lia directory is a private, Lia-managed backend,
 * not an external service. Round 5 shipped the bug this field ends: every
 * adopted instance read as `owned: false` - one bucket for "the user's own
 * AllTalk" and "our orphan from last session" - and the shutdown simply
 * never killed the latter. The model now splits by VERDICT, not by
 * who-spawned-it:
 *
 * - a child this manager spawned has NO attachment: `pid` alone says it;
 * - `lia-managed`: a pre-existing tree whose every listener PID and every
 *   proven ancestor lives under the install root (or is the recognized
 *   supervised launcher) - reused like a child, AND killed on shutdown;
 * - anything else is never adopted at all: external AllTalk and unknown
 *   owners both surface as port conflicts, and neither is ever killed.
 */
export interface RuntimeAttachment {
  kind: 'lia-managed'
  roots: ProvenProcessRoot[]
}

export interface RuntimeStateSnapshot {
  /**
   * `stopping` is the round-7 truth phase (item A/J): it exists only while
   * kill work is in flight, so the snapshot can never read 'stopped' while a
   * Lia tree still holds the port. `stopped` now means "termination
   * attempted, observed, and the ports confirmed free" - an `error` where
   * that proof failed.
   */
  phase: 'error' | 'notInstalled' | 'ready' | 'starting' | 'stopped' | 'stopping'
  /** Only set when `phase` is `error`. A short sentence, never a stack trace. */
  message?: string
  /** Process id of the managed child, when we started one. */
  pid?: number
  /** Ownership verdict of a pre-existing instance we attached to. */
  attachment?: RuntimeAttachment
}

/**
 * Port occupancy: the *socket* fact, distinct from the *health* fact (Phase 6
 * QA hotfix, items A/B).
 *
 * A health probe answers "does an AllTalk API speak here?" - an application
 * question. Occupancy answers "does anything LISTEN here?" - a socket
 * question. The boot-clean QA log proved these must never be equated: health
 * walked off a refused connection, and mapping that onto `unknown` produced a
 * false `port-occupied-unknown-process` on ports netstat showed as
 * `listeners=none`. Occupancy therefore comes only from a real listener
 * probe and stands in three explicit verdicts:
 *
 * - `free`: nothing listens; the right move is SPAWN.
 * - `occupied`: something listens; identify the owner, then fail fast.
 * - `unverifiable`: the probe itself could not tell (filtered port, probe
 *   failure); never silently translated to free, and never invented as an
 *   excuse to call a refused health check "occupied".
 */
export type RuntimePortOccupancy = 'free' | 'occupied' | 'unverifiable'

/**
 * The one supervised entry point of the voice runtime (hotfix brief, item A):
 * every path that could start AllTalk - autostart, bootstrap completion,
 * retry, prepare, manual button - funnels through `start()` of this single
 * manager, and `start()` only spawns when no healthy instance answers. The
 * four contract clauses of the brief map onto `doStart` below.
 */
export interface RuntimeManagerDeps {
  /** Where AllTalk is installed, or undefined when the user has not pointed at one. */
  installDir?: string
  /** Health probe: true when the server answers. Injected so tests need no server. */
  isHealthy: () => Promise<boolean>
  /**
   * Who listens on the port right now - the socket fact, injected so the
   * manager stays socket-free. Without it the manager cannot honestly
   * distinguish "free" from "occupied", so absence classifies as
   * `unverifiable`, which never spawns blindly.
   */
  probeOccupied?: () => Promise<RuntimePortOccupancy>
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
  /** How often to poll health while waiting for startup. */
  pollIntervalMs?: number
  startTimeoutMs?: number
  /**
   * Existence probe for the bundled espeak-ng directory (item I). Defaults to
   * a real `fs.access`; tests inject a table.
   */
  existsImpl?: (path: string) => Promise<boolean>
  /**
   * Runs an external program with an argument array, never a shell string.
   * Used for the Windows process-tree kill; injected in tests.
   */
  execImpl?: (command: string, args: string[], options: { timeoutMs: number }) => Promise<{ code: number | null }>
  /** Structured lifecycle events for the `[LIA-VOICE-RUNTIME]` log. */
  onEvent?: (event: string, detail?: string) => void
  /**
   * Port-owner evidence gathering (Windows QA hotfix, "diagnóstico Windows").
   *
   * Runs *before* the start decision whenever the port is occupied, and after
   * a contested shutdown: who owns 7851/7852 - PID, executable path, command
   * line, parent PID, creation time - so the QA log proves whether the holder
   * is a Lia child, another Lia spawn, or something external. It only ever
   * log*s; it never kills. The service wires the real
   * (netstat + Win32_Process) implementation; tests capture the calls.
   */
  portOwnerDiagnostics?: (context: { reason: 'alltalk-compatible' | 'occupied' | 'unverifiable' }) => Promise<PortOwnerRecord[] | undefined>
  /** Bound on the diagnostics above, so a slow PowerShell cannot stall a start. */
  portOwnerDiagnosticsTimeoutMs?: number
  /**
   * One-process lookup for the ancestry walk AND kill revalidation (round-6
   * item D; round-7 item B): the port diagnostics read the LISTENER;
   * rebuilding the validated tree root means asking about each parent up the
   * chain, and proving a root still IS the process we recorded means asking
   * about it once more before any taskkill. Tri-state by contract: 'gone'
   * requires the query to have RAN and found nothing; a failed query is
   * 'unreadable' and is NOT evidence of absence.
   * Wired to `inspectProcess` in production; absent in tests the
   * classification cannot prove anything and falls back to `unknown` - which
   * is the safe verdict by design.
   */
  inspectProcess?: (pid: number) => Promise<ProcessInspection>
  /**
   * Grace between a tree kill and the survivor probe, and the bound on
   * fallback rounds (round 7, item F). Defaults are Windows-shaped; tests
   * shrink them to nothing.
   */
  verifyGraceMs?: number
  verifyRounds?: number
  /** How long to wait for SIGTERM before escalating. Bounded, so app quit cannot hang. */
  stopGraceMs?: number
  /**
   * SUPERVISOR scope (Phase 7.1): when true, a stop against a tree that was
   * NOT spawned by THIS manager session - an attached/adopted lia-managed
   * tree - leaves that tree ALIVE instead of killing it. The launcher owns
   * only the runtimes it was asked to start; the user's own hand-started
   * server outlives the launcher (tests C/D of the supervisor contract).
   * The round-6 clause (every attached lia-managed tree dies with us)
   * stays the default and untouched for the embedded runtime path.
   */
  preserveAdoptedOnStop?: boolean
  /** Receives stdout/stderr lines. Diagnostics only; never surfaced raw. */
  onOutput?: (chunk: string) => void
}

/**
 * `source` names which of the audited call sites asked for a start (hotfix
 * QA brief: "prove who spawns"). It rides the `[LIA-VOICE-RUNTIME]` events -
 * `start-request source=autostart`, `spawn pid=1234 source=autostart`,
 * `start-coalesced existingPid=1234 source=bootstrap` - so two concurrent
 * start paths can never disguise themselves as one.
 */
export interface RuntimeStartOptions {
  source?: string
}

export interface RuntimeStopOptions {
  /**
   * After the owned tree is dead, poll until the port answers nobody, up to
   * this budget (the lifecycle contract's "confirm 7851/7852 are free"). 0
   * or omitted skips the confirmation.
   */
  confirmFreeMs?: number
}

export interface RuntimeManager {
  state: () => RuntimeStateSnapshot
  /** True when the folder looks like a real AllTalk install. */
  isInstalled: () => Promise<boolean>
  /** Starts if needed and waits for health. Idempotent. */
  start: (options?: RuntimeStartOptions) => Promise<RuntimeStateSnapshot>
  /** Stops the managed child, if any. Safe to call repeatedly. */
  stop: (options?: RuntimeStopOptions) => Promise<void>
  /**
   * Declares the app is going away: every later `start()` is refused with a
   * `start-rejected reason=shutting-down` event (lifecycle contract, clause 1).
   */
  enterShutdown: () => void
  /** PID of the live Lia-owned child, for the synchronous crash-path kill. */
  ownedChildPid: () => number | undefined
  /**
   * PIDs of the proven Lia tree we are responsible for at exit: the live
   * spawned child, and/or the validated roots of an attached lia-managed
   * tree. The 'exit' handler's synchronous kill sweeps all of them.
   */
  liaManagedRootPids: () => number[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

/**
 * Builds the spawn arguments for the platform.
 *
 * Exported because it is the part with security consequences: it must never
 * produce a shell-interpolated string containing a user-chosen path.
 *
 * `extras.env` is an already-computed environment: the existence-checked
 * espeak prepend (item I) happens async in `doStart`, so the env arrives here
 * ready rather than this sync function doing I/O.
 */
export function startCommandFor(
  platform: NodeJS.Platform,
  installDir: string,
  extras: { env?: NodeJS.ProcessEnv } = {},
): { args: string[], command: string, options: SpawnOptions } {
  const options: SpawnOptions = {
    cwd: installDir,
    // No console window on the user's desktop.
    windowsHide: true,
    // Inherit nothing: stdout/stderr are piped and read here.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: extras.env ?? { ...process.env },
  }

  if (platform === 'win32') {
    // A .bat needs cmd.exe, but as the program with the script as an argument -
    // not as a string handed to a shell.
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', WINDOWS_START_SCRIPT],
      options,
    }
  }

  return {
    command: 'bash',
    args: ['-lc', 'python3 script.py'],
    options,
  }
}

/**
 * The child's environment (hotfix brief, item I).
 *
 * The QA log warned `Espeak-ng for Windows WAS NOT FOUND` while the pin ships
 * a bundled copy under `system/espeak-ng`. Suppressing the warning is a PATH
 * prepend of exactly that bundled directory - and only of it, only on
 * Windows, and only when the directory actually exists. Nothing is installed
 * globally, and the change lives in the child's environment, never in the
 * user's.
 */
export async function spawnEnvFor(
  platform: NodeJS.Platform,
  installDir: string,
  existsImpl: (path: string) => Promise<boolean>,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (platform !== 'win32')
    return env

  const bundled = join(installDir, 'system', 'espeak-ng')
  if (!await existsImpl(bundled))
    return env

  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = `${bundled};${env[pathKey] ?? ''}`
  return env
}

/**
 * The Windows process-tree kill (hotfix brief, item K).
 *
 * `start_alltalk.bat` makes cmd.exe the parent and python.exe the worker, so
 * signalling the wrapper alone orphans the worker - which then holds on to
 * the very port the next start wants. The tree kill is `taskkill` on the
 * Lia-owned root PID with `/T`, as a fixed argument array with no shell.
 */
export function taskkillArgs(pid: number): string[] {
  return ['/PID', String(pid), '/T', '/F']
}

export function createRuntimeManager(deps: RuntimeManagerDeps): RuntimeManager {
  const platform = deps.platform ?? process.platform
  const spawnImpl = deps.spawnImpl ?? spawn
  const startTimeoutMs = deps.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
  const pollIntervalMs = deps.pollIntervalMs ?? 1000
  const stopGraceMs = deps.stopGraceMs ?? 5000
  const existsImpl = deps.existsImpl ?? exists
  const healthySafe = async (): Promise<boolean> => {
    try {
      return await deps.isHealthy()
    }
    catch {
      // A health probe that throws is *not* a socket answer; occupancy below
      // is what may conclude anything about the port.
      return false
    }
  }
  const occupancySafe = async (): Promise<RuntimePortOccupancy> => {
    if (!deps.probeOccupied)
      return 'unverifiable'
    try {
      return await deps.probeOccupied()
    }
    catch {
      return 'unverifiable'
    }
  }
  const emit = (event: string, detail?: string): void => {
    try {
      deps.onEvent?.(event, detail)
    }
    catch {
      // A logger must never change what the runtime state machine does.
    }
  }

  let snapshot: RuntimeStateSnapshot = { phase: 'stopped' }
  let child: ChildProcess | undefined
  /** Guards against two concurrent starts racing into two children. */
  let starting: Promise<RuntimeStateSnapshot> | undefined
  /** Round-7: concurrent stops converge into exactly ONE kill-and-verify run. */
  let stopping: Promise<void> | undefined
  /** Lifecycle contract, clause 1: no new starts once the app begins to die. */
  let shuttingDown = false

  async function runPortDiagnostics(reason: 'alltalk-compatible' | 'occupied' | 'unverifiable'): Promise<PortOwnerRecord[] | undefined> {
    if (!deps.portOwnerDiagnostics)
      return undefined
    emit('runtime.port-diagnosis-started', `reason=${reason}`)
    const timeoutMs = deps.portOwnerDiagnosticsTimeoutMs ?? 8000
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
    }, timeoutMs)
    timer.unref?.()
    let records: PortOwnerRecord[] | undefined
    try {
      records = await Promise.race([
        (async () => {
          try {
            return await deps.portOwnerDiagnostics!({ reason })
          }
          catch {
            // Evidence gathering must never change the start/stop outcome.
            emit('runtime.port-diagnosis-error')
            return undefined
          }
        })(),
        new Promise<PortOwnerRecord[] | undefined>((resolve) => {
          const timeout = setTimeout(resolve, timeoutMs, undefined)
          timeout.unref?.()
        }),
      ])
    }
    finally {
      clearTimeout(timer)
    }
    emit(timedOut ? 'runtime.port-diagnosis-timeout' : 'runtime.port-diagnosis-finished')
    return records
  }

  /** Max ancestry hops before the walk gives up and classifies unknown (item 11, case 5). */
  const ANCESTRY_WALK_LIMIT = 8

  type OwnershipVerdict
    = | { kind: 'lia-managed', roots: ProvenProcessRoot[] }
      | { kind: 'external' | 'unknown' }

  /**
   * The round-6 verdict: who owns the tree that holds our ports.
   *
   * Per listener PID, climb the ancestry and accept a node when its exe is
   * under the install root or it is the supervised launcher (cmd.exe running
   * start_alltalk.bat - an exe path outside the root by definition, yet the
   * crown of every legitimately spawned tree). The validated root is the
   * HIGHEST accepted node; `taskkill /T` below it then covers 7851+7852 in
   * one sweep (QA tree: 20092 owns children down to 20148).
   *
   * Verdicts, in the brief's own words:
   * - every listener proven ours        -> lia-managed (roots recorded);
   * - ANY listener plainly foreign      -> external (conflict, never killed);
   * - a gap anywhere - unreadable exe, unreadable ancestor that is neither
   *   under-root nor launcher nor a benign system host, a walk that cannot
   *   terminate -                             -> unknown (same protection).
   * An ancestor that CANNOT be read (already exited) does not condemn: the
   * original launcher dying while its python pal survives is precisely the
   * crash-recovery shape, and the proven under-root span stands on its own.
   */
  async function classifyOwners(records: PortOwnerRecord[]): Promise<OwnershipVerdict> {
    if (records.length === 0)
      return { kind: 'unknown' }

    const installDir = deps.installDir?.trim() ?? ''
    const accepted = (r: PortOwnerRecord) => isUnderInstallRoot(r, installDir) || isSupervisedLauncher(r, WINDOWS_START_SCRIPT)
    const listenPids = [...new Set(records.map(r => r.pid))]
    const roots: ProvenProcessRoot[] = []
    for (const pid of listenPids) {
      const record = records.find(r => r.pid === pid)!
      if (record.exe === undefined)
        return { kind: 'unknown' }
      if (!accepted(record))
        return { kind: 'external' }

      let root: PortOwnerRecord = record
      for (let hop = 0; root.parentPid !== undefined && hop < ANCESTRY_WALK_LIMIT; hop++) {
        if (!deps.inspectProcess) {
          // No ancestry probe: the listener alone proves the tree only while
          // it is itself the top - with a parent alive and unproven, honesty
          // is unknown, not wishful management.
          return { kind: 'unknown' }
        }
        const looked = await deps.inspectProcess(root.parentPid)
        if (looked.kind === 'unreadable') {
          // The query itself failed: NOISE about the parent is not proof in
          // either direction (item B: a broken inspection is not death).
          return { kind: 'unknown' }
        }
        if (looked.kind === 'gone') {
          // Parent provably gone: orphan shapes are the recovery case.
          break
        }
        const parent = looked.record
        if (accepted(parent)) {
          root = parent
          continue
        }
        if (isBenignAncestor(parent)) {
          // A shell/system host above the tree says nothing either way.
          break
        }
        // A read, named, foreign process owns our candidate root's ancestry:
        // the proof is broken and the brief says "não matar sem prova".
        return { kind: 'unknown' }
      }
      if (!roots.some(r => r.pid === root.pid))
        roots.push({ created: root.created, createdTicks: root.createdTicks, exe: root.exe, pid: root.pid })
    }
    return { kind: 'lia-managed', roots }
  }

  /**
   * The Windows-only tree kill of ONE proven root, with named revalidation
   * (round 7, items B/C, and the ownership safety correction):
   *
   * - record + compatible identity  -> the kill is permitted;
   * - provably gone                 -> nothing to kill;
   * - identity broke (recycled PID) -> never touch it again;
   * - UNREADABLE                    -> the identity of the PID right now
   *   cannot be proven. "I could not check" never decomposes into
   *   "still ours", so the direct kill is VETOED. The caller's fresh-
   *   diagnosis path is where new proof may be earned - and only a root
   *   proven by THAT new evidence may die.
   */
  async function killLiaRootTree(root: ProvenProcessRoot, context: { revalidate: boolean }): Promise<KillOutcome> {
    if (context.revalidate && deps.inspectProcess) {
      emit('runtime.root-revalidate-start', `pid=${root.pid}`)
      const fresh = await deps.inspectProcess(root.pid)
      if (fresh.kind === 'gone') {
        emit('runtime.root-revalidate-rejected', `pid=${root.pid} reason=process-gone`)
        return { result: 'gone' }
      }
      if (fresh.kind === 'unreadable') {
        // The correction, in one sentence: unproven is not safe.
        emit('runtime.root-revalidate-inconclusive', `pid=${root.pid}`)
        return { reason: 'revalidation-unreadable', result: 'vetoed' }
      }
      const identityBreaking
        = (root.exe !== undefined && fresh.record.exe !== root.exe)
          ? 'exe-mismatch'
          : (root.createdTicks !== undefined && fresh.record.createdTicks !== undefined && fresh.record.createdTicks !== root.createdTicks)
              ? 'created-mismatch'
              : (root.createdTicks === undefined && fresh.record.createdTicks === undefined
                && root.created !== undefined && fresh.record.created !== root.created)
                  ? 'created-mismatch'
                  : undefined
      if (identityBreaking !== undefined) {
        // The PID got recycled: whatever lives there now never shook our hand.
        emit('runtime.root-revalidate-rejected', `pid=${root.pid} reason=${identityBreaking}`)
        return { reason: identityBreaking, result: 'vetoed' }
      }
      emit('runtime.root-revalidate-ok', `pid=${root.pid}`)
    }
    const reported = await killProcessTree(root.pid)
    if (reported)
      emit('runtime.process-tree-terminated', `rootPid=${root.pid}`)
    return { result: 'attempted' }
  }

  function set(next: RuntimeStateSnapshot): RuntimeStateSnapshot {
    snapshot = next
    return next
  }

  async function isInstalled(): Promise<boolean> {
    const dir = deps.installDir?.trim()
    if (!dir)
      return false

    for (const marker of [...INSTALL_MARKERS, ...ENVIRONMENT_MARKERS]) {
      if (!await exists(join(dir, marker)))
        return false
    }
    // The launcher only exists once the user has actually run the setup script,
    // so it is the difference between "extracted the zip" and "installed".
    return platform === 'win32' ? exists(join(dir, WINDOWS_START_SCRIPT)) : true
  }

  async function waitForHealth(deadline: number): Promise<boolean> {
    for (;;) {
      try {
        if (await deps.isHealthy())
          return true
      }
      catch {
        // A server that is still booting refuses connections; that is not an
        // error yet, only a reason to keep waiting.
      }

      if (Date.now() >= deadline)
        return false

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }
  }

  /**
   * The observed tree kill (round 7, item D). Exit code is FACT, not noise:
   * `taskkill` returning non-zero - notoriously "process not found" when the
   * root died before the tree walk could start - used to be swallowed into a
   * pretend success, and the children below the dead root outlived their
   * very kill event. Now the caller learns the truth: true means taskkill
   * REPORTED the kill; whether the tree actually died is still only known by
   * probing the ports after (item E), which the verify loop does.
   */
  async function killProcessTree(pid: number): Promise<boolean> {
    if (platform !== 'win32' || !deps.execImpl)
      return false
    // Fixed arguments, no shell, Lia-owned root PID only (item K).
    const args = taskkillArgs(pid)
    emit('runtime.kill-tree-start', `pid=${pid}`)
    try {
      const result = await deps.execImpl('taskkill', args, { timeoutMs: stopGraceMs })
      emit('runtime.kill-tree-finished', `pid=${pid} exit=${String(result.code)}`)
      if (result.code !== 0) {
        // Never a success: the PID may already be dead (fine for the root,
        // fatal for its tree), or the kill itself failed. The caller's
        // survivor probe is the judge.
        emit('runtime.kill-tree-failed', `pid=${pid} exit=${String(result.code)}`)
        return false
      }
      return true
    }
    catch {
      emit('runtime.kill-tree-failed', `pid=${pid} reason=exec-error`)
      return false
    }
  }

  type KillOutcome
    = | { result: 'attempted' | 'gone' }
      | { reason: 'created-mismatch' | 'exe-mismatch' | 'process-gone' | 'revalidation-unreadable', result: 'vetoed' }

  interface VerifyOutcome {
    finished: boolean
    reason?: string
  }

  /** Delay helper: a pause that never pins the event loop. */
  async function grace(ms: number): Promise<void> {
    if (ms <= 0)
      return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      timer.unref?.()
    })
  }

  /**
   * Round 7, items D-F, the engine of the new stop: kill the proven roots,
   * then prove the ports. Survivors are re-diagnosed and re-verified, and
   * only PROVEN lia-managed survivors are killed again; anything foreign or
   * unproven ends the attempt with an error, never with a kill.
   *
   * Returns true only when the ports answer free afterwards. `roots` may
   * carry the spawned child's wrapper PID, which taskkill can refuse while
   * the python it raised is very much alive - the EV1 shape exactly.
   */
  async function killAndVerify(roots: ProvenProcessRoot[]): Promise<VerifyOutcome> {
    const rounds = deps.verifyRounds ?? 3
    const graceMs = deps.verifyGraceMs ?? 1500
    let survivors = [...roots]
    let lastReason: string | undefined
    for (let round = 1; round <= rounds; round++) {
      let unreadableVeto = false
      for (const root of survivors) {
        const outcome = await killLiaRootTree(root, { revalidate: true })
        if (outcome.result === 'vetoed') {
          if (outcome.reason === 'revalidation-unreadable')
            unreadableVeto = true
          lastReason = outcome.reason
        }
      }

      await grace(graceMs)
      const occupancy = await occupancySafe()
      emit('runtime.kill-verify', `round=${round} occupancy=${occupancy}`)
      if (occupancy === 'free')
        return { finished: true }

      // Who is really there? Only a rerun of the evidence can say - and this
      // is the OFFICIAL recovery from an unreadable revalidation: not a kill
      // on the old (unproven-today) identity, but a fresh census whose own
      // proof chain either re-establishes lia-managed (and only those newly
      // proven roots die) or stays silent and keeps every process alive.
      const records = await runPortDiagnostics('occupied')
      if (records === undefined || records.length === 0) {
        // The probe sees occupied but the census sees nobody - a lie
        // detection failure, not a port we may kill for.
        emit('runtime.kill-verify-inconclusive', `round=${round}`)
        return { finished: false, reason: unreadableVeto ? 'revalidation-unreadable' : (lastReason ?? 'verification-inconclusive') }
      }
      const verdict = await classifyOwners(records)
      if (verdict.kind !== 'lia-managed') {
        // The survivor is NOT provably ours - external survives, unknown
        // survives. Killing here would be the very murder the whole model
        // exists to prevent; the stop ends with a named reason instead.
        emit('runtime.shutdown-survivor-not-lia-managed', `classification=${verdict.kind} round=${round}`)
        return { finished: false, reason: unreadableVeto ? 'revalidation-unreadable' : `survivor-${verdict.kind}` }
      }
      survivors = verdict.roots
      emit('runtime.kill-verify-survivors', `round=${round} survivors=${survivors.map(r => r.pid).join(',')}`)
    }
    emit('runtime.kill-verify-exhausted', `rounds=${rounds}`)
    return { finished: false, reason: lastReason ?? 'kill-verify-exhausted' }
  }

  async function doStop(options: RuntimeStopOptions): Promise<void> {
    const current = child
    child = undefined
    if (starting)
      starting = undefined

    // Round-6 ownership, clause 4: EVERY lia-managed tree - spawned now or
    // found already running - dies when the Lia closes. The `owned:false`
    // bucket that used to spare it is gone: adopted is ours when proven, and
    // the unproven was never adopted (external/unknown are port conflicts,
    // never attachments, and never killed here either).
    if (!current && snapshot.attachment?.kind === 'lia-managed') {
      const attachment = snapshot.attachment
      if (deps.preserveAdoptedOnStop) {
        // Supervisor scope: this tree got adopted, never born here. It may
        // be the user's own hand-started server - and closing the launcher
        // must never take that down. The session ends; the tree stays.
        emit('runtime.attachment-preserved', `rootPid=${attachment.roots.map(r => r.pid).join(',')}`)
        set({ phase: 'stopped' })
        emit('runtime.stopped')
        return
      }
      // Item A, the rule this round exists for: 'stopped' is a FACT, not an
      // intention. The snapshot reads 'stopping' for the whole kill+verify,
      // and flips to 'stopped' only when the ports prove the tree is gone -
      // or to 'error' with the reason when they do not.
      set({ phase: 'stopping' })
      emit('runtime.stopping-lia-managed-existing', `rootPid=${attachment.roots.map(r => r.pid).join(',')}`)
      const outcome = await killAndVerify(attachment.roots)
      if (outcome.finished) {
        set({ phase: 'stopped' })
        emit('runtime.stopped')
      }
      else {
        set({ message: 'The voice system could not be fully stopped.', phase: 'error' })
        emit('runtime.stop-incomplete', `reason=${outcome.reason ?? 'ports-still-occupied-after-kill'}`)
      }
      await confirmPortsFree(options.confirmFreeMs ?? 0)
      return
    }

    if (!current || current.exitCode !== null) {
    // Nothing to kill. A previous failure is kept so the UI still explains
    // why the voice is unavailable instead of silently reading "stopped".
      if (snapshot.phase !== 'error' && snapshot.phase !== 'stopping' && snapshot.phase !== 'stopped')
        set({ phase: 'stopped' })
      return
    }

    const pid = current.pid
    set({ phase: 'stopping' })

    const exited = new Promise<void>((resolve) => {
      current.once('exit', () => resolve())
      // Never hang the app's shutdown on a stubborn child.
      setTimeout(resolve, stopGraceMs).unref?.()
    })

    current.kill('SIGTERM')
    await exited

    if (current.exitCode === null) {
    // Did not take the hint: make sure it cannot outlive us.
    // On Windows the bat wrapper dies alone and orphans its python worker, so
    // the escalation there is the process-tree kill first.
      if (platform === 'win32' && pid !== undefined) {
        await killLiaRootTree({ pid }, { revalidate: false })
        await new Promise<void>((resolve) => {
          current.once('exit', () => resolve())
          setTimeout(resolve, stopGraceMs).unref?.()
        })
      }
      if (current.exitCode === null)
        current.kill('SIGKILL')
    }

    // Item E, the axiom the QA forced us to accept: a root kill - even a
    // reported one - proves nothing about the tree. The ports alone answer
    // for it, and survivors get one verified fallback sweep before the stop
    // is allowed to claim 'stopped'.
    if (platform === 'win32') {
      await grace(deps.verifyGraceMs ?? 1500)
      const occupancy = await occupancySafe()
      emit('runtime.kill-verify', `round=kill occupancy=${occupancy}`)
      if (occupancy !== 'free') {
        const records = await runPortDiagnostics('occupied')
        const verdict = records !== undefined && records.length > 0 ? await classifyOwners(records) : { kind: 'unknown' as const }
        if (verdict.kind === 'lia-managed') {
          const outcome = await killAndVerify(verdict.roots)
          if (!outcome.finished) {
            set({ message: 'The voice system could not be fully stopped.', phase: 'error' })
            emit('runtime.stop-incomplete', `reason=${outcome.reason ?? 'ports-still-occupied-after-kill'}`)
            await confirmPortsFree(options.confirmFreeMs ?? 0)
            return
          }
        }
        else {
          if (verdict.kind === 'unknown')
            emit('runtime.kill-verify-inconclusive', 'round=kill')
          else
            emit('runtime.shutdown-survivor-not-lia-managed', `classification=${verdict.kind}`)
          set({ message: 'The voice system could not prove its port is free.', phase: 'error' })
          emit('runtime.stop-incomplete', 'reason=survivor-unverified')
          await confirmPortsFree(options.confirmFreeMs ?? 0)
          return
        }
      }
    }

    set({ phase: 'stopped' })
    emit('runtime.stopped')

    await confirmPortsFree(options.confirmFreeMs ?? 0)
  }

  function stop(options: RuntimeStopOptions = {}): Promise<void> {
    // Round-7 single-flight: concurrent stops converge into ONE kill-and-
    // verify run. The snapshot meanwhile reads 'stopping' - never 'stopped'
    // ahead of the proof (item A).
    if (!stopping) {
      stopping = doStop(options).finally(() => {
        stopping = undefined
      })
    }
    return stopping
  }

  /**
   * Lifecycle contract, clause 6: prove the ports are clear before the main
   * process is allowed to finish. Runs after every kill of a Lia tree -
   * spawned or attached; confirming someone else's port would just delay
   * every quit of a user who started AllTalk by hand.
   */
  async function confirmPortsFree(confirmFreeMs: number): Promise<void> {
    if (confirmFreeMs > 0) {
      const deadline = Date.now() + confirmFreeMs
      let lastOccupancy: RuntimePortOccupancy = 'unverifiable'
      let free = false
      while (Date.now() < deadline) {
        lastOccupancy = await occupancySafe()
        if (lastOccupancy === 'free') {
          free = true
          break
        }
        await new Promise<void>((resolve) => {
          const pause = setTimeout(resolve, 250)
          pause.unref?.()
        })
      }
      if (free) {
        emit('runtime.shutdown-ports-free')
      }
      else {
        emit('runtime.shutdown-ports-still-occupied', `occupancy=${lastOccupancy}`)
        await runPortDiagnostics(lastOccupancy === 'occupied' ? 'occupied' : 'unverifiable')
      }
    }
  }

  async function doStart(source: string): Promise<RuntimeStateSnapshot> {
    try {
      if (snapshot.phase === 'ready') {
        // Contract A-1/A-2: a live child, or any healthy API at all, is reused -
        // never joined by a second spawn.
        try {
          if (await deps.isHealthy()) {
            emit('runtime.reuse-running-instance')
            return snapshot
          }
        }
        catch {
          // fall through and start again
        }
        // An attached tree that stopped answering is OUR stale server, not a
        // stranger: stop() terminates it with proof before we respawn (item 8:
        // "matar/recomeçar se corrupto/stale").
        if (snapshot.attachment !== undefined)
          await stop()
        set({ phase: 'stopped' })
      }

      if (!(await isInstalled()))
        return set({ phase: 'notInstalled' })

      const installDir = deps.installDir!.trim()

      // The QA brief's item-C start order, nearly verbatim:
      //   1. health answers AllTalk-shaped  -> reuse/adopt
      //   2. health silent                  -> ask the SOCKET, not the health
      //   3. ports free                     -> SPAWN
      //   4. occupied                       -> identify owner, fail fast
      //   5. occupancy unverifiable         -> diagnose, never spawn blind
      //
      // The boot-clean QA log proved why health must never *become* occupancy:
      // a refused health check reads identically to "free" and to "stranger
      // holds the port" - only the socket probe above separates the two.
      const healthSaysAllTalk = await healthySafe()
      emit('runtime.classified', healthSaysAllTalk ? 'health=alltalk occupancy=skipped' : 'health=down')
      if (!healthSaysAllTalk) {
        const occupancy = await occupancySafe()
        emit('runtime.classified', `health=down occupancy=${occupancy}`)
        if (occupancy !== 'free') {
          // Someone - or no provable answer - holds the port. Evidence first,
          // decision second: "não matar antes da identificação", made an
          // ordering the tests assert.
          const records = await runPortDiagnostics(occupancy === 'occupied' ? 'occupied' : 'unverifiable')

          // Item 8 recovery path, where the last session left a corpse: the
          // tree is provably ours but its health is down - kill it with
          // proof and let the flow fall through to a fresh spawn.
          if (occupancy === 'occupied' && records !== undefined) {
            const verdict = await classifyOwners(records)
            if (verdict.kind === 'lia-managed') {
              emit('runtime.stopping-stale-lia-managed', `rootPid=${verdict.roots[0]?.pid ?? 'unknown'}`)
              for (const root of verdict.roots)
                await killLiaRootTree(root, { revalidate: true })
            }
            else {
              // Phase before announcement, always (round-5 contract, item B):
              // the state publisher re-reads the snapshot on every event - an
              // event fired before its set() would publish the phase the
              // machine just LEFT, and the publish dedupe would then swallow
              // the very transition that mattered.
              const foreign = verdict.kind === 'external'
              const next = set({
                message: foreign
                  ? 'The voice system is already being used by another process.'
                  : occupancy === 'occupied'
                    ? 'The voice system cannot prove who is using its port.'
                    : 'The voice system could not prove its own port is free.',
                phase: 'error',
              })
              emit(foreign
                ? 'runtime.port-occupied-external-process'
                : occupancy === 'occupied'
                  ? 'runtime.port-occupied-unknown-process'
                  : 'runtime.port-occupancy-unverifiable')
              return next
            }
          }
          else if (occupancy !== 'occupied') {
            // Unverifiable stands exactly as the round-4 contract drew it: a
            // probe that cannot see, never an excuse to spawn blind.
            const next = set({
              message: 'The voice system could not prove its own port is free.',
              phase: 'error',
            })
            emit('runtime.port-occupancy-unverifiable')
            return next
          }
          else {
            // Occupied by the socket, but no evidence the identification
            // produced (or nothing to classify): the round-4 contract's own
            // verdict - an unknown process holds the port, and only the safe
            // side applies.
            const next = set({
              message: records === undefined
                ? 'The voice system could not identify who is using its port.'
                : 'The voice system cannot prove who is using its port.',
              phase: 'error',
            })
            emit('runtime.port-occupied-unknown-process')
            return next
          }
        }
      }
      else {
        // An AllTalk-shaped server answers while we own no child. Round 6
        // ends the shrug that used to follow: ownership is PROVEN before any
        // attach. Provably ours (survivor of an earlier Lia session) -> adopt
        // as lia-managed, lifecycle included. Provably foreign -> a friendly
        // port conflict, never an adoption; an AllTalk the user opened by
        // hand stays theirs. Unproven -> the same conflict, safe side.
        const records = await runPortDiagnostics('alltalk-compatible')
        const verdict = records !== undefined ? await classifyOwners(records) : { kind: 'unknown' as const }
        if (verdict.kind === 'lia-managed') {
          const attachment: RuntimeAttachment = { kind: 'lia-managed', roots: verdict.roots }
          const next = set({ attachment, phase: 'ready' })
          emit('runtime.adopted-lia-managed-instance', `classification=lia-managed rootPid=${verdict.roots[0]?.pid ?? 'unknown'}`)
          return next
        }
        const foreign = verdict.kind === 'external'
        const next = set({
          message: foreign
            ? 'The voice system is already being used by another process.'
            : 'The voice system cannot prove who owns its port.',
          phase: 'error',
        })
        emit(foreign ? 'runtime.port-occupied-external-process' : 'runtime.port-occupied-unknown-process')
        return next
      }

      set({ phase: 'starting' })
      emit('runtime.spawn-requested', `source=${source}`)

      const env = await spawnEnvFor(platform, installDir, existsImpl)
      const { command, args, options } = startCommandFor(platform, installDir, { env })
      const spawned = spawnImpl(command, args, options)
      child = spawned
      emit('runtime.spawned', spawned.pid !== undefined ? `pid=${spawned.pid} source=${source}` : `source=${source}`)

      const record = (chunk: Buffer | string) => {
        deps.onOutput?.(String(chunk))
      }
      spawned.stdout?.on('data', record)
      spawned.stderr?.on('data', record)

      const exited = new Promise<number | null>((resolve) => {
        spawned.once('exit', code => resolve(code))
        spawned.once('error', () => resolve(null))
      })

      const healthy = await Promise.race([
        waitForHealth(Date.now() + startTimeoutMs),
        exited.then(() => false),
      ])

      if (!healthy) {
        // The spawn failed to serve. Ask the SOCKET first: if nobody took the
        // port at all, the child simply died (crash / health timeout). If
        // something did take it, one last health read separates "a racing Lia
        // instance won it" (healthy: attach with proof, not a second server)
        // from "our child died fighting a stranger" (friendly error, never a
        // kill).
        const afterOccupancy = await occupancySafe()
        if (afterOccupancy !== 'free') {
          const lateHealth = await healthySafe()
          if (lateHealth && spawned.exitCode === null) {
            // Our own child just got healthy a breath after the race closed:
            // adopt no one - the child we spawned IS the ready server.
            const next = set({ phase: 'ready', pid: spawned.pid })
            emit('runtime.health-ready')
            return next
          }
          if (lateHealth) {
            const records = await runPortDiagnostics('occupied')
            const verdict = records !== undefined ? await classifyOwners(records) : { kind: 'unknown' as const }
            if (verdict.kind === 'lia-managed') {
              await stop()
              const attachment: RuntimeAttachment = { kind: 'lia-managed', roots: verdict.roots }
              const next = set({ attachment, phase: 'ready' })
              emit('runtime.adopted-lia-managed-instance', `classification=lia-managed rootPid=${verdict.roots[0]?.pid ?? 'unknown'}`)
              return next
            }
          }
          else {
            await runPortDiagnostics(afterOccupancy === 'occupied' ? 'occupied' : 'unverifiable')
          }
          await stop()
          const next = set({
            message: afterOccupancy === 'occupied'
              ? 'The voice system is already being used by another process.'
              : 'The voice system could not prove its own port is free.',
            phase: 'error',
          })
          emit(afterOccupancy === 'occupied'
            ? 'runtime.port-occupied-unknown-process'
            : 'runtime.port-occupancy-unverifiable')
          return next
        }

        // Read the exit code *before* killing anything: stop() would otherwise
        // fill it in and make a timeout look like a crash.
        const died = spawned.exitCode !== null
        await stop()
        const next = set({
          phase: 'error',
          message: died
            ? 'The voice system closed while starting.'
            : 'The voice system took too long to start.',
        })
        emit('runtime.start-failed', died ? 'exited-during-startup' : 'health-timeout')
        return next
      }

      const next = set({ phase: 'ready', pid: spawned.pid })
      emit('runtime.health-ready')
      return next
    }
    catch {
      await stop()
      return set({ phase: 'error', message: 'The voice system could not be started.' })
    }
    finally {
      starting = undefined
    }
  }

  return {
    state: () => snapshot,

    isInstalled,

    start(options: RuntimeStartOptions = {}) {
      const source = options.source ?? 'unknown'
      emit('runtime.start-request', `source=${source}`)

      // Lifecycle contract, clause 1: once the app begins to die, no caller -
      // autostart racing the quit, a health check, a repair click buffered in
      // the renderer - may spawn anything ever again.
      if (shuttingDown) {
        emit('runtime.start-rejected', `reason=shutting-down source=${source}`)
        return Promise.resolve({
          message: 'The application is closing.',
          phase: 'error',
        })
      }

      // Single-instance guard. `starting` must be assigned *synchronously*: an
      // async function suspends at its first await, and every await before this
      // assignment was a window in which a second caller could spawn its own
      // child and leave two servers fighting over the same port. Concurrent
      // callers are logged as coalesced, so the QA timeline shows every
      // request even when only one spawn can ever happen.
      if (starting) {
        emit('runtime.start-coalesced', `source=${source} existingPid=${child?.pid ?? 'unknown'}`)
        return starting
      }

      starting = doStart(source)
      return starting
    },

    stop: (options: RuntimeStopOptions = {}) => stop(options),

    enterShutdown() {
      shuttingDown = true
      emit('runtime.shutdown-requested')
    },

    ownedChildPid: () => child && child.exitCode === null ? child.pid : undefined,

    liaManagedRootPids: () => {
      const pids: number[] = []
      if (child && child.exitCode === null && child.pid !== undefined)
        pids.push(child.pid)
      if (snapshot.attachment?.kind === 'lia-managed')
        pids.push(...snapshot.attachment.roots.map(r => r.pid))
      return [...new Set(pids)]
    },
  }
}
