import type { LiaEventWindowLifetime } from './event-publisher'

/**
 * Windows shutdown hotfix, item 6 + tests E/F: observability must NEVER
 * make shutdown reject. The renderer is a best-effort mirror over a
 * forever-durable terminal sink.
 */
import { describe, expect, it } from 'vitest'

import { createLiaEventPublisher } from './event-publisher'
import { ShutdownCoordinator } from './shutdown-coordinator'

function makeWindow(overrides: Partial<LiaEventWindowLifetime> = {}) {
  const sent: { channel: string, payload: unknown }[] = []
  const win: LiaEventWindowLifetime = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel, payload) => sent.push({ channel, payload }),
    },
    ...overrides,
  }
  return { sent, win }
}

describe('lia event publisher (hotfix item 6)', () => {
  it('delivers to a live renderer and always logs to the terminal sink', () => {
    const lines: string[] = []
    const { sent, win } = makeWindow()
    const publish = createLiaEventPublisher({ getWindow: () => win, log: line => lines.push(line) })

    publish('lia-app.shutdown', 'beginning graceful shutdown')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.channel).toBe('lia:event')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('lia-app.shutdown')
  })

  it('e: a destroyed window/webContents skips delivery without throwing, still logging', () => {
    const lines: string[] = []
    const destroyedWindow = makeWindow({ isDestroyed: () => true })
    const destroyedContents = makeWindow({
      webContents: {
        isDestroyed: () => true,
        send: () => { throw new TypeError('Object has been destroyed') },
      },
    })
    for (const { win } of [destroyedWindow, destroyedContents]) {
      const publish = createLiaEventPublisher({ getWindow: () => win, log: line => lines.push(line) })
      expect(() => publish('lia-app.shutdown', 'stage: no-owned-process')).not.toThrow()
    }
    expect(lines.filter(line => line.includes('lia-app.shutdown'))).toHaveLength(2)
    expect(lines.some(line => line.includes('stage: no-owned-process'))).toBe(true)
  })

  it('a window that disappears mid-shutdown is a gap, not a rejection', () => {
    const lines: string[] = []
    const publish = createLiaEventPublisher({ getWindow: () => undefined, log: line => lines.push(line) })
    expect(() => publish('voice', 'no-owned-process')).not.toThrow()
    expect(lines.some(line => line.includes('no-owned-process'))).toBe(true)
  })

  it('f: double shutdown with the renderer already gone - single flight, no unhandled rejection', async () => {
    // The exact QA shape: closing twice in a row while the window is
    // already torn down. The coordinator's own single-flight guarantee
    // holds AND the publisher never throws the teardown off its rails.
    const lines: string[] = []
    const destroyedContents: LiaEventWindowLifetime = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => true,
        send: () => { throw new TypeError('Object has been destroyed') },
      },
    }
    // Delivering through a dead renderer must be invisible to the callers.
    const publish = createLiaEventPublisher({
      getWindow: () => destroyedContents,
      log: line => lines.push(line),
    })
    const stops: string[] = []
    const coordinator = new ShutdownCoordinator({
      onLog: line => publish('lia-app.shutdown', line),
    })
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'stage',
      stop: async () => {
        stops.push('stage')
        publish('stage', 'no-owned-process')
      },
    })
    coordinator.register({
      holdsOwnedProcess: () => true,
      name: 'voice',
      stop: async () => {
        stops.push('voice')
        publish('voice', 'no-owned-process')
      },
    })

    const first = coordinator.stopAll()
    const second = coordinator.stopAll()
    await expect(Promise.all([first, second])).resolves.toBeDefined()
    expect(stops).toEqual(['stage', 'voice']) // exactly ONCE - shared run
    expect(lines.some(line => line.includes('no-owned-process'))).toBe(true)
  })

  it('a throw from inside send() is contained and still logged', () => {
    const lines: string[] = []
    const { win } = makeWindow()
    win.webContents.send = () => { throw new TypeError('Object has been destroyed') }
    const publish = createLiaEventPublisher({ getWindow: () => win, log: line => lines.push(line) })
    expect(() => publish('shutdown', 'finished')).not.toThrow()
    expect(lines.some(line => line.includes('delivery skipped'))).toBe(true)
    expect(lines.some(line => line.includes('finished'))).toBe(true)
  })
})
