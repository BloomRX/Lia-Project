import type { OidcAccountResult } from '../../../shared/eventa/lia-oidc-account'

import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { createAuthService } from './auth'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  loopback: vi.fn(),
  openExternal: vi.fn(),
  logError: vi.fn(),
  logWithError: vi.fn(),
  logWithFields: vi.fn(),
}))

vi.mock('@moeru/eventa', () => ({
  defineInvokeEventa: (event: string) => event,
  defineInvokeHandler: (_context: unknown, event: string, handler: (...args: any[]) => unknown) => fixture.handlers.set(event, handler),
}))
vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => ({ withFields: fixture.logWithFields, withError: fixture.logWithError }) }),
}))
vi.mock('electron', () => ({ shell: { openExternal: fixture.openExternal } }))
vi.mock('@proj-airi/stage-shared/auth', () => ({
  generateCodeChallenge: async () => 'synthetic-challenge',
  generateCodeVerifier: () => 'synthetic-verifier',
  generateState: () => 'synthetic-state',
}))
vi.mock('./http-server/http/auth', () => ({ startLoopbackServer: fixture.loopback }))
vi.mock('../../../shared/eventa', () => ({
  electronAuthCallback: 'success',
  electronAuthCallbackError: 'failure',
  electronAuthCancelled: 'cancelled',
  electronAuthLogout: 'logout',
  electronAuthStartLogin: 'start',
}))

const frames = [1, 2].map(id => Object.assign(new EventEmitter(), { id, mainFrame: {} }))

beforeEach(() => {
  vi.stubEnv('VITE_LIA_ENABLE_OIDC', '1')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  fixture.handlers.clear()
  frames.forEach(frame => frame.removeAllListeners())
})

function ipcFor(id: number) {
  const sender = frames.find(frame => frame.id === id)!
  return { raw: { ipcMainEvent: { sender, senderFrame: sender.mainFrame } } }
}
const ipc = ipcFor(1)

function registerWindow(emit = vi.fn(), id = 1, withOwner = true, account?: { execute: (input: unknown, signal: AbortSignal) => Promise<OidcAccountResult> }) {
  let closed: (() => void) | undefined
  const window = {
    webContents: frames.find(frame => frame.id === id)!,
    isDestroyed: () => false,
    once: (_event: string, listener: () => void) => { closed = listener },
  }
  const owner = {
    beginLogin: vi.fn(() => 'synthetic-revision'),
    establish: vi.fn(async () => true),
    logout: vi.fn(async () => ({ cleared: true, revocation: 'absent' as const })),
  }
  createAuthService({ context: { emit } as never, window: window as never, sessionOwner: withOwner ? owner : undefined, account })
  return { emit, owner, contents: window.webContents, close: () => closed?.() }
}

const accountChannel = 'eventa:invoke:lia:oidc:account'

it('binds account IPC to a Main owner and its own top frame', async () => {
  const execute = vi.fn(async () => ({ ok: true } as const))
  registerWindow(vi.fn(), 1, false, { execute })
  expect(fixture.handlers.has(accountChannel)).toBe(false)
  registerWindow(vi.fn(), 1, true, { execute })
  const invoke = fixture.handlers.get(accountChannel)!
  const operation = { kind: 'get-profile' }
  for (const sender of [ipcFor(2), { raw: { ipcMainEvent: { ...ipc.raw.ipcMainEvent, senderFrame: {} } } }, undefined]) {
    await expect(invoke(operation, sender)).resolves.toEqual({ ok: false, code: 'invalid-request' })
  }
  vi.stubEnv('VITE_LIA_ENABLE_OIDC', '')
  await expect(invoke(operation, ipc)).resolves.toEqual({ ok: false, code: 'unavailable' })
  expect(execute).not.toHaveBeenCalled()
  vi.stubEnv('VITE_LIA_ENABLE_OIDC', '1')
  await expect(invoke(operation, ipc)).resolves.toEqual({ ok: true })
  expect(execute).toHaveBeenCalledWith(operation, expect.any(AbortSignal))
})

it.each(['navigation', 'crash', 'destroyed'])('cancels account requests after %s and discards late results', async (event) => {
  const reply = Promise.withResolvers<OidcAccountResult>()
  const execute = vi.fn((_payload: unknown, _signal: AbortSignal) => reply.promise)
  const { contents } = registerWindow(vi.fn(), 1, true, { execute })
  const invoke = fixture.handlers.get(accountChannel)!
  const pending = invoke({ kind: 'get-profile' }, ipc)
  const signal = execute.mock.calls[0]![1]
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
  expect(signal.aborted).toBe(false)
  if (event === 'navigation')
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
  else
    contents.emit(event === 'crash' ? 'render-process-gone' : 'destroyed')
  expect(signal.aborted).toBe(true)
  reply.resolve({ ok: true, profile: { id: 'old-account', name: '', email: 'old@example.invalid', image: null } })
  await expect(pending).resolves.toEqual({ ok: false, code: 'cancelled' })
})

