import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMainTranscription, transcribeThroughMain } from './main-transcription'

const ipc = vi.hoisted(() => ({ run: vi.fn(), cancel: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent: { id: string } }) =>
    event.receiveEvent.id.includes(':cancel-') ? ipc.cancel : ipc.run,
}))

function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const request = { providerId: 'configured', model: 'selected', bytes: new Uint8Array([1]), fileName: 'a.wav', mimeType: 'audio/wav' }

beforeEach(() => {
  vi.resetAllMocks()
  ipc.cancel.mockResolvedValue({ ok: true })
})

describe('main transcription cancellation', () => {
  it('rejects oversized audio before reading or dispatching its bytes', async () => {
    const file = new File(['a'], 'a.wav', { type: 'audio/wav' })
    Object.defineProperty(file, 'size', { value: 24 * 1024 * 1024 + 1 })
    const read = vi.spyOn(file, 'arrayBuffer')
    const run = vi.fn()
    await expect(transcribeThroughMain({ run }, 'configured', { ...request, file })).rejects.toThrow('configuration')
    expect(read).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })
  it('does not dispatch a cancelled request or a new request after dispose', async () => {
    const port = createMainTranscription()
    const controller = new AbortController()
    controller.abort()
    expect(await port.run(request, controller.signal)).toEqual({ ok: false, code: 'cancelled' })
    port.dispose?.()
    expect(await port.run(request)).toEqual({ ok: false, code: 'cancelled' })
    expect(ipc.run).not.toHaveBeenCalled()
    expect(ipc.cancel).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('disposes pending IPC, handles its late %s and cancels exactly once', async (settlement) => {
    const late = pending<any>()
    ipc.run.mockReturnValue(late.promise)
    const port = createMainTranscription()
    const controller = new AbortController()
    const result = port.run(request, controller.signal)
    port.dispose?.()
    controller.abort()
    port.dispose?.()
    expect(await result).toEqual({ ok: false, code: 'cancelled' })
    late[settlement](settlement === 'resolve' ? { ok: true, text: 'late', status: 200 } : new Error('late'))
    await Promise.resolve()
    expect(ipc.cancel).toHaveBeenCalledExactlyOnceWith({ requestId: ipc.run.mock.calls[0][0].requestId })
  })

  it('isolates concurrent operations and ignores late text after abort', async () => {
    const first = pending<any>()
    ipc.run.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ok: true, text: 'current', status: 200 })
    const port = createMainTranscription()
    const controller = new AbortController()
    const old = port.run(request, controller.signal)
    const current = port.run(request)
    controller.abort()
    expect(await old).toEqual({ ok: false, code: 'cancelled' })
    expect(await current).toMatchObject({ text: 'current' })
    first.resolve({ ok: true, text: 'stale', status: 200 })
    await Promise.resolve()
    expect(ipc.cancel).toHaveBeenCalledTimes(1)
    expect(ipc.run.mock.calls[0][0].requestId).not.toBe(ipc.run.mock.calls[1][0].requestId)
  })

  it('observes rejected cancellation IPC without an unhandled rejection', async () => {
    ipc.run.mockReturnValue(new Promise(() => {}))
    ipc.cancel.mockRejectedValue(new Error('closed context'))
    const port = createMainTranscription()
    const result = port.run(request)
    port.dispose?.()
    expect(await result).toEqual({ ok: false, code: 'cancelled' })
    await Promise.resolve()
  })

  it('does not send audio if cancelled while reading the file', async () => {
    const bytes = pending<ArrayBuffer>()
    const file = new File(['a'], 'a.wav', { type: 'audio/wav' })
    vi.spyOn(file, 'arrayBuffer').mockReturnValue(bytes.promise)
    const controller = new AbortController()
    const port = { run: vi.fn() }
    const result = transcribeThroughMain(port, 'configured', { ...request, providerId: 'configured', file, signal: controller.signal })
    controller.abort()
    bytes.resolve(new ArrayBuffer(1))
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(port.run).not.toHaveBeenCalled()
  })
})
