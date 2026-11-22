import { describe, expect, it, vi } from 'vitest'

import { enforceSingleInstance } from './single-instance'

/**
 * Test E of the ownership correction: a second Lia App never becomes a
 * second supervisor - it signals the running one and leaves, having
 * created nothing, spawned nothing, supervised nothing.
 */
describe('e. single instance - one supervisor, ever', () => {
  it('the primary takes the lock and arms the second-instance handoff', () => {
    const deps = {
      focusPrimaryWindow: vi.fn(),
      leaveImmediately: vi.fn(),
      onSecondInstance: vi.fn(),
      requestLock: vi.fn(() => true),
    }
    const role = enforceSingleInstance(deps)
    expect(role).toBe('primary')
    expect(deps.onSecondInstance).toHaveBeenCalledTimes(1)
    expect(deps.leaveImmediately).not.toHaveBeenCalled()

    // The handoff focuses the existing window; the duplicate already died.
    const handoff = deps.onSecondInstance.mock.calls[0][0] as () => void
    handoff()
    expect(deps.focusPrimaryWindow).toHaveBeenCalledTimes(1)
  })

  it('the secondary leaves IMMEDIATELY and registers nothing (no coordinator birth)', () => {
    const order: string[] = []
    const role = enforceSingleInstance({
      focusPrimaryWindow: () => order.push('focus'),
      leaveImmediately: () => order.push('leave'),
      log: () => order.push('log'),
      onSecondInstance: () => order.push('handler-registered'),
      requestLock: () => false,
    })
    expect(role).toBe('secondary')
    // It never even ARMS the second-instance handler: a process on its way
    // out owns no listeners and therefore future supervisors cannot form.
    expect(order).toEqual(['log', 'leave'])
  })
})
