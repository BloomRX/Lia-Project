import { afterEach, expect, it, vi } from 'vitest'

import { createAuthService } from './auth'

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => unknown>(),
  loopback: vi.fn(),
  openExternal: vi.fn(),
  logError: vi.fn(),
  logWithError: vi.fn(),
}))

vi.mock('@moeru/eventa', () => ({
  defineInvokeHandler: (_context: unknown, event: string, handler: (...args: any[]) => unknown) => fixture.handlers.set(event, handler),
}))
vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => ({ error: fixture.logError, withError: fixture.logWithError }) }),
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
  electronAuthLogout: 'logout',
  electronAuthStartLogin: 'start',
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  fixture.handlers.clear()
})

it('does not read or disclose an external token rejection body', async () => {
  const response = new Response('synthetic-private-response', { status: 401 })
  const readBody = vi.spyOn(response, 'text')
  const transport = vi.fn(async () => response)
  vi.stubGlobal('fetch', transport)
  fixture.loopback.mockResolvedValue({ port: 12345, result: Promise.resolve({ code: 'synthetic-code' }), close: vi.fn() })
  fixture.logWithError.mockReturnValue({ error: fixture.logError })
  let deliver!: (payload: unknown) => void
  const delivered = new Promise((resolve) => {
    deliver = resolve
  })
  const emit = vi.fn((_event: string, payload: unknown) => deliver(payload))
  createAuthService({ context: { emit } as never, window: { webContents: { id: 1 } } as never })
  await fixture.handlers.get('start')!(undefined, { raw: { ipcMainEvent: { sender: { id: 1 } } } })
  await expect(delivered).resolves.toEqual({ error: 'OIDC signing in failed' })
  expect(transport).toHaveBeenCalledOnce()
  expect(readBody).not.toHaveBeenCalled()
  expect(fixture.logWithError).not.toHaveBeenCalled()
  expect(emit).toHaveBeenCalledExactlyOnceWith('failure', { error: 'OIDC signing in failed' })
})
