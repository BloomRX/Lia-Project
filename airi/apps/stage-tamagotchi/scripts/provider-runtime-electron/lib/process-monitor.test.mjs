import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { createProcessMonitor } from './process-monitor.mjs'

/**
 * Descendant tracking.
 *
 * `createProcessMonitor` takes its snapshot function, its clock and its timer
 * functions as parameters, so everything below runs on Linux against a fake
 * process table. That is deliberate: it lets the scenarios the mission asks for
 * — creation, exit, disappearance, failed identification — be exercised without
 * pretending a Windows host exists.
 *
 * What is NOT proved here, and cannot be: that `Get-CimInstance` behaves this
 * way on a real Windows box. The gate does that, on Windows, when it runs.
 */

const ROOT = 100

/**
 * A table where the monitor is driven by hand: every `poll()` reads whatever the
 * test last put in `state.table`.
 */
function createHarness({ intervalMs = 150 } = {}) {
  const state = { table: [], clock: 1_000_000, calls: 0, thrown: undefined, intervals: [] }
  const scheduled = []
  const monitor = createProcessMonitor({
    rootPid: ROOT,
    intervalMs,
    snapshot: () => {
      state.calls++
      if (state.thrown)
        throw state.thrown
      return state.table
    },
    now: () => state.clock,
    setInterval: (fn, ms) => {
      scheduled.push({ fn, ms })
      state.intervals.push(ms)
      return scheduled.length
    },
    clearInterval: (handle) => {
      scheduled[handle - 1] = undefined
    },
  })
  return { monitor, state, scheduled }
}

describe('createProcessMonitor — what it refuses to be constructed without', () => {
  it('requires a positive integer root PID', () => {
    assert.throws(() => createProcessMonitor({ rootPid: 0, snapshot: () => [] }), /root PID/)
    assert.throws(() => createProcessMonitor({ rootPid: 'x', snapshot: () => [] }), /root PID/)
  })

  it('requires a snapshot function', () => {
    assert.throws(() => createProcessMonitor({ rootPid: 1 }), /snapshot function/)
  })
})

