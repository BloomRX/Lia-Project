import type { LiaBrainSendTerminalReport } from '../../../shared/eventa'
import type { LiaBrainSendTerminalRecorder } from './brain-send-terminal-report-service'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationStore } from './brain-correlation-store'
import { createLiaBrainExecutionTerminalReportService, sanitizeLiaBrainExecutionTerminalReport } from './brain-execution-terminal-report-service'
import { createLiaBrainSendTerminalReportService, sanitizeLiaBrainSendTerminalReport } from './brain-send-terminal-report-service'

/**
 * Phase 8.0D-10B-4D4C4-B3B1: the trusted main ingress for the Lia logical-send
 * terminal report.
 *
 * The service under test is the REAL one, over a recording store double: the
 * tests call the REAL ingress operation with raw, hostile `unknown` payloads and
 * assert exactly what the store would have received. The authority boundary
 * these tests pin: the payload is sanitized, TWO contract facts are required,
 * and everything else is discarded - no round, no identity, no attempt, no error
 * data, no observer, no transport.
 *
 * Parity with the closest sibling (`brain-execution-terminal-report-service`)
 * is pinned behaviourally, never assumed: the same hostile getter that escapes
 * the sibling sanitizer escapes this one, and the same store failure is
 * contained the same way.
 */

const mocks = vi.hoisted(() => ({
  recordSendTerminal: vi.fn(),
}))

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** Code without comments - guards must only find the words in real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const REPO_ROOT = new URL('../../../../../../', import.meta.url)
/** `fileURLToPath` keeps the trailing separator of a directory URL. */
const REPO_PREFIX = `${fileURLToPath(REPO_ROOT).replace(/\/+$/, '')}/`

/** Every production (non-test) `.ts`/`.vue` file under the repo-relative roots. */
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

