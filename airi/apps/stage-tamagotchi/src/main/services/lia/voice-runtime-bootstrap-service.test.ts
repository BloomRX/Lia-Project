/**
 * Round-7 hotfix 4, item E: the bridge registers even when the runtime root
 * cannot resolve, and the renderer's invoke still reaches main.
 *
 * The bug this guards looked like this on the QA machine: the renderer
 * printed install-click / install-handler-enter / install-invoke and then
 * silence, while main logged `Error: Failed to get 'localAppData' path` with
 * `registerLiaBootstrapBridge` in the stack. Bridge registration used to
 * resolve the root eagerly (the persisted-state store needed a directory),
 * so a root that throws took the IPC handlers down with it - every invoke
 * after that went to a handler that did not exist.
 *
 * The contract now: registration touches NO filesystem; resolving the root is
 * lazy and happens where the action needs it. A root that cannot resolve is
 * then a structured bootstrap failure (phase 'failed', the familiar five
 * pending steps) answered to the waiting renderer - after the
 * `[LIA-VOICE-IPC] install-main-received` trace line, never before it.
 *
 * The mutation check: resolve the root inside registerLiaBootstrapBridge's
 * body again and the registration step of this suite throws before any
 * assertion gets a chance - which is the verdict the check must give.
 */
import type { LiaBootstrapState } from '../../../shared/lia-voice'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  electronLiaBootstrapChanged,
  electronLiaBootstrapRun,
  electronLiaBootstrapState,
} from '../../../shared/eventa'

vi.mock('electron', () => ({
  app: {
    // Registration must not consult any of these either; getPath answers are
    // only meaningful inside Electron proper.
    getPath: (_name: string) => '/tmp/lia-hotfix4',
  },
}))

const ROOT_ERROR = new Error('Failed to resolve the local runtime root (test)')

vi.mock('./voice-runtime-bootstrap-electron', async (importOriginal) => {
  const original = await importOriginal<typeof import('./voice-runtime-bootstrap-electron')>()
  return {
    ...original,
    // The machine fault the QA showed us, injected at the exact seam it
    // happened on: everything the bridge asks for a root now throws.
    runtimeAppDir: () => { throw ROOT_ERROR },
    runtimeRootDir: () => { throw ROOT_ERROR },
  }
})

/** One in-memory IPC pair, the same construction the click-flow suite uses. */
function makeTransport() {
  type Listener = (...args: unknown[]) => void
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

const fakeRuntimeControl = {
  clientConfig: () => ({ baseUrl: 'http://127.0.0.1:7851', timeoutMs: 1500 }),
  start: async () => ({ state: 'starting' }),
  state: () => ({ state: 'notInstalled' }),
  stop: async () => undefined,
}

describe('bridge registration survives an unresolvable runtime root (item E)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('registers every handler, then lets the renderer\'s install invoke reach main', async () => {
    // 1-3. registerLiaBootstrapBridge() does NOT throw even though touching
    // the root would, and the handlers exist.
    const { registerLiaBootstrapBridge } = await import('./voice-runtime-bootstrap-service')
    const transport = makeTransport()
    const { context: mainContext } = createMainContext(transport.ipcMain as never, transport.window as never)
    const published: LiaBootstrapState[] = []
    mainContext.on(electronLiaBootstrapChanged, (event) => {
      if (event.body)
        published.push(event.body)
    })

    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    let service: ReturnType<typeof registerLiaBootstrapBridge> | undefined
    expect(() => {
      service = registerLiaBootstrapBridge({ context: mainContext, runtime: fakeRuntimeControl })
    }).not.toThrow()
    expect(service).toBeDefined()

    // 4. The invoke actually crosses to main - a real round trip through the
    // eventa adapters, not a direct function call.
    const { context: rendererContext } = createRendererContext(transport.ipcRenderer as never)
    const runInstall = defineInvoke(rendererContext, electronLiaBootstrapRun)
    const result = await runInstall(false)

    // The handler's trace line printed before any heavy or failing work, so
    // on the wire's other side the click is provably heard (item D).
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-IPC] install-main-received', false)

    // 5. The answer is the structured failed state: phase failed, the five
    // steps the card draws, all pending, no invented detail.
    expect(result?.phase).toBe('failed')
    expect(result?.failureCategory).toBe('setup')
    expect(typeof result?.message).toBe('string')
    expect(result?.steps.map(step => `${step.id}:${step.status}`)).toEqual([
      'check-environment:pending',
      'fetch-source:pending',
      'run-setup:pending',
      'configure-engine:pending',
      'verify-install:pending',
      'verify-health:pending',
    ])

    // And it was published to the renderer through the ordinary channel too.
    expect(published.some(state => state.phase === 'failed')).toBe(true)

    consoleInfo.mockRestore()
  })

  it('answers not-installed for a plain state read while the root is broken (the card still mounts)', async () => {
    const { registerLiaBootstrapBridge } = await import('./voice-runtime-bootstrap-service')
    const transport = makeTransport()
    const { context: mainContext } = createMainContext(transport.ipcMain as never, transport.window as never)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registerLiaBootstrapBridge({ context: mainContext, runtime: fakeRuntimeControl })

    const { context: rendererContext } = createRendererContext(transport.ipcRenderer as never)
    const readState = defineInvoke(rendererContext, electronLiaBootstrapState)
    const state = await readState()
    expect(state?.phase).toBe('not-installed')
  }, 15000)

  it('keeps the same failure shape when the run is a repair', async () => {
    const { registerLiaBootstrapBridge } = await import('./voice-runtime-bootstrap-service')
    const transport = makeTransport()
    const { context: mainContext } = createMainContext(transport.ipcMain as never, transport.window as never)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    registerLiaBootstrapBridge({ context: mainContext, runtime: fakeRuntimeControl })

    const { context: rendererContext } = createRendererContext(transport.ipcRenderer as never)
    const runRepair = defineInvoke(rendererContext, electronLiaBootstrapRun)
    const result = await runRepair(true)

    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-IPC] install-main-received', true)
    expect(result?.phase).toBe('failed')

    consoleInfo.mockRestore()
  })
})
