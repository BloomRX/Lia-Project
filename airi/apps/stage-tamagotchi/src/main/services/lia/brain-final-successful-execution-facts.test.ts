import type { LiaBrainCorrelationSnapshot } from './brain-correlation-reader'
import type { LiaBrainFinalSuccessfulExecutionSnapshot } from './brain-final-successful-execution-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { authoredSourceEntry, normalizeLineEndings } from '../../../test-helpers'
import { createLiaBrainCorrelationStore } from './brain-correlation-store'
import { deriveLiaBrainFinalSuccessfulExecutionFacts } from './brain-final-successful-execution-facts'

/**
 * Phase 8.0D-10B-4D4C4-D2B3: the focused proof of the pure final successful
 * execution identity facts.
 *
 * The derivation is proven as PURE JOIN only: send-terminal gate, succeeded
 * round cardinality, roundId join, execution match cardinality. Nothing here
 * wires it into production beyond the composition, and nothing here claims
 * routeOverride, fallback, attemptIndex or requested-vs-winner.
 */

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
const FINAL_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-final-successful-execution-facts.ts'
const DIAGNOSTIC_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts'
const ROUTE_CONFORMANCE_FACTS = 'apps/stage-tamagotchi/src/main/services/lia/brain-route-conformance-facts.ts'
const BRAIN_ROOTS = ['apps/stage-tamagotchi/src']

/** `fileURLToPath` keeps the trailing separator of a directory URL. */
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT)

function productionSources(roots: string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const authored = authoredSourceEntry(REPO_ROOT_PATH, entry)
      if (!authored)
        continue
      files.push(authored.relativePosix)
    }
  }
  return files
}

