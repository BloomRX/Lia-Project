import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyCommandOutcome, parseVitestMetrics, parseLintMetrics, parseTypecheckMetrics, stripAnsi } from './qa-benchmark-lib.mjs'

describe('D2B9-A: classifier precedence', () => {
  it('A. typecheck with error TS2304 setTimeout → FAIL not ENV', () => {
    const out = classifyCommandOutcome({ id: 'typecheck', exitCode: 2, stdout: '', stderr: "src/foo.ts:10:5 - error TS2304: Cannot find name 'setTimeout'." })
    assert.equal(out, 'failed')
  })
  it('B. Stage Vitest 109 failed + ENOENT + Playwright missing → FAIL', () => {
    const stdout = `
Test Files  30 failed | 107 passed (141)
     Tests  109 failed | 1438 passed | 1 skipped (1548)
      Errors  1 error
      [browser] Chromium unavailable
      ENOENT: no such file
      Playwright executable missing
`
    const out = classifyCommandOutcome({ id: 'stage-vitest', exitCode: 1, stdout, stderr: '' })
    assert.equal(out, 'failed')
  })
  it('C. browser-only no tests + executable missing → ENV', () => {
    const stdout = `Test Files (4)
      Tests  no tests
      Errors  1 error
      Chromium executable doesn't exist at /tmp`
    const out = classifyCommandOutcome({ id: 'browser', exitCode: 1, stdout, stderr: '' })
    assert.equal(out, 'environment-limited')
  })
  it('D. lint 452 errors → FAIL', () => {
    const out = classifyCommandOutcome({ id: 'lint', exitCode: 1, stdout: '', stderr: '✖ 498 problems (452 errors, 46 warnings)\nDefinition for rule mock was not found' })
    assert.equal(out, 'failed')
  })
  it('E. stage-ui No projects matched → FAIL', () => {
    const out = classifyCommandOutcome({ id: 'stage-ui', exitCode: 1, stdout: '', stderr: 'No projects matched filter "@proj-airi/stage-ui"' })
    assert.equal(out, 'failed')
  })
  it('setTimeout false-env: typecheck diagnostics not confused with timeout', () => {
    const out = classifyCommandOutcome({ id: 'typecheck', exitCode: 2, stderr: "error TS2304: Cannot find name 'setTimeout'." })
    assert.equal(out, 'failed')
    // Ensure generic timeout does not trigger env
    const envCheck = classifyCommandOutcome({ id: 'lint', exitCode: 1, stderr: 'setTimeout is not defined' })
    assert.equal(envCheck, 'failed')
  })
})

describe('D2B9-A: metric parsers', () => {
  it('parses lia-core: 9 failed | 15 passed (24) and 21 failed | 288 passed (309)', () => {
    const text = `Test Files  9 failed | 15 passed (24)
      Tests  21 failed | 288 passed (309)`
    const m = parseVitestMetrics(text)
    assert.equal(m.filesTotal, 24)
    assert.equal(m.filesFailed, 9)
    assert.equal(m.filesPassed, 15)
    assert.equal(m.testsFailed, 21)
    assert.equal(m.testsPassed, 288)
    assert.equal(m.testsTotal, 309)
  })
  it('parses Stage: 30 failed | 107 passed (141) and 109 failed | 1438 passed | 1 skipped (1548) plus 1 error', () => {
    const text = `Test Files  30 failed | 107 passed (141)
      Tests  109 failed | 1438 passed | 1 skipped (1548)
      Errors  1 error`
    const m = parseVitestMetrics(text)
    assert.equal(m.filesTotal, 141)
    assert.equal(m.filesFailed, 30)
    assert.equal(m.filesPassed, 107)
    assert.equal(m.testsFailed, 109)
    assert.equal(m.testsPassed, 1438)
    assert.equal(m.testsSkipped, 1)
    assert.equal(m.testsTotal, 1548)
    assert.equal(m.errors, 1)
  })
  it('parses Browser: 4 files, no tests, 1 error', () => {
    const text = `Test Files (4)
      Tests  no tests
      Errors  1 error`
    const m = parseVitestMetrics(text)
    assert.equal(m.filesTotal, 4)
    assert.equal(m.testsFailed, 0)
    assert.equal(m.errors, 1)
  })
  it('parses Lint: 498 problems (452 errors, 46 warnings)', () => {
    const text = `✖ 498 problems (452 errors, 46 warnings)`
    const m = parseLintMetrics(text)
    assert.equal(m.problems, 498)
    assert.equal(m.errors, 452)
    assert.equal(m.warnings, 46)
  })
  it('handles ANSI codes', () => {
    const text = `\u001b[31mTest Files  9 failed | 15 passed (24)\u001b[0m\n\u001b[32mTests  21 failed | 288 passed (309)\u001b[0m`
    const m = parseVitestMetrics(text)
    assert.equal(m.filesFailed, 9)
    assert.equal(m.testsFailed, 21)
  })
  it('parses TypeScript 156 diagnostics', () => {
    const text = Array(156).fill("src/foo.ts:1:1 - error TS2304: Cannot find name 'x'").join("\n")
    const m = parseTypecheckMetrics(text)
    assert.equal(m.errors, 156)
  })
})

describe('D2B9-A: stage-ui canonical command', () => {
  it('uses pnpm run test-ui:run cwd airi', async () => {
    const { canonicalCommands } = await import('./qa-benchmark-lib.mjs')
    const cmds = canonicalCommands('/repo')
    const stageUi = cmds.find(c => c.id === 'stage-ui')
    assert.ok(stageUi)
    assert.deepEqual(stageUi.argv, ['pnpm', 'run', 'test-ui:run'])
    assert.ok(stageUi.cwd.endsWith('airi'))
    assert.ok(!stageUi.argv.join(' ').includes('@proj-airi/stage-ui'))
  })
})
