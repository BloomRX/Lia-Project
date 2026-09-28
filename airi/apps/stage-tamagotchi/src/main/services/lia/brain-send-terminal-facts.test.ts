import type { LiaBrainCorrelationSnapshot } from './brain-correlation-reader'
import type { LiaBrainSendTerminalObservationFacts, LiaBrainSendTerminalObservationSnapshot } from './brain-send-terminal-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createLiaBrainCorrelationStore } from './brain-correlation-store'
import { deriveLiaBrainSendTerminalObservationFacts } from './brain-send-terminal-facts'

/**
 * Phase 8.0D-10B-4D4C4-B4B2: the focused proof of the pure logical-send terminal
 * observation facts.
 *
 * The derivation is proven as PURE PROJECTION only: one optional read of the
 * snapshot the caller supplies, one closed-vocabulary check, one fresh result.
 * Nothing here wires it into production - it has zero production callers by
 * design - and nothing here joins the send settlement to a round, an attempt, a
 * decision or an identity, counts anything or interprets an absence.
 */

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
const SEND_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-facts.ts'
const DIAGNOSTIC_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts'
const DIAGNOSTIC_LOG = 'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts'
const BRAIN_ROOTS = ['apps/stage-tamagotchi/src']

/** `fileURLToPath` keeps the trailing separator of a directory URL. */
const REPO_PREFIX = `${fileURLToPath(REPO_ROOT).replace(/\/+$/, '')}/`

function productionSources(roots: string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      files.push(`${entry.parentPath.slice(REPO_PREFIX.length)}/${entry.name}`)
    }
  }
  return files
}

/** The production files matching one pattern, sorted - the ownership allowlist shape. */
function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')))
    .sort()
}

/** The production source of one repo-relative path. */
function readSource(relative: string): string {
  return readFileSync(new URL(relative, REPO_ROOT), 'utf-8')
}

/** Code without comments - guards must only find the words in real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The REAL canonical store, driven directly - the production boundary. */
function realStore(maxEntries = 8) {
  let clock = 1_000
  return {
    store: createLiaBrainCorrelationStore({ maxEntries, now: () => clock, ttlMs: 900_000 }),
    advance: (milliseconds: number) => {
      clock += milliseconds
    },
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value))
      deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