describe('createProcessMonitor — descendants', () => {
  it('captures a child that starts and exits between two of the old snapshots', () => {
    // The regression this replaces: `descendants()` was called four times, so a
    // child alive only between calls two and three was invisible. Here the child
    // exists for exactly one poll, and is still recorded.
    const { monitor, state } = createHarness()

    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.start()

    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 1 },
      { pid: 200, parentPid: ROOT, createdAt: 2 },
    ]
    monitor.rescan()

    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.rescan()
    monitor.stop()

    assert.deepEqual(monitor.identities().map(identity => identity.pid).sort(), [ROOT, 200])
  })

  it('follows a chain of grandchildren, not only direct children', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.start()
    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 1 },
      { pid: 200, parentPid: ROOT, createdAt: 2 },
      { pid: 300, parentPid: 200, createdAt: 3 },
      { pid: 400, parentPid: 300, createdAt: 4 },
    ]
    monitor.rescan()
    monitor.stop()
    assert.deepEqual(monitor.identities().map(identity => identity.pid).sort(), [100, 200, 300, 400])
  })

  it('ignores a process that does not descend from the root', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.start()
    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 1 },
      { pid: 900, parentPid: 4242, createdAt: 9 },
    ]
    monitor.rescan()
    monitor.stop()
    assert.deepEqual(monitor.identities().map(identity => identity.pid), [100])
  })

  it('does not hang on a table that reports a parent cycle', () => {
    // A malformed answer must degrade to "not a descendant", never to a loop.
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.start()
    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 1 },
      { pid: 200, parentPid: 300, createdAt: 2 },
      { pid: 300, parentPid: 200, createdAt: 3 },
    ]
    monitor.rescan()
    monitor.stop()
    assert.deepEqual(monitor.identities().map(identity => identity.pid), [ROOT])
  })

  it('keeps both incarnations when a PID is reused by a later child', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.start()
    state.table = [...state.table, { pid: 200, parentPid: ROOT, createdAt: 2 }]
    monitor.rescan()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }, { pid: 200, parentPid: ROOT, createdAt: 7 }]
    monitor.rescan()
    monitor.stop()

    const entries = monitor.identities().filter(identity => identity.pid === 200)
    assert.equal(entries.length, 2, 'both processes that wore PID 200 must reach teardown')
    assert.deepEqual(entries.map(entry => entry.createdAt).sort(), [2, 7])
  })

  it('rejects impossible parent ages before root and cached-owner shortcuts in either table order', () => {
    for (const reverse of [false, true]) {
      const { monitor, state } = createHarness()
      const root = { pid: ROOT, parentPid: 0, createdAt: 100 }
      monitor.start()
      const table = [
        root,
        { pid: 200, parentPid: ROOT, createdAt: 110 },
        { pid: 300, parentPid: 200, createdAt: 90 },
        { pid: 400, parentPid: 300, createdAt: 95 },
        { pid: 500, parentPid: ROOT, createdAt: 80 },
        { pid: 600, parentPid: 200, createdAt: 120 },
      ]
      state.table = reverse ? table.toReversed() : table
      monitor.rescan()
      monitor.stop()
      assert.deepEqual(monitor.identities().map(entry => entry.pid).sort((a, b) => a - b), [100, 200, 600])
    }
  })

  it('pins the root incarnation and does not adopt a recycled root or its new children', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 10 }, { pid: 200, parentPid: ROOT, createdAt: 20 }]
    monitor.start()
    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 100 },
      { pid: 300, parentPid: ROOT, createdAt: 110 },
      { pid: 400, parentPid: 300, createdAt: 120 },
    ]
    monitor.rescan()
    monitor.stop()
    assert.deepEqual(monitor.identities().map(entry => [entry.pid, entry.createdAt]), [[100, 10], [200, 20]])
  })

  it('preserves previously unseen children of the original root after its PID is reused', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 10 }]
    monitor.start()
    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 100 },
      { pid: 200, parentPid: ROOT, createdAt: 20 },
      { pid: 300, parentPid: ROOT, createdAt: undefined },
      { pid: 400, parentPid: ROOT, createdAt: 110 },
      { pid: 500, parentPid: ROOT, createdAt: 5 },
    ]
    monitor.rescan()
    monitor.stop()
    assert.deepEqual(monitor.identities().map(entry => [entry.pid, entry.createdAt]), [[100, 10], [200, 20], [300, undefined]])
  })

  it('retains old and unknown children of an already observed intermediate parent after reuse', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 10 }, { pid: 200, parentPid: ROOT, createdAt: 20 }]
    monitor.start()
    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 10 },
      { pid: 200, parentPid: 999, createdAt: 100 },
      { pid: 300, parentPid: 200, createdAt: 30 },
      { pid: 400, parentPid: 200, createdAt: undefined },
      { pid: 500, parentPid: 200, createdAt: 110 },
      { pid: 600, parentPid: 200, createdAt: 15 },
    ]
    monitor.rescan()
    monitor.stop()
    assert.deepEqual(monitor.identities().map(entry => [entry.pid, entry.createdAt]), [[100, 10], [200, 20], [300, 30], [400, undefined]])
  })

  it('retains unknown timestamps as evidence instead of treating uncertain ancestry as gone', () => {
    const { monitor, state } = createHarness()
    state.table = [
      { pid: ROOT, parentPid: 0, createdAt: 10 },
      { pid: 200, parentPid: ROOT, createdAt: undefined },
      { pid: 300, parentPid: 200, createdAt: 5 },
      { pid: 400, parentPid: ROOT, createdAt: undefined },
    ]
    monitor.start()
    monitor.stop()
    assert.deepEqual(monitor.identities().map(entry => entry.pid), [100, 200, 300, 400])
    assert.equal(monitor.identities().find(entry => entry.pid === 200).createdAt, undefined)
    assert.equal(monitor.identities().find(entry => entry.pid === 400).createdAt, undefined)
  })

  it('records the poll that first saw each process, for diagnosis', () => {
    const { monitor, state } = createHarness()
    state.clock = 5_000
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.start()
    state.clock = 5_150
    state.table = [...state.table, { pid: 200, parentPid: ROOT, createdAt: 2 }]
    monitor.rescan()
    monitor.stop()

    const observations = monitor.observations()
    assert.equal(observations.find(entry => entry.pid === ROOT).firstSeen, 5_000)
    assert.equal(observations.find(entry => entry.pid === 200).firstSeen, 5_150)
  })
})

