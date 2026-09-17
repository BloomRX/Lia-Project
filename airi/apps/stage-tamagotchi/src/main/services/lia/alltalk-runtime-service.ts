import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaRuntimeInstallStep, LiaRuntimeState } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia-schema'
import type { RuntimeManager } from './alltalk-runtime'

import process from 'node:process'

import { execFile, execFileSync } from 'node:child_process'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow, dialog } from 'electron'

import {
  electronLiaRuntimeChanged,
  electronLiaRuntimeInstallDirPick,
  electronLiaRuntimeInstallSteps,
  electronLiaRuntimeStart,
  electronLiaRuntimeState,
  electronLiaRuntimeStop,
} from '../../../shared/eventa'
import { CUSTOM_VOICE_PROVIDER_ID } from '../../../shared/lia-voice'
import { defaultLiaProductConfig } from '../../configs/lia-schema'
import { createAllTalkClient } from './alltalk-client'
import { gatherPortOwners, inspectProcess } from './alltalk-port-diagnostics'
import { loopbackHostFor, probeTcpListeners } from './alltalk-port-listeners'
import { createRuntimeManager, taskkillArgs } from './alltalk-runtime'
import { mergeAllTalkRuntime, resolveAllTalkRuntime } from './alltalk-runtime-config'
import { buildInstallSteps, mayAutostartRuntime } from './alltalk-runtime-install'
import { installRuntimeShutdownHooks } from './runtime-shutdown'
import { runtimeAppDir } from './voice-runtime-bootstrap-electron'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * How long the shutdown path proves the ports are free for. Bounded so quit
 * can never hang: if a stubborn holder remains, the `port-owner` lines it
 * logs are precisely the evidence the QA brief asks for.
 */
const SHUTDOWN_CONFIRM_FREE_MS = 15_000

export interface LiaRuntimeService {
  /** Current state, without starting anything. */
  state: () => LiaRuntimeState
  /**
   * Starts the runtime if it is installed and not already running.
   *
   * `source` is the audited call site (hotfix QA brief): 'ui-start' from the
   * button, 'bootstrap-verify-health', 'custom-voice-prepare-restart'... It
   * lands on the [LIA-VOICE-RUNTIME] timeline so the log can never confuse
   * two start paths with one.
   */
  start: (options?: { source?: string }) => Promise<LiaRuntimeState>
  /** Stops the managed process. Always safe to call. */
  stop: () => Promise<void>
  /**
   * Starts the runtime when the active voice needs it.
   *
   * Returns quietly when the selected voice is not a custom one: a user who
   * picked a built-in voice should never pay for a server they will not use.
   */
  autostartIfNeeded: (options?: { installing?: boolean }) => Promise<LiaRuntimeState | null>
  /**
   * Where the server actually listens.
   *
   * Exposed rather than re-derived elsewhere, so there is one place that decides
   * the address. A second, hardcoded copy is how the bootstrap ends up
   * health-checking a port the user moved the server off of, then reporting a
   * failure for a server that is in fact running.
   */
  clientConfig: () => { baseUrl: string, timeoutMs: number }
  /**
   * Whether the answering instance is a child the Lia spawned.
   *
   * Readiness for *use* never cares (item G of the hotfix brief), but the
   * prepare flow's engine-switch restart does: it may only stop an instance
   * with proven ownership, and needs to know before promising one.
   */
  isOwnedInstance: () => boolean
  /** Whether the runtime's install markers are complete on disk (item E). */
  isInstalled: () => Promise<boolean>
}

/** Maps the manager's internal phases onto what the renderer is told. */
function toRendererState(phase: string, message?: string): LiaRuntimeState {
  switch (phase) {
    case 'error':
      return { message: message ?? 'The voice system could not be started.', state: 'error' }
    case 'notInstalled':
      return { state: 'notInstalled' }
    case 'ready':
      return { state: 'ready' }
    case 'starting':
      return { state: 'starting' }
    // 'stopping' maps onto 'stopped' deliberately: the shared contract stays
    // a 5-state vocabulary (item J allows the internal phase without contract
    // change), and the quit path showing one extra beat of 'stopped' changes
    // nothing a user can observe behind a closing window.
    default:
      return { state: 'stopped' }
  }
}

/**
 * Every [LIA-VOICE-RUNTIME] line carries a wall-clock timestamp (hotfix QA
 * brief): the whole point of the instrumentation is ordering who came first
 * in a cold boot, and "first" is a timestamp.
 */
