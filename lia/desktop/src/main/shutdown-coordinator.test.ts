import { describe, expect, it, vi } from 'vitest'

import { createSupervisorQuitFlow, ShutdownCoordinator } from './shutdown-coordinator'

/**
 * Tests E and F of the Phase 7.1 contract, plus the coordinator's own
 * guarantees: ordered stops, single-flight across triggers, skip-honesty
 * for targets that own nothing, global timeout, no all-or-nothing.
 */

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

describe('shutdown coordinator ordering', () => {
  it('stops targets in registration order and reports each step', async () => {
    const order: string[] = []
    const coordinator = new ShutdownCoordinator({ globalTimeoutMs: 5_000 })
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'stage',
      stop: async () => {
        order.push('stage:begin')
        await delay(10)
        order.push('stage:end')
      },
    })
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'voice-runtime',
      stop: async () => {
        order.push('voice:begin')
        await delay(5)
        order.push('voice:end')
      },
    })

    const report = await coordinator.stopAll()
    expect(order).toEqual(['stage:begin', 'stage:end', 'voice:begin', 'voice:end'])
    expect(report.steps.map(step => step.name)).toEqual(['stage', 'voice-runtime'])
    expect(report.steps.every(step => step.outcome === 'stopped')).toBe(true)
    expect(report.timedOut).toBe(false)
    expect(coordinator.isShuttingDown()).toBe(true)
  })

  it('a failed target never blocks the next one (best effort, not all-or-nothing)', async () => {
    const order: string[] = []
    const coordinator = new ShutdownCoordinator()
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'stage',
      stop: async () => {
        order.push('stage')
        throw new Error('taskkill exploded')
      },
    })
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'voice-runtime',
      stop: async () => {
        order.push('voice')
      },
    })

    const report = await coordinator.stopAll()
    expect(order).toEqual(['stage', 'voice'])
    expect(report.steps[0].outcome).toBe('failed')
    expect(report.steps[0].error).toContain('taskkill exploded')
    expect(report.steps[1].outcome).toBe('stopped')
  })

  it('targets holding no owned process are answered, not stopped (test C/D spirit)', async () => {
    const stop = vi.fn(async () => {})
    const coordinator = new ShutdownCoordinator()
    coordinator.register({ holdsOwnedProcess: () => false, name: 'external-stage', stop })

    const report = await coordinator.stopAll()
    expect(stop).not.toHaveBeenCalled()
    expect(report.steps[0].outcome).toBe('no-owned-process')
  })

  it('the global timeout ends the wait without cancelling the report', async () => {
    const coordinator = new ShutdownCoordinator({ globalTimeoutMs: 25 })
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'stuck-thing',
      stop: () => delay(5_000),
    })

    const report = await coordinator.stopAll()
    expect(report.timedOut).toBe(true)
  })
})

describe('f. Double quit is single-flight', () => {
  it('concurrent stopAll() calls share one run; targets stop exactly once', async () => {
    const stop = vi.fn(async () => {
      await delay(10)
    })
    const coordinator = new ShutdownCoordinator()
    coordinator.register({ holdsOwnedProcess: () => true, name: 'stage', stop })

    const [first, second, third] = await Promise.all([
      coordinator.stopAll(),
      coordinator.stopAll(),
      delay(5).then(() => coordinator.stopAll()),
    ])
    expect(stop).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
    expect(second).toBe(third)
  })
})

describe('e. Ctrl+C in dev drives the full shutdown', () => {
  it('a signal triggers stopAll and only then ends the process', async () => {
    const events: string[] = []
    const coordinator = new ShutdownCoordinator()
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'stage',
      stop: async () => {
        await delay(5)
        events.push('stopped:stage')
      },
    })

    const flow = createSupervisorQuitFlow({
      coordinator,
      endProcess: code => events.push(`end:${code}`),
    })

    flow.onSigint()
    expect(events).toEqual([]) // The process must NOT die before the stop.
    await vi.waitFor(() => expect(events).toEqual(['stopped:stage', 'end:130']))
  })

  it('before-quit exits 0; a later signal joins the same run and never exits early', async () => {
    const events: string[] = []
    const stop = vi.fn(async () => {
      await delay(10)
      events.push('stopped')
    })
    const coordinator = new ShutdownCoordinator()
    coordinator.register({ holdsOwnedProcess: () => true, name: 'stage', stop })

    const flow = createSupervisorQuitFlow({
      coordinator,
      endProcess: code => events.push(`end:${code}`),
    })

    flow.onBeforeQuit()
    flow.onSigint()
    flow.onSigterm()
    await vi.waitFor(() => expect(events).toEqual(['stopped', 'end:0']))
    await delay(5)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['stopped', 'end:0']) // No second exit, ever.
  })
})
