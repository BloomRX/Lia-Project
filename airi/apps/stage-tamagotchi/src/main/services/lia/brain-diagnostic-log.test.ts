import type { LiaBrainCorrelationDiagnosticFacts } from './brain-correlation-diagnostic-facts'
import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'
import type { LiaBrainExecutionIdentityFacts } from './brain-execution-identity-facts'
import type { LiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationObserver } from './brain-correlation-observer'
import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { formatLiaBrainDiagnosticEntry, logLiaBrainDiagnostic, selectLiaBrainDiagnosticLog } from './brain-diagnostic-log'

/**
 * Phase 8.0D-10B-4D2B: the focused proof of the diagnostic LOG ADAPTER.
 *
 * Phase 8.0D-10B-4D4C3B2-B4: the line of a PRESENT correlation now also prints
 * the three approved terminal observation counts of the same retained snapshot,
 * appended after every identity/attempt field; a correlation with no live
 * snapshot still prints the historical absence line with no count invented.
 *
 * The formatter is pure and deterministic, so most of this file asserts exact
 * strings for every factual state. The logger itself is mocked at the module
 * boundary: what matters is that ONE entry causes exactly ONE informational
 * call carrying exactly the formatted line - never a second call, never a
 * warning and never an error.
 */

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
}))

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => ({ info: mocks.info }) }),
}))

const GROQ_ENGINE_ID = 'groq'
const GROQ_MODEL_ID = 'openai/gpt-oss-120b'