function productionMatching(pattern: RegExp): string[] {
  return productionSources(BRAIN_ROOTS)
    .filter(relative => pattern.test(normalizeLineEndings(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

function readSource(relative: string): string {
  return normalizeLineEndings(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function realStore(maxEntries = 8) {
  let clock = 1_000
  return {
    store: createLiaBrainCorrelationStore({ maxEntries, now: () => clock, ttlMs: 900_000 }),
    advance: (ms: number) => { clock += ms },
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

describe('final successful execution facts - send-level gate (Phase 8.0D-10B-4D4C4-D2B3)', () => {
  it('sendTerminal absent -> sendTerminalNotObserved even with succeeded round', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [{ roundId: 'R1', providerId: 'p1', modelId: 'm1' }],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({ status: 'sendTerminalNotObserved' })
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts({})).toEqual({ status: 'sendTerminalNotObserved' })
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts({ sendTerminal: undefined })).toEqual({ status: 'sendTerminalNotObserved' })
    // Explicit undefined sendTerminal with succeeded round must not fabricate winner
    expect(Object.keys(deriveLiaBrainFinalSuccessfulExecutionFacts(snap))).toEqual(['status'])
  })

  it('sendTerminal failed -> sendFailed even if succeeded round present', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [{ roundId: 'R1', providerId: 'p1', modelId: 'm1' }],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
      sendTerminal: { outcome: 'failed' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({ status: 'sendFailed' })
  })

  it('succeeded send with no succeeded round -> noSucceededRoundObserved', () => {
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts({
      executions: [{ roundId: 'R1', providerId: 'p', modelId: 'm' }],
      executionTerminals: [],
      sendTerminal: { outcome: 'succeeded' },
    })).toEqual({ status: 'noSucceededRoundObserved' })

    expect(deriveLiaBrainFinalSuccessfulExecutionFacts({
      executions: [],
      executionTerminals: [{ roundId: 'R1', outcome: 'failed' }],
      sendTerminal: { outcome: 'succeeded' },
    })).toEqual({ status: 'noSucceededRoundObserved' })

    expect(deriveLiaBrainFinalSuccessfulExecutionFacts({
      executions: [],
      executionTerminals: [{ roundId: 'R1', outcome: 'abandoned' }],
      sendTerminal: { outcome: 'succeeded' },
    })).toEqual({ status: 'noSucceededRoundObserved' })
  })
})

describe('final successful execution facts - successful round join (Phase 8.0D-10B-4D4C4-D2B3)', () => {
  it('one failed + one succeeded -> finalSuccessfulExecutionObserved for succeeded round', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [
        { roundId: 'R0', providerId: 'p0', modelId: 'm0' },
        { roundId: 'R1', providerId: 'p1', modelId: 'm1' },
      ],
      executionTerminals: [
        { roundId: 'R0', outcome: 'failed' },
        { roundId: 'R1', outcome: 'succeeded' },
      ],
      sendTerminal: { outcome: 'succeeded' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 1,
    })
  })

  it('successful round is first observed execution -> arrivalIndex 0, not initial/fallback', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [{ roundId: 'R1', providerId: 'p1', modelId: 'm1' }],
      executionTerminals: [
        { roundId: 'R0', outcome: 'failed' },
        { roundId: 'R1', outcome: 'succeeded' },
      ],
      sendTerminal: { outcome: 'succeeded' },
    }
    const result = deriveLiaBrainFinalSuccessfulExecutionFacts(snap)
    expect(result).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 0,
    })
    // Must not be labeled attemptIndex or fallback
    expect(Object.keys(result).sort()).toEqual(['executionArrivalIndex', 'modelId', 'providerId', 'roundId', 'status'])
    expect(JSON.stringify(result)).not.toMatch(/attemptIndex|fallback|initial/)
  })

  it('succeeded round has no execution report -> succeededRoundExecutionNotObserved', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
      sendTerminal: { outcome: 'succeeded' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({
      status: 'succeededRoundExecutionNotObserved',
      roundId: 'R1',
    })
  })

  it('multiple succeeded round terminals -> multipleSucceededRoundTerminalsObserved ambiguity', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [
        { roundId: 'R1', providerId: 'p1', modelId: 'm1' },
        { roundId: 'R2', providerId: 'p2', modelId: 'm2' },
      ],
      executionTerminals: [
        { roundId: 'R1', outcome: 'succeeded' },
        { roundId: 'R2', outcome: 'succeeded' },
      ],
      sendTerminal: { outcome: 'succeeded' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({ status: 'multipleSucceededRoundTerminalsObserved' })
    // Must not choose first/last
    expect(JSON.stringify(snap)).toContain('R1')
  })

  it('duplicate execution observations for succeeded round -> multipleExecutionsForSucceededRoundObserved ambiguity', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [
        { roundId: 'R1', providerId: 'p1', modelId: 'm1' },
        { roundId: 'R1', providerId: 'p1-dup', modelId: 'm1-dup' },
      ],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
      sendTerminal: { outcome: 'succeeded' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({
      status: 'multipleExecutionsForSucceededRoundObserved',
      roundId: 'R1',
    })
  })

  it('failed/abandoned rounds cannot win even if send succeeded', () => {
    for (const outcome of ['failed', 'abandoned'] as const) {
      const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
        executions: [{ roundId: 'R1', providerId: 'p', modelId: 'm' }],
        executionTerminals: [{ roundId: 'R1', outcome }],
        sendTerminal: { outcome: 'succeeded' },
      }
      expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({ status: 'noSucceededRoundObserved' })
    }
  })

  it('order does not define success - succeeded round found by roundId not array position', () => {
    // Succeeded round first in executions
    const first: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [
        { roundId: 'R1', providerId: 'p1', modelId: 'm1' },
        { roundId: 'R0', providerId: 'p0', modelId: 'm0' },
        { roundId: 'R2', providerId: 'p2', modelId: 'm2' },
      ],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
      sendTerminal: { outcome: 'succeeded' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(first)).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 0,
    })

    // Succeeded round middle
    const middle: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [
        { roundId: 'R0', providerId: 'p0', modelId: 'm0' },
        { roundId: 'R1', providerId: 'p1', modelId: 'm1' },
        { roundId: 'R2', providerId: 'p2', modelId: 'm2' },
      ],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
      sendTerminal: { outcome: 'succeeded' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(middle)).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 1,
    })

    // Succeeded round last
    const last: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [
        { roundId: 'R0', providerId: 'p0', modelId: 'm0' },
        { roundId: 'R2', providerId: 'p2', modelId: 'm2' },
        { roundId: 'R1', providerId: 'p1', modelId: 'm1' },
      ],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
      sendTerminal: { outcome: 'succeeded' },
    }
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(last)).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 2,
    })
  })
})

