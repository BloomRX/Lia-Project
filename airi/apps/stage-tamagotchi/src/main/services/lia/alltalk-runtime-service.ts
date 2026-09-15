import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaRuntimeInstallStep, LiaRuntimeState } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia-schema'
import type { RuntimeManager } from './alltalk-runtime'

import process from 'node:process'

import { execFile, execFileSync } from 'node:child_process'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow, dialog } from 'electron'

import {
  electronLiaRuntimeInstallDirPick,
  electronLiaRuntimeInstallSteps,
  electronLiaRuntimeStart,
  electronLiaRuntimeState,
  electronLiaRuntimeStop,
} from '../../../shared/eventa'
import { CUSTOM_VOICE_PROVIDER_ID } from '../../../shared/lia-voice'
import { defaultLiaProductConfig } from '../../configs/lia-schema'
import { createAllTalkClient } from './alltalk-client'
import { gatherPortOwners } from './alltalk-port-diagnostics'
import { loopbackHostFor, probeTcpListeners } from './alltalk-port-listeners'
import { createRuntimeManager, taskkillArgs } from './alltalk-runtime'
import { mergeAllTalkRuntime, resolveAllTalkRuntime } from './alltalk-runtime-config'
import { buildInstallSteps, mayAutostartRuntime } from './alltalk-runtime-install'
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
      onEvent: (event, detail) => runtimeLog(event, detail),
      onOutput: line => console.info('[lia-runtime]', new Date().toISOString(), line.trimEnd()),
      /**
       * Windows QA instrumentation: when anything is found on the port, name
       * it. Runs before every occupied-port decision and after a contested
       * stop; it gathers and logs, and kills nothing.
       */
      portOwnerDiagnostics: async () => {
        await gatherPortOwners({
          exec: execCapture,
          installDir,
          log: line => runtimeLog(line),
          platform: process.platform,
          ports: runtimePorts(readRuntime().baseUrl),
        })
      },
    })
    cached = { dir: installDir, manager: built }
    return built
  }

  async function startRuntime(source = 'unknown'): Promise<LiaRuntimeState> {
    const result = await manager().start({ source })
    return toRendererState(result.phase, result.message)
  }

  async function stopRuntime(): Promise<LiaRuntimeState> {
    await manager().stop()
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
    isOwnedInstance: () => manager().state().phase === 'ready' && manager().state().owned !== false,
    state: () => toRendererState(manager().state().phase),
    start: async (options = {}) => await startRuntime(options.source ?? 'unknown'),
    stop: async () => {
      await manager().stop()
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
   * The lifecycle contract (hotfix brief): everything the Lia started dies
   * with the Lia. Ordered: declare shutdown (no new starts, ever) → stop the
   * owned child gracefully (SIGTERM → grace → taskkill /T /F tree kill →
   * SIGKILL) → confirm 7851/7852 answer nobody → only then let the main
   * process exit. `before-quit` rather than `window-all-closed`, so it also
   * fires on a quit with windows still open, and `window-all-closed` itself
   * ends here through the default `app.quit()`.
   */
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting)
      return
    quitting = true

    const mgr = manager()
    mgr.enterShutdown()

    const phase = mgr.state().phase
    if (phase !== 'ready' && phase !== 'starting' && phase !== 'error') {
      runtimeLog('runtime.shutdown-nothing-to-stop', `phase=${phase}`)
      return
    }

    event.preventDefault()
    runtimeLog('runtime.shutdown-begin', `phase=${phase}`)
    void mgr.stop({ confirmFreeMs: SHUTDOWN_CONFIRM_FREE_MS })
      .catch((error: unknown) => {
        runtimeLog('runtime.shutdown-stop-error', error instanceof Error ? error.name : 'unknown')
      })
      .finally(() => {
        runtimeLog('runtime.shutdown-finished')
        app.exit(0)
      })
  })

  /**
   * Crash/exit path: `before-quit` never runs when the main process dies via
   * signal or unrecoverable error, so the synchronous best-effort kill runs
   * here instead. Windows only, owned root PID only, taskkill /T tree kill -
   * the same safety contract as the graceful path, just without await.
   */
  process.on('exit', () => {
    const pid = cached?.manager.ownedChildPid()
    if (pid === undefined)
      return
    runtimeLog('runtime.exit-sync-kill', `pid=${pid}`)
    killOwnedTreeSync(pid)
  })

  return service
}
