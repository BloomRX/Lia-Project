import type { LiaBrainChatDecisionRequest } from '../../../shared/eventa'
import type { LiaBrainSendTerminalReportService } from './brain-send-terminal-report-service'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { registerLiaBrainDecisionBridge } from './brain-decision-service'
import { registerLiaBrainExecutionReportHandler } from './brain-execution-report-service'
import { registerLiaBrainExecutionTerminalReportListener } from './brain-execution-terminal-report-listener'
import { createLiaBrainExecutionTerminalReportService } from './brain-execution-terminal-report-service'
import { registerLiaBrainSendTerminalReportListener } from './brain-send-terminal-report-listener'
import { createLiaBrainSendTerminalReportService } from './brain-send-terminal-report-service'

/**
 * Phase 8.0D-10B-4D4C4-B3B2: the production wiring of the FOURTH Brain channel.
 *
 * This is the integration proof: the REAL send-terminal listener, over the REAL
 * send-terminal ingress service, over the REAL correlation store - wired
 * exactly as `main/index.ts` wires it, and driven through the REAL Eventa
 * listener seam with the REAL envelope the renderer's one-way emit produces.
 *
 * The asymmetry this phase pins: the send path carries NO diagnostic trigger.
 * The same composition therefore also registers the REAL decision bridge, the
 * REAL execution report handler and the REAL round-terminal listener against
 * the ONE shared store and ONE shared observer, so "a send settlement observes
 * nothing" is proven against the very trigger the other three paths use.
 *
 * No renderer, no Electron and no browser are needed: the context double only
 * records the listeners the registration seams install.
 */

const channels = vi.hoisted(() => ({
  decision: { id: 'eventa:invoke:lia:brain:chat-decision' },
  executionObservation: { id: 'eventa:event:lia:brain:execution-observation', type: 'event' },
  executionTerminalObservation: { id: 'eventa:event:lia:brain:execution-terminal-observation', type: 'event' },
  sendTerminalObservation: { id: 'eventa:event:lia:brain:send-terminal-observation', type: 'event' },
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
  electronLiaBrainSendTerminalObservation: channels.sendTerminalObservation,
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

/** The canonical send-terminal ingress: ONE service over ONE store. */
function sendIngress(store: unknown) {
  return createLiaBrainSendTerminalReportService({ correlationStore: store as never })
}

/** The exact production wiring of the FOURTH channel: ONE service over ONE store. */
function wireSendTerminal(overrides: { store?: ReturnType<typeof createLiaBrainCorrelationService> } = {}) {
  const store = overrides.store ?? createLiaBrainCorrelationService()
  const context = fakeContext()
  const sendTerminalReportService = sendIngress(store)
  registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService })
  return { sendTerminalReportService, store }
}

/**
 * The FULL production composition: all FOUR channels over ONE store and ONE
 * shared observer (the first three triggering, the send path deliberately not).
 */
function wireFullComposition() {
  const store = createLiaBrainCorrelationService()
  const context = fakeContext()
  const { observed, observer } = observerDouble()
  const brain = brainDouble()
  registerLiaBrainDecisionBridge({ context, brain: brain as never, correlationStore: store, correlationObserver: observer as never })
  registerLiaBrainExecutionReportHandler({ context, correlationStore: store, correlationObserver: observer as never })
  const terminalReportService = createLiaBrainExecutionTerminalReportService({
    correlationStore: store,
    correlationObserver: observer as never,
  })
  registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })
  // Phase 8.0D-10B-4D4C4-B3B2: the send path, over the SAME store - and with NO
  // observer anywhere on its wiring.
  const sendTerminalReportService = sendIngress(store)
  registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService })
  return { brain, observed, store }
}

/** Delivers one send-terminal payload the way the renderer's one-way emit would. */
function deliverSendTerminal(payload: unknown): void {
  const listener = mocks.listeners.get(channels.sendTerminalObservation.id)
  expect(listener, 'send-terminal listener must be registered').toBeTypeOf('function')
  listener!({ ...channels.sendTerminalObservation, body: payload })
}

