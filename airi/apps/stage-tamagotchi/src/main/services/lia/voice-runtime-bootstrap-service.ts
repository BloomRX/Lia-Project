import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaBootstrapState } from '../../../shared/lia-voice'
import type { Bootstrapper } from './voice-runtime-bootstrap'

import { mkdir as fsMkdir, rm as fsRemove } from 'node:fs/promises'

import { defineInvokeHandler } from '@moeru/eventa'
import { app } from 'electron'

import {
  electronLiaBootstrapCancel,
  electronLiaBootstrapChanged,
  electronLiaBootstrapRemove,
  electronLiaBootstrapRun,
  electronLiaBootstrapState,
} from '../../../shared/eventa'
import { isLiaBootstrapActivePhase } from '../../../shared/lia-voice'
import { createAllTalkClient } from './alltalk-client'
import { DEFAULT_START_TIMEOUT_MS } from './alltalk-runtime'
import { createVoiceRuntimeBootstrapper } from './voice-runtime-bootstrap'
import {
  createRuntimeDownload,
  createRuntimeExec,
  createRuntimeExtract,
  createRuntimeLogger,
  createRuntimeProbe,
  createRuntimeStateStore,
  runtimeAppDir,
  runtimeRootDir,
} from './voice-runtime-bootstrap-electron'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * The slice of the runtime service the bootstrapper needs.
 *
 * Depending on this rather than the underlying process manager is deliberate:
 * the service owns the server, and reaching past it would leave two owners for
 * one process - which is how a user ends up with a port conflict they cannot
 * diagnose.
 */
export interface LiaRuntimeControl {
  start: () => Promise<unknown>
  stop: () => Promise<void>
  state: () => { state: string }
  /**
   * Where the server actually listens.
   *
   * Taken from the runtime service rather than hardcoded: a second copy of the
   * address is how the bootstrap ends up health-checking a port the user moved the
   * server off of, and then reporting a failure for a server that is running.
   */
  clientConfig: () => { baseUrl: string, timeoutMs: number }
}

/**
 * Wires the pure bootstrapper to IPC (items M, O, P, U).
 *
 * ## Concurrency (item U)
 *
 * Two guarantees matter here and they come from different places:
 *
 * - *Two clicks, one install.* The bootstrapper itself holds a single in-flight
 *   promise, so a second `run()` returns the first one's result. That is worth
 *   having at this level too, because the renderer disables the button on state
 *   change, and there is a window before that lands.
 * - *Autostart must not race an install.* `isInstalling()` is what the runtime
 *   service checks before starting the server on launch. Without it, opening the
 *   app mid-install would try to start a server whose files are still being
 *   written, and report a failure the user did nothing to cause.
 */
export interface LiaBootstrapService {
  state: () => LiaBootstrapState
  /** True while an install or repair is in flight. */
  isInstalling: () => boolean
  run: (repair?: boolean) => Promise<LiaBootstrapState>
  cancel: () => void
  remove: () => Promise<void>
  bootstrapper: () => Bootstrapper
}

