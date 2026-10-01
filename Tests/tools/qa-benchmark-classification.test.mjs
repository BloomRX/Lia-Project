import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { classifyBenchmark, classifyCommandOutcome, isEnvironmentFailure } from './qa-benchmark-lib.mjs'

describe('classification: browser', () => {
  it('browser missing → ENVIRONMENT-LIMITED', () => {
    const out = classifyCommandOutcome({ id: 'browser', exitCode: null, error: new Error('ENOENT'), stdout: '', stderr: 'chromium executable doesn\'t exist' })
    assert.equal(out, 'environment-limited')
    const bench = classifyBenchmark({ commands: [{ id: 'browser', status: out }, { id: 'core-agent', status: 'passed' }, { id: 'lia-core', status: 'passed' }, { id: 'lint', status: 'passed' }, { id: 'typecheck', status: 'passed' }, { id: 'build-packages', status: 'passed' }, { id: 'stage-ui', status: 'passed' }, { id: 'stage-vitest', status: 'passed' }] })
    assert.equal(bench, 'ENVIRONMENT-LIMITED')
  })
  it('browser test fail → FAIL', () => {
    const out = classifyCommandOutcome({ id: 'browser', exitCode: 1, stdout: '', stderr: 'Test Files 1 failed' })
    assert.equal(out, 'failed')
    const bench = classifyBenchmark({ commands: [{ id: 'browser', status: out }, { id: 'core-agent', status: 'passed' }] })
    assert.equal(bench, 'FAIL')
  })
})

