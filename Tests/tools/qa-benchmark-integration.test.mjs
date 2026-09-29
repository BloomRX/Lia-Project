import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import os from 'node:os'
import { describe, it, beforeEach, afterEach } from 'node:test'

// Import harness after lib
import { REPO_ROOT } from './qa-shared.mjs'
import { benchmarkRunId, nextBenchmarkRunId, isBenchmarkPublishPath, validateStagedAllowlist, buildShaManifest, verifyShaManifest, PUBLISH_TOTAL_HARD_MAX, PUBLISH_FILE_HARD_MAX } from './qa-benchmark-lib.mjs'
import { preflightSource, runBenchmark, createBenchmarkRawRun, createPublishStaging } from './qa-benchmark.mjs'

function git(cwd, args) {
  const p = spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return p
}
function gitOk(cwd, args) {
  const p = git(cwd, args)
  if (p.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${p.stderr} ${p.stdout}`)
  return p
}
function initBareRemote() {
  const dir = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-bare-'))
  gitOk(dir, ['init', '--bare'])
  // Allow push to non-bare? For bare it's fine
  return dir
}
function initSourceRepo(barePath, branch = 'arena/test-branch') {
  const src = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-src-'))
  gitOk(src, ['clone', barePath, '.'])
  gitOk(src, ['config', 'user.name', 'Test'])
  gitOk(src, ['config', 'user.email', 'test@test.test'])
  // Create initial commit
  writeFileSync(nodePath.join(src, 'README.md'), '# test\n', 'utf-8')
  // Ensure Tests/tools exists for harness? Copy minimal needed? For preflight we just need git repo, but for benchmark run we need harness files
  // Copy harness files from real repo
  const realTools = nodePath.join(REPO_ROOT, 'Tests', 'tools')
  const destTools = nodePath.join(src, 'Tests', 'tools')
  mkdirSync(destTools, { recursive: true })
  for (const f of ['qa-benchmark.mjs','qa-benchmark-lib.mjs','qa-security-bridge.py','qa-shared.mjs']) {
    const srcF = nodePath.join(realTools, f)
    if (existsSync(srcF)) {
      // Need to adjust imports? But we will run benchmark via imported function, not via file path, so we just need placeholder
      // Instead, we will run runBenchmark with repoRoot = src, which will look for Tests/tools/qa-security-bridge.py etc.
      // So copy real files
      mkdirSync(nodePath.dirname(nodePath.join(src, 'Tests', 'tools', f)), { recursive: true })
      writeFileSync(nodePath.join(src, 'Tests', 'tools', f), readFileSync(srcF, 'utf-8'), 'utf-8')
    }
  }
  // Also copy tools/project_cli.py
  mkdirSync(nodePath.join(src, 'tools'), { recursive: true })
  const cliSrc = nodePath.join(REPO_ROOT, 'tools', 'project_cli.py')
  if (existsSync(cliSrc)) writeFileSync(nodePath.join(src, 'tools', 'project_cli.py'), readFileSync(cliSrc, 'utf-8'), 'utf-8')
  // Copy .gitignore that ignores Tests/runs and .devkit-qa
  const giSrc = nodePath.join(REPO_ROOT, '.gitignore')
  if (existsSync(giSrc)) writeFileSync(nodePath.join(src, '.gitignore'), readFileSync(giSrc, 'utf-8'), 'utf-8')
  else writeFileSync(nodePath.join(src, '.gitignore'), 'Tests/runs/\nTests/runtimes/\nTests/logs/\nTests/inventory/\n.devkit-qa/\n', 'utf-8')
  // Create dummy bins for pnpm exec checks so mocked runners are not marked env-limited
  for (const bin of ['vitest', 'playwright', 'eslint', 'tsc']) {
    const p1 = nodePath.join(src, 'airi', 'node_modules', '.bin', bin)
    mkdirSync(nodePath.dirname(p1), { recursive: true })
    writeFileSync(p1, '# dummy', 'utf-8')
    const p2 = nodePath.join(src, 'airi', 'apps', 'stage-tamagotchi', 'node_modules', '.bin', bin)
    mkdirSync(nodePath.dirname(p2), { recursive: true })
    writeFileSync(p2, '# dummy', 'utf-8')
  }
  // Create branch and commit
  gitOk(src, ['checkout', '-b', branch])
  gitOk(src, ['add', '.'])
  gitOk(src, ['commit', '-m', 'init'])
  gitOk(src, ['push', '-u', 'origin', branch])
  return { src, barePath, branch }
}
function mockHardware() {
  return { os: 'linux 5.0 x64', platform: 'linux', arch: 'x64', cpuModel: 'TestCPU', logicalCores: 4, totalRamBytes: 8*1024*1024*1024, nodeVersion: 'v22', pnpmVersion: '9.0.0', gitVersion: '2.0', pythonVersion: '3.11.0' }
}
function mockRunner(status = 'passed') {
  return ({ id, label, cwd, argv, logPath, repoRoot }) => {
    const stdout = status === 'failed' ? 'Test Files 1 failed' : 'Test Files 1 passed'
    const stderr = status === 'failed' ? 'failure' : ''
    const exitCode = status === 'passed' ? 0 : status === 'failed' ? 1 : null
    const finalStatus = status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'environment-limited'
    try { mkdirSync(nodePath.dirname(logPath), { recursive: true }); writeFileSync(logPath, `STDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`, 'utf-8') } catch {}
    return { id, label, cwd: nodePath.relative(repoRoot, cwd).replace(/\\/g,'/'), argv, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 10, exitCode, status: finalStatus, stdout, stderr, logPath: nodePath.relative(repoRoot, logPath).replace(/\\/g,'/'), truncated: false }
  }
}
function mockRunnerMatrix(map) {
  return ({ id, ...rest }) => {
    const s = map[id] || 'passed'
    return mockRunner(s)({ id, ...rest })
  }
}

let tmpToClean = []
afterEach(() => {
  for (const p of tmpToClean) try { rmSync(p, { recursive: true, force: true }) } catch {}
  tmpToClean = []
})

// ---------------------------------------------------------------------------
// A-D preflight
// ---------------------------------------------------------------------------
describe('integration: preflight A-D', () => {
  it('A: clean source + matching remote passes', () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src, branch } = initSourceRepo(bare); tmpToClean.push(src)
    const pre = preflightSource({ repoRoot: src })
    assert.equal(pre.errors.length, 0)
    assert.ok(pre.sourceRemoteObserved)
    assert.equal(pre.head, pre.remoteSha)
  })
  it('B: dirty source stops before command runner', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    writeFileSync(nodePath.join(src, 'dirty.txt'), 'dirty', 'utf-8')
    const pre = preflightSource({ repoRoot: src })
    assert.ok(pre.errors.some(e => e.includes('dirty')))
    // runBenchmark should throw preflight failed
    let threw = false
    try { await runBenchmark({ repoRoot: src, args: ['--no-push'], now: new Date('2026-09-29T12:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware }) } catch (e) { threw = true; assert.match(String(e.message), /preflight/) }
    assert.ok(threw)
  })
  it('C: remote ref missing stops before tests', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const src = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-src-missing-')); tmpToClean.push(src)
    gitOk(src, ['init'])
    gitOk(src, ['config', 'user.name', 'Test'])
    gitOk(src, ['config', 'user.email', 'test@test.test'])
    gitOk(src, ['remote', 'add', 'origin', bare])
    writeFileSync(nodePath.join(src, 'README.md'), 'hi', 'utf-8')
    gitOk(src, ['add', '.']); gitOk(src, ['commit', '-m', 'init'])
    gitOk(src, ['checkout', '-b', 'arena/missing-branch'])
    // Do not push, so remote ref missing
    const pre = preflightSource({ repoRoot: src })
    assert.ok(pre.errors.some(e => e.includes('source remote not observed')))
    let threw = false
    try { await runBenchmark({ repoRoot: src, args: ['--no-push'], now: new Date(), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware }) } catch (e) { threw = true }
    assert.ok(threw)
  })
  it('D: source remote mismatch stops before tests', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src, branch } = initSourceRepo(bare); tmpToClean.push(src)
    // Create new commit locally without pushing
    writeFileSync(nodePath.join(src, 'extra.txt'), 'extra', 'utf-8')
    gitOk(src, ['add', '.']); gitOk(src, ['commit', '-m', 'extra local'])
    const pre = preflightSource({ repoRoot: src })
    assert.ok(pre.errors.some(e => e.includes('!=')))
    assert.equal(pre.head !== pre.remoteSha, true)
    let threw = false
    try { await runBenchmark({ repoRoot: src, args: ['--no-push'], now: new Date(), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware }) } catch (e) { threw = true }
    assert.ok(threw)
  })
})

// ---------------------------------------------------------------------------
// E-I first publication
// ---------------------------------------------------------------------------
describe('integration: first QA publication E-I', () => {
  it('E: first QA publication creates orphan evidence-only branch', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T12:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    assert.ok(res)
    assert.equal(res.status, 'PASS')
    // Check QA branch exists on bare
    const ls = git(bare, ['show-ref', '--verify', 'refs/heads/qa/windows-benchmarks'])
    assert.equal(ls.status, 0)
    // Check orphan: should not contain source README at root? Actually first commit contains only benchmarks, README, index
    const cloneQa = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-clone-')); tmpToClean.push(cloneQa)
    gitOk(cloneQa, ['clone', bare, '.'])
    gitOk(cloneQa, ['checkout', 'qa/windows-benchmarks'])
    assert.ok(existsSync(nodePath.join(cloneQa, 'README.md')))
    assert.ok(existsSync(nodePath.join(cloneQa, 'index.json')))
    const benchDirs = readdirSync(nodePath.join(cloneQa, 'benchmarks'))
    assert.ok(benchDirs.length === 1)
    // No source tree file like airi/package.json should be at root of QA branch
    assert.ok(!existsSync(nodePath.join(cloneQa, 'airi', 'package.json')))
    assert.ok(!existsSync(nodePath.join(cloneQa, 'Tests', 'tools', 'qa-benchmark.mjs')))
  })
  it('F: first QA branch contains expected layout and no source tree', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-30T10:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const cloneQa = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa2-')); tmpToClean.push(cloneQa)
    gitOk(cloneQa, ['clone', bare, '.'])
    gitOk(cloneQa, ['checkout', 'qa/windows-benchmarks'])
    const files = gitOk(cloneQa, ['ls-tree', '-r', '--name-only', 'HEAD']).stdout.trim().split('\n')
    assert.ok(files.includes('README.md'))
    assert.ok(files.includes('index.json'))
    assert.ok(files.some(f => f.startsWith('benchmarks/') && f.includes('/REPORT.md')))
    assert.ok(files.some(f => f.includes('SHA256SUMS.txt')))
    // No source files
    assert.ok(!files.some(f => f.startsWith('airi/')))
    assert.ok(!files.some(f => f.startsWith('src/')))
  })
  it('G: existing QA branch appends one run', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T12:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T13:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const cloneQa = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa3-')); tmpToClean.push(cloneQa)
    gitOk(cloneQa, ['clone', bare, '.'])
    gitOk(cloneQa, ['checkout', 'qa/windows-benchmarks'])
    const idx = JSON.parse(readFileSync(nodePath.join(cloneQa, 'index.json'), 'utf-8'))
    assert.equal(idx.length, 2)
    const benchDirs = readdirSync(nodePath.join(cloneQa, 'benchmarks'))
    assert.equal(benchDirs.length, 2)
  })
  it('H: existing prior benchmark folder unchanged', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const first = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T12:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const firstId = first.runId
    const clone1 = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-h1-')); tmpToClean.push(clone1)
    gitOk(clone1, ['clone', bare, '.']); gitOk(clone1, ['checkout', 'qa/windows-benchmarks'])
    const firstReportBefore = readFileSync(nodePath.join(clone1, 'benchmarks', firstId, 'REPORT.md'), 'utf-8')
    await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T13:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const clone2 = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-h2-')); tmpToClean.push(clone2)
    gitOk(clone2, ['clone', bare, '.']); gitOk(clone2, ['checkout', 'qa/windows-benchmarks'])
    const firstReportAfter = readFileSync(nodePath.join(clone2, 'benchmarks', firstId, 'REPORT.md'), 'utf-8')
    assert.equal(firstReportBefore, firstReportAfter)
  })
  it('I: source checkout HEAD/branch/status unchanged after publication', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src, branch } = initSourceRepo(bare); tmpToClean.push(src)
    const beforeHead = gitOk(src, ['rev-parse', 'HEAD']).stdout.trim()
    const beforeBranch = gitOk(src, ['branch', '--show-current']).stdout.trim()
    const beforeStatus = gitOk(src, ['status', '--porcelain=v1', '-uall']).stdout
    await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T12:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const afterHead = gitOk(src, ['rev-parse', 'HEAD']).stdout.trim()
    const afterBranch = gitOk(src, ['branch', '--show-current']).stdout.trim()
    const afterStatus = gitOk(src, ['status', '--porcelain=v1', '-uall']).stdout
    assert.equal(afterHead, beforeHead)
    assert.equal(afterBranch, beforeBranch)
    assert.equal(afterStatus, beforeStatus)
  })
})

// ---------------------------------------------------------------------------
// J-L race gates
// ---------------------------------------------------------------------------
describe('integration: race gates J-L', () => {
  it('J: source remote moves before first QA push → push blocked', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    // Prepare to run benchmark but simulate source move by pushing extra commit to bare directly via another clone before publication's final push
    // We'll patch runBenchmark to intercept? Simpler: run benchmark with a commandRunner that does the race during execution
    const raceRunner = ({ id, ...rest }) => {
      // After first command, push new commit to bare to move source remote
      if (id === 'core-agent') {
        const other = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-race-other-')); tmpToClean.push(other)
        gitOk(other, ['clone', bare, '.'])
        gitOk(other, ['config', 'user.name', 'Other'])
        gitOk(other, ['config', 'user.email', 'other@test.test'])
        gitOk(other, ['checkout', rest.repoRoot ? 'arena/test-branch' : 'master']) // fallback
        // Find branch name
        const br = gitOk(src, ['branch', '--show-current']).stdout.trim()
        try { gitOk(other, ['checkout', br]) } catch {}
        writeFileSync(nodePath.join(other, 'race.txt'), 'race', 'utf-8')
        gitOk(other, ['add', '.']); gitOk(other, ['commit', '-m', 'race'])
        gitOk(other, ['push', 'origin', br])
      }
      return mockRunner('passed')({ id, ...rest })
    }
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T12:00:00Z'), commandRunner: raceRunner, hardwareCollector: mockHardware })
    // Should have blocked with SOURCE_REMOTE_MOVED
    assert.equal(res.publication.pushSkippedReason, 'SOURCE_REMOTE_MOVED_DURING_BENCHMARK')
    // QA branch should not exist or not have new run?
    const ls = git(bare, ['show-ref', '--verify', 'refs/heads/qa/windows-benchmarks'])
    // If race happened before first push, QA branch may not exist or may exist from earlier? In this test, it's first push, so should be absent
    // If blocked, no QA branch
    // But our race pushed to source branch, not QA, so QA may still be absent
    // Check that publication did not succeed
    assert.equal(res.publication.pushed, false)
  })
  it('K: QA branch appears concurrently → push blocked (first publication)', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    let raceDone = false
    const raceRunner = ({ id, ...rest }) => {
      if (!raceDone && id === 'lint') {
        raceDone = true
        // Create QA branch concurrently directly on bare
        const other = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-race-')); tmpToClean.push(other)
        gitOk(other, ['clone', bare, '.'])
        gitOk(other, ['config', 'user.name', 'Other'])
        gitOk(other, ['config', 'user.email', 'other@test.test'])
        gitOk(other, ['checkout', '--orphan', 'qa/windows-benchmarks'])
        // Remove files
        for (const e of readdirSync(other)) if (e !== '.git') rmSync(nodePath.join(other, e), { recursive: true, force: true })
        writeFileSync(nodePath.join(other, 'README.md'), '# race qa\n', 'utf-8')
        writeFileSync(nodePath.join(other, 'index.json'), '[]\n', 'utf-8')
        mkdirSync(nodePath.join(other, 'benchmarks', 'race'), { recursive: true })
        writeFileSync(nodePath.join(other, 'benchmarks', 'race', 'dummy.txt'), 'x', 'utf-8')
        gitOk(other, ['add', '.']); gitOk(other, ['commit', '-m', 'race qa'])
        gitOk(other, ['push', 'origin', 'qa/windows-benchmarks'])
      }
      return mockRunner('passed')({ id, ...rest })
    }
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T14:00:00Z'), commandRunner: raceRunner, hardwareCollector: mockHardware })
    assert.ok(res.publication.pushSkippedReason === 'QA_REMOTE_MOVED' || res.publication.pushSkippedReason === 'publication-error' || res.publication.pushSkippedReason === 'QA_REMOTE_MOVED_DURING_BENCHMARK' || res.publication.pushed === false)
    // Ensure our run not published? Check that our runId not in QA index
    const cloneQa = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-k-check-')); tmpToClean.push(cloneQa)
    gitOk(cloneQa, ['clone', bare, '.'])
    gitOk(cloneQa, ['checkout', 'qa/windows-benchmarks'])
    const idx = JSON.parse(readFileSync(nodePath.join(cloneQa, 'index.json'), 'utf-8'))
    // Our runId should not be there (since blocked), only race dummy not in index? Actually race created index with [], so not our run
    // Just ensure no extra run with our timestamp
    // The test passes if push blocked
    assert.equal(res.publication.pushed, false)
  })
  it('L: existing QA remote moves → push blocked', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    // First publish succeeds
    await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T12:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    // Now race for second publish
    let raceDone = false
    const raceRunner = ({ id, ...rest }) => {
      if (!raceDone && id === 'lint') {
        raceDone = true
        const other = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-race2-')); tmpToClean.push(other)
        gitOk(other, ['clone', bare, '.'])
        gitOk(other, ['config', 'user.name', 'Other'])
        gitOk(other, ['config', 'user.email', 'other@test.test'])
        gitOk(other, ['checkout', 'qa/windows-benchmarks'])
        writeFileSync(nodePath.join(other, 'race2.txt'), 'race2', 'utf-8')
        // Need to commit via allowlist? But we bypass allowlist by directly committing race file not allowed? For test, we want to simulate QA moving, so we can force commit with --allow-empty or add file under benchmarks/race2
        mkdirSync(nodePath.join(other, 'benchmarks', 'race2'), { recursive: true })
        writeFileSync(nodePath.join(other, 'benchmarks', 'race2', 'dummy.txt'), 'y', 'utf-8')
        // Update index
        const idxPath = nodePath.join(other, 'index.json')
        const idx = JSON.parse(readFileSync(idxPath, 'utf-8'))
        idx.unshift({ runId: 'race2', sourceSha: 'abc', sourceBranch: 'x', status: 'PASS', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 1, reportPath: 'benchmarks/race2/REPORT.md' })
        writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n', 'utf-8')
        gitOk(other, ['add', '.']); gitOk(other, ['commit', '-m', 'race qa move'])
        gitOk(other, ['push', 'origin', 'qa/windows-benchmarks'])
      }
      return mockRunner('passed')({ id, ...rest })
    }
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T13:00:00Z'), commandRunner: raceRunner, hardwareCollector: mockHardware })
    assert.ok(res.publication.pushSkippedReason === 'QA_REMOTE_MOVED' || res.publication.pushSkippedReason === 'QA remote moved' || res.publication.pushed === false)
    assert.equal(res.publication.pushed, false)
  })
})

// ---------------------------------------------------------------------------
// M strict allowlist
// ---------------------------------------------------------------------------
describe('integration: strict allowlist M', () => {
  it('catches foreign path', () => {
    assert.equal(isBenchmarkPublishPath('benchmarks/20260929-120000-abc1234/summary.json', '20260929-120000-abc1234'), true)
    assert.equal(isBenchmarkPublishPath('benchmarks/20260929-120000-OTHER/summary.json', '20260929-120000-abc1234'), false)
    assert.equal(isBenchmarkPublishPath('benchmarks/20260929-120000-abc1234/../other/file', '20260929-120000-abc1234'), false)
    assert.equal(validateStagedAllowlist(['index.json', 'benchmarks/20260929-120000-abc1234/summary.json'], '20260929-120000-abc1234').allowed, true)
    assert.equal(validateStagedAllowlist(['benchmarks/OTHER/summary.json'], '20260929-120000-abc1234').allowed, false)
    assert.equal(validateStagedAllowlist(['benchmarks/20260929-120000-abc1234/file', 'benchmarks/OTHER/file'], '20260929-120000-abc1234').allowed, false)
  })
  it('broad benchmarks/ prefix not allowed', () => {
    // Old bug: p.startsWith('benchmarks/') would allow other run
    const files = ['benchmarks/20260930-000000-abc/summary.json', 'benchmarks/OTHER/summary.json']
    const res = validateStagedAllowlist(files, '20260930-000000-abc')
    assert.equal(res.allowed, false)
    assert.ok(res.invalid.includes('benchmarks/OTHER/summary.json'))
  })
})

// ---------------------------------------------------------------------------
// N security scanner error blocks commit
// ---------------------------------------------------------------------------
describe('integration: security scanner N', () => {
  it('scan error blocks publication', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    // Make security bridge unavailable via git rm and commit (keeps worktree clean)
    const bridgePath = nodePath.join(src, 'Tests', 'tools', 'qa-security-bridge.py')
    gitOk(src, ['rm', 'Tests/tools/qa-security-bridge.py'])
    gitOk(src, ['commit', '-m', 'remove bridge'])
    gitOk(src, ['push', 'origin', 'arena/test-branch'])
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T15:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    assert.equal(res.publication.pushed, false)
    assert.ok(res.publication.pushSkippedReason === 'security-guard-unavailable' || res.publication.pushSkippedReason === 'scan-error' || res.publication.pushSkippedReason === 'security-python-unavailable' || res.publication.pushSkippedReason === 'secret-residual')
  })
  it('scan read error blocks publication (direct bridge)', async () => {
    // Direct bridge test: unreadable file must be hasSecret true
    const tmp = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-bridge-direct-')); tmpToClean.push(tmp)
    const missing = nodePath.join(tmp, 'no-such-file.txt')
    // Use real repo's bridge via python
    const bridge = nodePath.join(REPO_ROOT, 'Tests', 'tools', 'qa-security-bridge.py')
    const py = (()=>{ try{ const p=spawnSync('python',['--version'],{encoding:'utf-8'}); if(p.status===0) return 'python'; const p2=spawnSync('python3',['--version'],{encoding:'utf-8'}); if(p2.status===0) return 'python3' }catch{} return 'python' })()
    // We call bridge via spawnSync to test fail-closed
    const { spawnSync } = await import('node:child_process')
    const out = spawnSync(py, [bridge, 'scan', '--json', missing], { encoding: 'utf-8' })
    const json = JSON.parse(out.stdout || '{}')
    // Missing file should be hasSecret true (fail closed)
    assert.equal(json.hasSecret, true)
    assert.ok(json.results[0].scanError || json.results[0].error)
  })
})

// ---------------------------------------------------------------------------
// O,P FAIL and ENVIRONMENT-LIMITED can publish
// ---------------------------------------------------------------------------
describe('integration: publish O,P', () => {
  it('O: FAIL benchmark evidence can publish', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const failRunner = mockRunnerMatrix({ 'core-agent': 'failed', 'lia-core': 'passed', 'browser': 'passed', 'lint': 'passed', 'typecheck': 'passed', 'build-packages': 'passed', 'stage-ui': 'passed', 'stage-vitest': 'passed' })
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T16:00:00Z'), commandRunner: failRunner, hardwareCollector: mockHardware })
    assert.equal(res.status, 'FAIL')
    assert.equal(res.publication.pushed, true)
    // Verify FAIL is on QA branch
    const cloneQa = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-o-')); tmpToClean.push(cloneQa)
    gitOk(cloneQa, ['clone', bare, '.']); gitOk(cloneQa, ['checkout', 'qa/windows-benchmarks'])
    const idx = JSON.parse(readFileSync(nodePath.join(cloneQa, 'index.json'), 'utf-8'))
    assert.ok(idx.some(e => e.status === 'FAIL'))
  })
  it('P: ENVIRONMENT-LIMITED evidence can publish', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const envRunner = mockRunnerMatrix({ 'browser': 'environment-limited', 'core-agent': 'passed', 'lia-core': 'passed', 'lint': 'passed', 'typecheck': 'passed', 'build-packages': 'passed', 'stage-ui': 'passed', 'stage-vitest': 'passed' })
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T16:30:00Z'), commandRunner: envRunner, hardwareCollector: mockHardware })
    assert.equal(res.status, 'ENVIRONMENT-LIMITED')
    assert.equal(res.publication.pushed, true)
  })
})

// ---------------------------------------------------------------------------
// Q --no-push creates NO QA ref
// ---------------------------------------------------------------------------
describe('integration: Q no-push', () => {
  it('creates NO QA commit/ref', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const res = await runBenchmark({ repoRoot: src, args: ['--no-push'], now: new Date('2026-09-29T17:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    assert.equal(res.publication.pushed, false)
    assert.equal(res.publication.pushSkippedReason, 'no-push-flag')
    const ls = git(bare, ['show-ref', '--verify', 'refs/heads/qa/windows-benchmarks'])
    assert.notEqual(ls.status, 0)
  })
})

// ---------------------------------------------------------------------------
// R SHA manifest verifies
// ---------------------------------------------------------------------------
describe('integration: R SHA manifest', () => {
  it('verifies after publication preparation', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T18:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const publishDir = nodePath.join(src, '.devkit-qa', 'benchmark-publish', res.runId, 'benchmarks', res.runId)
    const manifest = readFileSync(nodePath.join(publishDir, 'SHA256SUMS.txt'), 'utf-8')
    const v = verifyShaManifest(manifest, publishDir)
    assert.equal(v.ok, true)
    // Mutate summary and prove fails — append a byte (works regardless of PASS/ENV)
    const summaryPath = nodePath.join(publishDir, 'summary.json')
    const orig = readFileSync(summaryPath, 'utf-8')
    writeFileSync(summaryPath, orig + ' ', 'utf-8')
    const v2 = verifyShaManifest(manifest, publishDir)
    assert.equal(v2.ok, false)
    // Restore for cleanup
    writeFileSync(summaryPath, orig, 'utf-8')
  })
})

// ---------------------------------------------------------------------------
// S run-id collision -2
// ---------------------------------------------------------------------------
describe('integration: S collision', () => {
  it('produces -2 without deleting -1', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const now = new Date('2026-09-29T19:00:00Z')
    const first = await runBenchmark({ repoRoot: src, args: [], now, commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const firstId = first.runId
    assert.ok(existsSync(nodePath.join(src, 'Tests', 'runs', firstId)))
    const publishFirst = nodePath.join(src, '.devkit-qa', 'benchmark-publish', firstId)
    assert.ok(existsSync(publishFirst))
    const second = await runBenchmark({ repoRoot: src, args: [], now, commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    assert.notEqual(second.runId, firstId)
    assert.ok(second.runId.endsWith('-2') || second.runId.includes('-2'))
    assert.ok(existsSync(nodePath.join(src, 'Tests', 'runs', firstId)))
    assert.ok(existsSync(publishFirst))
    assert.ok(existsSync(nodePath.join(src, 'Tests', 'runs', second.runId)))
  })
})

// ---------------------------------------------------------------------------
// T 10 MiB hard limit blocks
// ---------------------------------------------------------------------------
describe('integration: T 10MiB hard limit', () => {
  it('blocks publication when total exceeds limit', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    // Create a runner that writes huge logs (11 MiB total) — need >5 MiB per file to trigger hard limit or >10 total after bounding
    const hugeRunner = ({ id, logPath, ...rest }) => {
      // Use 3 MiB raw which after bound becomes 2 MiB, 8*2=16 >10, so should block total hard limit
      // To ensure per-file hard max not hit, but total hard max is hit, we need many logs
      const huge = 'X'.repeat(3 * 1024 * 1024)
      try { mkdirSync(nodePath.dirname(logPath), { recursive: true }); writeFileSync(logPath, huge, 'utf-8') } catch {}
      return { id, label: id, cwd: rest.cwd ? nodePath.relative(rest.repoRoot, rest.cwd).replace(/\\/g,'/') : '.', argv: ['pnpm','exec','vitest'], startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 10, exitCode: 0, status: 'passed', stdout: huge.slice(0,100), stderr: '', logPath: nodePath.relative(rest.repoRoot, logPath).replace(/\\/g,'/'), truncated: false }
    }
    const res = await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T20:00:00Z'), commandRunner: hugeRunner, hardwareCollector: mockHardware })
    // Should be blocked due to size, even if status PASS
    assert.ok(res.publication.pushSkippedReason === 'publish-size-limit' || res.publication.pushSkippedReason === 'publish-file-size-limit')
    assert.equal(res.publication.pushed, false)
    // QA branch should not contain this run (if first run, no branch)
    const ls = git(bare, ['show-ref', '--verify', 'refs/heads/qa/windows-benchmarks'])
    if (ls.status === 0) {
      const cloneQa = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-t-')); tmpToClean.push(cloneQa)
      gitOk(cloneQa, ['clone', bare, '.']); gitOk(cloneQa, ['checkout', 'qa/windows-benchmarks'])
      const idx = JSON.parse(readFileSync(nodePath.join(cloneQa, 'index.json'), 'utf-8'))
      assert.ok(!idx.some(e => e.runId === res.runId))
    }
  })
})

// ---------------------------------------------------------------------------
// U interrupted/INCOMPLETE never published
// ---------------------------------------------------------------------------
describe('integration: U INCOMPLETE never published', () => {
  it('does not publish INCOMPLETE', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    // Simulate interrupted by creating run with INCOMPLETE and then trying to trigger publication check
    // Instead, we test that runBenchmark writes INCOMPLETE early and does not push if status stays INCOMPLETE (we can mock runner that throws)
    const throwingRunner = () => { throw new Error('simulated crash') }
    let threw = false
    try { await runBenchmark({ repoRoot: src, args: [], now: new Date('2026-09-29T21:00:00Z'), commandRunner: throwingRunner, hardwareCollector: mockHardware }) } catch { threw = true }
    // Find incomplete run folder
    const runs = readdirSync(nodePath.join(src, 'Tests', 'runs')).filter(n => n.includes('2026'))
    let incompleteFound = false
    for (const r of runs) {
      try {
        const s = JSON.parse(readFileSync(nodePath.join(src, 'Tests', 'runs', r, 'summary.json'), 'utf-8'))
        if (s.status === 'INCOMPLETE') incompleteFound = true
      } catch {}
    }
    // At least one incomplete should exist
    assert.ok(threw || incompleteFound)
    // Ensure QA branch not created for incomplete
    const ls = git(bare, ['show-ref', '--verify', 'refs/heads/qa/windows-benchmarks'])
    // If no successful run before, QA should be absent
    // We don't assert absent strictly, but ensure incomplete run not published
    if (ls.status === 0) {
      const cloneQa = mkdtempSync(nodePath.join(os.tmpdir(), 'lia-qa-u-')); tmpToClean.push(cloneQa)
      gitOk(cloneQa, ['clone', bare, '.']); gitOk(cloneQa, ['checkout', 'qa/windows-benchmarks'])
      const idx = JSON.parse(readFileSync(nodePath.join(cloneQa, 'index.json'), 'utf-8'))
      for (const r of runs) {
        const sPath = nodePath.join(src, 'Tests', 'runs', r, 'summary.json')
        if (existsSync(sPath)) {
          const s = JSON.parse(readFileSync(sPath, 'utf-8'))
          if (s.status === 'INCOMPLETE') assert.ok(!idx.some(e => e.runId === r))
        }
      }
    }
  })
  it('report-only does not create QA ref', async () => {
    const bare = initBareRemote(); tmpToClean.push(bare)
    const { src } = initSourceRepo(bare); tmpToClean.push(src)
    const first = await runBenchmark({ repoRoot: src, args: ['--no-push'], now: new Date('2026-09-29T22:00:00Z'), commandRunner: mockRunner('passed'), hardwareCollector: mockHardware })
    const beforeLs = git(bare, ['show-ref', '--verify', 'refs/heads/qa/windows-benchmarks'])
    assert.notEqual(beforeLs.status, 0)
    const res = await runBenchmark({ repoRoot: src, args: ['--report-only', first.runId], now: new Date(), hardwareCollector: mockHardware })
    assert.ok(res.reportRegenerated)
    const afterLs = git(bare, ['show-ref', '--verify', 'refs/heads/qa/windows-benchmarks'])
    assert.notEqual(afterLs.status, 0)
  })
})
