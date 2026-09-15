import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaRuntimeInstallStep, LiaRuntimeState } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia-schema'
import type { RuntimeManager, RuntimeProbeIdentity } from './alltalk-runtime'

import { execFile } from 'node:child_process'

import { defineInvokeHandler } from '@moeru/eventa'
import { app, BrowserWindow, dialog } from 'electron'

import {
  electronLiaRuntimeInstallDirPick,
  electronLiaRuntimeInstallSteps,
  electronLiaRuntimeStart,
  electronLiaRuntimeState,
  electronLiaRuntimeStop,
} from '../../../shared/eventa'
import { defaultLiaProductConfig } from '../../configs/lia-schema'
import { createAllTalkClient } from './alltalk-client'
import { createRuntimeManager } from './alltalk-runtime'
import { mergeAllTalkRuntime, resolveAllTalkRuntime } from './alltalk-runtime-config'
import { buildInstallSteps, mayAutostartRuntime } from './alltalk-runtime-install'
import { runtimeAppDir } from './voice-runtime-bootstrap-electron'

type MainContext = ReturnType<typeof createContext>['context']

export interface LiaRuntimeService {
  /** Current state, without starting anything. */
  state: () => LiaRuntimeState
  /** Starts the runtime if it is installed and not already running. */
  start: () => Promise<LiaRuntimeState>
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
       * Who is on the port, in three words the supervisor acts on (items B/D
       * of the hotfix brief): an AllTalk-shaped answer means reuse, a
       * non-answer (connection refused) means free, anything else - a
       * refusal to speak AllTalk - means a stranger holds the port and must
       * not be killed.
       */
      probeIdentity: async (): Promise<RuntimeProbeIdentity> => {
        try {
          const probe = await createAllTalkClient(runtime).status()
          return probe.ok ? 'alltalk' : 'unknown'
        }
        catch (error) {
          const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined
          const code = cause?.code ?? (error as { code?: string } | undefined)?.code
          return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' ? 'none' : 'unknown'
        }
      },
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
      onEvent: (event, detail) => console.info('[LIA-VOICE-RUNTIME]', event, detail ?? ''),
      onOutput: line => console.info('[lia-runtime]', line.trimEnd()),
    })
    cached = { dir: installDir, manager: built }
    return built
  }

  async function startRuntime(): Promise<LiaRuntimeState> {
    const result = await manager().start()
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

  defineInvokeHandler(context, electronLiaRuntimeStart, async (): Promise<LiaRuntimeState> => startRuntime())

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
    isOwnedInstance: () => manager().state().phase === 'ready' && manager().state().owned !== false,
    state: () => toRendererState(manager().state().phase),
    start: startRuntime,
    stop: async () => {
      await manager().stop()
    },
    async autostartIfNeeded(options: { installing?: boolean } = {}) {
      // Both conditions must hold: that this voice needs the runtime at all, and
      // that now is a safe moment. Starting a server whose files are still being
      // written would report a failure the user did nothing to cause.
      if (!mayAutostartRuntime(liaProductConfig.get()?.voice?.tts?.preferred, options))
        return null

      const installed = await manager().isInstalled()
      if (!installed) {
        // Not an error: the UI offers the guided install instead.
        return { state: 'notInstalled' }
      }

      return startRuntime()
    },
  }

  // Never leave the server running after the app closes. `before-quit` rather
  // than `window-all-closed`, so it also fires on a quit with windows still open.
  app.on('before-quit', (event) => {
    if (manager().state().phase !== 'ready')
      return

    event.preventDefault()
    void service.stop().finally(() => app.exit(0))
  })

  return service
}
