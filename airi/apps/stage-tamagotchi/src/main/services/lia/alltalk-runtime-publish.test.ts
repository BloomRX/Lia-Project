/**
 * Phase 6 hotfix, item A/C, main half: the state-publish wiring.
 *
 * The QA evidence this suite guards: main printed `runtime.health-ready`
 * ~75 s after spawn, and the card kept saying "Iniciando o sistema de voz…"
 * for minutes. The renderer's runtime state was pull-only - read once at
 * mount - so a transition that happened after the read had nowhere to go.
 *
 * The chain this file proves at its main-process link:
 *
 *   manager transition event (onEvent, the same hook the log uses)
 *     -> publishRuntimeState: snapshot -> toRendererState -> dedupe
 *     -> [LIA-VOICE-RUNTIME] runtime.state-published status=...
 *     -> context.emit(electronLiaRuntimeChanged)
 *     -> an actual renderer subscriber on the other end of the wire
 *
 * The manager itself is faked at its creation seam so a transition can be
 * fired by hand; everything behind it - the eventa main adapter, the
 * in-memory IPC pair, the renderer adapter - is the real production path.
 * The manager's own correctness (which event fires on which transition) is
 * the alltalk-runtime.test.ts suite; a regression that stops firing
 * publishRuntimeState from onEvent fails the first assertion here.
 */
import type { LiaRuntimeState } from '../../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronLiaRuntimeChanged, electronLiaRuntimeState } from '../../../shared/eventa'

const { captured, snapshot } = vi.hoisted(() => ({
  /** The onEvent hook the service hands the manager, captured at creation. */
  captured: { current: undefined as undefined | ((event: string, detail?: string) => void) },
  /** What the fake manager answers when the publisher re-reads its state. */
  snapshot: { current: { phase: 'stopped', message: undefined as string | undefined } },
}))

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => '/tmp/lia-runtime-publish',
    on: (_event: string, _listener: (...args: unknown[]) => void) => undefined,
  },
  BrowserWindow: class {},
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}))

vi.mock('./voice-runtime-bootstrap-electron', async (importOriginal) => {
  const original = await importOriginal<typeof import('./voice-runtime-bootstrap-electron')>()
  return { ...original, runtimeAppDir: () => '/tmp/lia-runtime-publish' }
})

vi.mock('./alltalk-runtime', async (importOriginal) => {
  const original = await importOriginal<typeof import('./alltalk-runtime')>()
  return {
    ...original,
    createRuntimeManager: (deps: { onEvent?: (event: string, detail?: string) => void }) => {
      captured.current = deps.onEvent
      return {
        enterShutdown: () => undefined,
        isInstalled: async () => true,
        ownedChildPid: () => undefined,
        start: async () => snapshot.current,
        state: () => snapshot.current,
        stop: async () => undefined,
      }
    },
  }
})

type Listener = (...args: unknown[]) => void

/** One in-memory IPC pair, the same construction the bridge suites use. */
function makeTransport() {
  const mainListeners = new Map<string, Listener[]>()
  const rendererListeners = new Map<string, Listener[]>()
  const add = (map: Map<string, Listener[]>) => (channel: string, listener: Listener) => {
    map.set(channel, [...(map.get(channel) ?? []), listener])
  }
  const remove = (map: Map<string, Listener[]>) => (channel: string, listener: Listener) => {
    map.set(channel, (map.get(channel) ?? []).filter(l => l !== listener))
  }
  const deliver = (map: Map<string, Listener[]>) => (channel: string, ...args: unknown[]) => {
    for (const listener of map.get(channel) ?? [])
      listener({}, ...args)
  }
  const sender = { isDestroyed: () => false, send: deliver(rendererListeners) }
  return {
    ipcMain: { off: remove(mainListeners), on: add(mainListeners) },
    ipcRenderer: {
      on: add(rendererListeners),
      removeListener: remove(rendererListeners),
      send: (channel: string, ...args: unknown[]) => {
        for (const listener of mainListeners.get(channel) ?? [])
          listener(sender, ...args)
      },
    },
    window: { isDestroyed: () => false, webContents: { id: 1, send: deliver(rendererListeners) } },
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++)
    await new Promise(resolve => setTimeout(resolve, 0))
}

describe('runtime state publish (Phase 6 hotfix, item A): the ready event can no longer die in main', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    captured.current = undefined
    snapshot.current = { message: undefined, phase: 'stopped' }
  })

  async function bridge() {
    const { registerLiaRuntimeBridge } = await import('./alltalk-runtime-service')
    const transport = makeTransport()
    const { context: mainContext } = createMainContext(transport.ipcMain as never, transport.window as never)
    registerLiaRuntimeBridge({
      context: mainContext,
      liaProductConfig: { get: () => undefined, update: () => undefined },
    })

    // A real renderer adapter at the other end of the real channel - the
    // subscribers the QA boot never heard from.
    const { context: rendererContext } = createRendererContext(transport.ipcRenderer as never)
    const received: LiaRuntimeState[] = []
    rendererContext.on(electronLiaRuntimeChanged, (event) => {
      if (event.body)
        received.push(event.body)
    })

    // The manager is built lazily on first use - one ordinary pull of the
    // state constructs it, exactly what a real boot's mount would do.
    const readState = defineInvoke(rendererContext, electronLiaRuntimeState)
    await readState()
    return { received }
  }

  it('a spawn-fired transition publishes starting, and the 75 s health-ready publishes ready - across the wire', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { received } = await bridge()

    expect(captured.current).toBeDefined()

    // Boot: the start path fires events; each one mirrors the snapshot.
    snapshot.current = { message: undefined, phase: 'starting' }
    captured.current!('runtime.spawn-requested', 'source=autostart')
    await flush()
    expect(received).toEqual([{ state: 'starting' }])
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-RUNTIME] runtime.state-published', 'status=starting', 'trigger=runtime.spawn-requested')

    // The QA moment: ~75 s later. Before the hotfix this is exactly where
    // the chain ended - an on-screen "Iniciando…" forever.
    snapshot.current = { message: undefined, phase: 'ready' }
    captured.current!('runtime.health-ready')
    await flush()
    expect(received).toEqual([{ state: 'starting' }, { state: 'ready' }])
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-RUNTIME] runtime.state-published', 'status=ready', 'trigger=runtime.health-ready')
  })

  it('publishes failures with their message, and dedupes a state that did not move', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { received } = await bridge()

    snapshot.current = { message: 'The voice system exited during startup.', phase: 'error' }
    captured.current!('runtime.start-failed', 'exited-during-startup')
    await flush()
    expect(received).toEqual([{ message: 'The voice system exited during startup.', state: 'error' }])

    // The same machine says the same thing again: no IPC spam either way.
    captured.current!('runtime.start-failed', 'exited-during-startup')
    await flush()
    expect(received).toHaveLength(1)
  })

  it('mutation guard: a regression that stops re-reading the snapshot publishes yesterday\'s state', async () => {
    // If publishRuntimeState ever went back to deriving the answer from the
    // trigger event instead of asking the manager, this ordering flips it:
    // the snapshot changes but the event is the same one as before.
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { received } = await bridge()

    snapshot.current = { message: undefined, phase: 'starting' }
    captured.current!('runtime.classified', 'health=down occupancy=free')
    await flush()
    expect(received).toEqual([{ state: 'starting' }])

    snapshot.current = { message: undefined, phase: 'ready' }
    captured.current!('runtime.classified', 'health=down occupancy=free')
    await flush()
    expect(received).toEqual([{ state: 'starting' }, { state: 'ready' }])
  })
})