/** Delivers one round-terminal payload the way the renderer's emit would. */
function deliverRoundTerminal(payload: unknown): void {
  const listener = mocks.listeners.get(channels.executionTerminalObservation.id)
  expect(listener, 'round-terminal listener must be registered').toBeTypeOf('function')
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

describe('lia send terminal channel wiring (Phase 8.0D-10B-4D4C4-B3B2)', () => {
  it('67: the wiring forwards the RAW payload object, untouched - identity preserved', () => {
    const report = vi.fn()
    const context = fakeContext()
    registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService: { report } as never })

    const payload = { correlationId: 'corr-1', outcome: 'succeeded' }
    deliverSendTerminal(payload)

    expect(report).toHaveBeenCalledTimes(1)
    // The very same object reaches the service: no copy, no spread, no JSON
    // conversion, no reconstruction.
    expect(report.mock.calls[0]![0]).toBe(payload)

    // An invalid payload is forwarded just as literally.
    const hostile = { outcome: 'cancelled' }
    deliverSendTerminal(hostile)
    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls[1]![0]).toBe(hostile)
  })

  it('68: invalid bodies still reach the service EXACTLY once - the listener filters nothing', () => {
    const report = vi.fn()
    const context = fakeContext()
    registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService: { report } as never })

    for (const body of [undefined, null, {}, 'succeeded', 42, false, [], { correlationId: '' }, { correlationId: 'X' }, { correlationId: 'X', outcome: 'completed' }]) {
      report.mockClear()
      deliverSendTerminal(body)

      expect(report, JSON.stringify(body)).toHaveBeenCalledTimes(1)
      expect(report.mock.calls[0]![0], JSON.stringify(body)).toBe(body)
    }
  })

  it('69/41: duplicates and conflicts are forwarded twice each, in arrival order', () => {
    const report = vi.fn()
    const context = fakeContext()
    registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService: { report } as never })

    // Duplicate: two events, two calls.
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    expect(report).toHaveBeenCalledTimes(2)

    // Conflict: both forwarded, in order - the store owns first-write-wins.
    report.mockClear()
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    deliverSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    expect(report.mock.calls.map(call => (call[0] as { outcome: string }).outcome)).toEqual(['failed', 'succeeded'])
  })

  it('72: a hostile getter is never touched by the listener itself', () => {
    const report = vi.fn()
    const context = fakeContext()
    registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService: { report } as never })

    const hostile = {}
    Object.defineProperty(hostile, 'correlationId', {
      enumerable: true,
      get() {
        throw new Error('hostile getter')
      },
    })

    // The listener reads no property of the body: it forwards the object itself.
    expect(() => deliverSendTerminal(hostile)).not.toThrow()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]![0]).toBe(hostile)
  })

  it('71: a throwing service escapes EXACTLY like the sibling round-terminal listener', () => {
    // Neither sibling installs a catch around the delegation: the containment
    // policy lives in the ingress service, and the wiring adds no second
    // semantic layer. Both listeners behave identically.
    const throwing: LiaBrainSendTerminalReportService = {
      report: () => {
        throw new Error('ingress exploded')
      },
    }
    const sendContext = fakeContext()
    registerLiaBrainSendTerminalReportListener({ context: sendContext, sendTerminalReportService: throwing })

    const siblingContext = fakeContext()
    registerLiaBrainExecutionTerminalReportListener({
      context: siblingContext,
      terminalReportService: { report: () => { throw new Error('ingress exploded') } } as never,
    })

    expect(() => deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })).toThrow('ingress exploded')
    expect(() => deliverRoundTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })).toThrow('ingress exploded')
    expect(mocks.emitted).toEqual([])
  })
})

