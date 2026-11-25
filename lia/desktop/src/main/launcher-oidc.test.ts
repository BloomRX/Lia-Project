import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { registerLauncherOidc, resolveDevelopmentOidc } from './launcher-oidc'

describe('Launcher OIDC boundary', () => {
  it('accepts only an explicit development loopback issuer', () => {
    expect(resolveDevelopmentOidc(false, 'http://127.0.0.1:8000', 'lia-test')?.origin.hostname).toBe('127.0.0.1')
    expect(resolveDevelopmentOidc(true, 'http://127.0.0.1:8000', 'lia-test')).toBeUndefined()
    for (const origin of [undefined, 'http://localhost:8000', 'https://example.test', 'http://127.0.0.1/?x=y', 'http://user@127.0.0.1'])
      expect(resolveDevelopmentOidc(false, origin, 'lia-test')).toBeUndefined()
  })

  it('rejects foreign frames and extra arguments and removes every handler on close', async () => {
    const channels = new Map<string, (...args: unknown[]) => Promise<unknown>>()
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: {} }),
    })
    const openAuthorization = vi.fn()
    registerLauncherOidc({
      ipc: {
        handle: (channel, operation) => { channels.set(channel, operation as (...args: unknown[]) => Promise<unknown>) },
        removeHandler: channel => { channels.delete(channel) },
      },
      window: window as unknown as Parameters<typeof registerLauncherOidc>[0]['window'],
      vault: {} as Parameters<typeof registerLauncherOidc>[0]['vault'],
      openAuthorization,
    })
    const caller = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    expect([...channels.keys()].sort()).toEqual(['lia:oidc:cancel', 'lia:oidc:login', 'lia:oidc:logout', 'lia:oidc:profile', 'lia:oidc:status'])
    expect(await channels.get('lia:oidc:status')!(caller)).toEqual({ ok: true, available: false })
    for (const operation of channels.values()) {
      expect(await operation({ ...caller, senderFrame: {} })).toEqual({ ok: false, code: 'invalid-request' })
      expect(await operation(caller, 'https://arbitrary.example.test')).toEqual({ ok: false, code: 'invalid-request' })
    }
    expect(await channels.get('lia:oidc:login')!(caller)).toEqual({ ok: false, code: 'unavailable' })
    expect(openAuthorization).not.toHaveBeenCalled()
    window.emit('closed')
    expect(channels.size).toBe(0)
  })
})