function attempt(overrides: Partial<{ arrivalIndex: number, modelId: string, providerId: string, roundId: string }> = {}) {
  return { arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A', ...overrides }
}

const ZERO_TERMINALS: LiaBrainTerminalObservationFacts = {
  abandonedTerminalObservationCount: 0,
  failedTerminalObservationCount: 0,
  succeededTerminalObservationCount: 0,
}

/**
 * Phase 8.0D-10B-4D4C3B2-B4: the terminal count fields exactly as the formatter
 * appends them - fixed order, raw decimal integers, one space delimiter - for a
 * 0/0/0 present snapshot.
 */
const ZERO_COUNTS = 'succeededTerminalObservationCount=0 failedTerminalObservationCount=0 abandonedTerminalObservationCount=0'

/** The same three fields for an arbitrary count triple, in the fixed order. */
function counts(succeeded: number, failed: number, abandoned: number): string {
  return `succeededTerminalObservationCount=${succeeded} failedTerminalObservationCount=${failed} abandonedTerminalObservationCount=${abandoned}`
}

/** How many times one exact token appears in a line. */
function occurrences(line: string, token: string): number {
  return line.split(token).length - 1
}

/**
 * One structured entry for an arbitrary factual state.
 *
 * Phase 8.0D-10B-4D4C3B2-B4: a present state carries the composed terminal
 * counts, which the formatter appends to the line, while the absence state has
 * no terminal member at all - so no count is ever fabricated for it.
 */
function entry(
  facts: LiaBrainCorrelationDiagnosticFacts['facts'],
  correlationId = 'X',
  terminalFacts: LiaBrainTerminalObservationFacts = ZERO_TERMINALS,
): LiaBrainDiagnosticEntry {
  return facts.status === 'correlationNotObserved'
    ? { correlationId, facts }
    : { correlationId, facts, terminalFacts }
}

beforeEach(() => {
  mocks.info.mockClear()
})

describe('lia brain diagnostic log - formatting (Phase 8.0D-10B-4D2B)', () => {
  it('a: correlationNotObserved carries the common metadata only', () => {
    expect(formatLiaBrainDiagnosticEntry(entry({ status: 'correlationNotObserved' }, 'logical-send-X')))
      .toBe('[LIA-BRAIN-DIAG] correlationId="logical-send-X" status="correlationNotObserved"')
    // No route placeholder and no synthetic attempt.
    expect(formatLiaBrainDiagnosticEntry(entry({ status: 'correlationNotObserved' }))).not.toMatch(/expected|attempt/)
  })

  it('b: decisionNotObserved reports the observed attempts without expectation or equality', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt()],
      status: 'decisionNotObserved',
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" ${ZERO_COUNTS}`)
    // No expectation exists in this state, and equality is never manufactured.
    expect(line).not.toMatch(/expected|IdentityEqual/)
  })

  it('c: noBrainRouteSelected reports the observed attempts the same factual way', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt({ roundId: 'A' })],
      status: 'noBrainRouteSelected',
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="noBrainRouteSelected" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" ${ZERO_COUNTS}`)
    expect(line).not.toMatch(/expected|IdentityEqual/)
  })

  it('d: engineMappingMissing reports the SELECTED route ids - never as expected provider/model', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt()],
      engineId: 'mystery-engine',
      modelId: 'mystery-model',
      status: 'engineMappingMissing',
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="engineMappingMissing" selectedEngineId="mystery-engine" selectedModelId="mystery-model" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" ${ZERO_COUNTS}`)
    // No expected provider/model exists in this state: it is never invented.
    expect(line).not.toMatch(/expected/)
  })

  it('e: noExecutionObserved reports the expected route and NO synthetic attempt', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'noExecutionObserved',
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="noExecutionObserved" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" ${ZERO_COUNTS}`)
    expect(line).not.toMatch(/attempt/)
  })

  it('f: attemptIdentityFacts reports expectation, attempt ids and its own equality booleans', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' }],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true ${ZERO_COUNTS}`)
  })

  it('g: multiple attempts append in arrival order, each with its own identity pair', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [
        { arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' },
        { arrivalIndex: 1, modelId: 'claude-x', modelIdentityEqual: false, providerId: 'anthropic', providerIdentityEqual: false, roundId: 'B' },
      ],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true attempt1.arrivalIndex=1 attempt1.roundId="B" attempt1.providerId="anthropic" attempt1.modelId="claude-x" attempt1.providerIdentityEqual=false attempt1.modelIdentityEqual=false ${ZERO_COUNTS}`)
  })

  it('h/i/j/k: the four equality combinations stay independent - no combined field exists', () => {
    const pairs: [boolean, boolean][] = [[true, true], [false, true], [true, false], [false, false]]

    for (const [providerIdentityEqual, modelIdentityEqual] of pairs) {
      const line = formatLiaBrainDiagnosticEntry(entry({
        attempts: [{ arrivalIndex: 0, modelId: 'm', modelIdentityEqual, providerId: 'p', providerIdentityEqual, roundId: 'A' }],
        expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
        status: 'attemptIdentityFacts',
      }))

      // Each boolean is reported verbatim, on its own field...
      expect(line).toContain(`attempt0.providerIdentityEqual=${providerIdentityEqual}`)
      expect(line).toContain(`attempt0.modelIdentityEqual=${modelIdentityEqual}`)
      // ...and no aggregate/verdict vocabulary is ever produced.
      expect(line).not.toMatch(/Matches|Match\b|mismatch|divergence|aligned|correct|incorrect|success|failure|verdict|score|recommendation/i)
    }
  })

  it('l/m/n: duplicate attempts both appear, in array order, prefixed by their OWN arrivalIndex', () => {
    // Two distinct attempts AND a duplicated one: nothing is deduped or sorted.
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt({ arrivalIndex: 0, roundId: 'A' }), attempt({ arrivalIndex: 1, roundId: 'A' })],
      status: 'decisionNotObserved',
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt1.arrivalIndex=1 attempt1.roundId="A" attempt1.providerId="groq" attempt1.modelId="openai/gpt-oss-120b" ${ZERO_COUNTS}`)

    // N: the prefix always agrees with the attempt's own arrivalIndex - a fact
    // object whose indexes are out of positional order is still reported by its
    // OWN value, never by the iteration position.
    const outOfOrder = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt({ arrivalIndex: 7, roundId: 'late' }), attempt({ arrivalIndex: 3, roundId: 'early' })],
      status: 'decisionNotObserved',
    }))
    expect(outOfOrder).toContain('attempt7.arrivalIndex=7')
    expect(outOfOrder).toContain('attempt7.roundId="late"')
    expect(outOfOrder).toContain('attempt3.arrivalIndex=3')
    expect(outOfOrder).toContain('attempt3.roundId="early"')
    // The array order is preserved verbatim, even when the indexes descend.
    expect(outOfOrder.indexOf('attempt7')).toBeLessThan(outOfOrder.indexOf('attempt3'))
  })

  it('48: ids with spaces, slashes, colons, equals, quotes and backslashes stay unambiguous', () => {
    const hostile = `odd id "with" spaces / slashes: a=b \\ backslash`

    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [{ arrivalIndex: 0, modelId: hostile, modelIdentityEqual: false, providerId: hostile, providerIdentityEqual: false, roundId: hostile }],
      expected: { engineId: hostile, modelId: hostile, providerId: hostile },
      status: 'attemptIdentityFacts',
    }, hostile))

    // Every string leaf is a JSON string literal, so delimiters cannot be
    // confused with the key=value structure.
    expect(line).toContain(`correlationId=${JSON.stringify(hostile)}`)
    expect(line).toContain(`expectedEngineId=${JSON.stringify(hostile)}`)
    expect(line).toContain(`attempt0.roundId=${JSON.stringify(hostile)}`)
    // Round-tripping one field proves the quoting is reversible.
    const field = line.slice(line.indexOf('attempt0.roundId=') + 'attempt0.roundId='.length)
    expect(JSON.parse(field.slice(0, JSON.stringify(hostile).length))).toBe(hostile)
    // And the line stays a single line.
    expect(line.split('\n')).toHaveLength(1)
  })

  it('58/59: the whole pre-B4 line stays the byte-identical PREFIX of the new line', () => {
    const facts: LiaBrainExecutionIdentityFacts = {
      attempts: [{ ...attempt(), modelIdentityEqual: true, providerIdentityEqual: true }],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }

    // The historical line, byte for byte - no field reordered or reworded.
    const identityOnly = '[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true'

    // A: present with zero retained terminals - the zeros are EXPLICIT.
    const zero = formatLiaBrainDiagnosticEntry(entry(facts, 'X', ZERO_TERMINALS))
    expect(zero).toBe(`${identityOnly} ${ZERO_COUNTS}`)
    expect(zero.slice(0, identityOnly.length)).toBe(identityOnly)

    // B: present with a nonzero mix - same prefix, the counts now literal.
    const nonzero = formatLiaBrainDiagnosticEntry(entry(facts, 'X', {
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    }))
    expect(nonzero).toBe(`${identityOnly} ${counts(2, 1, 1)}`)
    expect(nonzero.slice(0, identityOnly.length)).toBe(identityOnly)
  })

  it('60: the absence state never gains a count - the entry, not the formatter, decides it', () => {
    // The absent state carries no terminal member: its line is the historical one.
    const absent = entry({ status: 'correlationNotObserved' }, 'logical-send-X')
    expect(formatLiaBrainDiagnosticEntry(absent)).toBe('[LIA-BRAIN-DIAG] correlationId="logical-send-X" status="correlationNotObserved"')
    expect('terminalFacts' in absent).toBe(false)

    // The counts live OUTSIDE `facts`: an identity state with no field of its own
    // keeps its exact prefix and gains only the three appended count fields.
    const facts: LiaBrainExecutionIdentityFacts = { attempts: [], status: 'decisionNotObserved' }
    for (const [terminalFacts, suffix] of [
      [ZERO_TERMINALS, ZERO_COUNTS],
      [{ abandonedTerminalObservationCount: 0, failedTerminalObservationCount: 1, succeededTerminalObservationCount: 0 }, counts(0, 1, 0)],
      [{ abandonedTerminalObservationCount: 1, failedTerminalObservationCount: 1, succeededTerminalObservationCount: 2 }, counts(2, 1, 1)],
    ] as const)
      expect(formatLiaBrainDiagnosticEntry(entry(facts, 'X', terminalFacts))).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" ${suffix}`)
  })

  it('determinism: the same entry always formats to the exact same string', () => {
    const source = entry({
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' }],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    })

    const first = formatLiaBrainDiagnosticEntry(source)
    const second = formatLiaBrainDiagnosticEntry(source)
    expect(first).toBe(second)
    // No timestamp, no random id, no environment value anywhere in the line.
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|GMT|Z\b/)
    // The field ORDER is fixed: the common metadata leads, attempts follow.
    expect(first.indexOf('correlationId=')).toBeLessThan(first.indexOf('status='))
    expect(first.indexOf('status=')).toBeLessThan(first.indexOf('expectedEngineId='))
    expect(first.indexOf('expectedModelId=')).toBeLessThan(first.indexOf('attempt0.'))
  })
})