function runtimeLog(event: string, detail?: string): void {
  console.info('[LIA-VOICE-RUNTIME]', new Date().toISOString(), event, detail ?? '')
}

/**
 * The API port and the bundled-web port the diagnostics inspect. AllTalk
 * serves its API on the configured port and the built-in Gradio client one
 * port above it in the pinned build; no flags are invented here.
 */
function runtimePorts(baseUrl: string): number[] {
  try {
    const apiPort = Number.parseInt(new URL(baseUrl).port || '7851', 10)
    return [apiPort, apiPort + 1]
  }
  catch {
    return [7851, 7852]
  }
}

/** execFile with captured stdout, shaped for the diagnostics module. */
async function execCapture(command: string, args: string[], options: { timeoutMs: number }): Promise<{ code: number | null, stdout: string }> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: options.timeoutMs }, (error, stdout) => {
      resolve({
        code: typeof error?.code === 'number' ? error.code : 0,
        stdout: typeof stdout === 'string' ? stdout : '',
      })
    })
  })
}

/**
 * Synchronous best-effort tree kill for the crash/exit path (lifecycle
 * contract): the `before-quit` path does the graceful stop; this only runs
 * when the process is already dying and can no longer await. Fixed
 * arguments, no shell, Lia-owned root PID only - the same taskkill contract
 * as everywhere else.
 */
function killOwnedTreeSync(pid: number): void {
  if (process.platform !== 'win32')
    return
  try {
    execFileSync('taskkill', taskkillArgs(pid), { stdio: 'ignore', timeout: 5000 })
  }
  catch {
    // Already gone, or taskkill unavailable on a stripped image: the QA log
    // line above is the record; the process is exiting either way.
  }
}

