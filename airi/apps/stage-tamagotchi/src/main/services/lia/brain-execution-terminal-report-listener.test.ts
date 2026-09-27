import type { LiaBrainChatDecisionRequest } from '../../../shared/eventa'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { registerLiaBrainDecisionBridge } from './brain-decision-service'
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

/** The exact production wiring of the THIRD channel: ONE service over ONE store. */
function wireTerminal(overrides: { store?: ReturnType<typeof createLiaBrainCorrelationService> } = {}) {
  const store = overrides.store ?? createLiaBrainCorrelationService()
  const context = fakeContext()
  const terminalReportService = createLiaBrainExecutionTerminalReportService({ correlationStore: store })
  registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })
  return { store, terminalReportService }
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
  const terminalReportService = createLiaBrainExecutionTerminalReportService({ correlationStore: store })
  // The terminal registration receives NO observer - the pinned asymmetry.
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
      terminalReportService: createLiaBrainExecutionTerminalReportService({ correlationStore: countingStore as never }),
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
      terminalReportService: createLiaBrainExecutionTerminalReportService({ correlationStore: countingStore as never }),
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
    // and NO diagnostic trigger from the terminal path.
    expect(store.get('X')!.executions).toEqual([])
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    expect(observed).toEqual([])

    // I: the normal start path for the SAME round then lands beside it...
    deliverExecution(executionReport('X', 'R'))
    expect(store.get('X')!.executions).toEqual([executionReport('X', 'R')])
    // ...the terminal fact is unchanged, and the START still triggers exactly
    // the observation it always did.
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'failed', roundId: 'R' }])
    expect(observed).toEqual(['X'])
  })

  it('j: start before terminal keeps both facts, and the terminal adds no observation', () => {
    const { observed, store } = wireFullComposition()

    deliverExecution(executionReport('X', 'R'))
    expect(observed).toEqual(['X'])

    deliverTerminal({ correlationId: 'X', outcome: 'succeeded', roundId: 'R' })

    expect(store.get('X')!.executions).toHaveLength(1)
    expect(store.get('X')!.executionTerminals).toEqual([{ outcome: 'succeeded', roundId: 'R' }])
    // The terminal write did NOT add a trigger.
    expect(observed).toEqual(['X'])
  })

  it('k: terminal and decision coexist in either order, with first-decision semantics intact', () => {
    // Terminal first.
    const terminalFirst = wireFullComposition()
    deliverTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })
    expect(terminalFirst.observed).toEqual([])
    const firstDecision = askDecision({ correlationId: 'X', facts: FACTS })
    expect(terminalFirst.store.get('X')!.decision).toBe(firstDecision)
    expect(terminalFirst.store.get('X')!.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'R' }])
    // The observation came from the DECISION path only.
    expect(terminalFirst.observed).toEqual(['X'])
    // First decision wins: a second shadow request never replaces it.
    askDecision({ correlationId: 'X', facts: FACTS })
    expect(terminalFirst.store.get('X')!.decision).toBe(firstDecision)
    expect(terminalFirst.store.get('X')!.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'R' }])

    // Decision first.
    mocks.listeners.clear()
    const decisionFirst = wireFullComposition()
    const firstDecisionAgain = askDecision({ correlationId: 'X', facts: FACTS })
    deliverTerminal({ correlationId: 'X', outcome: 'abandoned', roundId: 'R' })
    expect(decisionFirst.store.get('X')!.decision).toBe(firstDecisionAgain)
    expect(decisionFirst.store.get('X')!.executionTerminals).toEqual([{ outcome: 'abandoned', roundId: 'R' }])
    expect(decisionFirst.observed).toEqual(['X'])
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
      }),
    })

    expect(() => deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })).not.toThrow()
    expect(() => deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })).not.toThrow()
    expect(observed).toEqual([])
    expect(mocks.emitted).toEqual([])
  })

  it('n: the terminal path triggers the observer ZERO times, while the other two paths still do', () => {
    const { observed, store } = wireFullComposition()

    // One valid terminal event: no observation, even though the composition
    // holds the very observer the other producers use.
    deliverTerminal({ correlationId: 'X', outcome: 'failed', roundId: 'R' })
    expect(observed).toEqual([])
    expect(store.get('X')!.executionTerminals).toHaveLength(1)

    // Regression: the execution-start write still observes its key.
    deliverExecution(executionReport('Y', 'R'))
    expect(observed).toEqual(['Y'])

    // Regression: the decision write still observes its key.
    askDecision({ correlationId: 'Z', facts: FACTS })
    expect(observed).toEqual(['Y', 'Z'])

    // A terminal for an already-observed key adds nothing.
    deliverTerminal({ correlationId: 'Y', outcome: 'abandoned', roundId: 'R' })
    expect(observed).toEqual(['Y', 'Z'])
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
    expect(entryCode).toContain('const terminalReportService = createLiaBrainExecutionTerminalReportService({ correlationStore: deps.liaBrainCorrelation, })')
    expect(entryCode).toContain('registerLiaBrainExecutionTerminalReportListener({ context, terminalReportService })')

    // The terminal block receives NO observer: the pinned asymmetry.
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

  it('s: the three-channel Brain allowlist is unchanged and the fourth does not exist', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    expect(shared.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []).toEqual([
      'eventa:invoke:lia:brain:chat-decision',
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
    ])

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