/** Production sources whose content matches the pattern, in stable order. */
function productionSourcesMatching(roots: string[], pattern: RegExp): string[] {
  return productionSources(roots)
    .filter(relative => pattern.test(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')))
    .sort()
}

const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']

/** The narrow recorder double the ingress receives - and nothing else. */
function recorderDouble(recordSendTerminal: (report: unknown) => void = mocks.recordSendTerminal): LiaBrainSendTerminalRecorder {
  return { recordSendTerminal } as LiaBrainSendTerminalRecorder
}

/** The ingress under test, over the recording recorder double. */
function ingress(store: LiaBrainSendTerminalRecorder = recorderDouble()) {
  return createLiaBrainSendTerminalReportService({ correlationStore: store })
}

/** The report the recorder received on the Nth accepted call. */
function storedReport(index = 0): Record<string, unknown> {
  return mocks.recordSendTerminal.mock.calls[index]![0] as Record<string, unknown>
}

const VALID_REPORT = {
  correlationId: 'logical-send-X',
  outcome: 'failed',
}

const EXTRA_FIELDS = {
  roundId: 'round-a',
  attemptCount: 3,
  providerId: 'groq',
  modelId: 'openai/gpt-oss-120b',
  engineId: 'groq',
  conversationId: 'conversation-1',
  error: 'boom',
  stack: 'Error: boom\n  at ...',
  errorCode: 'E_HOSTILE',
  failureStage: 'streaming',
  message: 'private message',
  prompt: 'private prompt',
  text: 'private text',
  messages: [{ role: 'user', content: 'private' }],
  attachments: ['file:///secret'],
  tools: ['shell'],
  usage: { totalTokens: 12 },
  token: 'sk-secret',
  apiKey: 'sk-secret',
  timestamp: 1_700_000_000_000,
  nested: { providerId: 'anthropic', outcome: 'succeeded' },
}

beforeEach(() => {
  mocks.recordSendTerminal.mockClear()
})

describe('lia send terminal ingress service - sanitizer (Phase 8.0D-10B-4D4C4-B3B1)', () => {
  it('60/61: each accepted settlement is forwarded verbatim, with the exact two canonical keys', () => {
    const service = ingress()

    for (const outcome of ['succeeded', 'failed'] as const) {
      mocks.recordSendTerminal.mockClear()
      service.report({ correlationId: `corr-${outcome}`, outcome })

      expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(1)
      const report = storedReport()
      // EXACTLY the two contract fields - no round, no attempt count, no
      // provider/model identity, no timing, no usage, no error.
      expect(Object.keys(report).sort()).toEqual(['correlationId', 'outcome'])
      expect(report).toEqual({ correlationId: `corr-${outcome}`, outcome })
    }
  })

  it('b: the sanitized value is a fresh object, never the hostile payload itself', () => {
    const service = ingress()
    const payload = { ...VALID_REPORT }
    service.report(payload)

    const report = storedReport()
    expect(report).not.toBe(payload)
    expect(report).toEqual(VALID_REPORT)
    // Mutating the payload after the call cannot reach what was recorded: the
    // canonical report was built field-by-field.
    payload.outcome = 'succeeded'
    payload.correlationId = 'mutated'
    expect(storedReport()).toEqual(VALID_REPORT)
    // And the sanitizer is pure: it returns a value and holds no state.
    expect(sanitizeLiaBrainSendTerminalReport({ ...VALID_REPORT })).toEqual(VALID_REPORT)
  })

  it('c/63: whitespace policy is inherited - the key convention is non-empty string, never trimmed', () => {
    const service = ingress()

    // A whitespace-only key is still a usable key, exactly like both sibling
    // ingresses: the identifier policy must not diverge.
    service.report({ correlationId: '   ', outcome: 'failed' })
    expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(1)
    expect(storedReport()).toEqual({ correlationId: '   ', outcome: 'failed' })

    // Untrimmed in, untrimmed out: no normalization was introduced here.
    expect(sanitizeLiaBrainSendTerminalReport({ correlationId: ' corr ', outcome: 'failed' }))
      .toEqual({ correlationId: ' corr ', outcome: 'failed' })
    // And the sibling round-terminal sanitizer reads the same payload shape the
    // same way - the two boundaries stay identical.
    expect(sanitizeLiaBrainExecutionTerminalReport({ correlationId: '   ', outcome: 'failed', roundId: '   ' }))
      .toEqual({ correlationId: '   ', outcome: 'failed', roundId: '   ' })
  })

  it('29/65: hostile extra fields are discarded - only the two contract facts survive', () => {
    const service = ingress()
    service.report({ ...VALID_REPORT, ...EXTRA_FIELDS, roundId: 'R', error: 'secret', providerId: 'P' })

    expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(1)
    const report = storedReport()
    expect(Object.keys(report).sort()).toEqual(['correlationId', 'outcome'])
    expect(report).toEqual({ correlationId: 'logical-send-X', outcome: 'failed' })

    // Nothing hostile leaks through, in any casing or nesting.
    const serialized = JSON.stringify(report)
    for (const forbidden of ['round-a', 'attemptCount', 'groq', 'gpt-oss', 'conversation-1', 'boom', 'E_HOSTILE', 'streaming', 'private', 'sk-secret', '1700000000000', 'anthropic', 'nested', 'shell', 'file:///secret', 'totalTokens'])
      expect(serialized).not.toContain(forbidden)

    // The sanitizer is pure: no store, no state, exactly one fresh value.
    expect(sanitizeLiaBrainSendTerminalReport({ ...VALID_REPORT, ...EXTRA_FIELDS })).toEqual(VALID_REPORT)
  })

  it('62: an unusable correlationId ignores the payload - and never synthesizes one', () => {
    const service = ingress()

    for (const correlationId of [undefined, null, 0, 42, false, true, {}, [], '', () => {}, Symbol('x')]) {
      service.report({ ...VALID_REPORT, correlationId })
    }
    service.report({ outcome: 'failed' })
    service.report({ ...VALID_REPORT, correlationId: undefined })

    expect(mocks.recordSendTerminal).not.toHaveBeenCalled()
    // No generated key of any shape appears anywhere.
    expect(sanitizeLiaBrainSendTerminalReport({ ...VALID_REPORT, correlationId: 42 })).toBeUndefined()
    expect(sanitizeLiaBrainSendTerminalReport({ ...VALID_REPORT, correlationId: {} })).toBeUndefined()
    expect(sanitizeLiaBrainSendTerminalReport({ ...VALID_REPORT, correlationId: [] })).toBeUndefined()
  })

  it('64: only the TWO exact settlements are accepted - no aliases, no normalization', () => {
    const service = ingress()

    for (const outcome of [
      'success',
      'failure',
      'abandoned',
      'cancelled',
      'superseded',
      'completed',
      'error',
      'unknown',
      '',
      'SUCCEEDED',
      'Succeeded',
      'FAILED',
      'succeeded ',
      ' failed',
      undefined,
      null,
      0,
      1,
      false,
      true,
      {},
      [],
      () => {},
    ]) {
      service.report({ ...VALID_REPORT, outcome })
    }
    service.report({ correlationId: 'logical-send-X' })

    expect(mocks.recordSendTerminal).not.toHaveBeenCalled()
    // No coercion, no mapping to a boolean and no default outcome.
    expect(sanitizeLiaBrainSendTerminalReport({ ...VALID_REPORT, outcome: 'abandoned' })).toBeUndefined()
    expect(sanitizeLiaBrainSendTerminalReport({ ...VALID_REPORT, outcome: 'succeeded ' })).toBeUndefined()
  })

  it('h: primitives, null, arrays and functions are rejected safely', () => {
    const service = ingress()

    for (const payload of [undefined, null, [], ['succeeded'], 'string', 'failed', 42, 0, true, false, () => {}, Symbol('x'), new Map(), new Set(), new Date()]) {
      expect(() => service.report(payload)).not.toThrow()
    }
    // An array carrying the right fields is still not a report.
    expect(sanitizeLiaBrainSendTerminalReport(['logical-send-X', 'failed'])).toBeUndefined()

    expect(mocks.recordSendTerminal).not.toHaveBeenCalled()
  })

  it('75/32: a hostile getter behaves EXACTLY like the sibling ingress - the same containment policy', () => {
    // Both sibling sanitizers read properties with ordinary access and neither
    // installs a getter shield: the convention is mirrored, not strengthened in
    // only one service. Both the sibling INGRESS OPERATION and this one let the
    // same exception escape, because sanitization happens outside the store
    // try-block in both.
    const hostile = {}
    Object.defineProperty(hostile, 'correlationId', {
      enumerable: true,
      get() {
        throw new Error('hostile getter')
      },
    })

    expect(() => sanitizeLiaBrainSendTerminalReport(hostile)).toThrow('hostile getter')
    expect(() => sanitizeLiaBrainExecutionTerminalReport(hostile)).toThrow('hostile getter')
    const siblingService = createLiaBrainExecutionTerminalReportService({
      correlationStore: { recordExecutionTerminal: () => {} } as never,
      correlationObserver: { observe: () => {} } as never,
    })
    expect(() => siblingService.report(hostile)).toThrow('hostile getter')
    expect(() => ingress().report(hostile)).toThrow('hostile getter')

    // Same for the outcome read.
    const hostileOutcome = { correlationId: 'logical-send-X' }
    Object.defineProperty(hostileOutcome, 'outcome', {
      enumerable: true,
      get() {
        throw new Error('hostile outcome getter')
      },
    })
    expect(() => sanitizeLiaBrainSendTerminalReport(hostileOutcome)).toThrow('hostile outcome getter')
    expect(() => ingress().report(hostileOutcome)).toThrow('hostile outcome getter')

    expect(mocks.recordSendTerminal).not.toHaveBeenCalled()

    // An inherited prototype property is read exactly like an own one - the
    // sibling convention, with no own-property gate on either boundary.
    const prototypeCarrier = Object.create({ correlationId: 'inherited-key', outcome: 'succeeded' })
    expect(sanitizeLiaBrainSendTerminalReport(prototypeCarrier))
      .toEqual({ correlationId: 'inherited-key', outcome: 'succeeded' })
    ingress().report(prototypeCarrier)
    expect(storedReport()).toEqual({ correlationId: 'inherited-key', outcome: 'succeeded' })
  })

  it('30/67: the incoming payload is never mutated - a frozen input still reports', () => {
    const service = ingress()
    const frozenPayload: Record<string, unknown> = Object.freeze({ ...VALID_REPORT, ...EXTRA_FIELDS })

    service.report(frozenPayload)

    expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(frozenPayload)).toBe(true)
    expect(frozenPayload).toEqual({ ...VALID_REPORT, ...EXTRA_FIELDS })
    expect(storedReport()).toEqual(VALID_REPORT)
  })

  it('31/68: every accepted call builds a distinct canonical report - no cache, no reuse', () => {
    const service = ingress()

    service.report(VALID_REPORT)
    service.report(VALID_REPORT)

    expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(2)
    const first = storedReport(0)
    const second = storedReport(1)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    // The payload itself is never handed to the store, so two calls can never
    // share one object.
    expect(first).not.toBe(VALID_REPORT)
  })

  it('19: the sanitized report is passed straight to the store - no clone in between', () => {
    const service = ingress()
    service.report(VALID_REPORT)

    // Exactly one store call site, and it receives the sanitizer result itself:
    // the module has no spread, no clone and no second construction.
    const source = stripComments(readSource('./brain-send-terminal-report-service.ts'))
    expect(source.match(/correlationStore\.recordSendTerminal\(report\)/g)).toHaveLength(1)
    expect(source).not.toMatch(/\{\s*\.\.\.report\s*\}|\{\s*\.\.\.value\s*\}|\{\s*\.\.\.payload\s*\}/)
    expect(sanitizeLiaBrainSendTerminalReport(VALID_REPORT)).toEqual(storedReport())
  })

  it('o/p: the service has exactly one public operation, and it returns void', () => {
    const service = ingress()

    expect(Object.keys(service)).toEqual(['report'])
    expect(service.report(VALID_REPORT)).toBeUndefined()
    expect(service.report({ ...VALID_REPORT, outcome: 'unknown' })).toBeUndefined()
    // No counter, no last report, no validation result to read.
    expect(Object.keys(service)).toEqual(['report'])
  })

  it('20: invalid payloads never throw merely because validation failed', () => {
    const service = ingress()

    for (const payload of [undefined, null, {}, { correlationId: '' }, { correlationId: 'X' }, { correlationId: 'X', outcome: 'completed' }, 'x', 7, [], new Date()])
      expect(() => service.report(payload)).not.toThrow()

    expect(mocks.recordSendTerminal).not.toHaveBeenCalled()
  })
})

describe('lia send terminal ingress service - forwarding (Phase 8.0D-10B-4D4C4-B3B1)', () => {
  it('24/70: two identical valid reports are forwarded TWICE - the ingress does not dedupe', () => {
    const service = ingress()

    service.report({ ...VALID_REPORT })
    service.report({ ...VALID_REPORT })

    expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(2)
    expect(storedReport(0)).toEqual(VALID_REPORT)
    expect(storedReport(1)).toEqual(VALID_REPORT)
  })

  it('25/71: a conflict is forwarded twice, in arrival order - the ingress resolves nothing', () => {
    const service = ingress()

    service.report({ correlationId: 'X', outcome: 'failed' })
    service.report({ correlationId: 'X', outcome: 'succeeded' })

    expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(2)
    expect(mocks.recordSendTerminal.mock.calls.map(call => (call[0] as { outcome: string }).outcome)).toEqual(['failed', 'succeeded'])
    // What the canonical store does with the second one is the STORE's
    // business, and this layer never asks.
    expect(storedReport(0)).toEqual({ correlationId: 'X', outcome: 'failed' })
    expect(storedReport(1)).toEqual({ correlationId: 'X', outcome: 'succeeded' })
  })

  it('69: a throwing store is isolated with the sibling policy - no escape, no retry, repeatable', () => {
    let attempts = 0
    const service = ingress(recorderDouble(() => {
      attempts += 1
      throw new Error('diagnostic memory is gone')
    }))

    // No exception escapes the ingress...
    expect(() => service.report(VALID_REPORT)).not.toThrow()
    expect(attempts).toBe(1)
    // ...and the ingress remains usable afterwards, without a retry.
    expect(() => service.report({ ...VALID_REPORT, correlationId: 'logical-send-Y' })).not.toThrow()
    expect(attempts).toBe(2)

    // Invalid input is never attempted at all, even with a hostile store.
    expect(() => service.report({ correlationId: 'X', outcome: 'completed' })).not.toThrow()
    expect(attempts).toBe(2)
  })

  it('m: the ingress cannot join a send to a round - the recorder surface has ONE member', () => {
    // The dependency contract is the narrow ability to record a send terminal:
    // the double exposes nothing else, and a payload may carry any round data.
    const store = { recordSendTerminal: mocks.recordSendTerminal }
    const service = ingress(store as LiaBrainSendTerminalRecorder)

    service.report({ correlationId: 'logical-send-X', outcome: 'failed', roundId: 'round-a', attemptCount: 2 })

    expect(mocks.recordSendTerminal).toHaveBeenCalledTimes(1)
    expect(storedReport()).toEqual({ correlationId: 'logical-send-X', outcome: 'failed' })

    const source = stripComments(readSource('./brain-send-terminal-report-service.ts'))
    expect(source).not.toMatch(/correlationStore\.(?:get|size|recordDecision|recordExecution)/)
  })
})

describe('lia send terminal ingress service - real correlation store (Phase 8.0D-10B-4D4C4-B3B1)', () => {
  /** A real canonical store the ingress forwards into, counting every forward. */
  function realStoreIngress(store: ReturnType<typeof createLiaBrainCorrelationStore>) {
    const forwarded: LiaBrainSendTerminalReport[] = []
    const service = ingress(recorderDouble((report) => {
      forwarded.push(report as LiaBrainSendTerminalReport)
      store.recordSendTerminal(report as LiaBrainSendTerminalReport)
    }))
    return { service, forwarded, store }
  }

  function clockedStore() {
    let current = 1_000
    return {
      store: createLiaBrainCorrelationStore({ maxEntries: 8, now: () => current, ttlMs: 900_000 }),
      advance: (ms: number) => {
        current += ms
      },
    }
  }

  it('72/26: both duplicates ARE forwarded, and the canonical snapshot keeps the first settlement', () => {
    const { store } = clockedStore()
    const { service, forwarded } = realStoreIngress(store)

    service.report({ correlationId: 'X', outcome: 'failed' })
    service.report({ correlationId: 'X', outcome: 'failed' })

    // Ingress: forwards. Store: canonicalizes.
    expect(forwarded).toEqual([{ correlationId: 'X', outcome: 'failed' }, { correlationId: 'X', outcome: 'failed' }])
    expect(store.size).toBe(1)
    expect(store.get('X')!.sendTerminal).toEqual({ outcome: 'failed' })
    expect(Object.keys(store.get('X')!.sendTerminal!)).toEqual(['outcome'])
  })

  it('73/27: both conflict directions are forwarded, and first-write wins in the store', () => {
    const failedFirst = realStoreIngress(clockedStore().store)
    failedFirst.service.report({ correlationId: 'X', outcome: 'failed' })
    failedFirst.service.report({ correlationId: 'X', outcome: 'succeeded' })

    const succeededFirst = realStoreIngress(clockedStore().store)
    succeededFirst.service.report({ correlationId: 'X', outcome: 'succeeded' })
    succeededFirst.service.report({ correlationId: 'X', outcome: 'failed' })

    expect(failedFirst.forwarded.map(report => report.outcome)).toEqual(['failed', 'succeeded'])
    expect(succeededFirst.forwarded.map(report => report.outcome)).toEqual(['succeeded', 'failed'])
    expect(failedFirst.store.get('X')!.sendTerminal).toEqual({ outcome: 'failed' })
    expect(succeededFirst.store.get('X')!.sendTerminal).toEqual({ outcome: 'succeeded' })
  })

  it('74/28: one valid report on a new key creates the send-terminal-only entry, with nothing synthesized', () => {
    const { store } = clockedStore()
    const { service } = realStoreIngress(store)

    service.report({ correlationId: 'X', outcome: 'succeeded' })

    expect(store.size).toBe(1)
    const snapshot = store.get('X')!
    expect(snapshot.correlationId).toBe('X')
    expect(snapshot.decision).toBeUndefined()
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([])
    expect(snapshot.sendTerminal).toEqual({ outcome: 'succeeded' })
    expect('sendTerminal' in snapshot).toBe(true)
    // The ingress added no fact of its own: an unrelated key stays absent.
    expect(store.get('Y')).toBeUndefined()
  })

  it('n: a rejected payload leaves the real store completely untouched', () => {
    const { store } = clockedStore()
    const { service, forwarded } = realStoreIngress(store)

    for (const payload of [undefined, null, {}, { correlationId: '' }, { correlationId: 'X' }, { correlationId: 'X', outcome: 'abandoned' }, 42, 'x'])
      service.report(payload)

    expect(forwarded).toEqual([])
    expect(store.size).toBe(0)
    expect(store.get('X')).toBeUndefined()
  })
})

describe('lia send terminal ingress service - isolation invariants (Phase 8.0D-10B-4D4C4-B3B1)', () => {
  it('38/81/82: exactly ONE production call site of recordSendTerminal - this service, plus the store', () => {
    // B3A shipped the writer with ZERO production callers; this phase evolves
    // that allowlist honestly to exactly ONE - the ingress above it.
    expect(productionSourcesMatching(BRAIN_ROOTS, /\.recordSendTerminal\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts'])
    expect(productionSourcesMatching(BRAIN_ROOTS, /recordSendTerminal/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts',
    ])

    // The service calls it exactly once, and touches no other store member.
    const service = stripComments(readSource('./brain-send-terminal-report-service.ts'))
    expect(service.match(/\.recordSendTerminal\(/g)).toHaveLength(1)
    expect(service.match(/recordSendTerminal\(/g)).toHaveLength(1)
    expect(service).not.toMatch(/recordDecision\(|recordExecution\(|correlationStore\.(?:get|size)/)
  })

  it('37/39/83: the ingress has exactly ONE production caller - the canonical composition', () => {
    // B3B1 shipped this factory with ZERO callers on purpose; 8.0D-10B-4D4C4-B3B2
    // evolves that honestly to exactly ONE - the composition entry that creates
    // the instance the transport listener forwards into.
    expect(productionSourcesMatching(BRAIN_ROOTS, /(?<!function )createLiaBrainSendTerminalReportService\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/index.ts'])
    // The ingress interface and its narrow recorder contract are DECLARED in
    // exactly one production module, and TYPE-imported by exactly one consumer -
    // the transport listener. (The composition entry only calls the factory, so
    // the camel-case noun of that factory name is not a type reference.)
    expect(productionSourcesMatching(BRAIN_ROOTS, /export interface LiaBrainSendTerminalReportService|export interface LiaBrainSendTerminalRecorder/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts'])
    expect(productionSourcesMatching(BRAIN_ROOTS, /import type \{[^}]*LiaBrainSendTerminalReportService[^}]*\}/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts'])
    // Exactly ONE production file carries this name - the service itself...
    expect(productionSources(BRAIN_ROOTS).filter(relative => relative.includes('brain-send-terminal-report-service')))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts'])
    // ...and exactly TWO other production modules reference it: the composition
    // entry (which calls the factory) and the transport listener (which imports
    // its interface TYPE only). No reader, no observer, no formatter, no
    // renderer, no second main handler.
    expect(productionSourcesMatching(BRAIN_ROOTS, /brain-send-terminal-report-service/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/index.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts',
      ])
    // The listener consumes the ingress through its narrow public interface and
    // never reaches a store member directly; no renderer path does either.
    for (const relative of ['../../../renderer/main.ts', '../../../renderer/services/lia/send-terminal-reporter.ts'])
      expect(readSource(relative), relative).not.toMatch(/recordSendTerminal|brain-send-terminal-report-service/)
    const listener = stripComments(readSource('./brain-send-terminal-report-listener.ts'))
    expect(listener).not.toMatch(/recordSendTerminal|correlationStore/)
  })

  it('76/34: the ingress knows no transport - no Eventa, no Electron, no channel', () => {
    const source = stripComments(readSource('./brain-send-terminal-report-service.ts'))

    expect(source).not.toMatch(/defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|createContext|context\.on\(|\.emit\(/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain|electronLiaBrain/)
    // The whole dependency surface is the contract TYPE and the narrow recorder
    // contract, both TYPE-ONLY - no renderer, no Core Agent, no Stage UI.
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainSendTerminalReport } from '../../../shared/eventa'`,
    ])
    expect(source).not.toMatch(/from '[^']*(?:renderer|core-agent|stage-ui|lia-core)/)
    expect(source).not.toMatch(/createLiaBrainCorrelationStore|createLiaBrainCorrelationService|brain-correlation-store|LiaBrainCorrelationService/)
  })

  it('77/23: the ingress has no observer, no read side and no diagnostic dependency', () => {
    const source = stripComments(readSource('./brain-send-terminal-report-service.ts'))

    // There is no send-level trigger in this phase: the module cannot observe,
    // and it does not even receive an observer.
    expect(source).not.toMatch(/correlationObserver|observer|\.observe\(/)
    expect(source).not.toMatch(/brain-correlation-observer|brain-correlation-reader|brain-execution-identity-facts|brain-execution-terminal-facts|brain-expected-route|brain-diagnostic-log/)
    expect(source).not.toMatch(/composeLiaBrainCorrelationDiagnosticFacts|LiaBrainDiagnosticEntry|formatLiaBrainDiagnosticEntry|logLiaBrainDiagnostic|brain-correlation-diagnostic-facts/)
    expect(source).not.toMatch(/LIA_BRAIN_ENGINE_PROVIDER_MAPPING|readLiaBrainExecutionIdentityFacts/)
  })

  it('78/54: the ingress holds no authority and derives no verdict', () => {
    const source = stripComments(readSource('./brain-send-terminal-report-service.ts'))

    expect(source).not.toMatch(/LiaBrainService|lia-brain-service|decideBrainRoute|automaticPolicy|liaProductConfig|LiaProductConfig/)
    expect(source).not.toMatch(/fallback|retry|setProvider|setModel|activeProvider|activeModel|permission|\btools?\b|switch/)
    // No fallback/final/winner/completion vocabulary of any kind.
    expect(source).not.toMatch(/fallbackObserved|fallbackCount|finalAttempt|winningAttempt|winner|completed|completion|finished|sendSucceeded|sendFailed|verdict|score|priority|preferred/)
    // No arithmetic, no aggregate and no outcome branch beyond the sanitizer
    // gate: the outcome is validated as one of two exact strings, copied
    // verbatim, and never selects a different path.
    expect(source).not.toMatch(/TerminalObservationCount|reduce|\+\+|switch|\belse\b/)
    expect(source).not.toMatch(/outcome\s*(?:===|==|!==|!=)\s*['"`]/)
    // The four branches are the three tolerant sanitizer gates (isRecord, key
    // length, outcome read) plus the one sanitized-report gate.
    expect(source.match(/\bif\b/g)).toHaveLength(4)
  })

  it('79/55/56/57: no state, no time, no async and no storage', () => {
    const source = stripComments(readSource('./brain-send-terminal-report-service.ts'))

    expect(source).not.toMatch(/\bnew Map\b|\bnew Set\b|history|\bcache\b|\bpending\b|dedupe|lastReport|lastOutcome|sendTerminalStore/)
    expect(source).not.toMatch(/Date\.now|performance\.now|setTimeout|setInterval|\bttl\b/i)
    expect(source).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|process\.nextTick/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios|localStorage|sessionStorage|writeFile|readFile|process\.env/)
  })

  it('80/58: no logging, no telemetry and no private data can enter', () => {
    const source = stripComments(readSource('./brain-send-terminal-report-service.ts'))

    expect(source).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    // Privacy: the contract has no room for content or credentials, and the
    // sanitizer never reads anything but the two approved keys.
    expect(source).not.toMatch(/prompt|messages|usage|credential|apiKey|api_key|secret|baseURL|attachments|roundId|attemptCount|providerId|modelId|engineId|\berror\b|failureStage/i)
    expect(source.match(/value\.(\w+)/g)).toEqual(['value.correlationId', 'value.outcome'])
    // No own-property gate, no entries walk, no spread: only the two named keys
    // are ever read.
    expect(source).not.toMatch(/Object\.(?:keys|entries|values|assign|fromEntries)|hasOwnProperty|Object\.hasOwn/)
  })

  it('84/48: the fourth channel has exactly ONE main consumer - the send-terminal listener', () => {
    // B3B1 froze this channel with no main consumer; 8.0D-10B-4D4C4-B3B2 wires
    // exactly ONE main module to it - the transport listener - and no second
    // main handler of any kind.
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src/main'], /electronLiaBrainSendTerminalObservation|send-terminal-observation/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts'])
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src/main'], /context\.on\(electronLiaBrainSendTerminalObservation/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts'])
    // The legitimate sides stay: the shared contract declares it and the
    // renderer reporter pushes it - and the ingress itself knows no transport.
    expect(readSource('../../../shared/eventa/index.ts')).toContain(`'eventa:event:lia:brain:send-terminal-observation'`)
    expect(readSource('../../../renderer/services/lia/send-terminal-reporter.ts')).toContain('electronLiaBrainSendTerminalObservation')
    expect(productionSourcesMatching(BRAIN_ROOTS, /electronLiaBrainSendTerminalObservation/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts',
      'apps/stage-tamagotchi/src/renderer/services/lia/send-terminal-reporter.ts',
      'apps/stage-tamagotchi/src/shared/eventa/index.ts',
    ])
    expect(stripComments(readSource('./brain-send-terminal-report-service.ts')))
      .not
      .toMatch(/electronLiaBrainSendTerminalObservation|brain-send-terminal-report-listener/)
  })

  it('40/41/42/43/44/45/46/47: the frozen layers are untouched by this phase', () => {
    // The canonical store keeps the exact B3A surface this ingress consumes.
    const store = stripComments(readSource('./brain-correlation-store.ts'))
    expect(store.match(/recordSendTerminal: \(report: LiaBrainSendTerminalReport\) => void/g)).toHaveLength(1)
    expect(store.match(/export interface LiaBrainSendTerminalRecord/g)).toHaveLength(1)
    expect(store).toMatch(/sendTerminal\?: LiaBrainSendTerminalRecord/)
    expect(store).not.toMatch(/LiaBrainSendTerminalRecorder|brain-send-terminal-report-service/)

    // No send fact is EXPOSED anywhere on the read side, and the formatter still
    // prints exactly the three terminal counts. The reader is no longer listed
    // here: 8.0D-10B-4D4C4-B4B1 lets its SNAPSHOT contract carry the raw record
    // structurally. The composition left the list in 8.0D-10B-4D4C4-B4B3, where
    // it composes the derived send sibling from that same snapshot - exposure
    // stays zero because no line and no consumer reads the member yet.
    for (const relative of [
      './brain-correlation-observer.ts',
      './brain-diagnostic-log.ts',
      './brain-execution-terminal-facts.ts',
      './brain-execution-identity-facts.ts',
    ])
      expect(stripComments(readSource(relative)), relative).not.toMatch(/sendTerminal|sendSucceeded|sendFailed/)
    // 8.0D-10B-4D4C4-B4B2 evolves the field-vocabulary allowlist honestly: the
    // ONE production owner of `sendTerminalOutcome` is the pure send-facts
    // projection (which still has zero production callers), and the distinct
    // term `sendTerminalObserved` is introduced NOWHERE.
    expect(productionSourcesMatching(BRAIN_ROOTS, /sendTerminalOutcome|sendTerminalObserved/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-facts.ts'])
    expect(productionSourcesMatching(BRAIN_ROOTS, /sendTerminalObserved/)).toEqual([])

    // The transport, the Stage seam and Core Agent know nothing about the
    // stored field: B2 and the B1 seam stay frozen.
    for (const relative of ['../../../shared/eventa/index.ts', '../../../renderer/main.ts'])
      expect(readSource(relative), relative).not.toMatch(/sendTerminal|LiaBrainSendTerminalRecord/)
    expect(productionSourcesMatching(['packages/stage-ui/src', 'packages/core-agent/src'], /sendTerminal|LiaBrainSendTerminalRecord/)).toEqual([])

    // FOUR channels, no fifth - and the observer trigger allowlist is still
    // exactly THREE producers: a send terminal triggers no observation.
    const tags = new Set<string>()
    for (const relative of productionSources(BRAIN_ROOTS)) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:event:lia:brain:send-terminal-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
    expect(productionSourcesMatching(BRAIN_ROOTS, /correlationObserver\.observe\(/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-service.ts',
    ])
  })

  it('86: the sibling round-terminal ingress is untouched and stays the closest sibling', () => {
    const sibling = stripComments(readSource('./brain-execution-terminal-report-service.ts'))

    expect(sibling.match(/correlationStore\.recordExecutionTerminal\(/g)).toHaveLength(1)
    expect(sibling.match(/correlationObserver\.observe\(/g)).toHaveLength(1)
    // The sibling keeps its three-field contract and its own channel silence;
    // this phase changed no line of it.
    expect(sibling).toMatch(/roundId = readString\(value\.roundId\)/)
    expect(sibling).not.toMatch(/electronLiaBrain|recordSendTerminal/)
  })
})
