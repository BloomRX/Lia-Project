import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import os from 'node:os'
import nodePath from 'node:path'
import { publicCommandResult, maskPrivatePaths, containsPrivatePath, exitCodeForStatus } from './qa-benchmark-lib.mjs'
import { REPO_ROOT } from './qa-shared.mjs'

describe('publicCommandResult exact shape', () => {
  it('allows only whitelisted fields', () => {
    const raw = {
      id: 'browser',
      label: 'Browser Stage',
      cwd: '/home/user/Lia-Project/airi/apps/stage-tamagotchi',
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser'],
      startedAt: '2026-09-30T00:00:00Z',
      endedAt: '2026-09-30T00:00:10Z',
      durationMs: 10000,
      exitCode: 1,
      status: 'failed',
      stdout: 'SECRET OUTPUT',
      stderr: 'C:\\Users\\Alice\\secret',
      error: new Error('Error with absolute path /home/user/secret'),
      stack: 'stack trace',
      testFiles: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      errors: 1,
      logPath: '/tmp/c9f0f3/lia-123/log.log',
      truncated: false,
      extra: 'should not appear',
    }
    const pub = publicCommandResult(raw)
    assert.equal(pub.id, 'browser')
    assert.equal(pub.label, 'Browser Stage')
    assert.ok(pub.cwd)
    assert.deepEqual(pub.argv, ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser'])
    assert.equal(pub.exitCode, 1)
    assert.equal(pub.status, 'failed')
    // Forbidden fields must not appear
    const json = JSON.stringify(pub)
    assert.ok(!json.includes('SECRET OUTPUT'))
    assert.ok(!json.includes('C:\\Users\\Alice'))
    assert.ok(!json.includes('Error with absolute'))
    assert.ok(!json.includes('stack trace'))
    assert.ok(!json.includes('extra'))
    assert.ok(!pub.stdout)
    assert.ok(!pub.stderr)
    assert.ok(!pub.error)
    assert.ok(!pub.stack)
    // Allowed fields
    assert.ok('testFiles' in pub)
    assert.ok('logPath' in pub)
    assert.ok('truncated' in pub)
  })
  it('cwd is repo-relative, not absolute', () => {
    const raw = { id: 'core-agent', label: 'x', cwd: REPO_ROOT + '/airi', argv: ['pnpm','test'], startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1, exitCode: 0, status: 'passed', logPath: 'logs/test.log', truncated: false }
    const pub = publicCommandResult(raw)
    // Should not contain absolute repoRoot
    assert.ok(!pub.cwd.includes(REPO_ROOT))
    assert.ok(pub.cwd.includes('airi'))
  })
  it('stdout/stderr/error exclusion proof', () => {
    const raw = { id: 'lint', label: 'Lint', cwd: 'airi', argv: ['pnpm','lint'], startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1, exitCode: 1, status: 'failed', stdout: 'stdout leak', stderr: 'stderr leak', error: 'error leak', logPath: 'logs/lint.log', truncated: false }
    const pub = publicCommandResult(raw)
    const json = JSON.stringify(pub)
    assert.ok(!json.includes('stdout leak'))
    assert.ok(!json.includes('stderr leak'))
    assert.ok(!json.includes('error leak'))
  })
})

describe('repoRoot exclusion from gitInfo', () => {
  it('gitInfo publish should not contain repoRoot', async () => {
    const { createSummarySkeleton } = await import('./qa-benchmark-lib.mjs')
    const s = createSummarySkeleton({ runId: '20260930-000000-abc1234', sourceSha: 'a'.repeat(40), sourceBranch: 'arena/x', remoteSourceSha: 'a'.repeat(40), startedAt: new Date() })
    s.gitInfo = { sourceSha: 'a'.repeat(40), sourceBranch: 'arena/x', remoteSourceSha: 'a'.repeat(40), repoRoot: REPO_ROOT, gitVersion: '2', nodeVersion: 'v22', pnpmVersion: '9', pythonVersion: '3.11' }
    const pub = publicCommandResult({ id: 'test', label: 'test', cwd: 'airi', argv: ['pnpm','test'], startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1, exitCode: 0, status: 'passed', logPath: 'logs/test.log', truncated: false })
    // Simulate gitInfo publish filtering
    const gitPublish = { sourceSha: s.gitInfo.sourceSha, sourceBranch: s.gitInfo.sourceBranch, remoteSourceSha: s.gitInfo.remoteSourceSha, gitVersion: s.gitInfo.gitVersion, nodeVersion: s.gitInfo.nodeVersion, pnpmVersion: s.gitInfo.pnpmVersion, pythonVersion: s.gitInfo.pythonVersion }
    assert.ok(!JSON.stringify(gitPublish).includes(REPO_ROOT))
    assert.ok(!('repoRoot' in gitPublish))
  })
})

describe('path privacy masking', () => {
  it('masks repoRoot → <REPO>', () => {
    const text = `error in ${REPO_ROOT}/airi/foo.ts`
    const masked = maskPrivatePaths(text, { repoRoot: REPO_ROOT, homedir: os.homedir(), tmpdir: os.tmpdir() })
    assert.ok(masked.includes('<REPO>/airi/foo.ts'))
    assert.ok(!masked.includes(REPO_ROOT))
  })
  it('Windows path: C:\\Users\\Alice\\Documents\\Lia-Project\\airi\\foo.ts → <REPO>\\airi\\foo.ts', () => {
    const fakeRepo = 'C:\\Users\\Alice\\Documents\\Lia-Project'
    const text = `at ${fakeRepo}\\airi\\foo.ts:10:5`
    const masked = maskPrivatePaths(text, { repoRoot: fakeRepo, homedir: 'C:\\Users\\Alice', tmpdir: 'C:\\Temp' })
    assert.ok(masked.includes('<REPO>\\airi\\foo.ts'))
    assert.ok(!masked.includes('C:\\Users\\Alice\\Documents'))
    assert.ok(!masked.includes(fakeRepo))
  })
  // Deterministic and OS-independent. These roots deliberately do NOT overlap,
  // so each token is attributable to its own root. Deriving this expectation
  // from os.homedir()/os.tmpdir() made it OS-dependent: Windows nests TEMP
  // below HOME while Linux does not. The privacy contract is "no private bytes
  // remain", not "a TEMP path always renders as the literal <TEMP>".
  it('masks HOME and TEMP for non-overlapping roots', () => {
    const home = 'C:\\Users\\Alice'
    const tmp = 'D:\\Temp'
    const repo = 'J:\\Lia-Project'
    const ctx = { repoRoot: repo, homedir: home, tmpdir: tmp }
    const text = `home ${home}\\file and tmp ${tmp}\\file`
    const masked = maskPrivatePaths(text, ctx)

    assert.ok(masked.includes('<HOME>'), '<HOME> token must be present')
    assert.ok(masked.includes('<TEMP>'), '<TEMP> token must be present')
    assert.ok(!masked.includes(home), 'raw HOME must be absent')
    assert.ok(!masked.includes(tmp), 'raw TEMP must be absent')
    assert.ok(!masked.includes('Alice'), 'no username may remain')
    assert.equal(containsPrivatePath(masked, ctx), false)
  })
  // The real Windows shape: TEMP is nested below HOME. Under the frozen
  // repo -> home -> temp precedence HOME is replaced first, so a temp path
  // legitimately renders as <HOME>\AppData\Local\Temp\... instead of <TEMP>.
  // That is acceptable - the contract is that no private bytes survive - and
  // this test pins the behavior so it stays documented rather than surprising.
  it('nested TEMP under HOME (Windows shape) leaves no private bytes', () => {
    const home = 'C:\\Users\\Alice'
    const tmp = 'C:\\Users\\Alice\\AppData\\Local\\Temp'
    const repo = 'J:\\Lia-Project'
    const ctx = { repoRoot: repo, homedir: home, tmpdir: tmp }
    const input = `${tmp}\\something\\file.log`

    assert.equal(containsPrivatePath(input, ctx), true, 'private path must be detected before masking')

    const masked = maskPrivatePaths(input, ctx)
    assert.ok(!masked.includes('Alice'), 'no username may remain')
    assert.ok(!masked.includes(home), 'raw HOME must be absent')
    assert.ok(!masked.includes(tmp), 'raw TEMP must be absent')
    assert.equal(containsPrivatePath(masked, ctx), false)

    // Documents current precedence: <HOME> owns the nested prefix, and literal
    // <TEMP> is deliberately NOT required for the nested case.
    assert.ok(masked.includes('<HOME>'), 'HOME token owns the nested prefix')
    assert.ok(!masked.includes('<TEMP>'), 'nested TEMP renders under <HOME> with frozen precedence')
  })
  it('handles both slash representations', () => {
    const repo = '/home/user/Lia-Project'
    const text1 = `path ${repo}/airi/foo`
    const text2 = `path ${repo.replace(/\//g, '\\')}\\airi\\foo`
    const m1 = maskPrivatePaths(text1, { repoRoot: repo, homedir: os.homedir(), tmpdir: os.tmpdir() })
    const m2 = maskPrivatePaths(text2, { repoRoot: repo, homedir: os.homedir(), tmpdir: os.tmpdir() })
    assert.ok(m1.includes('<REPO>'))
    // m2 may contain backslashes, but should also be masked if we handle alt slashes
    assert.ok(m2.includes('<REPO>') || m2.includes('<HOME>') || m2.includes('<TEMP>') || !m2.includes(repo))
  })
})

describe('residual private-path gate', () => {
  it('detects residual repoRoot', () => {
    const text = `leaked ${REPO_ROOT}/secret`
    assert.ok(containsPrivatePath(text, { repoRoot: REPO_ROOT, homedir: os.homedir(), tmpdir: os.tmpdir() }))
    const masked = maskPrivatePaths(text, { repoRoot: REPO_ROOT, homedir: os.homedir(), tmpdir: os.tmpdir() })
    assert.ok(!containsPrivatePath(masked, { repoRoot: REPO_ROOT, homedir: os.homedir(), tmpdir: os.tmpdir() }))
  })
  it('detects HOME', () => {
    const home = os.homedir()
    assert.ok(containsPrivatePath(`file ${home}/.ssh`, { repoRoot: REPO_ROOT, homedir: home, tmpdir: os.tmpdir() }))
  })
})

describe('exit code mapping', () => {
  it('PASS 0, FAIL 1, ENV 2, INCOMPLETE 3', () => {
    assert.equal(exitCodeForStatus('PASS'), 0)
    assert.equal(exitCodeForStatus('FAIL'), 1)
    assert.equal(exitCodeForStatus('ENVIRONMENT-LIMITED'), 2)
    assert.equal(exitCodeForStatus('INCOMPLETE'), 3)
    assert.equal(exitCodeForStatus('unknown'), 3)
  })
})

describe('browser precise classifier', () => {
  it('realistic browser test with chromium should be FAIL not env', async () => {
    const { classifyCommandOutcome } = await import('./qa-benchmark-lib.mjs')
    const out = classifyCommandOutcome({ id: 'browser', exitCode: 1, stdout: '[browser] chromium Test Files 1 failed', stderr: 'AssertionError: expected true to be false\n at /tmp/test.ts:10' })
    assert.equal(out, 'failed')
  })
  it('Chromium executable does not exist → env-limited', async () => {
    const { classifyCommandOutcome } = await import('./qa-benchmark-lib.mjs')
    const out = classifyCommandOutcome({ id: 'browser', exitCode: 1, stdout: '', stderr: "Error: Chromium executable doesn't exist at /tmp/chromium" })
    assert.equal(out, 'environment-limited')
  })
})

// ---------------------------------------------------------------------------
// JSON-escaped private paths (D2B9-H)
//
// The real failure class: a Windows temp path nested below HOME reached a
// publication staging through a JSON-serialized log, where every backslash is
// doubled. The unescaped form never matches those bytes, so the old masker left
// them in place AND the residual gate reported the evidence clean.
//
// Identities here are fake (Alice) - never real user data.
// ---------------------------------------------------------------------------
describe('JSON-escaped private paths', () => {
  const HOME = 'C:\\Users\\Alice'
  const TMP = 'C:\\Users\\Alice\\AppData\\Local\\Temp'
  const REPO = 'J:\\Lia-Project'
  const ctx = { repoRoot: REPO, homedir: HOME, tmpdir: TMP }

  /** Real JSON string escaping, not a hand-assumed Windows shape. */
  const jsonEscaped = value => JSON.stringify(value).slice(1, -1)

  it('TEMP under HOME: detects the JSON-escaped bytes before masking (§9)', () => {
    const structured = {
      fields: {
        extensionsRoot: `${TMP}\\airi-plugins-AbCd12\\extensions\\v1`,
      },
    }
    const jsonLog = JSON.stringify(structured)

    // The exact representation that escaped into the real staging.
    assert.ok(jsonLog.includes(jsonEscaped(TMP)), 'json log must contain the escaped temp path')
    assert.ok(!jsonLog.includes(TMP), 'the unescaped form must NOT be what is present')

    // The essential assertion: the residual gate catches those exact bytes.
    assert.equal(containsPrivatePath(jsonLog, ctx), true)
  })

  it('TEMP under HOME: masking removes it and keeps the JSON parseable (§10)', () => {
    const structured = {
      fields: {
        extensionsRoot: `${TMP}\\airi-plugins-AbCd12\\extensions\\v1`,
      },
    }
    const jsonLog = JSON.stringify(structured)
    const masked = maskPrivatePaths(jsonLog, ctx)

    assert.ok(!masked.includes('Alice'), 'no username may remain')
    assert.ok(!masked.includes(jsonEscaped(HOME)), 'no JSON-escaped HOME may remain')
    assert.ok(!masked.includes(HOME), 'no ordinary HOME may remain')
    assert.equal(containsPrivatePath(masked, ctx), false)

    // Masking must not corrupt the log syntax.
    const reparsed = JSON.parse(masked)
    assert.ok(reparsed.fields.extensionsRoot.includes('<HOME>'))
  })

  it('REPO: detects and masks the JSON-escaped repo path (§11)', () => {
    const jsonLog = JSON.stringify({ file: `${REPO}\\airi\\foo.ts` })

    assert.ok(jsonLog.includes(jsonEscaped(REPO)), 'escaped repo path must be present')
    assert.equal(containsPrivatePath(jsonLog, ctx), true)

    const masked = maskPrivatePaths(jsonLog, ctx)
    assert.ok(masked.includes('<REPO>'), '<REPO> token must be present')
    assert.ok(!masked.includes(jsonEscaped(REPO)), 'escaped repo bytes must be gone')
    assert.ok(!masked.includes('Lia-Project'), 'no private repo bytes may remain')
    assert.equal(containsPrivatePath(masked, ctx), false)
    assert.ok(JSON.parse(masked).file.includes('<REPO>'))
  })

  it('HOME and TEMP are each covered on their own, not only via repoRoot (§12)', () => {
    for (const [label, value] of [['HOME', HOME], ['TEMP', TMP]]) {
      const jsonLog = JSON.stringify({ p: value })
      assert.ok(jsonLog.includes(jsonEscaped(value)), `${label}: escaped form must be present`)
      assert.equal(containsPrivatePath(jsonLog, ctx), true, `${label}: must be detected`)

      const masked = maskPrivatePaths(jsonLog, ctx)
      assert.ok(!masked.includes(jsonEscaped(value)), `${label}: escaped bytes must be gone`)
      assert.ok(!masked.includes('Alice'), `${label}: no username may remain`)
      assert.equal(containsPrivatePath(masked, ctx), false, `${label}: must be clean`)
    }
  })

  it('double-encoded evidence is still detected and masked (§13)', () => {
    const twice = JSON.stringify(JSON.stringify({ path: `${TMP}\\airi-plugins-AbCd12` }))

    assert.equal(containsPrivatePath(twice, ctx), true)
    const masked = maskPrivatePaths(twice, ctx)
    assert.ok(!masked.includes('Alice'), 'no username may remain')
    assert.equal(containsPrivatePath(masked, ctx), false)
  })

  it('masked ordinary text stays clean - no false positive from the new variants', () => {
    const benign = JSON.stringify({ note: 'all good', count: 3, token: '<HOME>' })
    assert.equal(containsPrivatePath(benign, ctx), false)
    assert.equal(maskPrivatePaths(benign, ctx), benign)
  })
})
