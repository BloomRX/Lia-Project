import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { describe, it } from 'node:test'

import { REPO_ROOT } from './qa-shared.mjs'

const BAT_FILE = nodePath.join(REPO_ROOT, 'LiaTests.bat')
const GITIGNORE_FILE = nodePath.join(REPO_ROOT, '.gitignore')
const bat = readFileSync(BAT_FILE, 'utf-8')

describe('LiaTests.bat: Windows-oriented static validation', () => {
  it('uses CRLF line endings (batch-safe on Windows)', () => {
    assert.ok(bat.includes('\r\n'))
  })

  it('offers the full menu: 5 top options + storage submenu', () => {
    assert.match(bat, /1\. Voice QA - existing runtime smoke/)
    assert.match(bat, /2\. Voice QA - isolated clean install/)
    assert.match(bat, /3\. Open latest test folder/)
    assert.match(bat, /4\. Restore normal Lia configuration/)
    assert.match(bat, /5\. Exit/)
    assert.match(bat, /6\. Storage \/ cleanup/)
    assert.match(bat, /a\. Show test storage usage/)
    assert.match(bat, /b\. Delete selected managed test run/)
    assert.match(bat, /c\. Delete ALL managed test runs/)
    assert.match(bat, /d\. Inventory possible legacy Lia test artifacts/)
  })

  it('requires Node before doing anything', () => {
    assert.match(bat, /where node/)
  })

  it('creates run folders through qa-run (unique timestamp ids) and captures the git SHA', () => {
    assert.match(bat, /qa-run\.mjs" create smoke/)
    assert.match(bat, /qa-run\.mjs" create clean-install/)
    // environment.txt (branch/SHA/status) is written by the same create step
  })

  it('produces checklist/notes paths for the tester', () => {
    assert.match(bat, /QA-CHECKLIST\.txt/)
    assert.match(bat, /USER-NOTES\.txt/)
  })

  it('launches Lia through the supported Lia.bat with console capture', () => {
    assert.match(bat, /Lia\.bat/)
    assert.match(bat, /Tee-Object/)
    assert.match(bat, /lia-console\.log/)
  })

  it('smoke option runs the existing production smoke script', () => {
    assert.match(bat, /kokoro-smoke\.mjs/)
  })

  it('smoke output is routed into the run-owned artifacts folder', () => {
    assert.match(bat, /kokoro-smoke\.mjs" "%RUN_DIR%\\artifacts\\smoke"/)
  })

  it('restore path goes through the saved original value (qa-config restore)', () => {
    assert.match(bat, /qa-config\.mjs" activate/)
    assert.match(bat, /qa-config\.mjs" restore/)
  })

  it('storage actions delegate to the guarded qa-storage helper', () => {
    for (const subcommand of ['usage', 'show-run', 'delete-run', 'delete-all', 'inventory', 'retention', 'prune-logs'])
      assert.ok(bat.includes(`qa-storage.mjs" ${subcommand}`), `missing qa-storage subcommand: ${subcommand}`)
  })

  it('retention and prune confirm explicitly before applying', () => {
    assert.match(bat, /--apply/)
    assert.match(bat, /Apply this plan\? \(y\/N\)/)
  })

  it('contains NO destructive shell command at all (deletion lives in Node guards)', () => {
    assert.doesNotMatch(bat, /\brmdir\b/i)
    assert.doesNotMatch(bat, /\brd\s+\/s/i)
    assert.doesNotMatch(bat, /^\s*(del|erase)\s/im)
    assert.doesNotMatch(bat, /git clean/)
    assert.doesNotMatch(bat, /--force/)
  })

  it('never targets the production runtime: no LOCALAPPDATA reference anywhere', () => {
    assert.doesNotMatch(bat, /LOCALAPPDATA/)
  })

  it('quotes every command-line use of %RUN_DIR% (paths with spaces must work)', () => {
    const commandLines = bat
      .split(/\r?\n/)
      .filter(line => line.includes('%RUN_DIR%'))
      .filter(line => /^\s*(node|start|explorer|for )/i.test(line))
    assert.ok(commandLines.length > 0, 'expected RUN_DIR to be used by commands')
    for (const line of commandLines) {
      // Either double-quoted for cmd, or single-quoted inside a double-quoted
      // powershell -Command argument (both survive paths with spaces).
      const safe = /"%RUN_DIR%/.test(line) || (/-Command "/.test(line) && /'%RUN_DIR%/.test(line))
      assert.ok(safe, `unquoted RUN_DIR in: ${line.trim()}`)
    }
  })

  it('resets RUN_DIR before each capture (no stale run can leak)', () => {
    const resets = bat.split(/\r?\n/).filter(line => line.trim() === 'set "RUN_DIR="')
    assert.ok(resets.length >= 2)
  })
})

describe('gitignore: harness-generated folders can never enter Git', () => {
  function ignored(path) {
    try {
      execSync(`git check-ignore ${path}`, { cwd: REPO_ROOT, stdio: 'ignore' })
      return true
    }
    catch {
      return false
    }
  }

  it('runs/runtimes/logs/inventory are ignored', () => {
    assert.ok(ignored('Tests/runs/20260923-235500/runtime/kokoro/model.onnx'))
    assert.ok(ignored('Tests/runs/20260923-235500/logs/lia-console.log'))
    assert.ok(ignored('Tests/runtimes/anything'))
    assert.ok(ignored('Tests/logs/x.log'))
    assert.ok(ignored('Tests/inventory/legacy-artifacts-20260923-235500.txt'))
  })

  it('run-owned artifacts are ignored because the parent run is ignored', () => {
    assert.ok(ignored('Tests/runs/20260923-235500/artifacts/smoke/greeting.wav'))
    assert.ok(ignored('Tests/runs/20260923-235500/artifacts/anything/downloaded.bin'))
  })

  it('the committed harness (README + tools) is NOT ignored', () => {
    assert.ok(!ignored('Tests/README.md'))
    assert.ok(!ignored('Tests/tools/qa-shared.mjs'))
    assert.ok(!ignored('LiaTests.bat'))
  })

  it('the .gitignore documents the QA block', () => {
    const gitignore = readFileSync(GITIGNORE_FILE, 'utf-8')
    assert.match(gitignore, /7\.9G-QA/)
    assert.match(gitignore, /^Tests\/runs\/$/m)
    assert.match(gitignore, /^Tests\/runtimes\/$/m)
    assert.match(gitignore, /^Tests\/logs\/$/m)
    assert.match(gitignore, /^Tests\/inventory\/$/m)
  })
})
