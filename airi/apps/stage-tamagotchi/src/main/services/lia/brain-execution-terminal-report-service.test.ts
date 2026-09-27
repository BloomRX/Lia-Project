import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { sanitizeLiaBrainExecutionObservationReport } from './brain-execution-report-service'
import { createLiaBrainExecutionTerminalReportService, sanitizeLiaBrainExecutionTerminalReport } from './brain-execution-terminal-report-service'

/**
 * Phase 8.0D-10B-4D4C2B1: the trusted main ingress for the Lia terminal report.
 *
 * The service under test is the REAL one, over a recording store double: the
 * tests call the REAL ingress operation with raw, hostile `unknown` payloads and
 * assert exactly what the store would have received. The authority boundary
 * these tests pin: the payload is sanitized, the three contract facts are
 * required, and everything else is discarded - no identity, no error data, no
 * join, no decision, no transport.
 */

const mocks = vi.hoisted(() => ({
  recordExecutionTerminal: vi.fn(),
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

/** The canonical correlation store double the ingress receives. */
function correlationStoreDouble(overrides: Partial<{ recordExecutionTerminal: (report: unknown) => void }> = {}) {
  return { recordExecutionTerminal: overrides.recordExecutionTerminal ?? mocks.recordExecutionTerminal } as never
}

/** The ingress under test, over the recording store double. */
function ingress(store: unknown = correlationStoreDouble()) {
  return createLiaBrainExecutionTerminalReportService({ correlationStore: store as never })
}

/** The report the store received on the Nth accepted call. */
function storedReport(index = 0): Record<string, unknown> {
  return mocks.recordExecutionTerminal.mock.calls[index]![0] as Record<string, unknown>
}

const VALID_REPORT = {
  correlationId: 'logical-send-X',
  roundId: 'round-a',
  outcome: 'failed',
}

const EXTRA_FIELDS = {
  providerId: 'groq',
  modelId: 'openai/gpt-oss-120b',
  engineId: 'groq',
  conversationId: 'conversation-1',
  turnIndex: 3,
  error: 'boom',
  stack: 'Error: boom\n  at ...',
  errorCode: 'E_HOSTILE',
  failureStage: 'streaming',
  prompt: 'private prompt',
  messages: [{ role: 'user', content: 'private' }],
  token: 'sk-secret',
  timestamp: 1_700_000_000_000,
  nested: { providerId: 'anthropic', outcome: 'succeeded' },
  apiKey: 'sk-secret',
}

beforeEach(() => mocks.recordExecutionTerminal.mockClear())

describe('lia terminal ingress service - sanitizer (Phase 8.0D-10B-4D4C2B1)', () => {
  it('a: each accepted outcome is forwarded verbatim, with the exact three canonical keys', () => {
    const service = ingress()

    for (const outcome of ['succeeded', 'failed', 'abandoned'] as const) {
      mocks.recordExecutionTerminal.mockClear()
      service.report({ correlationId: `corr-${outcome}`, outcome, roundId: `round-${outcome}` })

      expect(mocks.recordExecutionTerminal).toHaveBeenCalledTimes(1)
      const report = storedReport()
      // EXACTLY the three contract fields - no conversation, no provider/model
      // identity, no turn, no timing, no usage, no error.
      expect(Object.keys(report).sort()).toEqual(['correlationId', 'outcome', 'roundId'])
      expect(report).toEqual({ correlationId: `corr-${outcome}`, outcome, roundId: `round-${outcome}` })
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
    payload.outcome = 'abandoned'
    payload.roundId = 'mutated'
    expect(storedReport()).toEqual(VALID_REPORT)
  })

  it('c: whitespace policy is inherited - the key convention is non-empty string, never trimmed', () => {
    const service = ingress()

    // A whitespace-only key is still a usable key, exactly like the execution
    // ingress: the two services must not diverge on identifier policy.
    service.report({ correlationId: '   ', outcome: 'failed', roundId: ' \t ' })
    expect(mocks.recordExecutionTerminal).toHaveBeenCalledTimes(1)
    expect(storedReport()).toEqual({ correlationId: '   ', outcome: 'failed', roundId: ' \t ' })

    // And the sibling sanitizer reads the same payload shape the same way.
    expect(sanitizeLiaBrainExecutionObservationReport({ ...VALID_REPORT, conversationId: '', providerId: '', modelId: '' }))
      .toEqual({ conversationId: '', correlationId: 'logical-send-X', modelId: '', providerId: '', roundId: 'round-a' })
    expect(sanitizeLiaBrainExecutionObservationReport({ correlationId: '   ' }))
      .toMatchObject({ correlationId: '   ' })

    // Untrimmed in, untrimmed out: no normalization was introduced here.
    expect(sanitizeLiaBrainExecutionTerminalReport({ correlationId: ' corr ', outcome: 'failed', roundId: ' round ' }))
      .toEqual({ correlationId: ' corr ', outcome: 'failed', roundId: ' round ' })
  })

  it('d: hostile extra fields are discarded - only the three contract facts survive', () => {
    const service = ingress()
    service.report({ ...VALID_REPORT, ...EXTRA_FIELDS })

    expect(mocks.recordExecutionTerminal).toHaveBeenCalledTimes(1)
    const report = storedReport()
    expect(Object.keys(report).sort()).toEqual(['correlationId', 'outcome', 'roundId'])
    expect(report).toEqual(VALID_REPORT)

    // Nothing hostile leaks through, in any casing or nesting.
    const serialized = JSON.stringify(report)
    for (const forbidden of ['groq', 'gpt-oss', 'conversation-1', 'boom', 'E_HOSTILE', 'streaming', 'private', 'sk-secret', '1700000000000', 'anthropic', 'turnIndex', 'nested'])
      expect(serialized).not.toContain(forbidden)

    // The sanitizer is pure: no store, no state, exactly one fresh value.
    expect(sanitizeLiaBrainExecutionTerminalReport({ ...VALID_REPORT, ...EXTRA_FIELDS })).toEqual(VALID_REPORT)
  })

  it('e: an unusable correlationId ignores the payload - and never synthesizes one', () => {
    const service = ingress()

    for (const correlationId of [undefined, null, 0, false, {}, [], '', () => {}]) {
      service.report({ ...VALID_REPORT, correlationId })
    }
    service.report({ outcome: 'failed', roundId: 'round-a' })
    service.report({ ...VALID_REPORT, correlationId: undefined })

    expect(mocks.recordExecutionTerminal).not.toHaveBeenCalled()
    // No generated key of any shape appears anywhere.
    expect(sanitizeLiaBrainExecutionTerminalReport({ ...VALID_REPORT, correlationId: 42 })).toBeUndefined()
  })

  it('f: an unusable roundId ignores the payload - and never synthesizes one', () => {
    const service = ingress()

    for (const roundId of [undefined, null, 0, false, {}, [], '', () => {}]) {
      service.report({ ...VALID_REPORT, roundId })
    }
    service.report({ correlationId: 'logical-send-X', outcome: 'failed' })
    service.report({ ...VALID_REPORT, roundId: undefined })

    expect(mocks.recordExecutionTerminal).not.toHaveBeenCalled()
    expect(sanitizeLiaBrainExecutionTerminalReport({ ...VALID_REPORT, roundId: 42 })).toBeUndefined()
  })

  it('g: only the three exact outcomes are accepted - no aliases, no normalization', () => {
    const service = ingress()

    for (const outcome of [undefined, null, '', 'cancelled', 'completed', 'error', 'success', 'failure', 'unknown', 'SUCCEEDED', 'Succeeded', 'succeeded ', ' abandoned', 0, false, {}, [], () => {}]) {
      service.report({ ...VALID_REPORT, outcome })
    }
    service.report({ correlationId: 'logical-send-X', roundId: 'round-a' })

    expect(mocks.recordExecutionTerminal).not.toHaveBeenCalled()
  })

  it('h: primitives, null, arrays and functions are rejected safely', () => {
    const service = ingress()

    for (const payload of [undefined, null, [], ['succeeded'], 'string', 'failed', 42, 0, true, false, () => {}, Symbol('x'), new Map(), new Set(), new Date()]) {
      expect(() => service.report(payload)).not.toThrow()
    }
    // An array carrying the right fields in order is still not a report.
    expect(sanitizeLiaBrainExecutionTerminalReport(['logical-send-X', 'round-a', 'failed'])).toBeUndefined()

    expect(mocks.recordExecutionTerminal).not.toHaveBeenCalled()
  })

  it('i: a hostile getter behaves EXACTLY like the sibling ingress - the same containment policy', () => {
    // Both ingress sanitizers read properties with ordinary access and neither
    // installs a getter shield: the convention is mirrored, not strengthened in
    // only one of the two services.
    const hostile = {}
    Object.defineProperty(hostile, 'correlationId', {
      enumerable: true,
      get() {
        throw new Error('hostile getter')
      },
    })

    expect(() => sanitizeLiaBrainExecutionObservationReport(hostile)).toThrow('hostile getter')
    expect(() => sanitizeLiaBrainExecutionTerminalReport(hostile)).toThrow('hostile getter')
    // Same for the round key.
    const hostileRound = { correlationId: 'logical-send-X', outcome: 'failed' }
    Object.defineProperty(hostileRound, 'roundId', {
      enumerable: true,
      get() {
        throw new Error('hostile round getter')
      },
    })
    expect(() => sanitizeLiaBrainExecutionTerminalReport(hostileRound)).toThrow('hostile round getter')
  })

  it('j: an inherited prototype property is read exactly like an own one - the sibling convention', () => {
    // Ordinary property access is the documented convention on both ingresses:
    // the prototype chain is part of the object model, and neither service adds
    // an own-property gate.
    const prototypeCarrier = Object.create({ correlationId: 'inherited-key', outcome: 'succeeded', roundId: 'inherited-round' })
    expect(sanitizeLiaBrainExecutionTerminalReport(prototypeCarrier))
      .toEqual({ correlationId: 'inherited-key', outcome: 'succeeded', roundId: 'inherited-round' })

    const service = ingress()
    service.report(prototypeCarrier)
    expect(storedReport()).toEqual({ correlationId: 'inherited-key', outcome: 'succeeded', roundId: 'inherited-round' })
  })

  it('k/l: duplicates and conflicts are both forwarded - the ingress resolves nothing', () => {
    const service = ingress()

    // K: two identical payloads produce two store calls: no dedupe here.
    service.report({ ...VALID_REPORT })
    service.report({ ...VALID_REPORT })
    expect(mocks.recordExecutionTerminal).toHaveBeenCalledTimes(2)
    expect(storedReport(0)).toEqual(VALID_REPORT)
    expect(storedReport(1)).toEqual(VALID_REPORT)

    // L: a conflict for one round is forwarded twice, in arrival order - the
    // store owns first-terminal-wins.
    mocks.recordExecutionTerminal.mockClear()
    service.report({ correlationId: 'logical-send-X', outcome: 'failed', roundId: 'round-r' })
    service.report({ correlationId: 'logical-send-X', outcome: 'succeeded', roundId: 'round-r' })
    expect(mocks.recordExecutionTerminal.mock.calls.map(call => (call[0] as { outcome: string }).outcome)).toEqual(['failed', 'succeeded'])
  })

  it('m: a terminal is accepted with no knowledge of any execution start', () => {
    // The store double holds NO execution starts and exposes no read API at
    // all: this ingress cannot join a round to a start even by accident.
    const store = { recordExecutionTerminal: mocks.recordExecutionTerminal }
    const service = createLiaBrainExecutionTerminalReportService({ correlationStore: store as never })

    service.report({ correlationId: 'logical-send-X', outcome: 'abandoned', roundId: 'round-never-started' })

    expect(mocks.recordExecutionTerminal).toHaveBeenCalledTimes(1)
    expect(storedReport()).toEqual({ correlationId: 'logical-send-X', outcome: 'abandoned', roundId: 'round-never-started' })
  })

  it('n: a throwing store is isolated with the sibling policy - no escape, repeatable', () => {
    const service = ingress(correlationStoreDouble({
      recordExecutionTerminal: () => {
        throw new Error('diagnostic memory is gone')
      },
    }))

    // No exception escapes the ingress...
    expect(() => service.report(VALID_REPORT)).not.toThrow()
    // ...and the ingress remains usable afterwards.
    expect(() => service.report({ ...VALID_REPORT, roundId: 'round-b' })).not.toThrow()
  })

  it('o/p: the service has exactly one public operation, and it returns void', () => {
    const service = ingress()

    expect(Object.keys(service)).toEqual(['report'])
    expect(service.report(VALID_REPORT)).toBeUndefined()
    expect(service.report({ ...VALID_REPORT, outcome: 'unknown' })).toBeUndefined()
    // No counter, no last report, no validation result to read.
    expect(Object.keys(service)).toEqual(['report'])
  })
})

describe('lia terminal ingress service - isolation invariants (Phase 8.0D-10B-4D4C2B1)', () => {
  it('q: exactly ONE production call site of recordExecutionTerminal - this service, plus the store', () => {
    const callSites = productionSourcesMatching(
      BRAIN_ROOTS,
      /recordExecutionTerminal/,
    )
    expect(callSites).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-service.ts',
    ].sort())

    // The service calls it exactly once, and touches no other store member.
    const service = stripComments(readSource('./brain-execution-terminal-report-service.ts'))
    expect(service.match(/recordExecutionTerminal\(/g)).toHaveLength(1)
    expect(service).not.toMatch(/recordDecision|recordExecution\(|correlationStore\.(?:get|size)/)
  })

  it('r: ZERO production callers of the new ingress factory - Eventa is still unconnected', () => {
    expect(productionSourcesMatching(BRAIN_ROOTS, /(?<!function )createLiaBrainExecutionTerminalReportService\(/)).toEqual([])
    // And the terminal channel still has no main-side listener of any kind.
    for (const relative of productionSources(['apps/stage-tamagotchi/src/main'])) {
      const source = stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))
      expect(source, relative).not.toMatch(/execution-terminal-observation|electronLiaBrainExecutionTerminalObservation/)
      expect(source, relative).not.toMatch(/execution-terminal-report-service/)
    }
    // The shared contract still declares it, and the renderer still pushes it.
    expect(readSource('../../../shared/eventa/index.ts')).toContain('eventa:event:lia:brain:execution-terminal-observation')
    expect(readSource('../../../renderer/services/lia/execution-terminal-reporter.ts')).toContain('electronLiaBrainExecutionTerminalObservation')
  })

  it('s/t: the ingress is type-only, store-only and transport-free', () => {
    const source = stripComments(readSource('./brain-execution-terminal-report-service.ts'))

    // S: the shared contract is imported TYPE-ONLY, and the only store edge is
    // the injected canonical service type - no renderer, no Core Agent, no
    // Stage UI, no second store.
    expect(source).toMatch(/import type \{ LiaBrainExecutionTerminalReport \} from '\.\.\/\.\.\/\.\.\/shared\/eventa'/)
    expect(source).toMatch(/import type \{ LiaBrainCorrelationService \} from '\.\/brain-correlation-service'/)
    expect(source).not.toMatch(/from '[^']*(?:renderer|core-agent|stage-ui|lia-core)/)
    expect(source).not.toMatch(/createLiaBrainCorrelationStore|createLiaBrainCorrelationService|brain-correlation-store/)
    // T: no Eventa, no Electron, no handler registration, no channel literal.
    expect(source).not.toMatch(/defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|context\.on\(|\.emit\(/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain|electronLiaBrain/)
  })

  it('u: no observer trigger, no reader/facts, no diagnostic log, no authority', () => {
    const source = stripComments(readSource('./brain-execution-terminal-report-service.ts'))

    // U: the terminal write is NOT a diagnostic trigger yet, and the whole
    // diagnostic read side stays unreachable from here.
    expect(source).not.toMatch(/correlationObserver|correlation-observer|\.observe\(/)
    expect(source).not.toMatch(/brain-correlation-reader|brain-execution-identity-facts|brain-expected-route|brain-diagnostic-log|readLiaBrainExecutionIdentityFacts/)
    // No logger or telemetry of any kind: invalid payloads are silently ignored.
    expect(source).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    // No Brain service, policy, config or catalog.
    expect(source).not.toMatch(/LiaBrainService|lia-brain-service|decideBrainRoute|automaticPolicy|liaProductConfig|LiaProductConfig/)
    // No execution authority, no retry, no fallback, no comparison, no aggregate
    // vocabulary and no provider/model selection.
    expect(source).not.toMatch(/fallback|retry|setProvider|setModel|activeProvider|activeModel|permission|\btools?\b|routeMatch|mismatch|divergence|compare|verdict|score|finalAttempt|winningAttempt/)
  })

  it('v: no state, no dedupe, no async and no timers', () => {
    const source = stripComments(readSource('./brain-execution-terminal-report-service.ts'))

    expect(source).not.toMatch(/\bnew Map\b|\bnew Set\b|history|\bcache\b|\bpending\b|dedupe|lastReport|lastTerminal/)
    expect(source).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval|process\.nextTick/)
    // No environment, network, filesystem or storage surface either.
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios|localStorage|sessionStorage|writeFile|readFile|process\.env/)
  })

  it('w: the three-channel Brain allowlist is unchanged, and no channel was added', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    expect(shared.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []).toEqual([
      'eventa:invoke:lia:brain:chat-decision',
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
    ])

    // The contract itself still declares exactly THREE Brain channels, and this
    // phase added no fourth.
    const tags = new Set<string>()
    for (const relative of productionSources(BRAIN_ROOTS)) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
  })

  it('x: the sibling execution ingress is untouched, and the store is still the only writer', () => {
    const sibling = stripComments(readSource('./brain-execution-report-service.ts'))

    // The reference baseline keeps its exact shape: one sanitizer, one handler
    // registration, one diagnostic write, one observer trigger.
    expect(sibling).toMatch(/export function sanitizeLiaBrainExecutionObservationReport/)
    expect(sibling.match(/correlationStore\.recordExecution\(/g)).toHaveLength(1)
    expect(sibling.match(/correlationObserver\.observe\(/g)).toHaveLength(1)
    expect(sibling).toMatch(/context\.on\(electronLiaBrainExecutionObservation/)

    // This phase added no terminal write anywhere else, and no second store.
    expect(productionSourcesMatching(BRAIN_ROOTS, /createLiaBrainTerminalStore|terminalCorrelationStore|terminalCache|executionTerminalStore/)).toEqual([])
    // The terminal ingress does not import the sibling ingress or vice versa.
    expect(stripComments(readSource('./brain-execution-terminal-report-service.ts'))).not.toMatch(/brain-execution-report-service/)
    expect(sibling).not.toMatch(/terminal/)
  })
})
