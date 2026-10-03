/**
 * Phase 7.9E.4: render-facing Lia voice/greeting handlers must exist BEFORE
 * the renderer can run - regression coverage for the race that killed the
 * startup greeting on real Windows (voice-status-invoke-start with no end).
 *
 * Proof strategy, two layers:
 * A. BEHAVIOR: with every sibling seam mocked, the composition runs in the
 *    exact order context -> engine -> voice bridge -> capabilities ->
 *    prewarm -> greeting latch, creates ONE Kokoro engine and ONE latch,
 *    and forwards the managed fact honestly (standalone keeps prewarm off).
 * B. STRUCTURE (convention): the composition is invoked from the
 *    `onWindowCreated` hook of setupMainWindow, and in windows/main that
 *    hook runs BEFORE `await load(...)` - so the renderer can never outrun
 *    registration again.
 */
import { readFile } from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startLiaMainWindowVoiceRuntime } from './main-window-voice-runtime'

const h = vi.hoisted(() => {
  return {
    calls: [] as string[],
    isManaged: true,
    latchArgs: [] as Array<{ managedLaunch: boolean }>,
    kokoroFactoryCalls: 0,
    preferred: undefined as string | undefined,
    prewarmArgs: [] as Array<{ engineIds: string[], managedLaunch: boolean }>,
    seamLogs: [] as string[],
  }
})

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => '/tmp/lia-test-user-data' },
  ipcMain: { handle: () => undefined },
}))

vi.mock('@moeru/eventa/adapters/electron/main', () => ({
  createContext: (_ipcMain: unknown, _window: unknown) => {
    h.calls.push('context')
    return { context: { fake: true } }
  },
}))

vi.mock('@lia/core/voice/engines/kokoro', () => ({
  createKokoroVoiceEngine: () => {
    h.kokoroFactoryCalls += 1
    h.calls.push('kokoro-engine')
    return {
      id: 'kokoro',
      capabilities: () => ({ clonesVoice: false }),
      health: async () => ({ ok: true, state: 'ready' }),
      start: async () => undefined,
      stop: async () => undefined,
    }
  },
}))

vi.mock('./lia-voice-service', () => ({
  registerLiaVoiceBridge: () => {
    h.calls.push('voice-bridge')
    return { voiceAvailable: async () => true, voiceChanged: () => undefined }
  },
}))

vi.mock('./lia-capabilities', () => ({
  registerLiaCapabilitiesBridge: () => {
    h.calls.push('capabilities-bridge')
    return { invalidate: () => undefined }
  },
}))

vi.mock('./voice-prewarm', () => ({
  prewarmManagedVoice: (options: { engines: Array<{ id: string }>, managedLaunch: boolean }) => {
    h.calls.push('prewarm')
    h.prewarmArgs.push({ engineIds: options.engines.map(engine => engine.id), managedLaunch: options.managedLaunch })
    return { readyEngines: () => ['kokoro'], settled: Promise.resolve() }
  },
}))

vi.mock('./startup-greeting', () => ({
  registerLiaStartupGreetingBridge: (params: { managedLaunch: boolean }) => {
    h.calls.push('greeting-latch')
    h.latchArgs.push({ managedLaunch: params.managedLaunch })
  },
}))

vi.mock('./lia-managed', () => ({
  isLauncherManaged: () => h.isManaged,
}))

const fakeWindow = { webContents: { send: () => undefined } } as never
const fakeProductConfig = {
  get: () => ({ voice: { ...(h.preferred ? { engine: { preferred: h.preferred } } : {}), runtime: {} } }),
  update: () => undefined,
} as never
const fakeStore = {} as never