describe('final successful execution facts - immutability and freshness (Phase 8.0D-10B-4D4C4-D2B3)', () => {
  it('input is never mutated and frozen snapshot is accepted', () => {
    const snap = deepFreeze({
      executions: [{ roundId: 'R1', providerId: 'p1', modelId: 'm1' }],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' } as const],
      sendTerminal: { outcome: 'succeeded' as const },
    })
    const before = JSON.stringify(snap)
    const result = deriveLiaBrainFinalSuccessfulExecutionFacts(snap)
    expect(result).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 0,
    })
    expect(JSON.stringify(snap)).toBe(before)
    expect(Object.isFrozen(snap)).toBe(true)
  })

  it('every call returns a fresh object', () => {
    const snap: LiaBrainFinalSuccessfulExecutionSnapshot = {
      executions: [{ roundId: 'R1', providerId: 'p1', modelId: 'm1' }],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' }],
      sendTerminal: { outcome: 'succeeded' },
    }
    const first = deriveLiaBrainFinalSuccessfulExecutionFacts(snap)
    const second = deriveLiaBrainFinalSuccessfulExecutionFacts(snap)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })

  it('hostile extra fields are ignored - not joined, not interpreted', () => {
    const snap = {
      executions: [{ roundId: 'R1', providerId: 'p1', modelId: 'm1', extra: 'ignored', conversationId: 'c' }],
      executionTerminals: [{ roundId: 'R1', outcome: 'succeeded' as const, extra: 'ignored' }],
      sendTerminal: { outcome: 'succeeded' as const, extra: 'ignored' },
      decision: { status: 'automatic' },
      correlationId: 'X',
      createdAt: 123,
    } as unknown as LiaBrainFinalSuccessfulExecutionSnapshot

    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 0,
    })
  })
})

describe('final successful execution facts - canonical store boundary (Phase 8.0D-10B-4D4C4-D2B3)', () => {
  it('real store snapshot with one failed + one succeeded yields correct final', () => {
    const { store } = realStore()
    store.recordExecution({ conversationId: 'c1', correlationId: 'X', modelId: 'm0', providerId: 'p0', roundId: 'R0' })
    store.recordExecution({ conversationId: 'c1', correlationId: 'X', modelId: 'm1', providerId: 'p1', roundId: 'R1' })
    store.recordExecutionTerminal({ correlationId: 'X', roundId: 'R0', outcome: 'failed' })
    store.recordExecutionTerminal({ correlationId: 'X', roundId: 'R1', outcome: 'succeeded' })
    store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })

    const snap = store.get('X')!
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({
      status: 'finalSuccessfulExecutionObserved',
      roundId: 'R1',
      providerId: 'p1',
      modelId: 'm1',
      executionArrivalIndex: 1,
    })
  })

  it('real store: send absent, succeeded round exists -> sendTerminalNotObserved', () => {
    const { store } = realStore()
    store.recordExecution({ conversationId: 'c1', correlationId: 'X', modelId: 'm1', providerId: 'p1', roundId: 'R1' })
    store.recordExecutionTerminal({ correlationId: 'X', roundId: 'R1', outcome: 'succeeded' })
    const snap = store.get('X')!
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({ status: 'sendTerminalNotObserved' })
  })

  it('real store: succeeded round has no execution -> succeededRoundExecutionNotObserved', () => {
    const { store } = realStore()
    store.recordExecutionTerminal({ correlationId: 'X', roundId: 'R1', outcome: 'succeeded' })
    store.recordSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    const snap = store.get('X')!
    expect(deriveLiaBrainFinalSuccessfulExecutionFacts(snap)).toEqual({
      status: 'succeededRoundExecutionNotObserved',
      roundId: 'R1',
    })
  })

  it('structural compatibility - reader snapshot satisfies minimal input', () => {
    const snapshotFitsInput: LiaBrainCorrelationSnapshot extends LiaBrainFinalSuccessfulExecutionSnapshot ? true : false = true
    expect(snapshotFitsInput).toBe(true)
    const asInput = (snap: LiaBrainCorrelationSnapshot): LiaBrainFinalSuccessfulExecutionSnapshot => snap
    expect(asInput({ executions: [] })).toEqual({ executions: [] })
  })
})

