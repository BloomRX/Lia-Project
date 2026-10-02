import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { describe, it } from 'node:test'

import { REPO_ROOT } from './qa-shared.mjs'
import {
  benchmarkRunId,
  boundText,
  buildShaManifest,
  canonicalCommands,
  classifyBenchmark,
  createSummarySkeleton,
  hardwareFromNode,
  isPublishAllowed,
  nextBenchmarkRunId,
  PUBLISH_FILE_HARD_MAX,
  PUBLISH_PER_LOG_MAX,
  PUBLISH_TOTAL_HARD_MAX,
  sha256OfText,
} from './qa-benchmark-lib.mjs'

// ---------------------------------------------------------------------------
// benchmarkRunId + collision
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: benchmarkRunId', () => {
  it('formats YYYYMMDD-HHMMSS-<short>', () => {
    const id = benchmarkRunId(new Date('2026-09-29T14:05:06.123Z'), 'abc1234')
    assert.match(id, /^\d{8}-\d{6}-abc1234$/)
  })
  it('produces monotonic collision suffixes', () => {
    const now = new Date('2026-09-29T14:05:06Z')
    const a = benchmarkRunId(now, 'abc1234')
    const b = nextBenchmarkRunId(a, new Set([a]))
    const c = nextBenchmarkRunId(a, new Set([a,b]))
    assert.equal(b, `${a}-2`)
    assert.equal(c, `${a}-3`)
  })
  it('reuses runTimestampId semantics (zero-padded UTC)', () => {
    const id = benchmarkRunId(new Date(Date.UTC(2026,0,2,3,4,5)), 'deadbee')
    assert.equal(id, '20260102-030405-deadbee')
  })
})

// ---------------------------------------------------------------------------
// canonicalCommands
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: canonicalCommands', () => {
  it('returns pnpm exec, never npx nor install', () => {
    const cmds = canonicalCommands(nodePath.join(REPO_ROOT))
    for (const c of cmds) {
      assert.equal(c.argv[0], 'pnpm', `expected pnpm exec for ${c.id}`)
      assert.ok(c.argv[1]==='exec' || c.argv.includes('test') || c.argv.includes('lint') || c.argv.includes('typecheck') || c.argv.includes('build:packages') || c.argv.includes('run'), `unexpected argv for ${c.id}: ${c.argv.join(' ')}`)
      assert.ok(!c.argv.join(' ').includes('npx'), `must not use npx: ${c.id}`)
      assert.ok(!c.argv.join(' ').includes('install'), `must not install: ${c.id}`)
    }
  })
  it('lia-core uses canonical pnpm test not re-invented vitest', () => {
    const cmds = canonicalCommands(REPO_ROOT)
    const lia = cmds.find(c=>c.id==='lia-core')
    assert.deepEqual(lia.argv, ['pnpm','test'])
    assert.ok(lia.cwd.endsWith('lia-core'))
  })
  it('core-agent uses vitest run --project @proj-airi/core-agent', () => {
    const cmds = canonicalCommands(REPO_ROOT)
    const ca = cmds.find(c=>c.id==='core-agent')
    assert.deepEqual(ca.argv, ['pnpm','exec','vitest','run','--project','@proj-airi/core-agent'])
  })
  it('browser uses vitest run --project browser', () => {
    const cmds = canonicalCommands(REPO_ROOT)
    const br = cmds.find(c=>c.id==='browser')
    assert.deepEqual(br.argv, ['pnpm','exec','vitest','run','--project','browser'])
  })
  it('all ids unique and at least 4 commands', () => {
    const cmds = canonicalCommands(REPO_ROOT)
    assert.ok(cmds.length >= 4)
    assert.equal(new Set(cmds.map(c=>c.id)).size, cmds.length)
  })
})

// ---------------------------------------------------------------------------
// classifyBenchmark
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: classifyBenchmark', () => {
  it('PASS when all passed and no env limits', () => {
    assert.equal(classifyBenchmark({ commands: [{status:'passed'},{status:'passed'}], environmentLimitations: [] }), 'PASS')
  })
  it('FAIL when any failed', () => {
    assert.equal(classifyBenchmark({ commands: [{status:'passed'},{status:'failed'}], environmentLimitations: [] }), 'FAIL')
  })
  it('ENVIRONMENT-LIMITED when any env-limited and none failed', () => {
    assert.equal(classifyBenchmark({ commands: [{status:'passed'},{status:'environment-limited'}], environmentLimitations: ['x'] }), 'ENVIRONMENT-LIMITED')
    assert.equal(classifyBenchmark({ commands: [{status:'passed'}], environmentLimitations: ['missing tool'] }), 'ENVIRONMENT-LIMITED')
  })
  it('FAIL takes precedence over env-limited', () => {
    assert.equal(classifyBenchmark({ commands: [{status:'failed'},{status:'environment-limited'}], environmentLimitations: ['x'] }), 'FAIL')
  })
})