describe('7.9E.4 - voice runtime registers at the window-creation seam (order, exactly once)', () => {
  beforeEach(() => {
    h.calls.length = 0
    h.prewarmArgs.length = 0
    h.latchArgs.length = 0
    h.kokoroFactoryCalls = 0
    h.isManaged = true
    h.preferred = undefined
    h.seamLogs.length = 0
  })

  it('managed launch: exact composition order context -> engine -> bridges -> prewarm -> latch', () => {
    startLiaMainWindowVoiceRuntime({
      liaProductConfig: fakeProductConfig,
      liaVoiceProfiles: fakeStore,
      window: fakeWindow,
    })
    expect(h.calls).toEqual(['context', 'kokoro-engine', 'voice-bridge', 'capabilities-bridge', 'prewarm', 'greeting-latch'])
    // Exactly once each: ONE engine set, ONE greeting latch per process.
    expect(h.kokoroFactoryCalls).toBe(1)
    expect(h.prewarmArgs).toEqual([{ engineIds: ['kokoro'], managedLaunch: true }])
    expect(h.latchArgs).toEqual([{ managedLaunch: true }])
  })

  it('standalone launch: handlers still register (renderer contract unchanged), prewarm stays OFF', () => {
    h.isManaged = false
    startLiaMainWindowVoiceRuntime({
      liaProductConfig: fakeProductConfig,
      liaVoiceProfiles: fakeStore,
      window: fakeWindow,
    })
    expect(h.calls).toEqual(['context', 'kokoro-engine', 'voice-bridge', 'capabilities-bridge', 'prewarm', 'greeting-latch'])
    expect(h.prewarmArgs).toEqual([{ engineIds: ['kokoro'], managedLaunch: false }])
    expect(h.latchArgs).toEqual([{ managedLaunch: false }])
  })

  it('7.9F default/legacy config: prewarm warms ONLY the product default engine (Kokoro)', () => {
    startLiaMainWindowVoiceRuntime({
      liaProductConfig: fakeProductConfig,
      liaVoiceProfiles: fakeStore,
      window: fakeWindow,
    })
    expect(h.prewarmArgs).toEqual([{ engineIds: ['kokoro'], managedLaunch: true }])
  })

  it('7.9F multi-engine: ONLY the SELECTED engine warms, never every registered engine', () => {
    h.preferred = 'second-engine'
    const kokoroEngine = { id: 'kokoro', capabilities: () => ({ clonesVoice: false }), health: async () => ({ ok: true, state: 'ready' }), start: async () => undefined, stop: async () => undefined }
    const secondEngine = { ...kokoroEngine, id: 'second-engine' }
    startLiaMainWindowVoiceRuntime({
      engines: [kokoroEngine, secondEngine] as never,
      liaProductConfig: fakeProductConfig,
      liaVoiceProfiles: fakeStore,
      window: fakeWindow,
    })
    // Exactly ONE engine in the warm list - a solo start (the prewarm module
    // itself starts each listed engine exactly once, pinned by its own tests).
    expect(h.prewarmArgs).toEqual([{ engineIds: ['second-engine'], managedLaunch: true }])
    expect(h.kokoroFactoryCalls).toBe(0) // test seam engines: no second build-side engine constructed
  })

  it('7.9F unknown configured engine: warms NOTHING and logs an honest metadata-only note', () => {
    h.preferred = 'alltalk-server'
    startLiaMainWindowVoiceRuntime({
      liaProductConfig: fakeProductConfig,
      liaVoiceProfiles: fakeStore,
      log: line => h.seamLogs.push(line),
      window: fakeWindow,
    })
    expect(h.prewarmArgs).toEqual([{ engineIds: [], managedLaunch: true }])
    expect(h.seamLogs).toContainEqual('event=lia.voice.selection source=configured unknown=alltalk-server')
  })
})

describe('7.9E.4 - structural proof: registration happens BEFORE the renderer load', () => {
  it('main/index.ts starts the voice runtime INSIDE the windows:main onWindowCreated hook', async () => {
    const source = await readFile(new URL('../../index.ts', import.meta.url), 'utf8')
    const hookStart = source.indexOf('onWindowCreated: (window)')
    expect(hookStart).toBeGreaterThan(-1)
    const seamCall = source.indexOf('startLiaMainWindowVoiceRuntime(')
    const hookEnd = source.indexOf('onSizeSettingsReady:', hookStart)
    expect(seamCall).toBeGreaterThan(hookStart)
    expect(seamCall).toBeLessThan(hookEnd)
  })

  it('windows/main/index.ts invokes onWindowCreated BEFORE awaiting load(...)', async () => {
    const source = await readFile(new URL('../../windows/main/index.ts', import.meta.url), 'utf8')
    const hookCall = source.indexOf('params.onWindowCreated(window)')
    const loadCall = source.indexOf('await load(')
    expect(hookCall).toBeGreaterThan(-1)
    expect(loadCall).toBeGreaterThan(-1)
    expect(hookCall).toBeLessThan(loadCall)
  })
})
