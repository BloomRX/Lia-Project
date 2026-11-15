import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import {
  classifyAll,
  classifyIdentity,
  isSameProcess,
  isVerifiable,
  parseCimDate,
  parseProcessTable,
  processTableCommand,
  toIdentity,
} from './process-identity.mjs'

/**
 * The identity the gate now relies on: `(pid, createdAt)`, compared exactly.
 *
 * Every case here is a scenario the PROMPT-31 mission lists: original alive,
 * original finished, PID reused, creation time unreadable, process vanishing
 * mid-query, and a malformed answer from the identification mechanism.
 *
 * These run on Linux because the parsing and comparison are pure. Nothing in
 * this file needs a Windows host — the `Get-CimInstance` call itself is the only
 * part that does, and it is exercised by `processTableCommand` (shape only) and
 * by the real gate.
 */

const T0 = 1_763_100_000_000

describe('parseCimDate — the two shapes PowerShell produces', () => {
  it('reads the Windows PowerShell 5.1 legacy DateTime form', () => {
    assert.equal(parseCimDate(`/Date(${T0})/`), T0)
  })

  it('reads the 5.1 form with escaped delimiters', () => {
    assert.equal(parseCimDate(`\\/Date(${T0})\\/`), T0)
  })

  it('reads the 5.1 form with a zone suffix', () => {
    assert.equal(parseCimDate(`/Date(${T0}+0000)/`), T0)
  })

  it('reads ISO 8601 with a Z zone and seven fractional digits', () => {
    // .NET emits 7 fractional digits; ECMAScript understands 3. Truncating must
    // not shift the instant, only drop precision below a millisecond.
    assert.equal(parseCimDate('2026-11-06T03:22:58.9410000Z'), Date.parse('2026-11-06T03:22:58.941Z'))
  })

  it('reads ISO 8601 with a local offset and folds it to the same instant', () => {
    assert.equal(
      parseCimDate('2026-11-06T03:22:58.941-03:00'),
      Date.parse('2026-11-06T06:22:58.941Z'),
    )
  })

  it('normalizes a number that a caller already parsed', () => {
    assert.equal(parseCimDate(T0), T0)
  })

  it('answers undefined for a missing or empty value instead of inventing an instant', () => {
    for (const value of [undefined, null, '', '   ', {}, []])
      assert.equal(parseCimDate(value), undefined, `${JSON.stringify(value)} must not parse`)
  })

  it('refuses a date without a zone rather than resolving it in local time', () => {
    // `Date.parse('2026-11-06T03:22:58')` succeeds and silently invents a zone.
    // That is the quiet normalization this parser exists to forbid.
    assert.equal(parseCimDate('2026-11-06T03:22:58'), undefined)
  })

  it('refuses a date without a time', () => {
    assert.equal(parseCimDate('2026-11-06'), undefined)
  })

  it('refuses nonsense and negative epochs', () => {
    assert.equal(parseCimDate('/Date(not-a-number)/'), undefined)
    assert.equal(parseCimDate('/Date(-5)/'), undefined)
    assert.equal(parseCimDate('/Date(0)/'), undefined)
  })
})

describe('toIdentity — building an identity from a CIM row', () => {
  it('reads the projection the gate produces', () => {
    assert.deepEqual(
      toIdentity({ ProcessId: 4321, ParentProcessId: 100, Created: '2026-11-06T03:22:58.941Z' }),
      { pid: 4321, parentPid: 100, createdAt: Date.parse('2026-11-06T03:22:58.941Z') },
    )
  })

  it('reads the raw CIM names and string numbers', () => {
    assert.deepEqual(
      toIdentity({ ProcessId: '4321', ParentProcessId: '100', CreationDate: `/Date(${T0})/` }),
      { pid: 4321, parentPid: 100, createdAt: T0 },
    )
  })

  it('keeps the identity when the creation time is unreadable', () => {
    // The PID is still useful for a diagnostic; the missing instant is what
    // makes it unverifiable, and that is recorded rather than papered over.
    const identity = toIdentity({ ProcessId: 7, Created: null })
    assert.equal(identity.pid, 7)
    assert.equal(identity.createdAt, undefined)
    assert.equal(isVerifiable(identity), false)
  })

  it('rejects a row with no usable PID', () => {
    assert.equal(toIdentity({}), undefined)
    assert.equal(toIdentity({ ProcessId: 0 }), undefined)
    assert.equal(toIdentity({ ProcessId: -1 }), undefined)
    assert.equal(toIdentity({ ProcessId: 'abc' }), undefined)
    assert.equal(toIdentity(null), undefined)
  })

  it('drops a parent that cannot be a PID instead of guessing one', () => {
    assert.equal(toIdentity({ ProcessId: 9, ParentProcessId: 0 }).parentPid, undefined)
    assert.equal(toIdentity({ ProcessId: 9, ParentProcessId: 'x' }).parentPid, undefined)
  })
})