// ---------------------------------------------------------------------------
// boundText / limits
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: boundText', () => {
  it('passes through short text', () => {
    const r = boundText('hello', 10)
    assert.equal(r.text, 'hello')
    assert.equal(r.truncated, false)
  })
  it('head+tail with marker when over limit', () => {
    const big = 'A'.repeat(5000) + 'B'.repeat(5000)
    const r = boundText(big, 4000)
    assert.equal(r.truncated, true)
    assert.ok(r.text.toLowerCase().includes('truncated'))
    assert.ok(r.text.startsWith('A'.repeat(100)))
    assert.ok(r.text.endsWith('B'.repeat(100)))
    assert.ok(Buffer.from(r.text).length <= 4000 + 500)
  })
  it('constants match spec', () => {
    assert.equal(PUBLISH_PER_LOG_MAX, 2*1024*1024)
    assert.equal(PUBLISH_FILE_HARD_MAX, 5*1024*1024)
    assert.equal(PUBLISH_TOTAL_HARD_MAX, 10*1024*1024)
  })
})

// ---------------------------------------------------------------------------
// sha256 deterministic
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: sha256 + manifest', () => {
  it('sha256OfText known vector', () => {
    assert.equal(sha256OfText('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
  it('buildShaManifest lexically sorted', () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'lia-manifest-'))
    const a = nodePath.join(dir, 'b.txt'); writeFileSync(a,'b')
    const b = nodePath.join(dir, 'a.txt'); writeFileSync(b,'a')
    const manifest = buildShaManifest([a,b], dir)
    const lines = manifest.trim().split('\n')
    assert.ok(lines[0].includes('a.txt'))
    assert.ok(lines[1].includes('b.txt'))
  })
  it('manifest lines are <hex>  <rel>', () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'lia-manifest2-'))
    const f = nodePath.join(dir, 'x.log'); writeFileSync(f,'x')
    const m = buildShaManifest([f], dir)
    assert.match(m.trim(), /^[0-9a-f]{64}  x\.log$/)
  })
})

// ---------------------------------------------------------------------------
// hardwareFromNode safe
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: hardwareFromNode', () => {
  it('returns safe fields, no user paths', () => {
    const hw = hardwareFromNode()
    assert.ok(hw.os)
    assert.ok(hw.arch)
    assert.ok(hw.nodeVersion)
    assert.ok(typeof hw.totalRamBytes === 'number')
    // must not contain APPDATA, HOME, etc.
    const json = JSON.stringify(hw)
    assert.ok(!json.includes(process.env.APPDATA ?? '___notset___') || !process.env.APPDATA)
  })
})

// ---------------------------------------------------------------------------
// summary skeleton
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: createSummarySkeleton', () => {
  it('has required keys and schemaVersion 1', () => {
    const s = createSummarySkeleton({ runId: '20260929-120000-abc1234', sourceSha: 'a'.repeat(40), sourceBranch: 'arena/x', remoteSourceSha: 'a'.repeat(40), startedAt: new Date('2026-09-29T12:00:00Z') })
    assert.equal(s.schemaVersion, 1)
    assert.equal(s.runId, '20260929-120000-abc1234')
    assert.ok(s.redaction)
    assert.ok(s.publication)
    assert.ok(s.truncation)
  })
})

// ---------------------------------------------------------------------------
// isPublishAllowed
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: isPublishAllowed', () => {
  it('allows benchmark run and index/README', () => {
    assert.ok(isPublishAllowed('benchmarks/20260929-120000-abc1234/summary.json', '20260929-120000-abc1234'))
    assert.ok(isPublishAllowed('benchmarks/20260929-120000-abc1234/logs/core-agent.log', '20260929-120000-abc1234'))
    assert.ok(isPublishAllowed('index.json', '20260929-120000-abc1234'))
    assert.ok(isPublishAllowed('README.md', '20260929-120000-abc1234'))
  })
  it('denies other benchmark, raw, devkit-qa', () => {
    assert.equal(isPublishAllowed('benchmarks/20260929-120000-OTHER/summary.json', '20260929-120000-abc1234'), false)
    assert.equal(isPublishAllowed('Tests/runs/20260929-120000-abc1234/logs/raw/x.log', '20260929-120000-abc1234'), false)
    assert.equal(isPublishAllowed('.devkit-qa/x', '20260929-120000-abc1234'), false)
    assert.equal(isPublishAllowed('benchmarks/20260929-120000-abc1234', '20260929-120000-abc1234'), false) // dir itself
  })
})