describe('lia send terminal channel - real store integration (Phase 8.0D-10B-4D4C4-B3B2)', () => {
  it('34/73: a valid SUCCEEDED settlement reaches the canonical store through the real listener', () => {
    const { store } = wireSendTerminal()

    deliverSendTerminal({ correlationId: 'X', outcome: 'succeeded' })

    const snapshot = store.get('X')!
    expect(snapshot.sendTerminal).toEqual({ outcome: 'succeeded' })
    expect(Object.keys(snapshot.sendTerminal!)).toEqual(['outcome'])
    expect(snapshot.decision).toBeUndefined()
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([])
    expect(store.size).toBe(1)
    expect(mocks.emitted).toEqual([])
  })

  it('35/74: a valid FAILED settlement reaches the canonical store through the real listener', () => {
    const { store } = wireSendTerminal()

    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })

    expect(store.get('X')!.sendTerminal).toEqual({ outcome: 'failed' })
    expect(store.size).toBe(1)
  })

  it('36/43/75: representative invalid payloads cross the listener, are rejected by the ingress, and write nothing', () => {
    const { store } = wireSendTerminal()

    for (const payload of [
      undefined,
      null,
      {},
      'failed',
      42,
      { correlationId: '', outcome: 'failed' },
      { correlationId: 'X', outcome: 'cancelled' },
      { correlationId: 'X', outcome: 'abandoned' },
      { correlationId: 'X', outcome: 'completed' },
      { correlationId: 'X', outcome: 'SUCCEEDED' },
      { correlationId: 'X' },
      { correlationId: 42, outcome: 'failed' },
    ]) {
      expect(() => deliverSendTerminal(payload)).not.toThrow()
    }

    // The ingress sanitizer owns the matrix (B3B1); here only the layering is
    // pinned: the listener forwarded, and the store stayed untouched.
    expect(store.size).toBe(0)
    expect(store.get('X')).toBeUndefined()
    expect(mocks.emitted).toEqual([])
  })

  it('37/76: hostile extra fields are stripped by the ingress - the store keeps only the settlement', () => {
    const { store } = wireSendTerminal()

    deliverSendTerminal({
      apiKey: 'sk-secret',
      attemptCount: 3,
      conversationId: 'conversation-1',
      correlationId: 'X',
      error: 'secret',
      failureStage: 'streaming',
      messages: [{ content: 'private', role: 'user' }],
      modelId: 'openai/gpt-oss-120b',
      nested: { outcome: 'succeeded' },
      outcome: 'failed',
      prompt: 'private prompt',
      providerId: 'P',
      roundId: 'R',
      stack: 'Error: secret',
      timestamp: 1_700_000_000_000,
      usage: { totalTokens: 12 },
    })

    const snapshot = store.get('X')!
    expect(snapshot.sendTerminal).toEqual({ outcome: 'failed' })
    expect(Object.keys(snapshot.sendTerminal!)).toEqual(['outcome'])
    const serialized = JSON.stringify(snapshot)
    for (const forbidden of ['P', 'gpt-oss', 'conversation-1', 'secret', 'streaming', 'private', 'sk-secret', 'roundId', 'attemptCount', 'totalTokens', 'nested'])
      expect(serialized).not.toContain(forbidden)
  })

  it('38/77: the send settlement may be the FIRST fact of a correlation - nothing is synthesized', () => {
    const { store } = wireSendTerminal()

    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })

    const snapshot = store.get('X')!
    expect(snapshot.correlationId).toBe('X')
    expect(snapshot.decision).toBeUndefined()
    expect(snapshot.executions).toEqual([])
    expect(snapshot.executionTerminals).toEqual([])
    expect(snapshot.sendTerminal).toEqual({ outcome: 'failed' })
    expect('sendTerminal' in snapshot).toBe(true)
    // An unrelated key stays absent.
    expect(store.get('Y')).toBeUndefined()
  })

  it('39/78: an existing entry gains ONLY the send terminal, without disturbing its facts', () => {
    const { observed, store } = wireFullComposition()

    // The three existing producers write their own facts first.
    const decision = askDecision({ correlationId: 'X', facts: FACTS })
    deliverExecution(executionReport('X', 'R'))
    deliverRoundTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })
    expect(observed).toEqual(['X', 'X', 'X'])

    const before = store.get('X')!

    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })

    const after = store.get('X')!
    expect(after.decision).toBe(decision)
    expect(after.executions).toEqual(before.executions)
    expect(after.executionTerminals).toEqual(before.executionTerminals)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.sendTerminal).toEqual({ outcome: 'failed' })
    expect(store.size).toBe(1)
    // The round succeeded and the send failed - both retained verbatim, and the
    // send path observed NOTHING.
    expect(observed).toEqual(['X', 'X', 'X'])
  })

  it('40/79: duplicate events both reach the store, which keeps ONE canonical settlement', () => {
    const { store } = wireSendTerminal()
    const forwarded: unknown[] = []
    const countingStore = { recordSendTerminal: (report: unknown) => forwarded.push(report) }

    // Layering: two events -> two ingress calls (no dedupe in the wiring).
    mocks.listeners.clear()
    registerLiaBrainSendTerminalReportListener({ context: fakeContext(), sendTerminalReportService: sendIngress(countingStore) })
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    expect(forwarded).toEqual([
      { correlationId: 'X', outcome: 'failed' },
      { correlationId: 'X', outcome: 'failed' },
    ])

    // Canonical store semantics: the first settlement of the send is kept.
    mocks.listeners.clear()
    wireSendTerminal({ store })
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    expect(store.get('X')!.sendTerminal).toEqual({ outcome: 'failed' })
  })

  it('80: conflicting events are both forwarded, and first-write wins in BOTH directions', () => {
    const failedFirst = wireSendTerminal()
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    deliverSendTerminal({ correlationId: 'X', outcome: 'succeeded' })

    mocks.listeners.clear()
    const succeededFirst = wireSendTerminal()
    deliverSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })

    expect(failedFirst.store.get('X')!.sendTerminal).toEqual({ outcome: 'failed' })
    expect(succeededFirst.store.get('X')!.sendTerminal).toEqual({ outcome: 'succeeded' })
  })

  it('43: a throwing store is contained by the ingress - the listener path never escapes, and nothing is retried', () => {
    let attempts = 0
    const context = fakeContext()
    registerLiaBrainSendTerminalReportListener({
      context,
      sendTerminalReportService: createLiaBrainSendTerminalReportService({
        correlationStore: {
          recordSendTerminal: () => {
            attempts += 1
            throw new Error('diagnostic memory is gone')
          },
        },
      }),
    })

    expect(() => deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })).not.toThrow()
    expect(() => deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })).not.toThrow()
    // One attempt per event, no retry, and nothing was ever emitted.
    expect(attempts).toBe(2)
    expect(mocks.emitted).toEqual([])
  })

  it('46: a hostile getter through the REAL ingress follows the frozen B3B1 semantics exactly', () => {
    const { store } = wireSendTerminal()

    const hostile = {}
    Object.defineProperty(hostile, 'correlationId', {
      enumerable: true,
      get() {
        throw new Error('hostile getter')
      },
    })

    // B3B1 froze: property access escapes. The wiring changes nothing about it.
    expect(() => deliverSendTerminal(hostile)).toThrow('hostile getter')
    expect(store.size).toBe(0)
  })

  it('31/33: a send settlement triggers NO observation, while the three existing producers still do', () => {
    const { observed, store } = wireFullComposition()

    // The send path writes - and triggers nothing.
    deliverSendTerminal({ correlationId: 'X', outcome: 'failed' })
    expect(store.get('X')!.sendTerminal).toEqual({ outcome: 'failed' })
    expect(observed).toEqual([])

    // A second send event for the same key: still zero observations.
    deliverSendTerminal({ correlationId: 'X', outcome: 'succeeded' })
    expect(observed).toEqual([])

    // The three existing triggers remain exactly as they were.
    deliverExecution(executionReport('Y', 'R'))
    expect(observed).toEqual(['Y'])
    deliverRoundTerminal({ correlationId: 'Z', outcome: 'abandoned', roundId: 'R' })
    expect(observed).toEqual(['Y', 'Z'])
    askDecision({ correlationId: 'W', facts: FACTS })
    expect(observed).toEqual(['Y', 'Z', 'W'])
  })
})

