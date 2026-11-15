import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { createGroupRecorder, describeGroups, GATE_GROUPS } from './run-groups.mjs'

/**
 * The accounting for the 16 verification groups.
 *
 * The property under test is not "there are 16 entries in a list" — that would
 * pass if the gate never called `begin`. It is that a group cannot be counted as
 * executed unless it actually began, and cannot be counted as passed unless it
 * actually reached `pass`.
 */

/** A clock that advances one tick per read, so timings are deterministic. */
function ticker() {
  let tick = 0
  return () => `t${++tick}`
}

describe('GATE_GROUPS — the 16 groups the mission fixes', () => {
  it('has exactly 16, with contiguous ids from 1', () => {
    assert.equal(GATE_GROUPS.length, 16)
    assert.deepEqual(GATE_GROUPS.map(group => group.id), Array.from({ length: 16 }, (_, index) => index + 1))
  })

  it('gives every group a non-empty title', () => {
    for (const group of GATE_GROUPS)
      assert.ok(group.title.trim().length > 0, `group ${group.id} has no title`)
  })

  it('has no duplicate id or title', () => {
    assert.equal(new Set(GATE_GROUPS.map(group => group.id)).size, 16)
    assert.equal(new Set(GATE_GROUPS.map(group => group.title)).size, 16)
  })
})

describe('createGroupRecorder — executed means begun, passed means reached', () => {
  it('records a full run as complete', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    for (const group of GATE_GROUPS) {
      recorder.begin(group.id)
      recorder.pass(group.id)
    }
    const summary = recorder.summary()
    assert.equal(summary.total, 16)
    assert.equal(summary.executed, 16)
    assert.equal(summary.passed, 16)
    assert.equal(summary.failed, 0)
    assert.equal(summary.notRun, 0)
    assert.equal(summary.complete, true)
  })

  it('does not count a group as executed merely because a later one ran', () => {
    // Groups 1–3 run; the process dies inside 4. Groups 5–16 must read
    // `not-run`, not "assumed fine because the file contains them".
    const recorder = createGroupRecorder({ now: ticker() })
    for (const id of [1, 2, 3]) {
      recorder.begin(id)
      recorder.pass(id)
    }
    recorder.begin(4)

    const summary = recorder.summary()
    assert.equal(summary.executed, 4)
    assert.equal(summary.passed, 3)
    assert.equal(summary.notRun, 12)
    assert.equal(summary.complete, false)
    assert.equal(summary.interruptedAt, 4)
  })

  it('marks the interrupted group as still running, not as failed, until it is told', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    recorder.begin(1)
    recorder.pass(1)
    recorder.begin(2)
    assert.equal(recorder.summary().groups[1].status, 'running')
    assert.equal(recorder.summary().aborted, 1)
  })

  it('records a failure with its diagnostic', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    recorder.begin(1)
    recorder.fail(1, 'assert.equal: expected 200, got 401')
    const summary = recorder.summary()
    assert.equal(summary.groups[0].status, 'failed')
    assert.match(summary.groups[0].detail, /got 401/)
    assert.equal(summary.failed, 1)
    assert.equal(summary.passed, 0)
    assert.equal(summary.interruptedAt, 1)
  })

  it('ignores a failure reported for a group that already passed', () => {
    // A late teardown error must not retroactively fail a group that finished.
    const recorder = createGroupRecorder({ now: ticker() })
    recorder.begin(1)
    recorder.pass(1)
    recorder.fail(1, 'cleanup exploded')
    assert.equal(recorder.summary().groups[0].status, 'passed')
  })

  it('records begin and end times for a passed group', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    recorder.begin(1)
    recorder.pass(1)
    const group = recorder.summary().groups[0]
    assert.equal(group.beganAt, 't1')
    assert.equal(group.endedAt, 't2')
  })
})

describe('createGroupRecorder — a typo must not silently drop a group', () => {
  it('refuses an id outside the declared set', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    assert.throws(() => recorder.begin(17), /not one of the 16 declared groups/)
    assert.throws(() => recorder.begin(0), /not one of the 16 declared groups/)
  })

  it('refuses to begin the same group twice', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    recorder.begin(1)
    assert.throws(() => recorder.begin(1), /begun twice/)
  })

  it('refuses to pass a group that never began', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    assert.throws(() => recorder.pass(5), /without being begun/)
  })

  it('refuses to pass the same group twice', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    recorder.begin(1)
    recorder.pass(1)
    assert.throws(() => recorder.pass(1), /already passed/)
  })
})

describe('describeGroups — the sentence a reader cannot misread', () => {
  it('claims all 16 only when all 16 passed', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    for (const group of GATE_GROUPS) {
      recorder.begin(group.id)
      recorder.pass(group.id)
    }
    assert.equal(describeGroups(recorder.summary()), 'all 16 groups executed and passed')
  })

  it('names the group where execution stopped', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    for (const id of [1, 2, 3]) {
      recorder.begin(id)
      recorder.pass(id)
    }
    recorder.begin(4)
    assert.match(describeGroups(recorder.summary()), /stopped inside group 4.*12 never ran/)
  })

  it('distinguishes a recorded failure from an interruption', () => {
    const recorder = createGroupRecorder({ now: ticker() })
    recorder.begin(1)
    recorder.pass(1)
    recorder.begin(2)
    recorder.fail(2, 'boom')
    assert.match(describeGroups(recorder.summary()), /1\/16 groups passed; group 2 failed/)
  })

  it('does not say PASS for an empty run', () => {
    const summary = createGroupRecorder({ now: ticker() }).summary()
    assert.equal(summary.executed, 0)
    assert.equal(summary.complete, false)
    assert.match(describeGroups(summary), /0\/16/)
  })
})
