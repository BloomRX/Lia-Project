import type { LiaBootstrapState } from '../../../shared/lia-voice'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The runtime store as the renderer's window into the bootstrap.
 *
 * The round-2 brief puts two requirements on this store and both are pinned
 * here: progress reaches the renderer by *subscription* (the main process
 * pushes every state change; the store used to only learn the final state,
 * which is why clicking Install looked like nothing happened), and the store
 * keeps no parallel copy of the state machine - whatever arrives over IPC is
 * stored verbatim.
 */

const ipc = vi.hoisted(() => ({
  /** Handlers the store registered, by eventa id. */
  handlers: new Map<string, Array<(payload: unknown) => void>>(),
  /** How many times each invoke channel was called, by receiveEvent id. */
  invokes: [] as string[],
  bootstrapRunResult: { current: { phase: 'installing-runtime', steps: [] } as LiaBootstrapState },
  runtimeState: { current: { state: 'ready' } },
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  getElectronEventaContext: () => ({
    on: (event: { id?: string }, handler: (payload: unknown) => void) => {
      const id = event?.id ?? 'unknown'
      const list = ipc.handlers.get(id) ?? []
      list.push(handler)
      ipc.handlers.set(id, list)
      return () => {}
    },
  }),
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const id = invoke?.receiveEvent?.id ?? 'unknown'
    return async (..._args: unknown[]) => {
      ipc.invokes.push(id)
      if (id === 'eventa:invoke:lia:bootstrap:run-receive')
        return ipc.bootstrapRunResult.current
      if (id === 'eventa:invoke:lia:bootstrap:state-receive')
        return { phase: 'not-installed', steps: [] }
      if (id === 'eventa:invoke:lia:runtime:state-receive')
        return ipc.runtimeState.current
      return undefined
    }
  },
}))

/** Delivers a main-process bootstrap event to every registered listener. */
function publish(state: LiaBootstrapState): void {
  // The real adapter delivers the eventa envelope; the payload rides `.body`.
  for (const handler of ipc.handlers.get('eventa:lia:bootstrap:changed') ?? [])
    handler({ body: state })
}

function installingState(): LiaBootstrapState {
  return {
    phase: 'installing-runtime',
    steps: [
      { id: 'check-environment', status: 'done' },
      { id: 'fetch-source', status: 'done' },
      { id: 'run-setup', status: 'running' },
      { id: 'verify-install', status: 'pending' },
      { id: 'verify-health', status: 'pending' },
    ],
  }
}

beforeEach(() => {
  ipc.handlers.clear()
  ipc.invokes.length = 0
  setActivePinia(createPinia())
})

describe('bootstrap state propagation', () => {
  it('subscribes to the published state instead of waiting for the invoke to return', async () => {
    const { useLiaRuntimeStore } = await import('./runtime')
    const store = useLiaRuntimeStore()

    expect(store.bootstrap).toBeUndefined()
    expect(ipc.handlers.get('eventa:lia:bootstrap:changed')?.length).toBeGreaterThan(0)

    publish(installingState())

    // The mid-install state is visible without any invoke resolving: this is
    // what turns "cliquei em Instalar e nada acontece" into live progress.
    expect(store.bootstrap?.phase).toBe('installing-runtime')
  })

  it('stores the published object verbatim - no parallel copy of the state machine', async () => {
    // Reference identity is the assertion that matters: a store that derived,
    // merged or rebuilt the payload would be a second source of truth, and two
    // sources of one fact is exactly how this project has been bitten before.
    const { useLiaRuntimeStore } = await import('./runtime')
    const store = useLiaRuntimeStore()

    const mid = installingState()
    publish(mid)
    expect(store.bootstrap).toBe(mid)

    const terminal: LiaBootstrapState = { phase: 'ready', steps: mid.steps, version: 'f16117e95b54' }
    publish(terminal)
    expect(store.bootstrap).toBe(terminal)
  })

  it('keeps the latest published state across navigation-shaped re-renders', async () => {
    const { useLiaRuntimeStore } = await import('./runtime')
    const store = useLiaRuntimeStore()

    publish(installingState())
    publish({ ...installingState(), phase: 'verifying' })

    expect(store.bootstrap?.phase).toBe('verifying')
  })
})

describe('the no-concurrent-installs guarantee, on the renderer side', () => {
  it('reports busy from the real state machine phases', async () => {
    const { useLiaRuntimeStore } = await import('./runtime')
    const store = useLiaRuntimeStore()

    expect(store.isInstalling).toBe(false)

    publish(installingState())
    expect(store.isInstalling).toBe(true)

    publish({ phase: 'ready', steps: [] })
    expect(store.isInstalling).toBe(false)
  })

  it('makes a second run request a no-op while one is in flight', async () => {
    const { useLiaRuntimeStore } = await import('./runtime')
    const store = useLiaRuntimeStore()

    publish(installingState())
    await store.runBootstrap()

    // The main process would collapse this into the same run anyway; the store
    // refusing first is what stops even the request from being made.
    expect(ipc.invokes.filter(id => id === 'eventa:invoke:lia:bootstrap:run-receive')).toHaveLength(0)
  })

  it('lets a fresh run through once the state machine is idle', async () => {
    const { useLiaRuntimeStore } = await import('./runtime')
    const store = useLiaRuntimeStore()

    await store.runBootstrap()

    expect(ipc.invokes.filter(id => id === 'eventa:invoke:lia:bootstrap:run-receive')).toHaveLength(1)
  })
})
