import type { LiaBrainChatDecisionRequest } from '../../../shared/eventa'
import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'
import type { LiaBrainTerminalObservationFacts } from './brain-execution-terminal-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationObserver } from './brain-correlation-observer'
import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { registerLiaBrainDecisionBridge } from './brain-decision-service'
import { formatLiaBrainDiagnosticEntry } from './brain-diagnostic-log'
import { registerLiaBrainExecutionReportHandler } from './brain-execution-report-service'
import { registerLiaBrainExecutionTerminalReportListener } from './brain-execution-terminal-report-listener'
import { createLiaBrainExecutionTerminalReportService } from './brain-execution-terminal-report-service'

/**
 * Phase 8.0D-10B-4D4C2B2: the production wiring of the THIRD Brain channel.
 *
 * This is the integration proof: the REAL terminal listener, over the REAL
 * terminal ingress service, over the REAL correlation store - wired exactly as
 * `main/index.ts` wires it, and driven through the REAL Eventa listener seam
 * with the REAL envelope the renderer's one-way emit produces. For the
 * cross-channel regressions the SAME composition also registers the REAL
 * execution report handler and the REAL decision bridge against the ONE shared
 * store and ONE shared observer, so "the terminal path triggers nothing" is
 * proven against the very trigger the other two paths use.
 *
 * No renderer, no Electron and no browser are needed: the context double only
 * records the listeners the registration seams install.
 */

const channels = vi.hoisted(() => ({
  decision: { id: 'eventa:invoke:lia:brain:chat-decision' },
  executionObservation: { id: 'eventa:event:lia:brain:execution-observation', type: 'event' },
  executionTerminalObservation: { id: 'eventa:event:lia:brain:execution-terminal-observation', type: 'event' },
}))

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown, options?: unknown) => unknown>(),
  emitted: [] as unknown[],
  decisions: 0,
}))

vi.mock('../../../shared/eventa', () => ({
  electronLiaBrainChatDecision: channels.decision,
  electronLiaBrainExecutionObservation: channels.executionObservation,
  electronLiaBrainExecutionTerminalObservation: channels.executionTerminalObservation,
}))

vi.mock('@moeru/eventa', () => ({
  defineInvokeHandler: (_context: unknown, channel: { id: string }, handler: unknown) => {
    mocks.listeners.set(channel.id, handler as never)
  },
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

/** A context double recording the listeners the registration seams install. */
function fakeContext() {
  return {
    on: (channel: { id: string }, handler: unknown) => {
      mocks.listeners.set(channel.id, handler as never)
      return () => {}
    },
    emit: (...args: unknown[]) => {
      mocks.emitted.push(args)
    },
  } as never
}

/** A canonical Brain service double: a real decision-shaped value per call. */
function brainDouble() {
  return {
    decide: vi.fn(() => {
      mocks.decisions += 1
      return {
        id: `decision-${mocks.decisions}`,
        mode: 'automatic',
        readiness: { status: 'ready' },
        selection: { route: { engine: { id: 'groq' }, model: { id: 'openai/gpt-oss-120b' } }, status: 'selected' },
        status: 'automatic',
      }
    }),
  }
}

const FACTS = { hasImageInput: false, reasoningRequested: true, usesTools: false }

/** A recording diagnostic observer double. */
function observerDouble() {
  const observed: string[] = []
  return { observed, observer: { observe: (correlationId: string) => observed.push(correlationId) } }
}

/** The canonical terminal ingress: ONE service over ONE store and ONE observer. */
function terminalIngress(store: unknown, observer: unknown = { observe: () => {} }) {
  return createLiaBrainExecutionTerminalReportService({ correlationStore: store as never, correlationObserver: observer as never })
}

/** The exact production wiring of the THIRD channel: ONE service over ONE store. */
function wireTerminal(overrides: { store?: ReturnType<typeof createLiaBrainCorrelationService> } = {}) {
  const store = overrides.store ?? createLiaBrainCorrelationService()
  const context = fakeContext()
  const { observed, observer } = observerDouble()
  const terminalReportService = terminalIngress(store, observer)
  registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })
  return { observed, store, terminalReportService }
}

/**
 * The FULL production composition: the terminal listener plus the two existing
 * producers, all over ONE store and ONE shared observer - the shape the
 * composition entry builds.
 */
function wireFullComposition() {
  const store = createLiaBrainCorrelationService()
  const context = fakeContext()
  const observed: string[] = []
  const observer = { observe: (correlationId: string) => observed.push(correlationId) }
  const brain = brainDouble()
  registerLiaBrainDecisionBridge({ context, brain: brain as never, correlationStore: store, correlationObserver: observer as never })
  registerLiaBrainExecutionReportHandler({ context, correlationStore: store, correlationObserver: observer as never })
  const terminalReportService = terminalIngress(store, observer)
  // Phase 8.0D-10B-4D4C3B2-B3: the terminal registration receives the SAME
  // observer the other two producers use - one canonical instance.
  registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })
  return { brain, observed, store }
}

