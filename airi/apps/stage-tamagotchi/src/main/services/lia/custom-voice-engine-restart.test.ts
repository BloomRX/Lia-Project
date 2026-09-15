import { beforeEach, describe, expect, it, vi } from 'vitest'

import { restartForEngineChangeIfNeeded } from './custom-voice-engine-restart'

/**
 * The engine-switch restart (Phase 6 hotfix, items F/L-10/L-11 and the
 * matching mutations in M): the running server must not keep serving Piper
 * after the disk says xtts, and nothing may claim "ready" before the API
 * actually answers again.
 */

let logs: Array<{ detail?: string, event: string }>
let state: string
let owned: boolean
let healthy: boolean
let calls: { start: number, stop: number }

beforeEach(() => {
  logs = []
  state = 'ready'
  owned = true
  healthy = true
  calls = { start: 0, stop: 0 }
})

const log = (event: string, detail?: string) => logs.push({ detail, event })

function deps(overrides: Partial<Parameters<typeof restartForEngineChangeIfNeeded>[0]> = {}) {
  return {
    isHealthy: async () => healthy,
    isOwnedInstance: () => owned,
    log,
    pollIntervalMs: 1,
    portFreeTimeoutMs: 30,
    runtimeState: () => state,
    start: vi.fn(async () => {
      calls.start += 1
      return { state }
    }),
    stop: vi.fn(async () => {
      calls.stop += 1
      healthy = false
    }),
    ...overrides,
  }
}

describe('restartForEngineChangeIfNeeded', () => {
  it('idle runtime: no restart, no spawn - prepare never starts a server (item D)', async () => {
    state = 'stopped'
    const fake = deps()
    const outcome = await restartForEngineChangeIfNeeded(fake)

    expect(outcome).toEqual({ ok: true, restarted: false })
    expect(calls.stop).toBe(0)
    expect(calls.start).toBe(0)
    expect(logs).toEqual([])
  })

  it('owned Piper instance: stops, waits for silence, starts, verifies - then ready', async () => {
    const fake = deps()
    const outcome = await restartForEngineChangeIfNeeded(fake)

    expect(outcome).toEqual({ ok: true, restarted: true })
    expect(calls.stop).toBe(1)
    expect(calls.start).toBe(1)
    const events = logs.map(entry => entry.event)
    expect(events).toEqual([
      'runtime.restart-for-engine-change',
      'runtime.stopped',
      'runtime.health-ready',
      'runtime.engine-verified',
    ])
    expect(logs[logs.length - 1].detail).toBe('xtts')
  })

  it('foreign instance: never stopped, never claimed - the block is named', async () => {
    owned = false
    const fake = deps()
    const outcome = await restartForEngineChangeIfNeeded(fake)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok)
      expect(outcome.detail).toContain('did not start')
    expect(calls.stop).toBe(0)
    expect(calls.start).toBe(0)
    expect(logs.map(entry => entry.event)).toEqual(['runtime.restart-blocked-foreign-instance'])
  })

  it('unknown ownership reads as foreign: no stop, no claim', async () => {
    const fake = deps({ isOwnedInstance: undefined })
    const outcome = await restartForEngineChangeIfNeeded(fake)

    expect(outcome.ok).toBe(false)
    expect(calls.stop).toBe(0)
  })

  it('waits for the port before starting - a slow release is not an error', async () => {
    let releases = 0
    const fake = deps({
      isHealthy: async () => {
        // Two healthy reads after stop, then silence.
        if (calls.stop === 0)
          return true
        releases += 1
        return releases <= 2
      },
      stop: vi.fn(async () => {
        calls.stop += 1
      }),
    })
    const outcome = await restartForEngineChangeIfNeeded(fake)

    expect(outcome).toEqual({ ok: true, restarted: true })
    expect(calls.start).toBe(1)
  })

  it('a port that never falls silent: error, and no start into the conflict', async () => {
    const fake = deps({ isHealthy: async () => true })
    const outcome = await restartForEngineChangeIfNeeded(fake)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok)
      expect(outcome.detail).toContain('port')
    expect(calls.start).toBe(0)
    expect(logs.map(entry => entry.event)).toContain('runtime.port-free-timeout')
  })

  it('a start that fails: error, and "engine-verified" is never claimed', async () => {
    const fake = deps({
      start: vi.fn(async () => {
        calls.start += 1
        return { state: 'error' }
      }),
    })
    const outcome = await restartForEngineChangeIfNeeded(fake)

    expect(outcome.ok).toBe(false)
    const events = logs.map(entry => entry.event)
    expect(events).toContain('runtime.restart-failed')
    expect(events).not.toContain('runtime.engine-verified')
    expect(events).not.toContain('runtime.health-ready')
  })
})