export function registerLiaBootstrapBridge(params: {
  context: MainContext
  runtime: LiaRuntimeControl
}): LiaBootstrapService {
  const { context } = params
  const logger = createRuntimeLogger()
  const store = createRuntimeStateStore(runtimeRootDir())

  /**
   * Emits every state change.
   *
   * Wrapped so a listener that throws cannot abort the install: the renderer
   * being slow or unhappy is not a reason to leave a half-finished runtime.
   */
  const emit = (state: LiaBootstrapState): void => {
    try {
      context.emit(electronLiaBootstrapChanged, state)
    }
    catch (error) {
      logger({ event: 'emit-failed', step: 'bootstrap' })
      console.warn('[LIA-VOICE-BOOTSTRAP] could not notify the renderer', error)
    }
  }

  const isHealthy = async (): Promise<boolean> => {
    try {
      const status = await createAllTalkClient(params.runtime.clientConfig()).status()
      return status.ok
    }
    catch {
      return false
    }
  }

  /**
   * Starts the runtime and waits for it to answer.
   *
   * Delegates to the existing runtime manager rather than spawning a second
   * process: two managers for one server is how a user ends up with a port
   * conflict they cannot diagnose.
   */
  const startRuntime = async (): Promise<boolean> => {
    await params.runtime.start()
    // The manager's own budget, not a second copy of it. Polling for less time
    // than the manager allows would report a timeout for a runtime that is still
    // legitimately starting.
    const deadline = Date.now() + DEFAULT_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (params.runtime.state().state === 'ready')
        return true
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    return false
  }

  let bootstrapper: Bootstrapper | undefined

  /**
   * Builds the bootstrapper once.
   *
   * Cached because the install directory is fixed for the session; rebuilding it
   * per call would mean two objects each holding their own in-flight promise,
   * which is precisely the double-install this is meant to prevent.
   */
  const ensureBootstrapper = (): Bootstrapper => {
    if (bootstrapper)
      return bootstrapper

    bootstrapper = createVoiceRuntimeBootstrapper({
      download: createRuntimeDownload(),
      exec: createRuntimeExec(),
      exists: async path => await import('node:fs/promises').then(({ stat }) => stat(path).then(() => true, () => false)),
      stat: async p => await import('node:fs/promises').then(({ stat }) => stat(p).then(s => ({ size: s.size }), () => undefined)),
      extract: createRuntimeExtract({
        // Diagnostics for a refused entry. Fired once, for the first one only: a
        // 700-entry archive would otherwise emit 700 identical lines and bury the
        // single entry that matters. Paths stay in the log, never in the UI.
        onComplete: info => logger({
          detail: `entries=${info.entries}`,
          elapsedMs: info.elapsedMs,
          event: 'extract-complete',
          step: 'fetch-source',
        }),
        onProgress: info => logger({
          detail: `entries=${info.entries}${info.stripRoot ? ` stripRoot=${info.stripRoot}` : ''}`,
          event: 'extract-start',
          step: 'fetch-source',
        }),
        onReject: report => logger({
          detail: `reason=${report.reason} raw=${report.raw} normalised=${report.normalised} root=${report.rootDir} target=${report.computedTarget ?? 'n/a'}`,
          event: 'entry-rejected',
          step: 'fetch-source',
        }),
      }),
      isHealthy,
      log: entry => logger(entry),
      mkdir: async (path) => {
        await fsMkdir(path, { recursive: true })
      },
      // The bootstrapper reports every state mutation; each one is forwarded to
      // the renderer as-is. This replaces the old 250 ms republication timer,
      // which emitted updates carrying no new information - and looked, from the
      // UI side, exactly like a fake progress driver.
      onStateChange: state => emit(state),
      probe: createRuntimeProbe(),
      readFile: async path => await import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8').then(content => content, () => undefined)),
      readState: async () => store.read(),
      remove: async path => fsRemove(path, { force: true, recursive: true }),
      rename: async (from, to) => (await import('node:fs/promises')).rename(from, to),
      runtimeDir: runtimeRootDir(),
      startRuntime,
      writeFile: async (path, content) => await import('node:fs/promises').then(({ writeFile }) => writeFile(path, content, 'utf8')),
      writeState: store.write,
    })

    return bootstrapper
  }

  /** Runs and publishes, so the renderer never has to poll. */
  const runAndPublish = async (repair: boolean): Promise<LiaBootstrapState> => {
    const instance = ensureBootstrapper()
    emit(instance.state())

    // Every transition in between is pushed by the bootstrapper itself through
    // onStateChange; this wrapper only brackets the run with the initial and
    // the final snapshot.
    const final = await instance.run({ repair })
    emit(final)
    return final
  }

  defineInvokeHandler(context, electronLiaBootstrapState, async (): Promise<LiaBootstrapState> =>
    ensureBootstrapper().state())

  defineInvokeHandler(context, electronLiaBootstrapRun, async (_repair: boolean): Promise<LiaBootstrapState> => {
    // Round-7 hotfix-3 trace: this line is the boundary between "the click
    // reached main" and "the bootstrap never started". The store prints its
    // own line first; the bootstrapper prints the start log after this.
    console.info('[LIA-VOICE-IPC] install-main-received', _repair)
    return runAndPublish(_repair ?? false)
  })

  defineInvokeHandler(context, electronLiaBootstrapCancel, async (): Promise<void> => {
    ensureBootstrapper().cancel()
  })

  defineInvokeHandler(context, electronLiaBootstrapRemove, async (): Promise<void> => {
    // Stop first: deleting files out from under a running server leaves it
    // holding handles and reporting errors for the rest of the session.
    await params.runtime.stop().catch(() => undefined)
    await ensureBootstrapper().remove()
    emit(ensureBootstrapper().state())
  })

  return {
    state: () => ensureBootstrapper().state(),
    isInstalling: () => isLiaBootstrapActivePhase(ensureBootstrapper().state().phase),
    run: async (repair?: boolean) => runAndPublish(repair ?? false),
    cancel: () => ensureBootstrapper().cancel(),
    remove: async () => {
      await params.runtime.stop().catch(() => undefined)
      await ensureBootstrapper().remove()
      emit(ensureBootstrapper().state())
    },
    bootstrapper: ensureBootstrapper,
  }
}

/**
 * Whether a usable install already exists on disk.
 *
 * Used at startup so the app can recognise a previous install without running the
 * whole bootstrap, and so an interrupted install is not mistaken for a working
 * one.
 */
export async function hasUsableInstall(): Promise<boolean> {
  const dir = runtimeAppDir()
  const required = ['script.py', 'start_alltalk.bat', 'alltalk_environment/conda', 'alltalk_environment/env']
  for (const entry of required) {
    try {
      await import('node:fs/promises').then(({ stat }) => stat(`${dir}/${entry}`))
    }
    catch {
      return false
    }
  }
  return true
}

export { app as electronApp, runtimeAppDir, runtimeRootDir }
