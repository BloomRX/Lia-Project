/**
 * Phase 6 hotfix round 5, items G/I: every exit the OS lets us see runs the
 * graceful stop exactly once.
 *
 * The QA fact under guard: an AllTalk python tree outlived its Lia by four
 * hours, killed by nothing, because the dev-terminal quit path never reached
 * `before-quit` and no signal handler existed. These tests drive the three
 * trigger families - before-quit, SIGINT, SIGTERM (SIGHUP shares the SIGINT
 * machinery) - through the production module with fake listener registries,
 * so each assertion is about the CONTRACT, not about Electron.
 */
import type { Mock } from 'vitest'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRuntimeShutdown, installRuntimeShutdownHooks } from './runtime-shutdown'

interface Harness {
  fireQuit: (event?: { preventDefault: () => void }) => void
  fireSignal: (signal: string) => void
  fireExit: () => void
  enterShutdown: Mock<() => void>
  killTreeSync: Mock<(pid: number) => void>
  log: Mock<(event: string, detail?: string) => void>
  processEnded: Mock<(code: number) => void>
  signals: Map<string, () => void>
  stop: Mock<(options: { confirmFreeMs: number }) => Promise<void>>
}

function harness(options: { phase?: string, ownedPid?: number } = {}): Harness {
  let quitListener: ((event: { preventDefault: () => void }) => void) | undefined
  let exitListener: (() => void) | undefined
  const signals = new Map<string, () => void>()

  const h: Harness = {
    enterShutdown: vi.fn<() => void>(),
    killTreeSync: vi.fn<(pid: number) => void>(),
    log: vi.fn<(event: string, detail?: string) => void>(),
    processEnded: vi.fn<(code: number) => void>(),
    signals,
    stop: vi.fn<(options: { confirmFreeMs: number }) => Promise<void>>(async () => undefined),
    fireQuit(event = { preventDefault: vi.fn() }) {
      expect(quitListener, 'a before-quit listener must be registered').toBeDefined()
      quitListener!(event)
    },
    fireSignal(signal: string) {
      const listener = signals.get(signal)
      expect(listener, `a ${signal} listener must be registered`).toBeDefined()
      listener!()
    },
    fireExit() {
      expect(exitListener).toBeDefined()
      exitListener!()
    },
  }

  installRuntimeShutdownHooks({
    confirmFreeMs: 1,
    endProcess: h.processEnded,
    enterShutdown: h.enterShutdown,
    killTreeSync: h.killTreeSync,
    listeners: {
      beforeQuit: (listener) => { quitListener = listener },
      exit: (listener) => { exitListener = listener },
      signal: (signal, listener) => { signals.set(signal, listener) },
    },
    log: h.log,
    ownedRootPid: () => options.ownedPid,
    phase: () => options.phase ?? 'ready',
    stop: h.stop,
  })
  return h
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++)
    await new Promise(resolve => setTimeout(resolve, 0))
}