describe('isSameProcess — strict, never approximate', () => {
  const original = { pid: 100, createdAt: T0 }

  it('accepts the same PID and the same instant', () => {
    assert.equal(isSameProcess(original, { pid: 100, createdAt: T0 }), true)
  })

  it('rejects the same PID one millisecond apart', () => {
    // No tolerance window: this is the collision the exact comparison exists to
    // catch, and rounding would erase it.
    assert.equal(isSameProcess(original, { pid: 100, createdAt: T0 + 1 }), false)
  })

  it('rejects a different PID', () => {
    assert.equal(isSameProcess(original, { pid: 101, createdAt: T0 }), false)
  })

  it('rejects when either side has no creation time', () => {
    assert.equal(isSameProcess(original, { pid: 100, createdAt: undefined }), false)
    assert.equal(isSameProcess({ pid: 100, createdAt: undefined }, original), false)
  })
})

describe('classifyIdentity — alive, gone, and the state that is neither', () => {
  const original = { pid: 100, createdAt: T0 }

  it('reports the original process as alive while it is still there', () => {
    const verdict = classifyIdentity(original, [{ pid: 100, createdAt: T0 }])
    assert.equal(verdict.status, 'alive')
  })

  it('reports the original process as gone once it finished', () => {
    const verdict = classifyIdentity(original, [])
    assert.equal(verdict.status, 'gone')
  })

  it('reports a reused PID as gone, and says why', () => {
    // This is the case `process.kill(pid, 0)` got wrong: the number is in use by
    // a different process, so the ORIGINAL is finished. Saying "alive" here is
    // the false positive the mission forbids.
    const verdict = classifyIdentity(original, [{ pid: 100, createdAt: T0 + 60_000 }])
    assert.equal(verdict.status, 'gone')
    assert.match(verdict.reason, /recycled/)
  })

  it('reports unknown when the creation time was never captured', () => {
    const verdict = classifyIdentity({ pid: 100, createdAt: undefined }, [{ pid: 100, createdAt: T0 }])
    assert.equal(verdict.status, 'unknown')
    assert.match(verdict.reason, /never captured/)
  })

  it('reports unknown when the process table could not be read', () => {
    // A failed query is not evidence of shutdown. Collapsing it into `gone`
    // would let a broken host report a clean teardown.
    const verdict = classifyIdentity(original, undefined)
    assert.equal(verdict.status, 'unknown')
    assert.match(verdict.reason, /could not be read/)
  })

  it('reports unknown for an absent identity instead of throwing', () => {
    assert.equal(classifyIdentity(undefined, []).status, 'unknown')
    assert.equal(classifyIdentity({ pid: 0, createdAt: T0 }, []).status, 'unknown')
  })
})