it('bounds account requests per window and sanitizes exceptions before releasing capacity', async () => {
  const reply = Promise.withResolvers<OidcAccountResult>()
  const execute = vi.fn(() => reply.promise)
  const operation = { kind: 'get-profile' }
  registerWindow(vi.fn(), 1, true, { execute })
  const firstWindow = fixture.handlers.get(accountChannel)!
  registerWindow(vi.fn(), 2, true, { execute })
  const secondWindow = fixture.handlers.get(accountChannel)!

  const pending = Array.from({ length: 8 }, () => firstWindow(operation, ipc))
  await expect(firstWindow(operation, ipc)).resolves.toEqual({ ok: false, code: 'unavailable' })
  expect(execute).toHaveBeenCalledTimes(8)
  pending.push(secondWindow(operation, ipcFor(2)))
  expect(execute).toHaveBeenCalledTimes(9)
  reply.reject(new Error('synthetic-private-credential'))
  expect(await Promise.all(pending)).toEqual(Array.from({ length: 9 }, () => ({ ok: false, code: 'unavailable' })))
  execute.mockResolvedValueOnce({ ok: true })
  await expect(firstWindow(operation, ipc)).resolves.toEqual({ ok: true })
})

function tokenResponse() {
  return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', id_token: 'synthetic-id', expires_in: 3600 })
}

it('rejects login while OIDC is off, before opening a listener or calling the issuer', async () => {
  vi.stubEnv('VITE_LIA_ENABLE_OIDC', '')
  const transport = vi.fn()
  vi.stubGlobal('fetch', transport)
  const { emit } = registerWindow()

  await expect(fixture.handlers.get('start')!(undefined, ipc)).rejects.toThrow('OIDC is disabled')
  expect(fixture.loopback).not.toHaveBeenCalled()
  expect(fixture.openExternal).not.toHaveBeenCalled()
  expect(transport).not.toHaveBeenCalled()
  expect(emit).not.toHaveBeenCalled()
})

it('refuses the legacy opt-in when no Main session owner is registered', async () => {
  registerWindow(vi.fn(), 1, false)
  await expect(fixture.handlers.get('start')!(undefined, ipc)).rejects.toThrow('OIDC is disabled')
  expect(fixture.loopback).not.toHaveBeenCalled()
})

it('ignores login and logout from a subframe or another window', async () => {
  const { owner } = registerWindow()
  const childFrame = { raw: { ipcMainEvent: { ...ipc.raw.ipcMainEvent, senderFrame: {} } } }
  for (const sender of [childFrame, ipcFor(2), undefined]) {
    await fixture.handlers.get('start')!(undefined, sender)
    await fixture.handlers.get('logout')!(undefined, sender)
  }
  expect(owner.beginLogin).not.toHaveBeenCalled()
  expect(owner.logout).not.toHaveBeenCalled()
  expect(fixture.loopback).not.toHaveBeenCalled()
})

it.each(['logout', 'closed'] as const)('discards an exchange result after %s', async (cancel) => {
  const { promise, resolve } = Promise.withResolvers<Response>()
  const started = Promise.withResolvers<void>()
  const transport = vi.fn((_url: URL, _options: RequestInit) => {
    started.resolve()
    return promise
  })
  vi.stubGlobal('fetch', transport)
  fixture.loopback.mockResolvedValue({ port: 12345, result: Promise.resolve({ code: 'synthetic-code' }), close: vi.fn() })
  fixture.openExternal.mockResolvedValue(undefined)
  const { emit, close } = registerWindow()
  await fixture.handlers.get('start')!(undefined, ipc)
  await started.promise
  if (cancel === 'logout')
    await fixture.handlers.get('logout')!(undefined, ipc)
  else
    close()

  const response = tokenResponse()
  const readBody = vi.spyOn(response, 'json')
  resolve(response)
  await new Promise<void>(done => setImmediate(done))

  if (cancel === 'logout')
    expect(emit).toHaveBeenCalledExactlyOnceWith('cancelled', undefined)
  else
    expect(emit).not.toHaveBeenCalled()
  expect(readBody).not.toHaveBeenCalled()
  expect(transport.mock.calls[0]?.[1].signal?.aborted).toBe(true)
})

it('does not read or disclose an external token rejection body', async () => {
  const response = new Response('synthetic-private-response', { status: 401 })
  const readBody = vi.spyOn(response, 'text')
  const transport = vi.fn(async () => response)
  vi.stubGlobal('fetch', transport)
  fixture.loopback.mockResolvedValue({ port: 12345, result: Promise.resolve({ code: 'synthetic-code' }), close: vi.fn() })
  fixture.logWithFields.mockReturnValue({ error: fixture.logError })
  let deliver!: (payload: unknown) => void
  const delivered = new Promise((resolve) => {
    deliver = resolve
  })
  const emit = vi.fn((_event: string, payload: unknown) => deliver(payload))
  registerWindow(emit)
  await fixture.handlers.get('start')!(undefined, ipc)
  await expect(delivered).resolves.toEqual({ error: 'OIDC signing in failed' })
  expect(transport).toHaveBeenCalledOnce()
  expect(readBody).not.toHaveBeenCalled()
  expect(fixture.logWithError).not.toHaveBeenCalled()
  expect(fixture.logWithFields).toHaveBeenCalledExactlyOnceWith({ phase: 'exchange', status: 401 })
  expect(fixture.logError).toHaveBeenCalledExactlyOnceWith('OIDC signing in failed')
  expect(emit).toHaveBeenCalledExactlyOnceWith('failure', { error: 'OIDC signing in failed' })
})