/** Delivers one terminal payload the way the renderer's one-way emit would. */
function deliverTerminal(payload: unknown): void {
  const listener = mocks.listeners.get(channels.executionTerminalObservation.id)
  expect(listener, 'terminal listener must be registered').toBeTypeOf('function')
  listener!({ ...channels.executionTerminalObservation, body: payload })
}

/** Delivers one execution-start report the way the renderer's emit would. */
function deliverExecution(payload: unknown): void {
  const listener = mocks.listeners.get(channels.executionObservation.id)
  expect(listener, 'execution report handler must be registered').toBeTypeOf('function')
  listener!({ ...channels.executionObservation, body: payload })
}

/** Calls the decision bridge the way the renderer invoke would. */
function askDecision(request: Partial<LiaBrainChatDecisionRequest>) {
  const handler = mocks.listeners.get(channels.decision.id)
  expect(handler, 'decision bridge must be registered').toBeTypeOf('function')
  return handler!({ facts: FACTS, ...request }) as Record<string, unknown>
}

function executionReport(correlationId: string, roundId: string) {
  return { conversationId: 'conversation-1', correlationId, modelId: 'openai/gpt-oss-120b', providerId: 'groq', roundId }
}

beforeEach(() => {
  mocks.listeners.clear()
  mocks.emitted.length = 0
  mocks.decisions = 0
})