describe('classifyAll — the four states the report must separate', () => {
  const root = { pid: 100, createdAt: T0 }

  it('separates main, descendants, alive and unconfirmed', () => {
    const descendants = [
      { pid: 200, createdAt: T0 + 10 },
      { pid: 300, createdAt: T0 + 20 },
      { pid: 400, createdAt: undefined },
    ]
    const result = classifyAll({
      root,
      processes: descendants,
      // 200 is still running, 300 finished, 400 has no creation time.
      live: [{ pid: 200, createdAt: T0 + 10 }],
    })

    assert.deepEqual(result.alive.map(entry => entry.pid), [200])
    // The root is deliberately absent from `live`: the main process is checked
    // by the same rule as everything else, so it lands in `gone` here.
    assert.deepEqual(result.gone.map(entry => entry.pid), [100, 300])
    assert.deepEqual(result.unknown.map(entry => entry.pid), [400])
    assert.deepEqual(result.unverifiable, [400])
    assert.equal(result.classified.find(entry => entry.role === 'main').status, 'gone')
  })

  it('does not double-count the main process as its own descendant', () => {
    const result = classifyAll({ root, processes: [{ ...root }], live: [] })
    assert.equal(result.classified.filter(entry => entry.pid === 100).length, 1)
  })

  it('keeps both incarnations of a recycled PID and classifies each on its own', () => {
    const result = classifyAll({
      root,
      processes: [
        { pid: 500, createdAt: T0 + 1 },
        { pid: 500, createdAt: T0 + 2 },
      ],
      // Root kept alive so this case is only about the two incarnations.
      live: [root, { pid: 500, createdAt: T0 + 2 }],
    })
    assert.deepEqual(result.alive.map(entry => entry.createdAt).sort(), [T0, T0 + 2].sort())
    assert.deepEqual(result.gone.map(entry => entry.createdAt), [T0 + 1])
  })

  it('marks everything unknown when the table read failed', () => {
    const result = classifyAll({ root, processes: [{ pid: 200, createdAt: T0 }], live: undefined })
    assert.equal(result.unknown.length, 2)
    assert.equal(result.gone.length, 0)
  })
})

describe('parseProcessTable — what PowerShell actually returns', () => {
  it('reads an array', () => {
    const rows = parseProcessTable(JSON.stringify([
      { ProcessId: 1, ParentProcessId: 0, Created: '2026-11-06T03:22:58.941Z' },
      { ProcessId: 2, ParentProcessId: 1, Created: '2026-11-06T03:22:59.941Z' },
    ]))
    assert.deepEqual(rows.map(row => row.pid), [1, 2])
  })

  it('reads a single object, which is what a one-row ConvertTo-Json returns', () => {
    const rows = parseProcessTable(JSON.stringify({ ProcessId: 1, ParentProcessId: 0, Created: '2026-11-06T03:22:58.941Z' }))
    assert.equal(rows.length, 1)
  })

  it('reads the empty string PowerShell emits for an empty array', () => {
    assert.deepEqual(parseProcessTable(''), [])
    assert.deepEqual(parseProcessTable('   '), [])
  })

  it('throws on malformed JSON rather than pretending nothing is running', () => {
    // The distinction matters: an unreadable table becomes `unknown` at the call
    // site, never `gone`.
    assert.throws(() => parseProcessTable('not json'), /could not be parsed/)
  })

  it('drops rows that carry no PID', () => {
    assert.deepEqual(parseProcessTable(JSON.stringify([{ ProcessId: 0 }, { nope: true }])), [])
  })
})

describe('processTableCommand — the query must carry the fields the parser needs', () => {
  it('selects the PID, the parent and a canonical creation stamp', () => {
    const command = processTableCommand()
    assert.match(command, /ProcessId/)
    assert.match(command, /ParentProcessId/)
    // Created inside PowerShell, in UTC, so 5.1 and 7 agree at the source.
    // The quote style is incidental; the call is `ToString('o')` in PowerShell.
    assert.match(command, /CreationDate\.ToUniversalTime\(\)\.ToString\(.o.\)/)
    assert.match(command, /ConvertTo-Json/)
    // Depth 3: the default of 2 truncates nested rows.
    assert.match(command, /-Depth 3/)
  })

  it('escapes a quote in the process name instead of breaking the filter', () => {
    // A doubled apostrophe is how PowerShell escapes one inside a filter.
    assert.match(processTableCommand('we\'ird.exe'), /we''ird\.exe/)
  })
})
