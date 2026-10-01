import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { canonicalCommands, classifyCommandOutcome, isEnvironmentFailure, parseVitestMetrics } from './qa-benchmark-lib.mjs'
import { REPO_ROOT } from './qa-shared.mjs'

describe('D2B9-C labels', () => {
  it('no hard counts', () => {
    const cmds = canonicalCommands(REPO_ROOT)
    for (const c of cmds) {
      assert.equal(c.label.includes('12 files'), false)
      assert.equal(c.label.includes('124 tests'), false)
      assert.equal(c.label.includes('24 files'), false)
      assert.equal(c.label.includes('309 tests'), false)
    }
    assert.equal(cmds.find(c => c.id === 'core-agent').label, 'Core Agent')
    assert.equal(cmds.find(c => c.id === 'lia-core').label, 'Lia Core')
  })
  it('parse 12/124', () => {
    const m = parseVitestMetrics(' Test Files  12 passed (12)\n Tests  124 passed (124)')
    assert.equal(m.testFiles, 12)
    assert.equal(m.passed, 124)
    assert.equal(m.failed, 0)
  })
  it('parse 27/336', () => {
    const m = parseVitestMetrics(' Test Files  27 passed (27)\n Tests  336 passed (336)')
    assert.equal(m.testFiles, 27)
    assert.equal(m.passed, 336)
  })
  it('parse ANSI-colored pass-only 27/336', () => {
    const m = parseVitestMetrics('\u001B[32m Test Files  27 passed (27)\u001B[0m\n\u001B[32m      Tests  336 passed (336)\u001B[0m')
    assert.equal(m.testFiles, 27)
    assert.equal(m.passed, 336)
    assert.equal(m.failed, 0)
  })
  it('parse pass+skipped fail+pass', () => {
    const a = parseVitestMetrics(' Test Files  12 passed (12)\n Tests  124 passed | 2 skipped (126)')
    assert.equal(a.skipped, 2)
    const b = parseVitestMetrics(' Test Files  1 failed | 11 passed (12)\n Tests  2 failed | 122 passed (124)')
    assert.equal(b.failed, 2)
    assert.equal(b.passed, 122)
  })
  it('browser env', () => {
    assert.equal(isEnvironmentFailure({ id: 'browser', stderr: '', stdout: 'Browser executable doesn\'t exist' }), true)
    assert.equal(classifyCommandOutcome({ exitCode: 1, id: 'browser', stderr: 'Executable doesn\'t exist', stdout: 'Tests  no tests' }), 'environment-limited')
  })
})
