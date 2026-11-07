import assert from 'node:assert/strict'

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { GATE_GROUPS } from './lib/run-groups.mjs'

/**
 * Structural integrity of `gate.test.mjs`.
 *
 * The gate itself skips outside Windows, which means a change that drops a
 * group, reorders the accounting, or reintroduces a hardcoded two-secret
 * substitution would pass every Linux check in this repository. This file is
 * the cheap guard against that: it reads the gate as text and refuses the shapes
 * that would quietly reduce coverage.
 *
 * It is a linter for one file, not a substitute for running the gate. It cannot
 * tell whether an assertion inside a group still asserts the right thing; it can
 * tell whether the group is still there, still begun, still passed, and still
 * covers all ten curated providers.
 */

const here = dirname(fileURLToPath(import.meta.url))
const gate = await readFile(join(here, 'gate.test.mjs'), 'utf8')
// Read once, at module scope: `describe` callbacks are not async, so the runner
// cannot be awaited inside one.
const runner = await readFile(join(here, 'run-gate-windows.ps1'), 'utf8')

/** Count non-overlapping occurrences without a regex escaping trap. */
function count(text, needle) {
  return text.split(needle).length - 1
}

describe('gate.test.mjs — the 16 groups are all still wired', () => {
  it('begins and passes every declared group exactly once', () => {
    for (const group of GATE_GROUPS) {
      assert.equal(count(gate, `groups.begin(${group.id})`), 1, `group ${group.id} must be begun exactly once`)
      assert.equal(count(gate, `groups.pass(${group.id},`), 1, `group ${group.id} must be passed exactly once`)
    }
  })

  it('begins each group before it passes it', () => {
    // Order, not just presence: a `pass` before its `begin` would throw at
    // runtime, but only on Windows — where nobody is watching on a Friday.
    let cursor = 0
    for (const group of GATE_GROUPS) {
      const beginAt = gate.indexOf(`groups.begin(${group.id})`, cursor)
      const passAt = gate.indexOf(`groups.pass(${group.id},`, cursor)
      assert.ok(beginAt >= 0 && passAt >= 0, `group ${group.id} is missing a marker`)
      assert.ok(beginAt < passAt, `group ${group.id} is passed before it is begun`)
      cursor = passAt
    }
  })

  it('keeps the groups in ascending order', () => {
    const order = [...gate.matchAll(/groups\.begin\((\d+)\)/g)].map(match => Number(match[1]))
    assert.deepEqual(order, GATE_GROUPS.map(group => group.id))
  })

  it('has no leftover report.checks.push, which would bypass the accounting', () => {
    assert.equal(count(gate, 'report.checks.push('), 0)
  })
})

describe('gate.test.mjs — the ten curated providers are still exercised', () => {
  it('lists all ten curated ids', () => {
    for (const id of ['openai', 'groq', 'cerebras-ai', 'anthropic', 'xai', 'mistral-ai', 'openrouter-ai', 'openai-compatible', 'lm-studio', 'ollama'])
      assert.ok(gate.includes(`'${id}'`), `the gate no longer mentions ${id}`)
  })

  it('treats lm-studio and ollama as keyless, which is what the product does', () => {
    assert.match(gate, /const keyless = new Set\(\['lm-studio', 'ollama'\]\)/)
  })

  it('still executes the whole matrix in both json and stream mode', () => {
    assert.match(gate, /executeProvider\(id, model, 'json'\)/)
    assert.match(gate, /executeProvider\(id, model, 'stream'\)/)
  })
})

describe('gate.test.mjs — secrets are protected by the registry, not by a list', () => {
  it('builds one registry from every minted secret', () => {
    assert.match(gate, /const secretRegistry = createSecretRegistry\(secrets\)/)
  })

  it('no longer hardcodes a two-value substitution', () => {
    // The exact defect from the review: `.replaceAll(secrets.generic, ...)`
    // followed by `.replaceAll(secrets.local, ...)` left the eight per-provider
    // keys in the log.
    assert.equal(count(gate, 'replaceAll(secrets.generic'), 0)
    assert.equal(count(gate, 'replaceAll(secrets.local'), 0)
  })

  it('writes both artifacts through the redacting writer', () => {
    assert.match(gate, /writeArtifact\(\{ writeFile, join \}, artifacts, 'report\.json'/)
    assert.match(gate, /writeArtifact\(\{ writeFile, join \}, artifacts, 'electron\.log'/)
  })

  it('keeps the direct write only for the withheld marker', () => {
    const directWrites = [...gate.matchAll(/await writeFile\(join\(artifacts,/g)]
    assert.equal(directWrites.length, 1, 'only the ARTIFACTS-WITHHELD marker may bypass the registry')
  })
})

describe('gate.test.mjs — process teardown is identity-based', () => {
  it('no longer decides liveness with a bare PID probe', () => {
    assert.equal(count(gate, 'process.kill('), 0)
    assert.equal(count(gate, 'exists(pid)'), 0)
  })

  it('classifies the tracked processes against a live table', () => {
    assert.match(gate, /classifyAll\(\{ processes: tracked, live \}\)/)
  })

  it('starts a monitor for every Electron lifetime', () => {
    assert.match(gate, /createProcessMonitor\(\{ rootPid: applicationProcess\.pid, snapshot \}\)/)
    assert.match(gate, /monitor\.start\(\)/)
  })

  it('stops the monitor before closing, so the last lifetime is observed', () => {
    const stopAt = gate.indexOf('stopMonitor()')
    assert.ok(stopAt > 0, 'the gate never stops the monitor')
    assert.ok(gate.indexOf('await application.close()', stopAt) > stopAt, 'the monitor is stopped after the close it is meant to observe')
  })

  it('does not treat an unverifiable shutdown as success', () => {
    assert.match(gate, /settled\.unknown\.length,\s*0,/)
  })

  it('assigns the report before any helper that reads it runs', () => {
    // `settleProcesses()` is module-scoped and reads `report`. If the assignment
    // moved below its first call, the gate would throw a TDZ error — on Windows,
    // where nobody is watching. This pins the order.
    const assignAt = gate.indexOf('\n  report = {')
    // Four spaces: the definition's own internal call is indented two, so this
    // finds the first call site in the test body rather than the helper itself.
    const firstSettle = gate.indexOf('\n    settleProcesses()')
    assert.ok(assignAt > 0, 'the report is never assigned')
    assert.ok(firstSettle > assignAt, 'settleProcesses() is called before the report exists')
  })

  it('declares the monitor and the tracked set before they are used', () => {
    assert.ok(gate.indexOf('let monitor') < gate.indexOf('monitor = createProcessMonitor('))
    assert.ok(gate.indexOf('const tracked = []') < gate.indexOf('tracked.push('))
  })
})

describe('run-gate-windows.ps1 — environment and export', () => {
  it('records the PowerShell version in the run artifacts', () => {
    assert.match(runner, /\$PSVersionTable/)
  })

  it('writes an environment file next to the report', () => {
    assert.match(runner, /environment\.json/)
  })

  it('exports a manifest with hashes', () => {
    assert.match(runner, /manifest\.json/)
    assert.match(runner, /Get-FileHash|SHA256/)
  })

  it('still refuses to call a failed run approved', () => {
    assert.match(runner, /GATE NAO APROVADO/)
  })
})