describe('lia send terminal wiring invariants (Phase 8.0D-10B-4D4C4-B3B2)', () => {
  it('5/6/94/96/97/98/99: the listener module is transport only - one registration, raw forwarding, no logic', () => {
    const source = stripComments(readSource('./brain-send-terminal-report-listener.ts'))

    // Exactly one listener registration, on the shared constant (never a
    // literal), and exactly one delegation to the ingress service.
    expect(source.match(/context\.on\(/g)).toHaveLength(1)
    expect(source).toMatch(/import \{ electronLiaBrainSendTerminalObservation \} from '\.\.\/\.\.\/\.\.\/shared\/eventa'/)
    expect(source).not.toMatch(/eventa:(?:invoke|event):lia:brain/)
    expect(source.match(/sendTerminalReportService\.report\(/g)).toHaveLength(1)
    // The delegation is the RAW body, without spread, clone or reconstruction.
    expect(source).toMatch(/sendTerminalReportService\.report\(\(event as \{ body\?: unknown \} \| undefined\)\?\.body\)/)
    expect(source).not.toMatch(/\.\.\.|JSON\.|structuredClone|Object\.assign/)

    // No sanitizer and no field knowledge: the payload is forwarded as it arrived.
    expect(source).not.toMatch(/isRecord|readString|correlationId|\boutcome\b|succeeded|failed|abandoned|attemptCount|roundId/)
    expect(source).not.toMatch(/isRecord|readString|\.length === 0|trim\(/)
    // The ONLY `typeof` is the Eventa context type alias, and the payload is
    // touched exactly once - the `body` of the event envelope.
    expect(source.match(/\btypeof\b/g)).toEqual(['typeof'])
    expect(source.match(/\.body/g)).toHaveLength(1)
    // No store, no observer, no read side, no diagnostic layer.
    expect(source).not.toMatch(/recordSendTerminal|correlationStore|brain-correlation-store|brain-correlation-service/)
    expect(source).not.toMatch(/correlationObserver|\.observe\(|brain-correlation-reader|brain-correlation-diagnostic-facts|brain-execution-terminal-facts|brain-diagnostic-log|sendTerminalOutcome|terminalFacts/)
    // No output, no authority, no aggregates, no async machinery, no state.
    expect(source).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    expect(source).not.toMatch(/fallback|retry|setProvider|setModel|permission|\btools?\b|switch|finalAttempt|winningAttempt|winner|completed|completion|finished/)
    expect(source).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval|\bnew Map\b|\bnew Set\b|history|\bcache\b|dedupe|Date\.now/)
    // No Eventa helper beyond the context listener, no channel definition.
    expect(source).not.toMatch(/defineEventa|defineInvokeEventa|defineInvokeHandler|ipcRenderer|BrowserWindow|\bemit\(/)
  })

  it('19/22/81/82/83/84: the entry creates ONE service over the SAME store and registers ONE listener', () => {
    const entry = stripComments(readSource('../../index.ts'))
    const entryCode = entry.replace(/\s+/g, ' ')

    // The send-terminal block exists exactly once, and it injects the canonical
    // lifecycle handle - the same one the other producers write through.
    expect(entry.match(/createLiaBrainSendTerminalReportService\(/g)).toHaveLength(1)
    expect(entry.match(/registerLiaBrainSendTerminalReportListener\(/g)).toHaveLength(1)
    expect(entryCode).toContain('const sendTerminalReportService = createLiaBrainSendTerminalReportService({ correlationStore: deps.liaBrainCorrelation, })')
    expect(entryCode).toContain('registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService })')

    // The dependency set is the store AND NOTHING ELSE: no observer reaches this
    // path, so no observation can be triggered by a send settlement.
    expect(entry.match(/dependsOn: \{ liaBrainCorrelation \}/g)).toHaveLength(3)
    const sendBlock = entryCode.slice(entryCode.indexOf('createLiaBrainSendTerminalReportService('))
    const sendWiring = sendBlock.slice(0, sendBlock.indexOf('registerLiaBrainSendTerminalReportListener({ context, sendTerminalReportService })'))
    expect(sendWiring).not.toMatch(/correlationObserver|observe|recordSendTerminal|isRecord|readString|outcome|succeeded|failed/)

    // No second store anywhere: the canonical service factory is still called
    // exactly once, and the entry never builds a store of its own.
    expect(entry.match(/createLiaBrainCorrelationService\(\)/g)).toHaveLength(1)
    expect(entry).not.toMatch(/createLiaBrainCorrelationStore\(/)
    expect(entry.match(/services:lia-brain-correlation'/g)).toHaveLength(1)
    // The other three producers keep their exact shapes and counts.
    expect(entry.match(/correlationStore: deps\.liaBrainCorrelation/g)).toHaveLength(4)
    expect(entry.match(/correlationObserver: deps\.liaBrainCorrelationObserver/g)).toHaveLength(3)
    expect(entry).not.toMatch(/\.observe\(/)
  })

  it('86/87/88/89/90/91/92/93: production allowlists - one listener, one factory caller, one report caller, four channels', () => {
    // The channel constant appears in production in exactly FOUR places: the
    // shared declaration, the renderer producer, the main listener, and the
    // composition entry that imports the listener helper.
    expect(productionSourcesMatching(BRAIN_ROOTS, /electronLiaBrainSendTerminalObservation/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts',
        'apps/stage-tamagotchi/src/renderer/services/lia/send-terminal-reporter.ts',
        'apps/stage-tamagotchi/src/shared/eventa/index.ts',
      ])
    // The channel LITERAL lives in the shared declaration ALONE: every consumer
    // imports the constant instead of retyping the tag.
    expect(productionSourcesMatching(BRAIN_ROOTS, /send-terminal-observation/))
      .toEqual(['apps/stage-tamagotchi/src/shared/eventa/index.ts'])
    expect(readSource('../../../shared/eventa/index.ts').match(/send-terminal-observation/g)).toHaveLength(1)
    // Exactly ONE main-side listener registers on that channel...
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src/main'], /context\.on\(electronLiaBrainSendTerminalObservation/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts'])
    // ...the service factory has exactly ONE production caller...
    expect(productionSourcesMatching(BRAIN_ROOTS, /(?<!function )createLiaBrainSendTerminalReportService\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/index.ts'])
    // ...`report(...)` is called from exactly ONE wiring module...
    expect(productionSourcesMatching(['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src'], /sendTerminalReportService\.report\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts'])
    // ...the listener registration is called from exactly ONE place...
    expect(productionSourcesMatching(BRAIN_ROOTS, /(?<!function )registerLiaBrainSendTerminalReportListener\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/index.ts'])
    // ...and the store write still belongs to the ingress service alone.
    expect(productionSourcesMatching(BRAIN_ROOTS, /\.recordSendTerminal\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts'])
    expect(productionSourcesMatching(BRAIN_ROOTS, /recordSendTerminal/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts',
    ])

    // FOUR Brain channels, no fifth.
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

    // THREE observer triggers remain exactly the three producers.
    expect(productionSourcesMatching(BRAIN_ROOTS, /correlationObserver\.observe\(/)).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-service.ts',
    ])
  })

  it('40/41/44/45/46/47/55/56/57/58/59/60/61: the frozen layers stay frozen', () => {
    // The store keeps the B3A surface this phase consumes; the ingress keeps its
    // B3B1 sanitizer contract and receives no observer.
    const store = stripComments(readSource('./brain-correlation-store.ts'))
    expect(store.match(/recordSendTerminal: \(report: LiaBrainSendTerminalReport\) => void/g)).toHaveLength(1)
    expect(store).toMatch(/sendTerminal\?: LiaBrainSendTerminalRecord/)
    expect(store).not.toMatch(/registerLiaBrainSendTerminalReportListener|brain-send-terminal-report-listener/)

    const ingress = stripComments(readSource('./brain-send-terminal-report-service.ts'))
    expect(ingress.match(/\.recordSendTerminal\(report\)/g)).toHaveLength(1)
    expect(ingress).not.toMatch(/correlationObserver|\.observe\(|electronLiaBrainSendTerminalObservation|brain-send-terminal-report-listener/)

    // No send-level EXPOSURE exists anywhere on the read side except via the
    // formatter (B4B4), which now prints the optional send outcome as the final
    // quoted field. The reader is no longer listed here: 8.0D-10B-4D4C4-B4B1
    // widened its snapshot CONTRACT to carry the raw record structurally. The
    // composition left the list in 8.0D-10B-4D4C4-B4B3: it now derives the
    // sibling through the pure send projection - an inert carriage; B4B4 adds
    // the formatter as the sole textual exposure.
    for (const relative of [
      './brain-correlation-observer.ts',
      './brain-execution-terminal-facts.ts',
      './brain-execution-identity-facts.ts',
    ])
      expect(stripComments(readSource(relative)), relative).not.toMatch(/sendTerminal|sendSucceeded|sendFailed/)
    // 8.0D-10B-4D4C4-B4B4 evolves the field-vocabulary allowlist honestly to its
    // exact new owners: the pure send-facts projection and the diagnostic
    // formatter, and nothing else. The distinct term `sendTerminalObserved` and
    // the verdict words stay absent from production entirely.
    expect(productionSourcesMatching(BRAIN_ROOTS, /sendTerminalOutcome|sendTerminalObserved|sendSucceeded|sendFailed/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-facts.ts',
      ])
    expect(productionSourcesMatching(BRAIN_ROOTS, /sendTerminalObserved|sendSucceeded|sendFailed/)).toEqual([])

    // The shared contract still declares exactly the two-field send report, and
    // the renderer/Stage/Core layers know nothing about the stored field.
    const shared = readSource('../../../shared/eventa/index.ts')
    expect(stripComments(shared).replace(/\s+/g, ' ')).toContain(`export interface LiaBrainSendTerminalReport { correlationId: string outcome: 'succeeded' | 'failed' }`)
    for (const relative of ['../../../shared/eventa/index.ts', '../../../renderer/main.ts'])
      expect(readSource(relative), relative).not.toMatch(/sendTerminal|LiaBrainSendTerminalRecord/)
    expect(productionSourcesMatching(['packages/stage-ui/src', 'packages/core-agent/src'], /sendTerminal|LiaBrainSendTerminalRecord/)).toEqual([])
  })

  it('100: the composition entry changed ONLY by the send-terminal block', () => {
    const entry = stripComments(readSource('../../index.ts'))

    // The sibling blocks are byte-identical in shape: the same three producers,
    // the same registrations and the same counts as before this phase.
    expect(entry.match(/registerLiaBrainExecutionTerminalReportListener\(/g)).toHaveLength(1)
    expect(entry.match(/registerLiaBrainExecutionReportHandler\(/g)).toHaveLength(1)
    expect(entry.match(/registerLiaBrainDecisionBridge\(/g)).toHaveLength(1)
    expect(entry.match(/createLiaBrainExecutionTerminalReportService\(/g)).toHaveLength(1)
    expect(entry.match(/createContext\(ipcMain\)/g)).toHaveLength(9)
    // The send-terminal imports are the only new lia imports.
    expect(entry.match(/from '\.\/services\/lia\/brain-send-terminal-/g)).toHaveLength(2)
  })
})