describe('final successful execution facts - source guards (Phase 8.0D-10B-4D4C4-D2B3)', () => {
  const source = readSource(FINAL_FACTS)
  const code = stripComments(source)

  it('the module imports nothing at all - no store, no adapter, no transport', () => {
    expect(source.match(/^import .*$/gm)).toBeNull()
    expect(code).not.toMatch(/^import /m)
    expect(code).not.toMatch(/from '/)
    expect(code).not.toMatch(/brain-correlation|brain-execution|brain-diagnostic|observer|LiaObserved|eventa/i)
  })

  it('the export surface is exactly the four approved names', () => {
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'LiaBrainFinalSuccessfulExecutionObservation',
      'LiaBrainFinalSuccessfulTerminalObservation',
      'LiaBrainFinalSuccessfulExecutionSnapshot',
      'LiaBrainFinalSuccessfulExecutionFacts',
      'deriveLiaBrainFinalSuccessfulExecutionFacts',
    ])
  })

  it('no fallback, winner, attemptIndex or routing vocabulary', () => {
    for (const forbidden of ['fallback', 'winningAttempt', 'winner', 'attemptIndex', 'isFallback', 'fallbackRoutes', 'initialAttempt', 'requestedInitialRoute', 'appliedRouteOverride', 'requestedRoute', 'requestedProvider', 'expectedProvider', 'winnerReason', 'routeOverrideApplied', 'preferred', 'selectedByBrain', 'correctness', 'score'])
      expect(code, forbidden).not.toContain(forbidden)
    // executionArrivalIndex is the only index allowed
    expect(code).toContain('executionArrivalIndex')
    expect(code).not.toMatch(/attemptIndex/)
  })

  it('no authority, no state, no clock, no async, no IO', () => {
    expect(code).not.toMatch(/recordDecision|recordExecution|recordSendTerminal|correlationObserver|\.observe\(/)
    expect(code).not.toMatch(/new Map|new Set|WeakMap|WeakSet|cache|history|singleton/)
    expect(code).not.toMatch(/Date\.now|performance\.now|Math\.random|timestamp|ttl/i)
    expect(code).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval/)
    expect(code).not.toMatch(/eventa|ipcMain|ipcRenderer|BrowserWindow|\.emit\(/)
    expect(code).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|child_process|dns|dgram|timers)['/]/)
    expect(code).not.toMatch(/console\.|useLogg|logger|telemetry/i)
  })

  it('closed vocabularies are enforced correctly', () => {
    expect(code).toMatch(/outcome !== 'succeeded' && outcome !== 'failed'/)
    expect(code).toMatch(/record\.outcome === 'succeeded'/)
    // sendTerminal vocabulary is exactly two values
    expect(code).not.toMatch(/abandoned.*sendTerminal|sendTerminal.*abandoned/)
  })

  it('the derivation has exactly ONE production call site - the composition', () => {
    expect(productionMatching(/deriveLiaBrainFinalSuccessfulExecutionFacts/)).toEqual([FINAL_FACTS, DIAGNOSTIC_FACTS].sort())
    expect(productionMatching(/(?<!function )deriveLiaBrainFinalSuccessfulExecutionFacts\(/)).toEqual([DIAGNOSTIC_FACTS])
    // Phase 8.0D-10B-4D4C4-D2B10: the route-conformance module is a third TYPE-ONLY
    // consumer of this module's fact union. It never CALLS the derivation, so the
    // two call-site allowlists above stay exactly as they were.
    expect(productionMatching(/brain-final-successful-execution-facts|LiaBrainFinalSuccessfulExecutionFacts|LiaBrainFinalSuccessfulExecutionSnapshot/)).toEqual([FINAL_FACTS, DIAGNOSTIC_FACTS, ROUTE_CONFORMANCE_FACTS].sort())
    expect(productionMatching(/FinalSuccessfulExecutionFacts/)).toEqual([FINAL_FACTS, DIAGNOSTIC_FACTS, ROUTE_CONFORMANCE_FACTS].sort())
  })

  it('no requested-vs-winner comparison vocabulary', () => {
    for (const forbidden of [/winnerMatchesRequested/i, /routeOverrideWon/i, /BrainWon/i, /fallbackWon/i, /requestedVsActual/i, /initialVsFinal/i, /routeMatch|mismatch|contradiction/i])
      expect(code, String(forbidden)).not.toMatch(forbidden)
  })
})