// ---------------------------------------------------------------------------
// powershellCommands contain CIM
// ---------------------------------------------------------------------------
describe('qa-benchmark-lib: powershellCommands CIM', () => {
  it('mentions Get-CimInstance Win32_*', async () => {
    const { powershellCommands } = await import('./qa-benchmark-lib.mjs')
    const cmds = powershellCommands()
    const joined = cmds.join('\n')
    assert.ok(joined.includes('Win32_OperatingSystem'))
    assert.ok(joined.includes('Win32_Processor'))
    assert.ok(joined.includes('Win32_VideoController'))
  })
})
// ---------------------------------------------------------------------------
// Chromium inventory: the field must mean the EXECUTABLE exists (D2B9-G)
// ---------------------------------------------------------------------------
describe('qa-benchmark: detectPlaywrightChromiumAvailability', () => {
  /** A spawn double that records the call and answers with a fixed status. */
  function recordingSpawn({ status = 0, throws = false } = {}) {
    const calls = []
    const spawn = (command, args, options) => {
      calls.push({ command, args, options })
      if (throws) throw new Error('spawn exploded')
      return { status, stdout: '', stderr: '' }
    }
    return { calls, spawn }
  }

  it('A: a child probe exiting 0 reports the executable as available', async () => {
    const { detectPlaywrightChromiumAvailability } = await import('./qa-benchmark.mjs')
    const { spawn } = recordingSpawn({ status: 0 })
    assert.equal(detectPlaywrightChromiumAvailability({ platform: 'linux', spawn, repoRoot: '/fake/repo' }), true)
  })

  it('B: a child probe exiting nonzero reports it as unavailable', async () => {
    const { detectPlaywrightChromiumAvailability } = await import('./qa-benchmark.mjs')
    for (const status of [1, 2, null]) {
      const { spawn } = recordingSpawn({ status })
      assert.equal(
        detectPlaywrightChromiumAvailability({ platform: 'linux', spawn, repoRoot: '/fake/repo' }),
        false,
        `status ${status} must be unavailable`,
      )
    }
  })

  it('C: a throwing spawn reports it as unavailable instead of failing the run', async () => {
    const { detectPlaywrightChromiumAvailability } = await import('./qa-benchmark.mjs')
    const { spawn } = recordingSpawn({ throws: true })
    assert.equal(detectPlaywrightChromiumAvailability({ platform: 'linux', spawn, repoRoot: '/fake/repo' }), false)
  })

  it('D: probes from the AIRI workspace, not the repository root', async () => {
    const { detectPlaywrightChromiumAvailability } = await import('./qa-benchmark.mjs')
    const { calls, spawn } = recordingSpawn({ status: 0 })
    detectPlaywrightChromiumAvailability({ platform: 'linux', spawn, repoRoot: '/fake/repo' })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.cwd, nodePath.join('/fake/repo', 'airi'))
    assert.notEqual(calls[0].options.cwd, '/fake/repo')
  })

  it('E: asks for the Chromium executable path, never a CLI version string', async () => {
    const { detectPlaywrightChromiumAvailability } = await import('./qa-benchmark.mjs')
    const { calls, spawn } = recordingSpawn({ status: 0 })
    detectPlaywrightChromiumAvailability({ platform: 'linux', spawn, repoRoot: '/fake/repo' })

    const { command, args } = calls[0]
    // Through pnpm, in the workspace, as an ES module probe - no shell involved.
    assert.equal(command, 'pnpm')
    assert.deepEqual(args.slice(0, 4), ['exec', 'node', '--input-type=module', '-e'])

    const probe = args.at(-1)
    // The semantics that make the field mean what its name says.
    assert.ok(probe.includes('chromium.executablePath()'), 'must ask Playwright for the executable path')
    assert.ok(probe.includes('existsSync('), 'must check that the file exists')
    assert.ok(probe.includes('process.exit('), 'must answer through the exit code only')
    // A CLI version string proves the npm package, not a runnable browser.
    assert.ok(!probe.includes('--version'), 'must not fall back to a version probe')
    assert.ok(!probe.includes('playwright --version'))
    // No absolute path is emitted by the child, and the probe stays one line so
    // Windows cmd.exe quoting cannot truncate it.
    assert.ok(!probe.includes('\n'), 'probe must stay a single line')
  })
})
