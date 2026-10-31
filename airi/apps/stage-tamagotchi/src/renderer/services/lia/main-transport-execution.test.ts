import type { TransportStartResult } from '../../../shared/eventa/lia-transport-execution'

import { setImmediate } from 'node:timers/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMainTransportExecution } from './main-transport-execution'

const ipc = vi.hoisted(() => ({ start: vi.fn(), pull: vi.fn(), cancel: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent: { id: string } }) => {
    const id = event.receiveEvent.id
    if (id.includes(':start-'))
      return ipc.start
    if (id.includes(':pull-'))
      return ipc.pull
    return ipc.cancel
  },
}))

const config = { providerId: 'service-a', baseUrl: 'https://fixture.invalid/v1/' }
const body = { model: 'chosen-model', messages: [{ role: 'user', content: 'synthetic' }] }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  ipc.start.mockResolvedValue({ ok: true, id: 'job' })
  ipc.cancel.mockResolvedValue(true)
  ipc.pull.mockImplementation(async ({ action }: { action: string }) => action === 'head'
    ? { ok: true, status: 200, contentType: 'text/plain' }
    : { ok: true, bytes: [79, 75], done: true })
})

describe('main transport execution disposal regression', () => {
  it('handles start IPC rejection after dispose without continuation or unhandled rejection', async () => {
    const start = deferred<TransportStartResult>()
    ipc.start.mockReturnValue(start.promise)
    const signal = new AbortController()
    const removeListener = vi.spyOn(signal.signal, 'removeEventListener')
    const port = createMainTransportExecution()
    const pending = port.dispatch(config, body, signal.signal)
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    port.dispose()
    await outcome
    start.reject(new Error('synthetic IPC failure'))
    // Give the host a turn to report any unhandled rejection to Vitest.
    await setImmediate()
    expect(ipc.pull).not.toHaveBeenCalled()
    expect(ipc.cancel).not.toHaveBeenCalled()
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    removeListener.mockRestore()
  })

  it('handles a failed start result after dispose without an ID to cancel', async () => {
    const start = deferred<TransportStartResult>()
    ipc.start.mockReturnValue(start.promise)
    const port = createMainTransportExecution()
    const pending = port.dispatch(config, body)
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    port.dispose()
    await outcome
    start.resolve({ ok: false, code: 'configuration' })
    await setImmediate()
    expect(ipc.pull).not.toHaveBeenCalled()
    expect(ipc.cancel).not.toHaveBeenCalled()
  })

  it('discards buffered bytes of an unfinished response when disposed before consumption', async () => {
    ipc.pull.mockImplementation(async ({ action }: { action: string }) => action === 'head'
      ? { ok: true, status: 200 }
      : { ok: true, bytes: [79, 75], done: false })
    const port = createMainTransportExecution()
    const response = await port.dispatch(config, body)
    await vi.waitFor(() => expect(ipc.pull).toHaveBeenCalledWith({ id: 'job', action: 'read' }))
    await setImmediate()
    port.dispose()
    const reader = response.body!.getReader()
    await expect(reader.read()).rejects.toMatchObject({ code: 'cancelled' })
    reader.releaseLock()
    expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'job' })
  })

  it('cancels a late start once without pulling or returning a response after dispose', async () => {
    const start = deferred<TransportStartResult>()
    ipc.start.mockReturnValue(start.promise)
    const port = createMainTransportExecution()
    const pending = port.dispatch(config, body)
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    port.dispose()
    start.resolve({ ok: true, id: 'late-job' })
    await outcome
    expect(ipc.pull).not.toHaveBeenCalled()
    expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'late-job' })
    port.dispose()
    expect(ipc.cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects promptly while start is still pending and cancels when its id arrives', async () => {
    const start = deferred<TransportStartResult>()
    ipc.start.mockReturnValue(start.promise)
    const port = createMainTransportExecution()
    const pending = port.dispatch(config, body)
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    port.dispose()
    await outcome
    expect(ipc.cancel).not.toHaveBeenCalled()
    start.resolve({ ok: true, id: 'late-job' })
    await vi.waitFor(() => expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'late-job' }))
    expect(ipc.pull).not.toHaveBeenCalled()
  })

  it('rejects new executions after dispose without IPC', async () => {
    const port = createMainTransportExecution()
    port.dispose()
    await expect(port.dispatch(config, body)).rejects.toMatchObject({ code: 'cancelled' })
    expect(ipc.start).not.toHaveBeenCalled()
    expect(ipc.cancel).not.toHaveBeenCalled()
  })

  it('cancels once after main has started fetching and headers are pending', async () => {
    const head = deferred<unknown>()
    ipc.pull.mockReturnValue(head.promise)
    const port = createMainTransportExecution()
    const signal = new AbortController()
    const pending = port.dispatch(config, body, signal.signal)
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await vi.waitFor(() => expect(ipc.pull).toHaveBeenCalledWith({ id: 'job', action: 'head' }))
    port.dispose()
    signal.abort()
    port.dispose()
    await outcome
    head.resolve({ ok: true, status: 200 })
    expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'job' })
    expect(ipc.pull).toHaveBeenCalledTimes(1)
  })

  it('cancels once while a response body read is pending', async () => {
    const read = deferred<unknown>()
    ipc.pull.mockImplementation(async ({ action }: { action: string }) => action === 'head'
      ? { ok: true, status: 200 }
      : read.promise)
    const port = createMainTransportExecution()
    const response = await port.dispatch(config, body)
    const outcome = expect(response.text()).rejects.toMatchObject({ code: 'cancelled' })
    port.dispose()
    await outcome
    port.dispose()
    expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'job' })
  })

  it('preserves other concurrent providers and separate port lifetimes', async () => {
    const start = deferred<TransportStartResult>()
    ipc.start.mockReturnValueOnce(start.promise)
    const port = createMainTransportExecution()
    const pending = port.dispatch(config, body)
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    port.dispose(config.providerId)
    start.resolve({ ok: true, id: 'removed-job' })
    await outcome
    await expect(port.dispatch(config, body)).rejects.toMatchObject({ code: 'cancelled' })
    expect(await (await port.dispatch({ ...config, providerId: 'service-b' }, body)).text()).toBe('OK')
    expect(await (await createMainTransportExecution().dispatch(config, body)).text()).toBe('OK')
    expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'removed-job' })
  })

  it('cancels a late start once on caller abort followed by dispose', async () => {
    const start = deferred<TransportStartResult>()
    ipc.start.mockReturnValue(start.promise)
    const port = createMainTransportExecution()
    const signal = new AbortController()
    const pending = port.dispatch(config, body, signal.signal)
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    signal.abort()
    port.dispose()
    start.resolve({ ok: true, id: 'late-job' })
    await outcome
    expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ id: 'late-job' })
    expect(ipc.pull).not.toHaveBeenCalled()
  })
})
