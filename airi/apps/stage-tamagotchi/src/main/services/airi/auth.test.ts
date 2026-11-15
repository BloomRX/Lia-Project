import { afterEach, expect, it, vi } from 'vitest'

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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  fixture.handlers.clear()
})

const ipc = { raw: { ipcMainEvent: { sender: { id: 1 } } } }

function registerWindow(emit = vi.fn(), id = 1) {
  let closed: (() => void) | undefined
  const window = {
    webContents: { id },
    isDestroyed: () => false,
    once: (_event: string, listener: () => void) => { closed = listener },
  }
  createAuthService({ context: { emit } as never, window: window as never })
  return { emit, close: () => closed?.() }
}

function tokenResponse() {
  return Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', id_token: 'synthetic-id', expires_in: 3600 })
}

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
  await fixture.handlers.get('start')!(undefined, { raw: { ipcMainEvent: { sender: { id: 2 } } } })
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
  registerWindow(emit)

  await fixture.handlers.get('start')!(undefined, ipc)
  await started.promise
  await fixture.handlers.get('start')!(undefined, ipc)
  first.resolve(tokenResponse())
  await delivered.promise
  await new Promise<void>(done => setImmediate(done))

  expect(transport.mock.calls[0]?.[1].signal.aborted).toBe(true)
  expect(transport.mock.calls[1]?.[1].signal.aborted).toBe(false)
  // This is a legacy compatibility check. Moving this callback to a public
  // session DTO belongs with migration of the authenticated transports.
  expect(emit).toHaveBeenCalledExactlyOnceWith('success', {
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
    idToken: 'synthetic-id',
    expiresIn: 3600,
  })
})