describe('createProcessMonitor — failures are recorded, never read as "nothing ran"', () => {
  it('records a throwing snapshot and keeps the processes already observed', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }, { pid: 200, parentPid: ROOT, createdAt: 2 }]
    monitor.start()
    state.thrown = new Error('powershell.exe is not recognized')
    monitor.rescan()
    monitor.stop()

    assert.equal(monitor.stats().failures.length, 1)
    assert.match(monitor.stats().failures[0].message, /not recognized/)
    // A failed poll must not erase evidence collected before it.
    assert.deepEqual(monitor.identities().map(identity => identity.pid).sort(), [100, 200])
  })

  it('does not throw out of the monitor when the snapshot fails', () => {
    const { monitor, state } = createHarness()
    state.thrown = new Error('boom')
    assert.doesNotThrow(() => monitor.start())
    assert.doesNotThrow(() => monitor.stop())
  })

  it('reports the sampling interval and states the blind window', () => {
    const { monitor } = createHarness({ intervalMs: 200 })
    monitor.start()
    monitor.stop()
    assert.equal(monitor.stats().intervalMs, 200)
    assert.match(monitor.stats().coverage, /short-lived processes can be missed/)
  })
})

describe('createProcessMonitor — lifecycle', () => {
  it('does not overlap slow periodic queries and drains the last observation on stop', async () => {
    let tick
    let finish
    let calls = 0
    const monitor = createProcessMonitor({
      rootPid: ROOT,
      snapshot: () => [{ pid: ROOT, createdAt: 1 }],
      asyncSnapshot: () => {
        calls++
        return new Promise((resolve) => {
          finish = resolve
        })
      },
      setInterval: (fn) => {
        tick = fn
        return 1
      },
      clearInterval: () => { tick = undefined },
    })
    monitor.start()
    tick()
    tick()
    await Promise.resolve()
    assert.equal(calls, 1)
    monitor.stop()
    assert.equal(tick, undefined)
    finish([{ pid: 200, parentPid: ROOT, createdAt: 2 }])
    await monitor.drain()
    assert.deepEqual(monitor.identities().map(identity => identity.pid), [ROOT, 200])
  })

  it('polls once at start, so the root is known before anything is launched', () => {
    const { monitor, state } = createHarness()
    state.table = [{ pid: ROOT, parentPid: 0, createdAt: 1 }]
    monitor.start()
    assert.equal(state.calls, 1)
    assert.equal(monitor.identities().length, 1)
    monitor.stop()
  })

  it('schedules on the requested interval and clears it on stop', () => {
    const { monitor, state, scheduled } = createHarness({ intervalMs: 125 })
    monitor.start()
    assert.deepEqual(state.intervals, [125])
    assert.equal(typeof scheduled[0].fn, 'function')
    monitor.stop()
    assert.equal(scheduled[0], undefined, 'the timer must be cleared')
  })

  it('tolerates stop() twice, so a finally block cannot throw', () => {
    const { monitor } = createHarness()
    monitor.start()
    monitor.stop()
    assert.doesNotThrow(() => monitor.stop())
  })

  it('counts its polls', () => {
    const { monitor } = createHarness()
    monitor.start()
    monitor.rescan()
    monitor.rescan()
    monitor.stop()
    assert.equal(monitor.stats().polls, 3)
  })
})