describe('runtime shutdown hooks (round-5, item G: the dev quit path)', () => {
  it('before-quit: declares shutdown, stops once with port confirmation, then lets the app exit with 0', async () => {
    const h = harness({ phase: 'ready' })
    const preventDefault = vi.fn()
    h.fireQuit({ preventDefault })

    // preventDefault is synchronous - the whole point is we intercept the
    // quit before Electron gets to it.
    expect(preventDefault).toHaveBeenCalledTimes(1)
    await settle()

    expect(h.enterShutdown).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledWith({ confirmFreeMs: 1 })
    expect(h.processEnded).toHaveBeenCalledWith(0)
    expect(h.log).toHaveBeenCalledWith('runtime.shutdown-begin', 'trigger=before-quit')
    expect(h.log).toHaveBeenCalledWith('runtime.shutdown-finished', 'trigger=before-quit')
  })

  it('ctrl+C (SIGINT) runs the same graceful stop, and leaves with 130', async () => {
    const h = harness({ phase: 'ready' })
    h.fireSignal('SIGINT')
    await settle()

    expect(h.enterShutdown).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.processEnded).toHaveBeenCalledWith(130)
    expect(h.log).toHaveBeenCalledWith('runtime.shutdown-signal', 'signal=SIGINT')
  })

  it('the SIGTERM kill (dev restart, CI timeout) runs the same graceful stop, and leaves with 143', async () => {
    const h = harness({ phase: 'ready' })
    h.fireSignal('SIGTERM')
    await settle()

    expect(h.enterShutdown).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.processEnded).toHaveBeenCalledWith(143)
  })

  it('single-flight: Ctrl+C racing the visible quit - and a repeat signal - is ONE stop, ONE exit', async () => {
    // The QA scenario behind idempotency: the user Ctrl+C's the terminal at
    // the exact moment the Electron window is closing. Two shutdowns racing
    // means two stops of the same child, and a log that lies about who died.
    const h = harness({ phase: 'ready' })
    h.fireQuit()
    h.fireSignal('SIGINT')
    h.fireQuit()
    h.fireSignal('SIGTERM')
    await settle()

    expect(h.enterShutdown).toHaveBeenCalledTimes(1)
    expect(h.stop).toHaveBeenCalledTimes(1)
    expect(h.processEnded).toHaveBeenCalledTimes(1)
    expect(h.processEnded).toHaveBeenCalledWith(0)
  })

  it('nothing to stop: a quiet quit (packaged) confirms no work; a signal leaves immediately with its code', async () => {
    const quiet = harness({ phase: 'stopped' })
    quiet.fireQuit()
    await settle()
    expect(quiet.log).toHaveBeenCalledWith('runtime.shutdown-nothing-to-stop', 'phase=stopped')
    expect(quiet.stop).not.toHaveBeenCalled()

    const signalled = harness({ phase: 'stopped' })
    signalled.fireSignal('SIGINT')
    await settle()
    expect(signalled.stop).not.toHaveBeenCalled()
    expect(signalled.processEnded).toHaveBeenCalledWith(130)
    expect(signalled.log).toHaveBeenCalledWith('runtime.shutdown-signal', 'signal=SIGINT')
  })

  it('the exit-event fallback: the last-resort synchronous kill fires only when an owned root exists', async () => {
    const owned = harness({ phase: 'ready', ownedPid: 17708 })
    owned.fireExit()
    expect(owned.log).toHaveBeenCalledWith('runtime.exit-sync-kill', 'pid=17708')
    expect(owned.killTreeSync).toHaveBeenCalledWith(17708)

    const nobody = harness({ phase: 'ready' })
    nobody.fireExit()
    expect(nobody.killTreeSync).not.toHaveBeenCalled()
  })

  it('mutation guard: shutdown semantics are not optional', async () => {
    // Deleting the SIGINT registration must fail somewhere observable. The
    // holder of that fact is the registry itself: if no listener is
    // captured, fireSignal's expect blows up before anything else can hide.
    const h = harness({ phase: 'ready' })
    expect(h.signals.get('SIGINT')).toBeDefined()
    expect(h.signals.get('SIGTERM')).toBeDefined()
    expect(h.signals.get('SIGHUP')).toBeDefined()
  })
})

describe('single-flight at the semantic core', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('run() executes once and reports who owned it', async () => {
    const stop = vi.fn(async () => new Promise<void>(resolve => setTimeout(resolve, 5)))
    const ended = vi.fn()
    const shutdown = createRuntimeShutdown({
      confirmFreeMs: 1,
      endProcess: ended,
      enterShutdown: () => undefined,
      killTreeSync: () => undefined,
      listeners: { beforeQuit: () => undefined, exit: () => undefined, signal: () => undefined },
      log: () => undefined,
      ownedRootPid: () => undefined,
      phase: () => 'ready',
      stop,
    })

    const [first, second, third] = await Promise.all([
      shutdown.run('before-quit', 0),
      shutdown.run('signal:SIGINT', 130),
      shutdown.run('before-quit', 0),
    ])

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(third).toBe(false)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledWith(0)
  })
})
