import type { ChildProcess } from 'node:child_process'

import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  LiaCustomVoiceEngineState,
  LiaCustomVoicePrepareState,
} from '../../../shared/eventa'
import type { LiaBootstrapState } from '../../../shared/lia-voice'
import type { Bootstrapper } from './voice-runtime-bootstrap'

import { spawn } from 'node:child_process'
import { mkdir as fsMkdir, rm as fsRemove } from 'node:fs/promises'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { app } from 'electron'

import {
  electronLiaBootstrapCancel,
  electronLiaBootstrapChanged,
  electronLiaBootstrapRemove,
  electronLiaBootstrapRun,
  electronLiaBootstrapState,
  electronLiaCustomVoiceCancel,
  electronLiaCustomVoiceChanged,
  electronLiaCustomVoiceEngineState,
  electronLiaCustomVoicePrepare,
} from '../../../shared/eventa'
import { isLiaBootstrapActivePhase } from '../../../shared/lia-voice'
import { createAllTalkClient } from './alltalk-client'
import { CUSTOM_VOICE_PREPARE_LOG_PREFIX, prepareCustomVoiceEngine } from './alltalk-custom-voice-prepare'
import { readCustomVoiceEngineStatus } from './alltalk-engine-config'
import { DEFAULT_START_TIMEOUT_MS } from './alltalk-runtime'
import { restartForEngineChangeIfNeeded } from './custom-voice-engine-restart'
import {
  BOOTSTRAP_STEP_IDS,
  createVoiceRuntimeBootstrapper,
} from './voice-runtime-bootstrap'
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
 * The failure a run reports when it breaks before the state machine even
 * reached a step (round-7 hotfix 4, item C). Uses the same five pending steps
 * the bootstrapper itself starts from, so the card shows the familiar
 * structured picture with its Retry - never an invented checklist.
 */