/**
 * Phase 8.0D-10B-4D4C3B2-B4: the terminal count section of the line.
 *
 * The formatter derives NOTHING here: it appends the three already-approved
 * counts of the entry's own `terminalFacts` member, after every identity/attempt
 * field, as bare decimal integers in a fixed order. The absence state has no
 * such member and therefore never prints one.
 */
describe('lia brain diagnostic log - terminal counts (Phase 8.0D-10B-4D4C3B2-B4)', () => {
  const ABSENT_LINE = '[LIA-BRAIN-DIAG] correlationId="X" status="correlationNotObserved"'
  const COUNT_FIELDS = ['succeededTerminalObservationCount', 'failedTerminalObservationCount', 'abandonedTerminalObservationCount']

  it('40/56: the absent line is byte-identical to the historical one, with zero count tokens', () => {
    // Exactly the current absence entry - nothing else in it.
    const absent: LiaBrainDiagnosticEntry = { correlationId: 'X', facts: { status: 'correlationNotObserved' } }
    const line = formatLiaBrainDiagnosticEntry(absent)

    expect(line).toBe(ABSENT_LINE)
    for (const field of COUNT_FIELDS)
      expect(occurrences(line, field), field).toBe(0)
    // No terminal member is fabricated by whoever formats it, either.
    expect('terminalFacts' in absent).toBe(false)
    expect(line).not.toMatch(/TerminalObservationCount|terminalFacts|succeeded|failed|abandoned|count/i)
  })

  it('41: decisionNotObserved with 0/0/0 prints the three zeros explicitly', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({ attempts: [attempt()], status: 'decisionNotObserved' }, 'X', ZERO_TERMINALS))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" ${ZERO_COUNTS}`)
    // "present, retaining no terminal observation" is a different fact from
    // "no live snapshot" - and the two lines say so.
    expect(line).not.toBe(ABSENT_LINE)
    expect(line.endsWith(ZERO_COUNTS)).toBe(true)
  })

  it('42: decisionNotObserved with 0/1/0 prints the literal counts', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({ attempts: [attempt()], status: 'decisionNotObserved' }, 'X', {
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 0,
    }))

    expect(line).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" ${counts(0, 1, 0)}`)
  })

  it('43/44: noExecutionObserved keeps its expected route and gains zero and nonzero counts', () => {
    const expected = { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' }
    const prefix = '[LIA-BRAIN-DIAG] correlationId="X" status="noExecutionObserved" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b"'

    const zero = formatLiaBrainDiagnosticEntry(entry({ attempts: [], expected, status: 'noExecutionObserved' }, 'X', ZERO_TERMINALS))
    expect(zero).toBe(`${prefix} ${ZERO_COUNTS}`)

    // A terminal-only retained state coexists with "no execution observed": the
    // counts are appended literally, with no contradiction invented.
    const nonzero = formatLiaBrainDiagnosticEntry(entry({ attempts: [], expected, status: 'noExecutionObserved' }, 'X', {
      abandonedTerminalObservationCount: 0,
      failedTerminalObservationCount: 2,
      succeededTerminalObservationCount: 0,
    }))
    expect(nonzero).toBe(`${prefix} ${counts(0, 2, 0)}`)
  })

  it('45/46: attemptIdentityFacts keeps its attempt serialization and gains 0/0/0 and 2/1/1', () => {
    const facts: LiaBrainExecutionIdentityFacts = {
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' }],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }
    const prefix = '[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true'

    expect(formatLiaBrainDiagnosticEntry(entry(facts, 'X', ZERO_TERMINALS))).toBe(`${prefix} ${ZERO_COUNTS}`)
    expect(formatLiaBrainDiagnosticEntry(entry(facts, 'X', {
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    }))).toBe(`${prefix} ${counts(2, 1, 1)}`)
  })

  it('47/55: with two attempts the counts appear exactly ONCE, at the very end of the line', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [
        { arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' },
        { arrivalIndex: 1, modelId: 'claude-x', modelIdentityEqual: false, providerId: 'anthropic', providerIdentityEqual: false, roundId: 'B' },
      ],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }, 'X', {
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    }))

    // Each exact field name appears exactly once - never per attempt.
    for (const field of ['succeededTerminalObservationCount=', 'failedTerminalObservationCount=', 'abandonedTerminalObservationCount='])
      expect(occurrences(line, field), field).toBe(1)
    // The block is appended after the last attempt field, in the fixed order.
    expect(line.endsWith(` ${counts(2, 1, 1)}`)).toBe(true)
    expect(line.indexOf('attempt1.modelIdentityEqual=')).toBeLessThan(line.indexOf('succeededTerminalObservationCount='))
    expect(line.indexOf('succeededTerminalObservationCount=')).toBeLessThan(line.indexOf('failedTerminalObservationCount='))
    expect(line.indexOf('failedTerminalObservationCount=')).toBeLessThan(line.indexOf('abandonedTerminalObservationCount='))
    // The attempt order itself is untouched: no per-attempt count was inserted.
    expect(line.indexOf('attempt0.arrivalIndex=')).toBeLessThan(line.indexOf('attempt1.arrivalIndex='))
    expect(occurrences(line, 'arrivalIndex=')).toBe(2)
  })

  it('12/13: the counts are bare decimal integers - never quoted, JSON, percentages or booleans', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({ attempts: [], status: 'decisionNotObserved' }, 'X', {
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    }))

    expect(line).toContain('succeededTerminalObservationCount=2')
    expect(line).toContain('failedTerminalObservationCount=1')
    expect(line).toContain('abandonedTerminalObservationCount=1')
    expect(line).not.toMatch(/TerminalObservationCount="/)
    expect(line).not.toMatch(/%/)
    expect(line).not.toMatch(/[{}]|true|false/)
    // Still one line, with the historical prefix and delimiters.
    expect(line.split('\n')).toHaveLength(1)
    expect(line.startsWith('[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" ')).toBe(true)
  })

  it('57/58: the same entry formats byte-identically twice and is never mutated', () => {
    const facts: LiaBrainExecutionIdentityFacts = {
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' }],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }
    const terminalFacts: LiaBrainTerminalObservationFacts = {
      abandonedTerminalObservationCount: 1,
      failedTerminalObservationCount: 1,
      succeededTerminalObservationCount: 2,
    }
    const frozen: LiaBrainDiagnosticEntry = { correlationId: 'X', facts, terminalFacts }
    Object.freeze(facts.attempts[0]!)
    Object.freeze(facts.attempts)
    Object.freeze(facts.expected)
    Object.freeze(facts)
    Object.freeze(terminalFacts)
    Object.freeze(frozen)
    const before = JSON.stringify(frozen)

    const first = formatLiaBrainDiagnosticEntry(frozen)
    const second = formatLiaBrainDiagnosticEntry(frozen)

    expect(first).toBe(second)
    expect(JSON.stringify(frozen)).toBe(before)
    expect(first).toBe(`[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true ${counts(2, 1, 1)}`)
  })
})