describe('logical send terminal facts - projection (Phase 8.0D-10B-4D4C4-B4B2)', () => {
  it('a/b: an absent record and an explicit undefined both project to an empty result', () => {
    const absent = deriveLiaBrainSendTerminalObservationFacts({})
    const explicitUndefined = deriveLiaBrainSendTerminalObservationFacts({ sendTerminal: undefined })

    expect(absent).toEqual({})
    expect(explicitUndefined).toEqual({})
    expect(Object.keys(absent)).toEqual([])
    expect(Object.keys(explicitUndefined)).toEqual([])
  })

  it('c/d: each settlement projects to exactly its own direct outcome', () => {
    expect(deriveLiaBrainSendTerminalObservationFacts({ sendTerminal: { outcome: 'succeeded' } }))
      .toEqual({ sendTerminalOutcome: 'succeeded' })
    expect(deriveLiaBrainSendTerminalObservationFacts({ sendTerminal: { outcome: 'failed' } }))
      .toEqual({ sendTerminalOutcome: 'failed' })

    // Exactly ONE key, and it is the qualified name - never a bare `outcome`.
    expect(Object.keys(deriveLiaBrainSendTerminalObservationFacts({ sendTerminal: { outcome: 'succeeded' } })))
      .toEqual(['sendTerminalOutcome'])
    expect(Object.keys(deriveLiaBrainSendTerminalObservationFacts({ sendTerminal: { outcome: 'failed' } })))
      .toEqual(['sendTerminalOutcome'])
  })

  it('e/f: an outcome outside the closed vocabulary contributes NOTHING - no throw, no repair', () => {
    // A hostile structural cast may smuggle the round-level vocabulary or an
    // arbitrary string past the type: neither may reach the diagnostic facts.
    for (const outcome of ['abandoned', 'bogus', '', 'SUCCEEDED', 'success', 'pending', 'cancelled']) {
      const hostile = { sendTerminal: { outcome } } as never as LiaBrainSendTerminalObservationSnapshot
      let projected: LiaBrainSendTerminalObservationFacts | undefined
      expect(() => {
        projected = deriveLiaBrainSendTerminalObservationFacts(hostile)
      }).not.toThrow()
      expect(projected).toEqual({})
      expect(Object.keys(projected!)).toEqual([])
    }
  })

  it('g/h: the result is a fresh object on every call, and never the raw record', () => {
    const absentSnapshot = {}
    const firstAbsent = deriveLiaBrainSendTerminalObservationFacts(absentSnapshot)
    const secondAbsent = deriveLiaBrainSendTerminalObservationFacts(absentSnapshot)
    expect(firstAbsent).not.toBe(secondAbsent)
    expect(firstAbsent).toEqual(secondAbsent)

    for (const outcome of ['succeeded', 'failed'] as const) {
      const snapshot = { sendTerminal: { outcome } }
      const first = deriveLiaBrainSendTerminalObservationFacts(snapshot)
      const second = deriveLiaBrainSendTerminalObservationFacts(snapshot)
      expect(first).not.toBe(second)
      expect(first).toEqual(second)
      // The facts object projects the outcome - it is never an alias of the raw
      // record the snapshot carries.
      expect(first).not.toBe(snapshot.sendTerminal)
      expect('sendTerminal' in first).toBe(false)
    }
  })

  it('i/j: the supplied snapshot is never edited, and a frozen one is accepted', () => {
    const frozen = deepFreeze({ sendTerminal: { outcome: 'failed' } })
    const projected = deriveLiaBrainSendTerminalObservationFacts(frozen)

    expect(projected).toEqual({ sendTerminalOutcome: 'failed' })
    expect(frozen.sendTerminal).toEqual({ outcome: 'failed' })
    expect(Object.keys(frozen.sendTerminal)).toEqual(['outcome'])
    expect(projected).not.toBe(frozen.sendTerminal)
  })

  it('k: every unrelated field of a richer snapshot is irrelevant to the projection', () => {
    // Structural typing: a full reader snapshot, with decisions, attempts, round
    // terminals and unrelated metadata, satisfies the minimal contract - and the
    // projection sees only the send terminal.
    const rich = {
      correlationId: 'X',
      createdAt: 123,
      decision: { selectedRoute: { engineId: 'groq' } },
      executions: [{ conversationId: 'c', correlationId: 'X', modelId: 'm', providerId: 'p', roundId: 'A' }],
      executionTerminals: [{ outcome: 'abandoned', roundId: 'A' }],
      sendTerminal: { outcome: 'failed' },
    }

    expect(deriveLiaBrainSendTerminalObservationFacts(rich))
      .toEqual(deriveLiaBrainSendTerminalObservationFacts({ sendTerminal: { outcome: 'failed' } }))
    expect(deriveLiaBrainSendTerminalObservationFacts({ ...rich, sendTerminal: undefined })).toEqual({})
  })
})

describe('logical send terminal facts - the canonical store boundary (Phase 8.0D-10B-4D4C4-B4B2)', () => {
  it('l: a real send-only entry projects its direct settlement, without an adapter', () => {
    for (const outcome of ['succeeded', 'failed'] as const) {
      const { store } = realStore()
      store.recordSendTerminal({ correlationId: 'X', outcome })

      // Store -> reader-compatible snapshot -> pure send facts: the canonical
      // snapshot satisfies the minimal input as-is (undefined narrowed away).
      const snapshot = store.get('X')!
      expect(snapshot.sendTerminal).toEqual({ outcome })
      expect(deriveLiaBrainSendTerminalObservationFacts(snapshot)).toEqual({ sendTerminalOutcome: outcome })
    }
  })

  it('m: a present entry with NO send terminal projects nothing - no interpretation', () => {
    const { store } = realStore()
    store.recordExecution({ conversationId: 'conversation-1', correlationId: 'X', modelId: 'openai/gpt-oss-120b', providerId: 'groq', roundId: 'A' })

    const snapshot = store.get('X')!
    expect('sendTerminal' in snapshot).toBe(false)
    expect(deriveLiaBrainSendTerminalObservationFacts(snapshot)).toEqual({})
    expect(Object.keys(deriveLiaBrainSendTerminalObservationFacts(snapshot))).toEqual([])
  })

  it('n/o: the first accepted settlement is the ONLY one projected, in both directions', () => {
    const failedFirst = realStore()
    failedFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })
    failedFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    expect(deriveLiaBrainSendTerminalObservationFacts(failedFirst.store.get('X')!))
      .toEqual({ sendTerminalOutcome: 'failed' })

    const succeededFirst = realStore()
    succeededFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    succeededFirst.store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })
    expect(deriveLiaBrainSendTerminalObservationFacts(succeededFirst.store.get('X')!))
      .toEqual({ sendTerminalOutcome: 'succeeded' })
  })

  it('p/q: the round terminal is NEVER joined to the send settlement - both directions stay legitimate', () => {
    const roundSucceeded = realStore()
    roundSucceeded.store.recordExecutionTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })
    roundSucceeded.store.recordSendTerminal({ correlationId: 'X', outcome: 'failed' })

    const projected = deriveLiaBrainSendTerminalObservationFacts(roundSucceeded.store.get('X')!)
    expect(projected).toEqual({ sendTerminalOutcome: 'failed' })
    // No mismatch, no contradiction, no round-derived field.
    expect(Object.keys(projected)).toEqual(['sendTerminalOutcome'])

    const roundAbandoned = realStore()
    roundAbandoned.store.recordExecutionTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })
    roundAbandoned.store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })

    expect(deriveLiaBrainSendTerminalObservationFacts(roundAbandoned.store.get('X')!))
      .toEqual({ sendTerminalOutcome: 'succeeded' })

    // The round collection alone projects nothing at all.
    const roundOnly = realStore()
    roundOnly.store.recordExecutionTerminal({ correlationId: 'Y', outcome: 'succeeded', roundId: 'R' })
    expect(deriveLiaBrainSendTerminalObservationFacts(roundOnly.store.get('Y')!)).toEqual({})
  })
})