describe('classification: typecheck', () => {
  it('typecheck OOM → ENVIRONMENT-LIMITED', () => {
    const out = classifyCommandOutcome({ id: 'typecheck', exitCode: 1, stdout: '', stderr: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory' })
    assert.equal(out, 'environment-limited')
    const bench = classifyBenchmark({ commands: [{ id: 'typecheck', status: out }] })
    assert.equal(bench, 'ENVIRONMENT-LIMITED')
  })
  it('typecheck diagnostics → FAIL', () => {
    const out = classifyCommandOutcome({ id: 'typecheck', exitCode: 2, stdout: '', stderr: 'error TS2322: Type ...' })
    assert.equal(out, 'failed')
    assert.equal(classifyBenchmark({ commands: [{ id: 'typecheck', status: out }] }), 'FAIL')
  })
})

describe('classification: build', () => {
  it('build fail → FAIL', () => {
    const out = classifyCommandOutcome({ id: 'build-packages', exitCode: 1, stdout: '', stderr: 'build error' })
    assert.equal(out, 'failed')
    assert.equal(classifyBenchmark({ commands: [{ id: 'build-packages', status: out }] }), 'FAIL')
  })
  it('build missing tool → ENVIRONMENT-LIMITED', () => {
    const out = classifyCommandOutcome({ id: 'build-packages', exitCode: null, error: new Error('spawn pnpm ENOENT'), stdout: '', stderr: '' })
    assert.equal(out, 'environment-limited')
  })
})

describe('classification: lint/stage-ui', () => {
  it('lint fail → FAIL', () => {
    assert.equal(classifyCommandOutcome({ id: 'lint', exitCode: 1, stderr: 'eslint error' }), 'failed')
    assert.equal(classifyBenchmark({ commands: [{ id: 'lint', status: 'failed' }] }), 'FAIL')
  })
  it('stage-ui fail → FAIL', () => {
    assert.equal(classifyCommandOutcome({ id: 'stage-ui', exitCode: 1, stderr: 'Test Files 1 failed' }), 'failed')
    assert.equal(classifyBenchmark({ commands: [{ id: 'stage-ui', status: 'failed' }] }), 'FAIL')
  })
})

describe('classification: required evidence', () => {
  it('PASS only when all required domains execute/pass', () => {
    const cmds = [
      { id: 'core-agent', status: 'passed' },
      { id: 'lia-core', status: 'passed' },
      { id: 'browser', status: 'passed' },
      { id: 'lint', status: 'passed' },
      { id: 'typecheck', status: 'passed' },
      { id: 'build-packages', status: 'passed' },
      { id: 'stage-ui', status: 'passed' },
      { id: 'stage-vitest', status: 'passed' },
    ]
    assert.equal(classifyBenchmark({ commands: cmds }), 'PASS')
  })
  it('any executed failed forces FAIL regardless of optional', () => {
    // Even if marked as not mandatory historically, now all are required, but test generic
    const cmds = [
      { id: 'core-agent', status: 'passed' },
      { id: 'browser', status: 'failed' },
    ]
    assert.equal(classifyBenchmark({ commands: cmds }), 'FAIL')
  })
  it('skipped-optional does not affect PASS', () => {
    const cmds = [
      { id: 'core-agent', status: 'passed' },
      { id: 'lia-core', status: 'passed' },
      { id: 'runtime-smoke', status: 'skipped-optional' },
      { id: 'browser', status: 'passed' },
      { id: 'lint', status: 'passed' },
      { id: 'typecheck', status: 'passed' },
      { id: 'build-packages', status: 'passed' },
      { id: 'stage-ui', status: 'passed' },
      { id: 'stage-vitest', status: 'passed' },
    ]
    assert.equal(classifyBenchmark({ commands: cmds }), 'PASS')
  })
  it('unknown nonzero → FAIL not env', () => {
    const out = classifyCommandOutcome({ id: 'core-agent', exitCode: 1, stderr: 'assertion failed' })
    assert.equal(out, 'failed')
  })
})

describe('classification: D2B9-D missing browser executable precedence', () => {
  // The real Windows evidence for the stage-ui node command: every collected
  // suite passed, and the single error is the absent headless shell.
  const STAGE_UI_MIXED = [
    'Test Files  149 passed (149)',
    'Tests  1041 passed (1041)',
    'Errors  1',
    'Unhandled Error  browserType.launch: Executable doesn\'t exist at C:\\Users\\lia\\AppData\\Local\\ms-playwright\\chromium_headless_shell-1234\\chrome-win64\\headless_shell',
  ].join('\n')

  it('A: stage-ui node results fully passing with only the missing executable -> ENVIRONMENT-LIMITED', () => {
    const out = classifyCommandOutcome({ id: 'stage-ui', exitCode: 1, stdout: STAGE_UI_MIXED, stderr: '' })
    assert.equal(out, 'environment-limited')
    const bench = classifyBenchmark({ commands: [{ id: 'stage-ui', status: out }, { id: 'core-agent', status: 'passed' }, { id: 'lia-core', status: 'passed' }] })
    assert.equal(bench, 'ENVIRONMENT-LIMITED')
  })

  it('B: Stage full with real failed Node tests stays FAILED even when the executable is missing', () => {
    const out = classifyCommandOutcome({
      id: 'stage-vitest',
      exitCode: 1,
      stdout: [
        'Test Files  14 failed | 128 passed (142)',
        'Tests  14 failed | 1531 passed | 4 skipped (1549)',
        'browserType.launch: Executable doesn\'t exist',
      ].join('\n'),
      stderr: '',
    })
    assert.equal(out, 'failed')
    assert.equal(classifyBenchmark({ commands: [{ id: 'stage-vitest', status: out }] }), 'FAIL')
  })

  it('C: browser command with no tests and only the missing executable -> ENVIRONMENT-LIMITED', () => {
    const out = classifyCommandOutcome({ id: 'browser', exitCode: 1, stdout: 'Errors  1', stderr: 'browserType.launch: Executable doesn\'t exist' })
    assert.equal(out, 'environment-limited')
    assert.equal(classifyBenchmark({ commands: [{ id: 'browser', status: out }] }), 'ENVIRONMENT-LIMITED')
  })

  it('D: no regression - TS diagnostics, lint errors and real FAIL lines stay FAILED', () => {
    assert.equal(classifyCommandOutcome({ id: 'typecheck', exitCode: 2, stderr: 'error TS2554: Expected 2 arguments, but got 1.' }), 'failed')
    assert.equal(classifyCommandOutcome({ id: 'lint', exitCode: 1, stderr: '✖ 4 problems (4 errors, 0 warnings)' }), 'failed')
    assert.equal(classifyCommandOutcome({ id: 'stage-vitest', exitCode: 1, stdout: 'FAIL  src/renderer/services/lia/execution-reporter.test.ts' }), 'failed')
    // A missing executable can never outrank a real failure in the same run.
    assert.equal(classifyCommandOutcome({
      id: 'stage-ui',
      exitCode: 1,
      stdout: `Test Files  1 failed | 148 passed (149)\nbrowserType.launch: Executable doesn't exist`,
      stderr: '',
    }), 'failed')
  })
})

describe('classification: isEnvironmentFailure pure', () => {
  it('recognizes ENOENT', () => {
    assert.ok(isEnvironmentFailure({ id: 'core-agent', error: new Error('spawn ENOENT') }))
  })
  it('recognizes chromium missing', () => {
    assert.ok(isEnvironmentFailure({ id: 'browser', stderr: "Chromium executable doesn't exist at /tmp" }))
  })
  it('recognizes OOM', () => {
    assert.ok(isEnvironmentFailure({ id: 'typecheck', stderr: 'JavaScript heap out of memory' }))
  })
  it('does not classify arbitrary nonzero as env', () => {
    assert.equal(isEnvironmentFailure({ id: 'core-agent', exitCode: 1, stderr: 'test failure' }), false)
  })
})