it('closes a loopback created after cancellation and skips opening the browser', async () => {
  const callback = Promise.withResolvers<{ code: string }>()
  const close = vi.fn(() => callback.reject(new Error('synthetic-cancelled')))
  const loopback = Promise.withResolvers<{ port: number, result: typeof callback.promise, close: typeof close }>()
  const waiting = Promise.withResolvers<void>()
  fixture.loopback.mockImplementation(() => {
    waiting.resolve()
    return loopback.promise
  })
  const { emit } = registerWindow()
  const start = fixture.handlers.get('start')!(undefined, ipc)
  await waiting.promise
  await fixture.handlers.get('logout')!(undefined, ipc)
  loopback.resolve({ port: 12345, result: callback.promise, close })
  await start

  expect(close).toHaveBeenCalledOnce()
  expect(fixture.openExternal).not.toHaveBeenCalled()
  expect(emit).toHaveBeenCalledExactlyOnceWith('cancelled', undefined)
})

it('notifies only the original window when another window replaces the login', async () => {
  const original = Promise.withResolvers<{ code: string }>()
  const replacement = Promise.withResolvers<{ code: string }>()
  const closeOriginal = vi.fn(() => original.reject(new Error('synthetic-cancelled')))
  fixture.loopback
    .mockResolvedValueOnce({ port: 12345, result: original.promise, close: closeOriginal })
    .mockResolvedValueOnce({ port: 12346, result: replacement.promise, close: vi.fn() })
  const firstWindow = registerWindow()
  await fixture.handlers.get('start')!(undefined, ipc)
  const secondWindow = registerWindow(vi.fn(), 2)
  await fixture.handlers.get('start')!(undefined, ipcFor(2))
  await new Promise<void>(done => setImmediate(done))

  expect(firstWindow.emit).toHaveBeenCalledExactlyOnceWith('cancelled', undefined)
  expect(secondWindow.emit).not.toHaveBeenCalled()
  expect(closeOriginal).toHaveBeenCalledOnce()
  secondWindow.close()
})

it('handles a rejected Eventa delivery without logging its error object', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => tokenResponse()))
  fixture.loopback.mockResolvedValue({ port: 12345, result: Promise.resolve({ code: 'synthetic-code' }), close: vi.fn() })
  fixture.logWithFields.mockReturnValue({ error: fixture.logError })
  const logged = Promise.withResolvers<void>()
  fixture.logError.mockImplementation(() => logged.resolve())
  const emit = vi.fn().mockRejectedValue(new Error('synthetic-private-delivery-error'))
  registerWindow(emit)
  await fixture.handlers.get('start')!(undefined, ipc)
  await logged.promise
  await new Promise<void>(done => setImmediate(done))

  expect(fixture.logWithFields).toHaveBeenCalledExactlyOnceWith({ phase: 'success' })
  expect(fixture.logError).toHaveBeenCalledExactlyOnceWith('OIDC event delivery failed')
  expect(emit).toHaveBeenCalledOnce()
})

it('completes the replacement login without republishing the old attempt', async () => {
  const first = Promise.withResolvers<Response>()
  const started = Promise.withResolvers<void>()
  const transport = vi.fn().mockImplementationOnce(() => {
    started.resolve()
    return first.promise
  }).mockImplementationOnce(async () => tokenResponse())
  vi.stubGlobal('fetch', transport)
  fixture.loopback.mockImplementation(async () => ({ port: 12345, result: Promise.resolve({ code: 'synthetic-code' }), close: vi.fn() }))
  const delivered = Promise.withResolvers<void>()
  const emit = vi.fn(() => delivered.resolve())
  const { owner } = registerWindow(emit)

  await fixture.handlers.get('start')!(undefined, ipc)
  await started.promise
  await fixture.handlers.get('start')!(undefined, ipc)
  first.resolve(tokenResponse())
  await delivered.promise
  await new Promise<void>(done => setImmediate(done))

  expect(transport.mock.calls[0]?.[1].signal.aborted).toBe(true)
  expect(transport.mock.calls[1]?.[1].signal.aborted).toBe(false)
  expect(emit).toHaveBeenCalledExactlyOnceWith('success', undefined)
  expect(owner.establish).toHaveBeenCalledExactlyOnceWith({
    access_token: 'synthetic-access',
    refresh_token: 'synthetic-refresh',
    id_token: 'synthetic-id',
    expires_in: 3600,
  }, expect.any(AbortSignal), 'synthetic-revision', 'synthetic-state')
  const authorization = new URL(fixture.openExternal.mock.calls.at(-1)![0])
  expect(authorization.searchParams.get('nonce')).toBe('synthetic-state')
})