describe('lia terminal channel wiring (Phase 8.0D-10B-4D4C2B2)', () => {
  it('a/b/c: each valid outcome reaches the canonical store through the real listener', () => {
    const { store } = wireTerminal()

    for (const outcome of ['succeeded', 'failed', 'abandoned'] as const) {
      deliverTerminal({ correlationId: `corr-${outcome}`, outcome, roundId: `round-${outcome}` })

      const snapshot = store.get(`corr-${outcome}`)!
      expect(snapshot.executionTerminals).toEqual([{ outcome, roundId: `round-${outcome}` }])
      // The terminal may be the very first fact of a logical send: nothing else
      // was invented beside it.
      expect(snapshot.decision).toBeUndefined()
      expect(snapshot.executions).toEqual([])
    }

    expect(store.size).toBe(3)
    expect(mocks.emitted).toEqual([])
  })

  it('d: representative invalid payloads cross the listener, are rejected by the ingress, and write nothing', () => {
    const { store } = wireTerminal()

    for (const payload of [
      undefined,
      null,
      {},
      'succeeded',
      42,
      { correlationId: '', outcome: 'succeeded', roundId: 'round-1' },
      { correlationId: 'corr-1', outcome: 'succeeded', roundId: '' },
      { correlationId: 'corr-1', outcome: 'cancelled', roundId: 'round-1' },
      { correlationId: 'corr-1', outcome: 'completed', roundId: 'round-1' },
      { correlationId: 'corr-1', roundId: 'round-1' },
      { correlationId: 42, outcome: 'succeeded', roundId: 'round-1' },
    ]) {
      expect(() => deliverTerminal(payload)).not.toThrow()
    }

    // The ingress sanitizer owns the matrix (4D4C2B1); here only the layering is
    // pinned: the listener forwarded, and the store stayed untouched.
    expect(store.size).toBe(0)
    expect(mocks.emitted).toEqual([])
  })

  it('e: hostile extra fields are stripped by the ingress - the store sees the canonical three keys', () => {
    const { store } = wireTerminal()

    deliverTerminal({
      apiKey: 'sk-secret',
      conversationId: 'conversation-1',
      correlationId: 'corr-1',
      error: 'boom',
      failureStage: 'streaming',
      messages: [{ content: 'private', role: 'user' }],
      modelId: 'openai/gpt-oss-120b',
      nested: { outcome: 'abandoned' },
      outcome: 'failed',
      prompt: 'private prompt',
      providerId: 'groq',
      roundId: 'round-1',
      stack: 'Error: boom',
      timestamp: 1_700_000_000_000,
      turnIndex: 3,
    })

    const snapshot = store.get('corr-1')!
    expect(snapshot.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'round-1' }])
    expect(Object.keys(snapshot.executionTerminals[0]!).sort()).toEqual(['outcome', 'roundId'])
    const serialized = JSON.stringify(snapshot)
    for (const forbidden of ['groq', 'gpt-oss', 'conversation-1', 'boom', 'streaming', 'private', 'sk-secret'])
      expect(serialized).not.toContain(forbidden)
  })

  it('f: duplicate events forward twice and the store keeps ONE terminal fact', () => {
    const { store } = wireTerminal()
    const recorded: unknown[] = []
    const countingStore = { recordExecutionTerminal: (report: unknown) => recorded.push(report) }

    // Layering: two events -> two ingress calls (no dedupe in the wiring).
    const countingContext = fakeContext()
    registerLiaBrainExecutionTerminalReportListener({
      context: countingContext,
      terminalReportService: terminalIngress(countingStore),
    })
    deliverTerminal({ correlationId: 'corr-1', outcome: 'failed', roundId: 'round-1' })
    deliverTerminal({ correlationId: 'corr-1', outcome: 'failed', roundId: 'round-1' })
    expect(recorded).toHaveLength(2)

    // Canonical store semantics: the first terminal fact of the round is kept.
    mocks.listeners.clear()
    wireTerminal({ store })
    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
  })

  it('g: conflicting events are both forwarded, in order - the store resolves, not the wiring', () => {
    const recorded: unknown[] = []
    const countingStore = { recordExecutionTerminal: (report: unknown) => recorded.push(report) }
    const context = fakeContext()
    registerLiaBrainExecutionTerminalReportListener({
      context,
      terminalReportService: terminalIngress(countingStore),
    })

    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    expect(recorded).toEqual([
      { correlationId: 'X', outcome: 'failed', roundId: 'R' },
      { correlationId: 'X', outcome: 'succeeded', roundId: 'R' },
    ])

    // And the canonical store keeps the first outcome.
    mocks.listeners.clear()
    const { store } = wireTerminal()
    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
  })

  it('h: a terminal event before any start is accepted, and start-after-terminal keeps both facts', () => {
    const { observed, store } = wireFullComposition()

    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })

    // H: terminal without a matching start - no error, no identity synthesis,
    // and (Phase 8.0D-10B-4D4C3B2-B3) exactly ONE observation of its own key,
    // after the write.
    expect(store.get('X')!.executions).toEqual([])
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    expect(observed).toEqual(['X'])

    // I: the normal start path for the SAME round then lands beside it...
    deliverExecution(executionReport('X', 'R'))
    expect(store.get('X')!.executions).toEqual([executionReport('X', 'R')])
    // ...the terminal fact is unchanged, and the START triggers its own
    // observation too - one per successful write, never a join.
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    expect(observed).toEqual(['X', 'X'])
  })

  it('j: start before terminal keeps both facts, and the terminal adds its OWN observation', () => {
    const { observed, store } = wireFullComposition()

    deliverExecution(executionReport('X', 'R'))
    expect(observed).toEqual(['X'])

    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    expect(store.get('X')!.executions).toHaveLength(1)
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'R' }])
    // Phase 8.0D-10B-4D4C3B2-B3: the terminal write triggers too - two producer
    // events, two observations of their own keys.
    expect(observed).toEqual(['X', 'X'])
  })

  it('k: terminal and decision coexist in either order, with first-decision semantics intact', () => {
    // Terminal first.
    const terminalFirst = wireFullComposition()
    deliverTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })
    expect(terminalFirst.observed).toEqual(['X'])
    const firstDecision = askDecision({ correlationId: 'X', facts: FACTS })
    expect(terminalFirst.store.get('X')!.decision).toBe(firstDecision)
    expect(terminalFirst.store.get('X')!.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'R' }])
    // Both producer events observed their own key - terminal first, decision
    // second.
    expect(terminalFirst.observed).toEqual(['X', 'X'])
    // First decision wins: a second shadow request never replaces it - and,
    // having been accepted, it triggers its own observation too.
    askDecision({ correlationId: 'X', facts: FACTS })
    expect(terminalFirst.store.get('X')!.decision).toBe(firstDecision)
    expect(terminalFirst.store.get('X')!.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'R' }])
    expect(terminalFirst.observed).toEqual(['X', 'X', 'X'])

    // Decision first.
    mocks.listeners.clear()
    const decisionFirst = wireFullComposition()
    const firstDecisionAgain = askDecision({ correlationId: 'X', facts: FACTS })
    deliverTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })
    expect(decisionFirst.store.get('X')!.decision).toBe(firstDecisionAgain)
    expect(decisionFirst.store.get('X')!.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'R' }])
    // Decision first, then terminal: both producer events observed their key.
    expect(decisionFirst.observed).toEqual(['X', 'X'])
  })

  it('l: the wiring forwards the RAW payload object, untouched - identity preserved', () => {
    const report = vi.fn()
    const context = fakeContext()
    registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService: { report } as never })

    const payload = { correlationId: 'corr-1', outcome: 'succeeded', roundId: 'round-1' }
    deliverTerminal(payload)

    expect(report).toHaveBeenCalledTimes(1)
    // The very same object reaches the service: no copy, no preprocessing.
    expect(report.mock.calls[0]![0]).toBe(payload)
    // An invalid payload is forwarded just as literally.
    const hostile = { outcome: 'cancelled' }
    deliverTerminal(hostile)
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[1]![0]).toBe(hostile)
  })

  it('m: a throwing store cannot escape the listener path, and nothing is retried or observed', () => {
    // The store error containment is owned by the ingress service (B1), and the
    // wiring adds no second semantic layer.
    const observed: string[] = []
    const context = fakeContext()
    registerLiaBrainExecutionTerminalReportListener({
      context,
      terminalReportService: createLiaBrainExecutionTerminalReportService({
        correlationStore: { recordExecutionTerminal: () => { throw new Error('diagnostic memory is gone') } } as never,
        correlationObserver: { observe: (correlationId: string) => observed.push(correlationId) } as never,
      }),
    })

    expect(() => deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })).not.toThrow()
    expect(() => deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })).not.toThrow()
    // The write threw both times, so nothing was ever observed.
    expect(observed).toEqual([])
    expect(mocks.emitted).toEqual([])
  })

  it('n: all THREE producers trigger the ONE observer, once each, with their own keys', () => {
    const { observed, store } = wireFullComposition()

    // Phase 8.0D-10B-4D4C3B2-B3: one valid terminal event now observes its key,
    // exactly like the other two producers.
    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    expect(observed).toEqual(['X'])
    expect(store.get('X')!.executionTerminals).toHaveLength(1)

    // The execution-start write observes its own key.
    deliverExecution(executionReport('Y', 'R'))
    expect(observed).toEqual(['X', 'Y'])

    // The decision write observes its own key.
    askDecision({ correlationId: 'Z', facts: FACTS })
    expect(observed).toEqual(['X', 'Y', 'Z'])

    // A further terminal for an already-observed key triggers again - the
    // trigger boundary is the accepted write, never a change detection.
    deliverTerminal({ correlationId: 'Y', outcome: 'abandoned', roundId: 'R' })
    expect(observed).toEqual(['X', 'Y', 'Z', 'Y'])
  })
})