function bootstrapRunFailureState(detail: string): LiaBootstrapState {
  return {
    failureCategory: 'setup',
    message: `The voice system could not start installing (${detail}).`,
    phase: 'failed',
    steps: BOOTSTRAP_STEP_IDS.map(id => ({ id, status: 'pending' as const })),
  }
}

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
  /**
   * Whether the answering instance is a Lia-owned child (hotfix brief, item F).
   *
   * The engine-switch restart may only stop what the Lia started; a foreign
   * instance makes the switch unclaimable instead. Optional so a leaner
   * control in tests reads as "unknown", the conservative value.
   */
  isOwnedInstance?: () => boolean
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

  /**
   * Lazy on purpose (round-7 hotfix 4, item C): resolving the Windows-local
   * runtime root can throw on a broken profile, and resolving it HERE killed
   * bridge registration with it - the invoke never reached main, which QA
   * could only see as "the click does nothing". Registration must not depend
   * on the filesystem; a failed root becomes a structured bootstrap failure
   * at run time, after the renderer's invoke reached the handler.
   */
  let stateStore: ReturnType<typeof createRuntimeStateStore> | undefined
  const getStateStore = () => (stateStore ??= createRuntimeStateStore(runtimeRootDir()))

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
      readState: async () => getStateStore().read(),
      remove: async path => fsRemove(path, { force: true, recursive: true }),
      rename: async (from, to) => (await import('node:fs/promises')).rename(from, to),
      runtimeDir: runtimeRootDir(),
      startRuntime,
      writeFile: async (path, content) => await import('node:fs/promises').then(({ writeFile }) => writeFile(path, content, 'utf8')),
      writeState: async record => getStateStore().write(record),
    })

    return bootstrapper
  }

  /** Runs and publishes, so the renderer never has to poll. */
  const runAndPublish = async (repair: boolean): Promise<LiaBootstrapState> => {
    try {
      const instance = ensureBootstrapper()
      emit(instance.state())

      // Every transition in between is pushed by the bootstrapper itself through
      // onStateChange; this wrapper only brackets the run with the initial and
      // the final snapshot.
      const final = await instance.run({ repair })
      emit(final)
      return final
    }
    catch (error) {
      // A root that cannot resolve (or any other pre-run failure) is a
      // bootstrap FAILURE, not a dead invoke (round-7 hotfix 4, item C/D):
      // log it with the reserved prefix, publish the ordinary failed state so
      // the card offers Retry, and answer the invoke truthfully. The failure
      // arrives AFTER install-main-received, exactly like any setup error.
      const detail = errorMessageFrom(error) ?? 'bootstrap registration failure'
      logger({ detail, event: 'failed', step: 'bootstrap' })
      const failed = bootstrapRunFailureState(detail)
      emit(failed)
      return failed
    }
  }

  defineInvokeHandler(context, electronLiaBootstrapState, async (): Promise<LiaBootstrapState> => {
    try {
      return ensureBootstrapper().state()
    }
    catch (error) {
      // Same rule as the run path: a broken root is a failing install the
      // card will show as an offer, not an unreadable bridge. The card's own
      // mount diagnostics stay quiet because the idle look is the offer.
      console.warn('[LIA-VOICE-BOOTSTRAP] could not resolve the runtime root for a state read; reporting not-installed', error)
      return { phase: 'not-installed', steps: [] }
    }
  })

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

  /* ------------------------------------------------------------------------
   * Custom voice engine preparation (Phase 6).
   *
   * Separate from the bootstrap on purpose: the base install is automatic and
   * carries no model, while preparing downloads ~2 GB of separately licensed
   * weights - only at an explicit user request, only through the upstream
   * CLI, and verified afterwards by reading the runtime's own config.
   * ------------------------------------------------------------------------ */

  const emitCustomVoice = (state: LiaCustomVoicePrepareState): void => {
    try {
      context.emit(electronLiaCustomVoiceChanged, state)
    }
    catch (error) {
      console.warn(CUSTOM_VOICE_PREPARE_LOG_PREFIX, 'could not notify the renderer', error)
    }
  }

  const customVoiceFs = {
    readFile: async (path: string) => await import('node:fs/promises').then(({ readFile }) => readFile(path, 'utf8').then(content => content, () => undefined)),
    listFiles: async (dir: string) => await import('node:fs/promises').then(({ readdir }) => readdir(dir).then(entries => entries, () => undefined)),
    writeFile: async (path: string, content: string) => await import('node:fs/promises').then(({ writeFile }) => writeFile(path, content, 'utf8')),
  }

  defineInvokeHandler(context, electronLiaCustomVoiceEngineState, async (): Promise<LiaCustomVoiceEngineState> => {
    try {
      const status = await readCustomVoiceEngineStatus(customVoiceFs, runtimeAppDir())
      return {
        engine: status.engine,
        firstRunPending: status.firstRunPending,
        missingModelFiles: status.missingModelFiles.length,
        modelComplete: status.modelComplete,
        ...(status.parseError ? { parseError: status.parseError } : {}),
        ready: status.ready,
      }
    }
    catch (error) {
      // Same rule as the bootstrap state read (hotfix 4): a broken root is a
      // state, not a dead handler. Not-ready is the honest answer.
      console.warn(CUSTOM_VOICE_PREPARE_LOG_PREFIX, 'engine state read failed; reporting not-ready', error)
      return { firstRunPending: false, missingModelFiles: 0, modelComplete: false, ready: false }
    }
  })

  /** Single-flight: two clicks must not start two downloads. */
  let prepareRunning: Promise<LiaCustomVoicePrepareState> | undefined
  /** Set between the cancel invoke and the prepare noticing it. */
  let prepareCancelRequested = false
  /** The download child, so cancel can actually kill it mid-flight. */
  let prepareChild: ChildProcess | undefined

  /**
   * Like `createRuntimeExec()`, but the child is reachable: the same spawn
   * contract (argument array, no shell, no window, buffered output, kill on
   * timeout), plus a handle the cancel invoke can use so "Cancel" is not a
   * lie that only takes effect at the timeout.
   */
  function createCancellableExec() {
    return (command: string, args: string[], options: { cwd: string, timeoutMs: number }): Promise<{ code: number | null, stderr: string, stdout: string }> =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: options.cwd,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        prepareChild = child

        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', chunk => (stdout += String(chunk)))
        child.stderr?.on('data', chunk => (stderr += String(chunk)))

        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          reject(new Error(`timed out after ${options.timeoutMs}ms`))
        }, options.timeoutMs)
        timer.unref?.()

        child.once('error', (error) => {
          clearTimeout(timer)
          prepareChild = undefined
          reject(error)
        })
        child.once('exit', (code) => {
          clearTimeout(timer)
          prepareChild = undefined
          resolve({ code, stderr, stdout })
        })
      })
  }

  defineInvokeHandler(context, electronLiaCustomVoicePrepare, async (): Promise<LiaCustomVoicePrepareState> => {
    if (prepareRunning)
      return prepareRunning

    prepareCancelRequested = false
    let latest: LiaCustomVoicePrepareState = { phase: 'checking' }
    const run = (async (): Promise<LiaCustomVoicePrepareState> => {
      try {
        const result = await prepareCustomVoiceEngine({
          appDir: runtimeAppDir(),
          exec: createCancellableExec(),
          isCancelled: () => prepareCancelRequested,
          log: (entry) => {
            // The brief's [LIA-VOICE-RUNTIME] prefix on every line; the detail
            // is engine names and file counts only, never paths or URLs.
            console.info(CUSTOM_VOICE_PREPARE_LOG_PREFIX, entry.event, entry.detail ?? '')
          },
          onStateChange: (state) => {
            latest = state
            emitCustomVoice(state)
          },
          ...customVoiceFs,
        })

        if (result.ok && result.changed) {
          // Item F of the hotfix brief: a newly prepared engine is not live
          // until a running stale instance has been swapped. Only after that
          // chain does the log deserve 'prepare.finished'.
          const restart = await restartForEngineChangeIfNeeded({
            isHealthy,
            isOwnedInstance: params.runtime.isOwnedInstance?.bind(params.runtime),
            log: (event, detail) => console.info(CUSTOM_VOICE_PREPARE_LOG_PREFIX, event, detail ?? ''),
            runtimeState: () => params.runtime.state().state,
            start: async () => await params.runtime.start() as { state: string },
            stop: async () => await params.runtime.stop(),
          })
          if (!restart.ok) {
            latest = { detail: restart.detail, phase: 'error' }
            emitCustomVoice(latest)
            return latest
          }
        }

        if (result.ok)
          console.info(CUSTOM_VOICE_PREPARE_LOG_PREFIX, 'prepare.finished', '')

        latest = result.ok
          ? { phase: 'ready' }
          : result.error === 'cancelled'
            ? { detail: result.message, phase: 'cancelled' }
            : { detail: result.message, phase: 'error' }
        emitCustomVoice(latest)
        return latest
      }
      finally {
        prepareRunning = undefined
        prepareChild = undefined
        prepareCancelRequested = false
      }
    })()

    prepareRunning = run
    return run
  })

  defineInvokeHandler(context, electronLiaCustomVoiceCancel, async (): Promise<void> => {
    prepareCancelRequested = true
    try {
      prepareChild?.kill('SIGKILL')
    }
    catch {
      // A child that already exited is done; nothing to undo.
    }
    console.info(CUSTOM_VOICE_PREPARE_LOG_PREFIX, 'prepare.cancel-requested', '')
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