export function registerLiaRuntimeBridge(params: {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined, update: (value: LiaProductConfig) => void }
}): LiaRuntimeService {
  const { context, liaProductConfig } = params

  /**
   * Cached per install directory. Recreated when the user points at a different
   * folder, so a stale manager can never spawn into an old location.
   */
  let cached: { dir: string | undefined, manager: RuntimeManager } | undefined

  /**
   * The push half of the state pair (Phase 6 hotfix: the 75 s health-ready
   * the card never saw).
   *
   * The renderer's runtime state used to be pull-only: the store asked once,
   * on mount, and kept that answer. A server that becomes healthy long after
   * the tab opened - the Windows QA boot was ~75 s - then stayed invisible:
   * main printed `runtime.health-ready` while the card kept saying
   * "Iniciando…". The manager already announces every transition through
   * `onEvent` (the [LIA-VOICE-RUNTIME] log line); this hook republishes the
   * resulting snapshot on the `lia:runtime:changed` channel. It dedupes so a
   * chatty state machine cannot spam IPC, and it never throws: publishing is
   * a mirror, and a mirror must not break what it reflects.
   */
  let lastPublished: string | undefined

  function publishRuntimeState(trigger: string): void {
    try {
      const snapshot = cached?.manager.state()
      if (!snapshot)
        return
      const next = toRendererState(snapshot.phase, snapshot.message)
      const fingerprint = JSON.stringify(next)
      if (fingerprint === lastPublished)
        return
      lastPublished = fingerprint
      // The item-A trace line, word for word from the hotfix brief: where
      // the ready event used to vanish, there is now a printed hand-off.
      console.info('[LIA-VOICE-RUNTIME] runtime.state-published', `status=${next.state}`, `trigger=${trigger}`)
      context.emit(electronLiaRuntimeChanged, next)
    }
    catch {
      // A renderer that is gone - or a context mid-teardown - must never
      // change what the runtime itself does next.
    }
  }

  function readRuntime() {
    return resolveAllTalkRuntime(liaProductConfig.get())
  }

  /**
   * Where to look for the runtime.
   *
   * An explicitly chosen folder wins - that is the "I already installed it"
   * path. Otherwise the directory the bootstrapper installs into is used, so the
   * two agree by construction. Without this they could disagree: the bootstrap
   * would finish successfully while the manager, pointed at an empty default,
   * kept reporting "not installed", and the UI would offer to install again
   * something that is already there.
   */
  function resolveInstallDir(runtime: { installDir?: string }): string {
    return runtime.installDir?.trim() || runtimeAppDir()
  }

  function manager(): RuntimeManager {
    const runtime = readRuntime()
    const installDir = resolveInstallDir(runtime)
    if (cached && cached.dir === installDir)
      return cached.manager

    const built = createRuntimeManager({
      installDir,
      isHealthy: async () => {
        const probe = await createAllTalkClient(runtime).status()
        return probe.ok
      },
      /**
       * The socket fact about the port - deliberately decoupled from the
       * health fact above (Phase 6 QA hotfix, item B). The boot-clean QA log
       * proved why: the client swallows a refused connection into a plain
       * "offline", and reading *that* as "occupied by a stranger" produced a
       * false `port-occupied-unknown-process` while netstat said
       * `listeners=none`. Occupancy is asked of the sockets themselves;
       * health findings never upgrade themselves to it.
       */
      probeOccupied: async () => await probeTcpListeners({
        host: loopbackHostFor(readRuntime().baseUrl),
        ports: runtimePorts(readRuntime().baseUrl),
      }),
      execImpl: async (command, args, options) => await new Promise((resolve) => {
        // Only ever used for the Windows process-tree kill. taskkill exits
        // non-zero when the PID is already gone, and that - like a missing
        // taskkill on a stripped system - leaves the tree either dead or
        // unverifiable, both of which the subsequent SIGKILL attempt on the
        // wrapper covers. It is never a reason to crash a stop.
        execFile(command, args, { timeout: options.timeoutMs }, (error) => {
          resolve({ code: typeof error?.code === 'number' ? error.code : 0 })
        })
      }),
      onEvent: (event, detail) => {
        runtimeLog(event, detail)
        publishRuntimeState(event)
      },
      onOutput: line => console.info('[lia-runtime]', new Date().toISOString(), line.trimEnd()),
      /**
       * Windows QA instrumentation: when anything is found on the port, name
       * it. Runs before every occupied-port decision and after a contested
       * stop; it gathers and logs, and kills nothing. Round 6: the records it
       * returns now double as the ownership evidence the manager classifies
       * with (lia-managed / external / unknown).
       */
      portOwnerDiagnostics: async () => {
        return await gatherPortOwners({
          exec: execCapture,
          installDir,
          log: line => runtimeLog(line),
          platform: process.platform,
          ports: runtimePorts(readRuntime().baseUrl),
        })
      },
      // The ancestry walk's one-process lookup (round-6 item D; round-7
      // item B): validated roots are reconstructed from listener PID +
      // parents, and re-checked before any kill - tri-state so a failed
      // query is never pretended to be death.
      inspectProcess: async pid =>
        await inspectProcess({ exec: execCapture, platform: process.platform }, pid),
    })
    cached = { dir: installDir, manager: built }
    return built
  }

  async function startRuntime(source = 'unknown'): Promise<LiaRuntimeState> {
    const result = await manager().start({ source })
    // The return-value flush (round-5, item B): a transition carries its own
    // event, but some end states do not - notInstalled, start-rejected, the
    // catch-all error. No renderer may be left holding the previous answer.
    publishRuntimeState('start-returned')
    return toRendererState(result.phase, result.message)
  }

  async function stopRuntime(): Promise<LiaRuntimeState> {
    await manager().stop()
    publishRuntimeState('stop-returned')
    return toRendererState(manager().state().phase)
  }

  defineInvokeHandler(context, electronLiaRuntimeState, async (): Promise<LiaRuntimeState> => {
    const installed = await manager().isInstalled()
    if (!installed)
      return { state: 'notInstalled' }
    return toRendererState(manager().state().phase)
  })

  defineInvokeHandler(context, electronLiaRuntimeStart, async (): Promise<LiaRuntimeState> => startRuntime('ui-start'))

  defineInvokeHandler(context, electronLiaRuntimeStop, async (): Promise<LiaRuntimeState> => stopRuntime())

  defineInvokeHandler(
    context,
    electronLiaRuntimeInstallDirPick,
    async (options: { clear?: boolean }): Promise<string | null> => {
      if (options?.clear) {
        const current = liaProductConfig.get() ?? defaultLiaProductConfig
        liaProductConfig.update(mergeAllTalkRuntime(current, { installDir: '' }))
        cached = undefined
        return null
      }

      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const dialogOptions = {
        title: 'Select the folder where AllTalk is installed',
        properties: ['openDirectory'] as Array<'openDirectory'>,
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      // Cancel keeps whatever was configured before.
      if (result.canceled || result.filePaths.length === 0)
        return null

      const chosen = result.filePaths[0]
      const current = liaProductConfig.get() ?? defaultLiaProductConfig
      liaProductConfig.update(mergeAllTalkRuntime(current, { installDir: chosen }))
      cached = undefined
      return chosen
    },
  )

  defineInvokeHandler(context, electronLiaRuntimeInstallSteps, async (): Promise<LiaRuntimeInstallStep[]> => {
    const configured = Boolean(readRuntime().installDir?.trim())
    const installed = await manager().isInstalled()
    return buildInstallSteps({ installDirConfigured: configured, installed })
  })

  const service: LiaRuntimeService = {
    clientConfig: () => {
      const runtime = readRuntime()
      return { baseUrl: runtime.baseUrl, timeoutMs: runtime.timeoutMs }
    },
    isInstalled: async () => await manager().isInstalled(),
    // Round 6: every ready instance is ours by definition - a spawned child
    // or a proven lia-managed tree (external/unknown never become ready).
    isOwnedInstance: () => {
      const snapshot = manager().state()
      return snapshot.phase === 'ready' && (snapshot.pid !== undefined || snapshot.attachment !== undefined)
    },
    state: () => toRendererState(manager().state().phase),
    start: async (options = {}) => await startRuntime(options.source ?? 'unknown'),
    stop: async () => {
      await manager().stop()
      publishRuntimeState('stop-returned')
    },
    async autostartIfNeeded(options: { installing?: boolean } = {}) {
      // The first waypoint of the boot timeline (hotfix QA brief): did the
      // autostart path even *ask* for a start, and was it allowed past the
      // gates? The decision is logged either way, because "autostart fired
      // before bootstrap" is one of the hypotheses the QA run must rule on.
      const preferred = liaProductConfig.get()?.voice?.tts?.preferred
      if (!mayAutostartRuntime(preferred, options)) {
        runtimeLog('runtime.autostart-skipped', `customVoice=${preferred?.providerId === CUSTOM_VOICE_PROVIDER_ID} installing=${options.installing === true}`)
        return null
      }
      runtimeLog('runtime.autostart-requested', `installing=${options.installing === true}`)

      const installed = await manager().isInstalled()
      if (!installed) {
        // Not an error: the UI offers the guided install instead.
        return { state: 'notInstalled' }
      }

      return startRuntime('autostart')
    },
  }

  // Registration waypoint: the log needs to know when the manager became
  // reachable at all, since "registered" precedes every start it will make.
  runtimeLog('runtime.manager-registered')

  /**
   * The lifecycle contract (hotfix brief, extended by the round-5 dev-quit
   * bug): everything the Lia started dies with the Lia, through EVERY exit
   * the operating system lets us see. Ordered: declare shutdown (no new
   * starts, ever) → stop the owned child gracefully (SIGTERM → grace →
   * taskkill /T /F tree kill → SIGKILL) → confirm 7851/7852 answer nobody →
   * then let the process end. The triggers: `before-quit` (packaged quit,
   * and `window-all-closed` through the default `app.quit()`), SIGINT /
   * SIGTERM / SIGHUP (the dev loop: Ctrl+C in the terminal, the runner's
   * kill on restart, a closed console), and the last-resort synchronous
   * kill on `exit`. The semantics live in `runtime-shutdown.ts` so tests
   * drive them without an Electron process.
   */
  installRuntimeShutdownHooks({
    confirmFreeMs: SHUTDOWN_CONFIRM_FREE_MS,
    endProcess: code => (code === 0 ? app.exit(0) : process.exit(code)),
    enterShutdown: () => manager().enterShutdown(),
    killTreeSync: pid => killOwnedTreeSync(pid),
    listeners: {
      beforeQuit: listener => app.on('before-quit', listener),
      exit: listener => process.on('exit', listener),
      signal: (signal, listener) => process.on(signal as NodeJS.Signals, listener),
    },
    log: (event, detail) => runtimeLog(event, detail),
    // The synchronous exit-path kill sweeps whichever proven Lia root the
    // shutdown could not stop gracefully: the spawned child first, then the
    // validated roots of an attached lia-managed tree (round-6 item 4).
    ownedRootPid: () => cached?.manager.ownedChildPid() ?? cached?.manager.liaManagedRootPids()[0],
    phase: () => manager().state().phase,
    stop: async options => await manager().stop(options),
  })

  return service
}