describe('lia terminal wiring invariants (Phase 8.0D-10B-4D4C2B2)', () => {
  it('o: the listener module is transport only - one registration, raw forwarding, no logic', () => {
    const source = stripComments(readSource('./brain-execution-terminal-report-listener.ts'))

    // Exactly one listener registration, on the shared constant (never a
    // literal), and exactly one delegation to the ingress service.
    expect(source.match(/context\.on\(/g)).toHaveLength(1)
    expect(source).toMatch(/import \{ electronLiaBrainExecutionTerminalObservation \} from '\.\.\/\.\.\/\.\.\/shared\/eventa'/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain/)
    expect(source.match(/terminalReportService\.report\(/g)).toHaveLength(1)

    // No sanitizer, no field knowledge, no store, no interpretation: the
    // payload is forwarded as it arrived.
    expect(source).not.toMatch(/isRecord|readString|roundId|correlationId|succeeded|failed|abandoned|\boutcome\b/)
    expect(source).not.toMatch(/require\(|\.length === 0|trim\(|JSON\./)
    expect(source).not.toMatch(/recordExecutionTerminal|recordExecution\(|recordDecision|correlationStore/)
    // No diagnostic trigger and no read side.
    expect(source).not.toMatch(/correlationObserver|\.observe\(|brain-correlation-reader|brain-execution-identity-facts|brain-expected-route|brain-diagnostic-log/)
    // No output, no authority, no aggregates, no async machinery.
    expect(source).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    expect(source).not.toMatch(/fallback|retry|setProvider|setModel|permission|\btools?\b|routeMatch|mismatch|compare|verdict|score|finalAttempt|winningAttempt/)
    expect(source).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval|\bnew Map\b|\bnew Set\b|history|\bcache\b|\bpending\b|dedupe/)
    // No Eventa helper beyond the context listener, no defineInvokeHandler.
    expect(source).not.toMatch(/defineEventa|defineInvokeEventa|defineInvokeHandler|ipcRenderer|BrowserWindow|\bemit\(/)
  })

  it('p/q: the composition entry creates ONE service over the SAME store and registers ONE listener', () => {
    const entry = stripComments(readSource('../../index.ts'))

    // The terminal block exists exactly once, and it injects the canonical
    // lifecycle handle - the same one the other two producers receive.
    expect(entry.match(/createLiaBrainExecutionTerminalReportService\(/g)).toHaveLength(1)
    expect(entry.match(/registerLiaBrainExecutionTerminalReportListener\(/g)).toHaveLength(1)
    const entryCode = entry.replace(/\s+/g, ' ')
    expect(entryCode).toContain('const terminalReportService = createLiaBrainExecutionTerminalReportService({ correlationStore: deps.liaBrainCorrelation, correlationObserver: deps.liaBrainCorrelationObserver, })')
    expect(entryCode).toContain('registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })')

    // Phase 8.0D-10B-4D4C3B2-B3: the terminal service is built over the SAME
    // lifecycle-owned observer the other three producers receive - one canonical
    // instance, never a second one - and the listener itself stays observer-free.
    // Phase 8.0D-10B-4D4C4-B4B5 adds the fourth (send) producer, so the global
    // counts are now four and three.
    expect(entry.match(/correlationObserver: deps\.liaBrainCorrelationObserver/g)).toHaveLength(4)
    expect(entry.match(/dependsOn: \{ liaBrainCorrelation, liaBrainCorrelationObserver \}/g)).toHaveLength(3)
    expect(entryCode).not.toContain('registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService, correlationObserver')

    // The entry never sanitizes, never writes to the store and never branches
    // on an outcome - the wiring is delegation only.
    const terminalBlock = entryCode.slice(
      entryCode.indexOf('createLiaBrainExecutionTerminalReportService('),
      entryCode.indexOf('registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })'),
    )
    expect(terminalBlock).not.toMatch(/recordExecutionTerminal|outcome|succeeded|failed|abandoned|isRecord|readString/)

    // And the existing execution listener block is untouched in shape.
    expect(entryCode.match(/registerLiaBrainExecutionReportHandler\(\{ context, correlationStore: deps\.liaBrainCorrelation, correlationObserver: deps\.liaBrainCorrelationObserver, \}\)/g)).toHaveLength(1)
  })

  it('r: production allowlists - one producer, one declaration, one main listener, one factory caller', () => {
    // The channel constant appears in production in exactly three places: the
    // shared declaration, the renderer producer, and this main listener.
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src'], /electronLiaBrainExecutionTerminalObservation/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-listener.ts',
        'apps/stage-tamagotchi/src/renderer/services/lia/execution-terminal-reporter.ts',
        'apps/stage-tamagotchi/src/shared/eventa/index.ts',
      ])

    // Exactly ONE main-side listener registers on that channel...
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src/main'], /context\.on\(electronLiaBrainExecutionTerminalObservation/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-listener.ts'])
    // ...the factory has exactly ONE production caller...
    expect(productionSourcesMatching(BRAIN_ROOTS, /(?<!function )createLiaBrainExecutionTerminalReportService\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/index.ts'])
    // ...`report(...)` is called from exactly ONE wiring module...
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src'], /terminalReportService\.report\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-listener.ts'])
    // ...and the store write still belongs to the ingress service alone.
    expect(productionSourcesMatching(BRAIN_ROOTS, /recordExecutionTerminal\(/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-service.ts',
      ])
  })

  it('s: the Brain allowlist is now exactly the FOUR known channels - this phase added the fourth', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    expect(shared.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []).toEqual([
      'eventa:invoke:lia:brain:chat-decision',
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:event:lia:brain:send-terminal-observation',
    ])

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
  })

  it('t: the frozen layers stay frozen - the reader carries terminals at TYPE level only', () => {
    // 8.0D-10B-4D4C3A-F: exactly ONE read-side layer names the terminal
    // vocabulary, and only inside its reader-owned SNAPSHOT CONTRACT. Every
    // other read-side layer stays terminal-free: no derivation, no observer
    // trigger, no diagnostic output.
    for (const relative of [
      './brain-execution-identity-facts.ts',
      './brain-expected-route.ts',
      './brain-correlation-observer.ts',
      './brain-diagnostic-log.ts',
    ]) {
      expect(stripComments(readSource(relative)), relative).not.toMatch(/executionTerminal|recordExecutionTerminal/)
    }

    // The reader: the collection is declared on the snapshot boundary it owns...
    const reader = stripComments(readSource('./brain-correlation-reader.ts'))
    expect(reader).toContain('executionTerminals?: readonly LiaObservedExecutionTerminal[]')
    // ...while the runtime read path never touches it, and no terminal-output
    // type or helper exists to carry it out of the read API.
    const runtime = reader.slice(reader.indexOf('export function readLiaBrainExecutionIdentityFacts'))
    expect(runtime).not.toMatch(/executionTerminals|roundId|outcome|terminal/i)
    expect(reader).not.toMatch(/LiaBrainCorrelationTerminalFacts|copyObservedExecutionTerminals|readTerminals|terminalMap/)
    expect(reader).not.toMatch(/recordExecutionTerminal|\.observe\(|anySucceeded|anyFailed|allFailed|hasTerminal|terminalCount|latestTerminal/)

    // The store keeps its three-field/one-method contract - the wiring did not
    // add a member or a semantic.
    const store = stripComments(readSource('./brain-correlation-store.ts'))
    expect(store.match(/recordExecutionTerminal: \(report: LiaBrainExecutionTerminalReport\) => void/g)).toHaveLength(1)
    expect(store).not.toMatch(/terminalListener|registerLiaBrainExecutionTerminalReportListener/)
  })
})

/**
 * Phase 8.0D-10B-4D4C3B2-B3: the terminal trigger over the REAL observer.
 *
 * The full production composition - the real terminal listener, the real
 * terminal ingress, the real decision bridge, the real execution report handler,
 * ONE real correlation store and the REAL diagnostic observer with its ONE-
 * snapshot composition - driven through the REAL Eventa seams, with the
 * structured entries recorded by a test-only callback. This is where the
 * terminal counts become visible in a structured entry.
 */
describe('terminal trigger - real observer integration (Phase 8.0D-10B-4D4C3B2-B3)', () => {
  const ZERO_TERMINALS: LiaBrainTerminalObservationFacts = {
    abandonedTerminalObservationCount: 0,
    failedTerminalObservationCount: 0,
    succeededTerminalObservationCount: 0,
  }

  /** The full composition, with the REAL observer and a recording entry sink. */
  function wireRealComposition() {
    const store = createLiaBrainCorrelationService()
    const context = fakeContext()
    const entries: LiaBrainDiagnosticEntry[] = []
    const lines: string[] = []
    const observer = createLiaBrainCorrelationObserver({
      correlationReader: store,
      // The REAL formatter runs over every entry the real observer produced, so
      // each observation also yields the exact line a dev build would log.
      log: (entry) => {
        entries.push(entry)
        lines.push(formatLiaBrainDiagnosticEntry(entry))
      },
    })
    const brain = brainDouble()
    registerLiaBrainDecisionBridge({ context, brain: brain as never, correlationStore: store, correlationObserver: observer })
    registerLiaBrainExecutionReportHandler({ context, correlationStore: store, correlationObserver: observer })
    const terminalReportService = terminalIngress(store, observer)
    registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })
    return { brain, entries, lines, store }
  }

  /** The present arm of one recorded entry, narrowed once. */
  function observedTerminals(entry: LiaBrainDiagnosticEntry): LiaBrainTerminalObservationFacts {
    if (!('terminalFacts' in entry))
      throw new Error('expected a present correlation entry')
    return entry.terminalFacts
  }

  it('a: TERMINAL FIRST - one stored terminal, ONE entry carrying the counted outcome', () => {
    const { entries, store } = wireRealComposition()

    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })

    // Exactly one retained terminal, and exactly one observation of its key.
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    expect(entries).toHaveLength(1)
    expect(entries[0]!.correlationId).toBe('X')
    // The identity side is the current factual answer - no synthesis, no status.
    expect(entries[0]!.facts).toEqual({ attempts: [], status: 'decisionNotObserved' })
    // ...and the terminal side is the counted outcome, visible on THIS call.
    expect(observedTerminals(entries[0]!)).toEqual({ ...ZERO_TERMINALS, failedTerminalObservationCount: 1 })
  })

  it('b: START THEN TERMINAL - two producer events, two entries, the second carrying the count', () => {
    const { entries, store } = wireRealComposition()

    deliverExecution(executionReport('X', 'R'))
    expect(entries).toHaveLength(1)
    expect(observedTerminals(entries[0]!)).toEqual(ZERO_TERMINALS)

    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    expect(entries).toHaveLength(2)
    expect(observedTerminals(entries[1]!)).toEqual({ ...ZERO_TERMINALS, succeededTerminalObservationCount: 1 })
    // Both facts are retained side by side; the attempt keeps its exact shape.
    expect(store.get('X')!.executions).toHaveLength(1)
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'R' }])
    expect(entries[1]!.facts.status).toBe('decisionNotObserved')
    if (entries[1]!.facts.status !== 'decisionNotObserved')
      throw new Error('expected decisionNotObserved')
    expect(Object.keys(entries[1]!.facts.attempts[0]!).sort()).toEqual(['arrivalIndex', 'modelId', 'providerId', 'roundId'])
  })

  it('c: TERMINAL THEN START - two entries, the second carrying BOTH streams', () => {
    const { entries, store } = wireRealComposition()

    deliverTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })
    expect(entries).toHaveLength(1)
    expect(observedTerminals(entries[0]!)).toEqual({ ...ZERO_TERMINALS, abandonedTerminalObservationCount: 1 })

    deliverExecution(executionReport('X', 'R'))

    expect(entries).toHaveLength(2)
    expect(observedTerminals(entries[1]!)).toEqual({ ...ZERO_TERMINALS, abandonedTerminalObservationCount: 1 })
    expect(entries[1]!.facts.status).toBe('decisionNotObserved')
    if (entries[1]!.facts.status !== 'decisionNotObserved')
      throw new Error('expected decisionNotObserved')
    expect(entries[1]!.facts.attempts.map(attempt => attempt.roundId)).toEqual(['R'])
    // No join: the terminal record is counted, never attached to the attempt.
    expect(store.get('X')!.executions).toHaveLength(1)
    expect(store.get('X')!.executionTerminals).toHaveLength(1)
  })

  it('d: DECISION + START + TERMINAL - exactly THREE triggers, no extra', () => {
    const { entries } = wireRealComposition()

    askDecision({ correlationId: 'X', facts: FACTS })
    expect(entries).toHaveLength(1)

    deliverExecution(executionReport('X', 'R'))
    expect(entries).toHaveLength(2)

    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    expect(entries).toHaveLength(3)
    expect(entries.map(entry => entry.correlationId)).toEqual(['X', 'X', 'X'])
    // The last entry is the fully-populated factual state.
    expect(entries[2]!.facts.status).toBe('attemptIdentityFacts')
    expect(observedTerminals(entries[2]!)).toEqual({ ...ZERO_TERMINALS, succeededTerminalObservationCount: 1 })
  })

  it('e: duplicate terminal events trigger twice, and the canonical store keeps ONE record', () => {
    const { entries, store } = wireRealComposition()

    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })

    expect(entries).toHaveLength(2)
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    // Both post-write entries read the same canonical retained fact.
    expect(observedTerminals(entries[0]!)).toEqual({ ...ZERO_TERMINALS, failedTerminalObservationCount: 1 })
    expect(observedTerminals(entries[1]!)).toEqual({ ...ZERO_TERMINALS, failedTerminalObservationCount: 1 })
  })

  it('f: conflicting terminal events trigger twice, and the store keeps the FIRST outcome', () => {
    const { entries, store } = wireRealComposition()

    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    expect(entries).toHaveLength(2)
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    for (const entry of entries)
      expect(observedTerminals(entry)).toEqual({ ...ZERO_TERMINALS, failedTerminalObservationCount: 1 })
  })

  it('g: the terminal-triggered entry carries counts and no raw record, and the line prints them', () => {
    const { entries, lines } = wireRealComposition()

    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    const entry = entries[0]!
    // 8.0D-10B-4D4C4-B4B3: the composed entry carries the derived send sibling as
    // well - empty here, because this snapshot retains no send settlement - and
    // its value is a fact about this snapshot, not a placeholder.
    expect(Object.keys(entry).sort()).toEqual(['correlationId', 'facts', 'finalSuccessfulExecutionFacts', 'sendTerminalFacts', 'terminalFacts'])
    expect('sendTerminalFacts' in entry && entry.sendTerminalFacts).toEqual({})
    const serialized = JSON.stringify(entry)
    for (const forbidden of ['executionTerminals', 'roundId', 'outcome', 'snapshot', 'createdAt'])
      expect(serialized, forbidden).not.toContain(forbidden)

    // Phase 8.0D-10B-4D4C3B2-B4: the line now serializes the counts the entry
    // already carried - the same key and status, plus the three count fields.
    expect(lines).toEqual(['[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" succeededTerminalObservationCount=1 failedTerminalObservationCount=0 abandonedTerminalObservationCount=0'])
    // The raw terminal record itself still never reaches the line.
    const line = formatLiaBrainDiagnosticEntry(entry)
    for (const forbidden of ['executionTerminals', 'outcome', 'roundId":', 'snapshot', 'terminalFacts', 'sendTerminalFacts'])
      expect(line, forbidden).not.toContain(forbidden)
  })

  /**
   * Phase 8.0D-10B-4D4C3B2-B4: the same real stack - real listener, real ingress,
   * real store, real observer, real composition - read through the REAL
   * formatter. These proofs show that the counts of the RETAINED snapshot reach
   * the very line a dev build logs, for every production path, and that nothing
   * else about the line changed.
   */
  describe('terminal observer trigger: the counts reach the formatted line (Phase 8.0D-10B-4D4C3B2-B4)', () => {
    const counts = (succeeded: number, failed: number, abandoned: number) =>
      `succeededTerminalObservationCount=${succeeded} failedTerminalObservationCount=${failed} abandonedTerminalObservationCount=${abandoned}`
    /** Terminal-first: nothing but the terminal was observed, so no attempt field. */
    const terminalFirst = '[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved"'
    /** After a request-start report: the same status plus the attempt's own fields. */
    const withAttempt = '[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="R" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b"'
    /** After the decision only: the expectation is known, no attempt yet. */
    const decisionOnly = '[LIA-BRAIN-DIAG] correlationId="X" status="noExecutionObserved" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b"'
    /** After decision AND request-start: expectation, attempt and the two booleans. */
    const withIdentity = '[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="R" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true'

    it('48: TERMINAL FIRST (failed) - one line, failed=1 and zeros for the other two', () => {
      const { lines } = wireRealComposition()

      deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })

      expect(lines).toEqual([`${terminalFirst} ${counts(0, 1, 0)}`])
    })

    it('49: START THEN TERMINAL - two lines, 0/0/0 then 1/0/0', () => {
      const { lines } = wireRealComposition()

      deliverExecution(executionReport('X', 'R'))
      expect(lines).toEqual([`${withAttempt} ${counts(0, 0, 0)}`])

      deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })
      expect(lines).toEqual([
        `${withAttempt} ${counts(0, 0, 0)}`,
        `${withAttempt} ${counts(1, 0, 0)}`,
      ])
    })

    it('50: TERMINAL THEN START - two lines, both 0/0/1, the second adding the attempt', () => {
      const { lines } = wireRealComposition()

      deliverTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })
      expect(lines).toEqual([`${terminalFirst} ${counts(0, 0, 1)}`])

      deliverExecution(executionReport('X', 'R'))
      expect(lines).toEqual([
        `${terminalFirst} ${counts(0, 0, 1)}`,
        `${withAttempt} ${counts(0, 0, 1)}`,
      ])
    })

    it('51: DECISION + START + TERMINAL - exactly three lines, no fourth', () => {
      const { lines } = wireRealComposition()

      askDecision({ correlationId: 'X', facts: FACTS })
      deliverExecution(executionReport('X', 'R'))
      deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

      expect(lines).toEqual([
        `${decisionOnly} ${counts(0, 0, 0)}`,
        `${withIdentity} ${counts(0, 0, 0)}`,
        `${withIdentity} ${counts(1, 0, 0)}`,
      ])
    })

    it('52: DUPLICATE TERMINAL - two lines, both printing the SAME canonical count', () => {
      const { lines, store } = wireRealComposition()

      deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
      deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })

      // The store kept ONE record, so the printed number counts the snapshot - it
      // is never incremented by the number of triggering events.
      expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
      expect(lines).toEqual([
        `${terminalFirst} ${counts(0, 1, 0)}`,
        `${terminalFirst} ${counts(0, 1, 0)}`,
      ])
    })

    it('53: CONFLICTING TERMINAL - both lines print the store first-write outcome', () => {
      const { lines, store } = wireRealComposition()

      deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
      deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

      expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
      expect(lines).toEqual([
        `${terminalFirst} ${counts(0, 1, 0)}`,
        `${terminalFirst} ${counts(0, 1, 0)}`,
      ])
    })
  })
})