describe('lia brain diagnostic log - selector and logger call (Phase 8.0D-10B-4D2B)', () => {
  it('o/p/q/r: the selector is pure - dev returns the exact adapter, production returns nothing', () => {
    // O: no callback outside dev...
    expect(selectLiaBrainDiagnosticLog(false)).toBeUndefined()
    // P: ...and exactly the adapter function inside dev, directly assignable to
    // the observer's optional callback contract.
    expect(selectLiaBrainDiagnosticLog(true)).toBe(logLiaBrainDiagnostic)
    // Q: repeated selection yields the very same function - no per-call wrapper.
    expect(selectLiaBrainDiagnosticLog(true)).toBe(selectLiaBrainDiagnosticLog(true))
    // R: no state and no side effect: selecting produces no logging at all.
    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('50: one entry causes exactly ONE informational call carrying the formatted line', () => {
    const source = entry({
      attempts: [attempt()],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    })

    logLiaBrainDiagnostic(source)

    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info).toHaveBeenCalledWith(formatLiaBrainDiagnosticEntry(source))
    // Exactly one line, and never at a higher level: these facts are not errors.
    const [line] = mocks.info.mock.calls[0] as [string]
    expect(line.split('\n')).toHaveLength(1)
    expect(line.startsWith('[LIA-BRAIN-DIAG] ')).toBe(true)
  })

  it('51/64: the DEV-selected callback + the REAL observer and store log one call per observation, counts included', () => {
    // The real correlation service, the REAL observer, the real adapter and the
    // real formatter - only the logger sink is a double.
    const store = createLiaBrainCorrelationService()
    store.recordExecution({ conversationId: 'conversation-1', correlationId: 'logical-send-X', modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'R' })
    const observer = createLiaBrainCorrelationObserver({ correlationReader: store, log: selectLiaBrainDiagnosticLog(true) })

    observer.observe('logical-send-X')

    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info).toHaveBeenCalledWith(`[LIA-BRAIN-DIAG] correlationId="logical-send-X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="R" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" ${ZERO_COUNTS}`)

    // A terminal observation becomes visible on the very next dev line.
    store.recordExecutionTerminal({ correlationId: 'logical-send-X', outcome: 'failed', roundId: 'R' })
    observer.observe('logical-send-X')
    expect(mocks.info).toHaveBeenCalledTimes(2)
    expect(mocks.info.mock.calls[1]![0]).toBe(`[LIA-BRAIN-DIAG] correlationId="logical-send-X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="R" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" ${counts(0, 1, 0)}`)

    // A key with no live snapshot is a factual observation too - still one call,
    // and still no fabricated count.
    observer.observe('absent')
    expect(mocks.info).toHaveBeenCalledTimes(3)
    expect(mocks.info.mock.calls[2]![0]).toBe('[LIA-BRAIN-DIAG] correlationId="absent" status="correlationNotObserved"')

    // Duplicates are preserved: two observations, two calls, no dedupe.
    observer.observe('absent')
    expect(mocks.info).toHaveBeenCalledTimes(4)
  })

  it('52: the NON-DEV selection still observes - it simply has no destination', () => {
    const reads: string[] = []
    const reader = {
      get(correlationId: string): undefined {
        reads.push(correlationId)
        return undefined
      },
    }
    const observer = createLiaBrainCorrelationObserver({ correlationReader: reader, log: selectLiaBrainDiagnosticLog(false) })

    // The gate selectors returns nothing, so the observer was built in the
    // reader-only shape...
    expect(selectLiaBrainDiagnosticLog(false)).toBeUndefined()
    // ...and the observation itself is NOT gated: the read still happens, the
    // call returns void and no logger call exists to make.
    expect(observer.observe('logical-send-X')).toBeUndefined()
    expect(reads).toEqual(['logical-send-X'])
    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('proof: a throwing logger is contained by the observer, never by the adapter', () => {
    mocks.info.mockImplementationOnce(() => {
      throw new Error('logger exploded')
    })
    const reader = { get: () => undefined }
    const observer = createLiaBrainCorrelationObserver({ correlationReader: reader, log: selectLiaBrainDiagnosticLog(true) })

    // The observer owns the mandatory isolation boundary - the adapter
    // deliberately has none of its own.
    expect(() => observer.observe('X')).not.toThrow()
    expect(mocks.info).toHaveBeenCalledTimes(1)
  })
})

describe('lia brain diagnostic log - source invariants (Phase 8.0D-10B-4D2B)', () => {
  const REPO_ROOT = new URL('../../../../../../', import.meta.url)
  const DIAGNOSTIC_LOG = 'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts'

  /** Code without comments - guards must only find the words in real code. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  it('55/56: one logger, one entry type, one fixed namespace - and no other capability at all', () => {
    const source = stripComments(readFileSync(new URL(DIAGNOSTIC_LOG, REPO_ROOT), 'utf-8'))

    // The whole import surface: the entry TYPE and the repository logger.
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'`,
      `import { useLogg } from '@guiiai/logg'`,
    ])
    // One logger handle, created once, with the FIXED namespace.
    expect(source.match(/useLogg\(/g)).toHaveLength(1)
    expect(source).toContain(`useLogg('lia:brain').useGlobalConfig()`)
    expect(source).not.toMatch(/useLogg\([^')]/)

    // No correlation read/mapping/facts/store/service knowledge: the adapter
    // receives facts that are already final.
    expect(source).not.toMatch(/brain-correlation-reader|brain-execution-identity-facts|brain-expected-route|brain-correlation-store|brain-correlation-service|readLiaBrainExecutionIdentityFacts|LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)
    // No Brain service, provider resolver, config, fallback or permission surface.
    expect(source).not.toMatch(/LiaBrainService|decide\(|createProductionBrain|liaProductConfig|getChatProviderInstance|useProviderStore|activeProvider|activeModel|fallback|retry|permission/i)
    // No IPC/Electron/Eventa, no window RPC, no second log path.
    expect(source).not.toMatch(/eventa|defineEventa|defineInvokeEventa|ipcMain|ipcRenderer|BrowserWindow|electron|ingestMainProcessLog|setupFileLogger|createContext/)
    // No filesystem, network or timers, no async/queue and no state collections.
    expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|dns|dgram|child_process|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|console\.|process\.stdout/)
    expect(source).not.toMatch(/async |await |Promise|setTimeout|setInterval|queueMicrotask|\bnew Map\b|\bnew Set\b|pending|\bcache\b|history|lastEvent/)
    // No aggregate/verdict vocabulary, in any casing.
    expect(source).not.toMatch(/anyAttemptMatches|finalAttemptMatches|expectedRouteObserved|fallbackDetected|overallStatus|routeMatch|mismatch|divergence|aligned|verdict|score|recommendation/i)
    // No whole-entry serialization: the line is built only from allowlisted fields.
    expect(source).not.toMatch(/JSON\.stringify\((?:entry|facts|decision)\b/)

    // The exported surface is exactly the three audited names.
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'formatLiaBrainDiagnosticEntry',
      'logLiaBrainDiagnostic',
      'selectLiaBrainDiagnosticLog',
    ])
  })

  it('59: the terminal block names exactly the three approved count fields - read, never derived', () => {
    const source = stripComments(readFileSync(new URL(DIAGNOSTIC_LOG, REPO_ROOT), 'utf-8'))

    // The formatter reads the entry's own already-derived terminal member...
    const blockStart = source.indexOf(`if ('terminalFacts' in entry)`)
    expect(blockStart).toBeGreaterThan(-1)
    // ...and appends exactly these three fields, in exactly this order.
    const block = source.slice(blockStart, source.indexOf(`return [PREFIX, ...fields].join(' ')`, blockStart))
    // The exact template the formatter pushes for one count: the emitted name,
    // the entry's own terminal member, and both as plain text.
    const dollar = '$'
    const template = (field: string) => `\`${field}=${dollar}{entry.terminalFacts.${field}}\`,`
    expect(block).toContain([
      template('succeededTerminalObservationCount'),
      template('failedTerminalObservationCount'),
      template('abandonedTerminalObservationCount'),
    ].join('\n      '))
    // Once as the emitted field name, once as the member it is read from.
    expect(block.match(/TerminalObservationCount=/g)).toHaveLength(3)

    // Nothing else about a terminal observation is reachable: no raw collection,
    // no outcome, no round key, no per-round record, no total and no boolean.
    expect(block).not.toMatch(/roundId|outcome|executionTerminals|total|succeededTerminalObserved|failedTerminalObserved|abandonedTerminalObserved/)
    expect(source).not.toMatch(/executionTerminals|\boutcome\b|terminalObservationCount|succeededTerminalObserved|failedTerminalObserved|abandonedTerminalObserved|terminalOutcome/)
    // The composed type, the composition and both facts modules stay unimported:
    // the adapter receives the entry contract and derives nothing of its own.
    expect(source).not.toMatch(/brain-correlation-diagnostic-facts|LiaBrainCorrelationDiagnosticFacts|composeLiaBrainCorrelationDiagnosticFacts|brain-execution-terminal-facts|LiaBrainTerminalObservationFacts|brain-execution-identity-facts|deriveLiaBrainTerminalObservationFacts|deriveLiaBrainExecutionIdentityFacts/)
  })

  it('60/61/62: no verdict/fallback/send/completion vocabulary, no authority and no new IO surface', () => {
    const source = stripComments(readFileSync(new URL(DIAGNOSTIC_LOG, REPO_ROOT), 'utf-8'))

    for (const forbidden of [
      /fallback/i,
      /finalAttempt|winningAttempt|winner/,
      /sendSucceeded|sendFailed|sendOutcome/,
      /completed|completion|finished/i,
      /routeMatch|mismatch|orphan/i,
    ])
      expect(source, String(forbidden)).not.toMatch(forbidden)

    // No Brain service, provider/config policy, retry, tool or permission reach -
    // a log line holds no authority over anything.
    expect(source).not.toMatch(/LiaBrainService|createProductionBrain|liaProductConfig|getChatProviderInstance|useProviderStore|activeProvider|activeModel|policy|retry|permission|tool/i)
    // No IPC, no Eventa message, no network, no filesystem, no timers, no async.
    expect(source).not.toMatch(/eventa|ipcMain|ipcRenderer|BrowserWindow|electron|from ['"](?:node:)?(?:fs|net|https?|dns|dgram|child_process|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|\basync\b|\bawait\b|Promise|setTimeout|setInterval|queueMicrotask|\bnew Map\b|\bnew Set\b/)
    // The import surface is unchanged, and so is the one logger handle.
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'`,
      `import { useLogg } from '@guiiai/logg'`,
    ])
    expect(source.match(/useLogg\(/g)).toHaveLength(1)
    expect(source).toContain(`useLogg('lia:brain').useGlobalConfig()`)
  })

  it('31/57: no generic log pipeline file was touched, and the Brain IPC allowlist is exactly four', () => {
    const roots = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']
    const repoPrefix = `${fileURLToPath(REPO_ROOT).replace(/\/+$/, '')}/`
    const files: string[] = []
    for (const root of roots) {
      for (const item of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
        if (!item.isFile() || !/\.(?:ts|vue)$/.test(item.name) || item.name.includes('.test.'))
          continue
        files.push(`${item.parentPath.slice(repoPrefix.length)}/${item.name}`)
      }
    }

    // The Brain diagnostic adapter is the ONLY new module in this pipeline: the
    // generic log infrastructure keeps its own consumers untouched, and the
    // structured entry never crosses an IPC boundary.
    const structuredEntryConsumers = files
      .filter(relative => /LiaBrainDiagnosticEntry/.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()
    expect(structuredEntryConsumers).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-observer.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts',
    ])

    const tags = new Set<string>()
    for (const relative of files) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:event:lia:brain:send-terminal-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
  })
})