describe('logical send terminal facts - structural compatibility (Phase 8.0D-10B-4D4C4-B4B2)', () => {
  it('r: the reader-owned snapshot satisfies the minimal input with no adapter', () => {
    // Compile-time proof: the widened reader contract IS assignable to the pure
    // input contract, so the composition can pass the very object the ONE read
    // returned (and the real store snapshot is one such object).
    const snapshotFitsInput: LiaBrainCorrelationSnapshot extends LiaBrainSendTerminalObservationSnapshot ? true : false = true
    expect(snapshotFitsInput).toBe(true)
    const asInput = (snapshot: LiaBrainCorrelationSnapshot): LiaBrainSendTerminalObservationSnapshot => snapshot
    expect(asInput({ executions: [] })).toEqual({ executions: [] })
  })
})

describe('logical send terminal facts - source guards (Phase 8.0D-10B-4D4C4-B4B2)', () => {
  const source = readSource(SEND_FACTS)
  const code = stripComments(source)

  it('s: the module imports nothing at all - no store, no adapter, no transport, no observer', () => {
    expect(source.match(/^import .*$/gm)).toBeNull()
    expect(code).not.toMatch(/^import /m)
    expect(code).not.toMatch(/from '/)
    expect(code).not.toMatch(/brain-correlation|brain-execution|brain-diagnostic|observer|LiaObserved|eventa/i)
  })

  it('t: the export surface is exactly the three approved names', () => {
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaBrainSendTerminalObservationSnapshot',
      'LiaBrainSendTerminalObservationFacts',
      'deriveLiaBrainSendTerminalObservationFacts',
    ])
    // No factory, no class, no service object and no reader interface.
    expect(code).not.toMatch(/createLia|class |\bget\s*[:(]|LiaBrainSendTerminalRecorder|CorrelationSnapshotReader/)
  })

  it('u: no raw family is reachable - no key, no round, no attempt, no decision, no identity', () => {
    for (const forbidden of ['correlationId', 'roundId', 'attemptIndex', 'attemptCount', 'executionTerminals', 'executions', 'decision', 'providerId', 'modelId', 'engineId', 'expected', 'conversationId', 'createdAt'])
      expect(code, forbidden).not.toContain(forbidden)
    // No count and no boolean pair either: presence of the qualified outcome is
    // the whole observation.
    expect(code).not.toMatch(/TerminalObservationCount|SucceededCount|FailedCount/)
    expect(code).not.toMatch(/sendSucceededObserved|sendFailedObserved|sendTerminalObserved|sendSucceeded|sendFailed|anySucceeded|allFailed/)
    expect(code).not.toMatch(/\bcount\b|total/i)
    // No status union: the qualified outcome IS the observation.
    expect(code).not.toMatch(/status|sendTerminalNotObserved/)
  })

  it('v: no aggregate, verdict, routing or completion vocabulary anywhere', () => {
    for (const forbidden of [
      /fallback/i,
      /finalAttempt|winningAttempt|winner/,
      /completed|completion|finished|pending/i,
      /routeMatch|mismatch|orphan/i,
      /\bfinal\b/,
      /preferred|chosen|score|recommendation|verdict/i,
    ])
      expect(code, String(forbidden)).not.toMatch(forbidden)
  })

  it('w: no authority, no state, no clock, no async, no IO and no transport', () => {
    expect(code).not.toMatch(/recordDecision|recordExecution|recordSendTerminal|correlationObserver|\.observe\(/)
    expect(code).not.toMatch(/brainService|fallbackResolver|setPreferred|permission|toolCall|switch/i)
    expect(code).not.toMatch(/new Map|new Set|WeakMap|WeakSet|cache|history|singleton/)
    expect(code).not.toMatch(/Date\b|Date\.now|performance\.now|Math\.random|timestamp|ttl/i)
    expect(code).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval/)
    expect(source).not.toMatch(/console\.|useLogg|logger|posthog|telemetry/i)
    expect(code).not.toMatch(/eventa|ipcMain|ipcRenderer|BrowserWindow|\.emit\(|context\.on\(|\bfetch\(|XMLHttpRequest/)
    expect(code).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]/)
    // Metadata only: no content, no credentials, no endpoints, no error text.
    expect(source).not.toMatch(/prompt|\bmessages\b|\bresponse\b|usage|credential|apiKey|baseURL|error text|stack/i)
  })

  it('x: the closed vocabulary is enforced with exactly the two approved settlements', () => {
    // The ONLY outcome words the module names are the two closed ones: each
    // declaration states them once and the projection guard checks them once.
    expect(source.match(/'succeeded'/g)).toHaveLength(3)
    expect(source.match(/'failed'/g)).toHaveLength(3)
    expect(code).toMatch(/outcome !== 'succeeded' && outcome !== 'failed'/)
    // ...and the round-level or foreign vocabulary never appears here at all.
    for (const forbidden of ['abandoned', 'cancelled', 'superseded'])
      expect(code, forbidden).not.toContain(forbidden)
    // The narrow guard is exactly the projection check: no sanitizer machinery.
    expect(code).not.toMatch(/isRecord|readString|typeof |\.trim\(|\.length === 0|structuredClone|JSON\./)
  })

  it('y: the derivation has exactly ONE production call site - the composition, and nowhere else', () => {
    // Phase 8.0D-10B-4D4C4-B4B3 wires the projection into the composition: the
    // module and its ONE call site are now both named, and no third module joins.
    expect(productionMatching(/deriveLiaBrainSendTerminalObservationFacts/)).toEqual([SEND_FACTS, DIAGNOSTIC_FACTS].sort())
    expect(productionMatching(/(?<!function )deriveLiaBrainSendTerminalObservationFacts\(/)).toEqual([DIAGNOSTIC_FACTS])
    // And no production module outside the pair names the module or its types.
    expect(productionMatching(/brain-send-terminal-facts|LiaBrainSendTerminalObservationSnapshot|LiaBrainSendTerminalObservationFacts/)).toEqual([SEND_FACTS, DIAGNOSTIC_FACTS].sort())
    // Phase 8.0D-10B-4D4C4-B4B4: the formatter now also owns the projected
    // OUTCOME textual field (printing it as the last quoted token), while the
    // composition still only owns the structured field name.
    expect(productionMatching(/sendTerminalOutcome/)).toEqual([SEND_FACTS, DIAGNOSTIC_LOG].sort())
    // The distinct term `sendTerminalObserved` is still introduced NOWHERE.
    expect(productionMatching(/sendTerminalObserved/)).toEqual([])
    // The deferred layers keep knowing nothing about the projection: the
    // observer, the identity facts and the round-terminal facts are untouched.
    // The formatter left the list in B4B4: it now prints the outcome.
    for (const relative of [
      'brain-correlation-observer.ts',
      'brain-execution-identity-facts.ts',
      'brain-execution-terminal-facts.ts',
    ]) {
      expect(stripComments(readSource(`apps/stage-tamagotchi/src/main/services/lia/${relative}`)), relative)
        .not
        .toMatch(/sendTerminalOutcome|brain-send-terminal-facts|deriveLiaBrainSendTerminalObservationFacts/)
    }
    // Formatter must still NOT import the pure module nor call the deriver.
    expect(stripComments(readSource(DIAGNOSTIC_LOG))).not.toMatch(/brain-send-terminal-facts|deriveLiaBrainSendTerminalObservationFacts/)
    expect(productionMatching(/sendTerminalFacts/)).toEqual([DIAGNOSTIC_FACTS, DIAGNOSTIC_LOG].sort())
  })
})
