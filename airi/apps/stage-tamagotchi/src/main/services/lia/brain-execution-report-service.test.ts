import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerLiaBrainExecutionReportHandler, sanitizeLiaBrainExecutionObservationReport } from './brain-execution-report-service'

/**
 * Phase 8.0D-10B-4A: the trusted main handler for the Lia execution report.
 *
 * The handler is registered on an Eventa context double, so the tests call the
 * REAL listener with the REAL eventa envelope. The authority boundary these
 * tests pin: the report is sanitized, its logical-send key is required, and the
 * result is DISCARDED - no retention, no routing, no execution command.
 */

const channels = vi.hoisted(() => ({
  executionObservation: { id: 'eventa:event:lia:brain:execution-observation', type: 'event' },
  decision: { id: 'eventa:invoke:lia:brain:chat-decision' },
}))

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown, options?: unknown) => unknown>(),
  emitted: [] as unknown[],
  // Phase 8.0D-10B-4B3: the injected correlation store, observed through its
  // single write (recording is diagnostic; the handler keeps no state of its own).
  recordExecution: vi.fn(),
  // Phase 8.0D-10B-4C4C: the injected diagnostic observer, observed through its
  // single trigger (observing is diagnostic too).
  observe: vi.fn(),
}))

vi.mock('../../../shared/eventa', () => ({
  electronLiaBrainExecutionObservation: channels.executionObservation,
  electronLiaBrainChatDecision: channels.decision,
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

/** The canonical correlation store double the handler receives. */
function correlationStoreDouble(overrides: Partial<{ recordExecution: (report: unknown) => void }> = {}) {
  return { recordExecution: overrides.recordExecution ?? mocks.recordExecution } as never
}

/** The canonical diagnostic observer double the handler receives. */
function correlationObserverDouble(observe: (correlationId: string) => void = mocks.observe) {
  return { observe } as never
}

/** A context double that records the ONE listener the handler registers. */
function fakeContext() {
  return {
    on: (channel: { id: string }, handler: (payload: unknown, options?: unknown) => unknown) => {
      mocks.listeners.set(channel.id, handler)
      return () => {}
    },
    emit: (...args: unknown[]) => {
      mocks.emitted.push(args)
    },
  } as never as Parameters<typeof registerLiaBrainExecutionReportHandler>[0]['context']
}

/** Registers the handler with the canonical store + observer injected, as main does. */
function registerHandler(store: unknown = correlationStoreDouble(), observer: unknown = correlationObserverDouble()): void {
  registerLiaBrainExecutionReportHandler({ context: fakeContext(), correlationStore: store as never, correlationObserver: observer as never })
}

/** Deliver one report exactly as the renderer's one-way emit would. */
function deliver(report: unknown): unknown {
  const listener = mocks.listeners.get(channels.executionObservation.id)
  expect(listener, 'the report listener must be registered').toBeTypeOf('function')
  return listener!({ ...channels.executionObservation, body: report })
}

const VALID_REPORT = {
  correlationId: 'logical-send-X',
  conversationId: 'conversation-1',
  roundId: 'round-a',
  providerId: 'groq',
  modelId: 'openai/gpt-oss-120b',
}

beforeEach(() => {
  mocks.listeners.clear()
  mocks.emitted.length = 0
  mocks.recordExecution.mockClear()
  mocks.observe.mockClear()
})

describe('lia execution report handler (Phase 8.0D-10B-4A)', () => {
  it('r: the handler registers on the ONE report channel and accepts a valid report', () => {
    registerHandler()

    expect([...mocks.listeners.keys()]).toEqual([channels.executionObservation.id])
    // R: accepted - the listener completes without throwing and returns void.
    expect(deliver(VALID_REPORT)).toBeUndefined()
    // Y: no command, no reply, no second emission of any kind.
    expect(mocks.emitted).toEqual([])
  })

  it('s: malformed fields are sanitized by the tolerant convention', () => {
    // A non-record body is not a report at all.
    expect(sanitizeLiaBrainExecutionObservationReport(undefined)).toBeUndefined()
    expect(sanitizeLiaBrainExecutionObservationReport(null)).toBeUndefined()
    expect(sanitizeLiaBrainExecutionObservationReport('logical-send-X')).toBeUndefined()
    expect(sanitizeLiaBrainExecutionObservationReport([])).toBeUndefined()

    // Every field except the key may read as empty - never as a cast value.
    expect(sanitizeLiaBrainExecutionObservationReport({ correlationId: 'x' })).toEqual({
      correlationId: 'x',
      conversationId: '',
      roundId: '',
      providerId: '',
      modelId: '',
    })
    expect(sanitizeLiaBrainExecutionObservationReport({
      correlationId: 'x',
      conversationId: 7,
      roundId: { id: 'round-a' },
      providerId: ['groq'],
      modelId: null,
    })).toEqual({
      correlationId: 'x',
      conversationId: '',
      roundId: '',
      providerId: '',
      modelId: '',
    })

    // Unknown keys - a decision, a policy, a prompt, a credential, a callback -
    // are never looked at, so they cannot travel further.
    const sanitized = sanitizeLiaBrainExecutionObservationReport({
      ...VALID_REPORT,
      decision: { status: 'automatic' },
      automaticPolicy: { mode: 'automatic' },
      prompt: 'private text',
      apiKey: 'sk-secret',
      onReady: () => {},
    })
    expect(sanitized).toEqual(VALID_REPORT)
    expect(Object.keys(sanitized!).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
  })

  it('t: a missing or blank correlationId is not an actionable report', () => {
    expect(sanitizeLiaBrainExecutionObservationReport({ ...VALID_REPORT, correlationId: undefined })).toBeUndefined()
    expect(sanitizeLiaBrainExecutionObservationReport({ ...VALID_REPORT, correlationId: '' })).toBeUndefined()
    expect(sanitizeLiaBrainExecutionObservationReport({ ...VALID_REPORT, correlationId: 42 })).toBeUndefined()
    expect(sanitizeLiaBrainExecutionObservationReport({ ...VALID_REPORT, correlationId: null })).toBeUndefined()

    // Delivering one changes nothing at all: no throw, no state, no emission.
    registerHandler()
    expect(deliver({ ...VALID_REPORT, correlationId: '' })).toBeUndefined()
    expect(deliver({ correlationId: 'x'.repeat(4096), conversationId: 'c', roundId: 'r', providerId: 'p', modelId: 'm' })).toBeUndefined()
    expect(mocks.emitted).toEqual([])
  })

  it('t2: the handler keeps no memory - the same key is not special on a second report', () => {
    registerHandler()

    // Identical reports, twice, plus a report with a repeated key: nothing is
    // deduplicated, latched, counted or remembered.
    deliver(VALID_REPORT)
    deliver(VALID_REPORT)
    deliver({ ...VALID_REPORT, roundId: 'round-b' })
    expect([...mocks.listeners.keys()]).toEqual([channels.executionObservation.id])
    expect(mocks.emitted).toEqual([])
  })

  it('k/l/m/o: a valid report is recorded once, sanitized to exactly five fields', () => {
    registerHandler()

    // O first: malformed non-correlation fields follow the established
    // tolerance (non-strings read as empty, unknown keys are never read).
    deliver(VALID_REPORT)

    // K: exactly one diagnostic write for one report.
    expect(mocks.recordExecution).toHaveBeenCalledTimes(1)
    const [recorded] = mocks.recordExecution.mock.calls[0] as [Record<string, unknown>]
    // L: the exact sanitized five-field object.
    expect(recorded).toEqual(VALID_REPORT)
    // M: nothing else travels with it.
    expect(Object.keys(recorded).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
  })

  it('o2: unknown/hostile input fields are absent from the recorded object', () => {
    registerHandler()

    deliver({
      ...VALID_REPORT,
      conversationId: 7,
      roundId: null,
      providerId: ['groq'],
      modelId: { id: 'x' },
      prompt: 'private text',
      apiKey: 'sk-secret',
      baseURL: 'https://example.invalid/',
      decision: { status: 'automatic' },
      onReady: () => {},
    })

    const [recorded] = mocks.recordExecution.mock.calls[0] as [Record<string, unknown>]
    expect(recorded).toEqual({
      correlationId: 'logical-send-X',
      conversationId: '',
      roundId: '',
      providerId: '',
      modelId: '',
    })
    expect(JSON.stringify(recorded)).not.toContain('private text')
    expect(JSON.stringify(recorded)).not.toContain('sk-secret')
    expect(JSON.stringify(recorded)).not.toContain('example.invalid')
  })

  it('n: a missing, blank or non-string correlationId records nothing', () => {
    registerHandler()

    for (const correlationId of [undefined, '', 42, null, {}, []])
      deliver({ ...VALID_REPORT, correlationId })

    expect(mocks.recordExecution).not.toHaveBeenCalled()
  })

  it('p/q/r: a throwing store is isolated, and the handler still emits nothing', () => {
    registerHandler(correlationStoreDouble({
      recordExecution: () => {
        throw new Error('diagnostic memory is gone')
      },
    }))

    // P: no exception escapes the one-way handler.
    expect(() => deliver(VALID_REPORT)).not.toThrow()
    // Q: no reply, no command, no second emission.
    expect(mocks.emitted).toEqual([])
    // And the handler remains repeatable after a failure.
    expect(() => deliver({ ...VALID_REPORT, roundId: 'round-b' })).not.toThrow()

    // R: no Brain decision, policy or config surface exists in the handler.
    const source = stripComments(readSource('./brain-execution-report-service.ts'))
    expect(source).not.toMatch(/decide\(|LiaBrainService|automaticPolicy|brainRequirement|liaProductConfig|LiaBrainChatDecision/)
  })

  it('u/v/w/x: the handler has no service, no decision, no config and no storage surface', () => {
    const source = stripComments(readSource('./brain-execution-report-service.ts'))

    // U/V: no Brain service and no routing decision of any kind.
    expect(source).not.toMatch(/LiaBrainService|lia-brain-service|\.decide\(|decideBrainRoute|brainRequirementForChatTurn/)
    expect(source).not.toMatch(/@lia\/core|createProductionBrainAutomaticPolicy|LiaBrainChatDecision|electronLiaBrainChatDecision/)
    // W: no product config read or write.
    expect(source).not.toMatch(/LiaProductConfig|liaProductConfig|updateLiaProductConfig|readLiaProductConfig|useProviderStore|provider-config/)
    // X: no retention and no storage.
    expect(source).not.toMatch(/\bnew Map\b|\bnew Set\b|localStorage|sessionStorage|lastExecution|pendingExecution|history|\bcache\b|TTL|writeFile|readFile/)
    // No execution authority and no comparison, no external capability at all.
    expect(source).not.toMatch(/fallback|retry|selectProvider|setProvider|permission|\bmatch\b|mismatch|divergence|compare/)
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)

    // The registration takes the context and nothing else - there is no
    // dependency through which execution could be touched.
    // The registration signature gained exactly TWO dependencies - the canonical
    // correlation store the lifecycle injects (8.0D-10B-4B3) and the canonical
    // diagnostic observer of the same lifecycle (8.0D-10B-4C4C).
    expect(source).toMatch(/export function registerLiaBrainExecutionReportHandler\(params: \{\s*context: MainContext\s*correlationStore: LiaBrainCorrelationService\s*correlationObserver: LiaBrainCorrelationObserver\s*\}\): void/)
    expect(source.match(/context\.on\(/g)).toHaveLength(1)
  })

  it('z: untrusted provider/model claims cannot change routing behavior', async () => {
    const { registerLiaBrainDecisionBridge } = await import('./brain-decision-service')

    // The REAL decision bridge, over a spy service, registered next to the
    // report handler on the same context double.
    const decide = vi.fn(() => ({ status: 'modeUnspecified' }))
    const context = fakeContext()
    registerLiaBrainExecutionReportHandler({ context, correlationStore: correlationStoreDouble(), correlationObserver: correlationObserverDouble() })
    registerLiaBrainDecisionBridge({ context, brain: { decide } as never, correlationStore: correlationStoreDouble(), correlationObserver: correlationObserverDouble() })

    const askDecision = () => (mocks.listeners.get(channels.decision.id)!)({
      facts: { hasImageInput: false, reasoningRequested: false, usesTools: false },
      correlationId: 'logical-send-X',
    })

    const before = askDecision()
    decide.mockClear()

    // Hostile execution claims: a route identity, a policy blob, a preference.
    deliver({
      correlationId: 'logical-send-X',
      conversationId: 'conversation-1',
      roundId: 'round-a',
      providerId: 'engineId=openai;modelId=gpt-5.4;mode=manual',
      modelId: 'groq',
    })
    deliver({ correlationId: 'logical-send-X', conversationId: '', roundId: '', providerId: '__proto__', modelId: 'constructor' })

    // The decision bridge answers exactly as before, with the same requirement,
    // and the report handler consumed nothing.
    const after = askDecision()
    expect(after).toEqual(before)
    expect(decide).toHaveBeenCalledTimes(1)

    // And the report channel itself only ever carried an inert projection.
    expect(sanitizeLiaBrainExecutionObservationReport({
      correlationId: 'logical-send-X',
      conversationId: 'conversation-1',
      roundId: 'round-a',
      providerId: 'engineId=openai;modelId=gpt-5.4;mode=manual',
      modelId: 'groq',
    })?.providerId).toBe('engineId=openai;modelId=gpt-5.4;mode=manual')
    expect(mocks.emitted).toEqual([])
  })
})

describe('lia execution report invariants (Phase 8.0D-10B-4A)', () => {
  it('one production handler site, wired by the composition entry, and no second Brain seam', () => {
    const stageSrc = fileURLToPath(new URL('../../../', import.meta.url))

    const registrarFiles: string[] = []
    const handlerFiles: string[] = []
    for (const entry of readdirSync(stageSrc, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const file = `${entry.parentPath}/${entry.name}`
      const source = readFileSync(file, 'utf-8')
      const relative = file.slice(stageSrc.length)
      // The registration SIGNAL: calling the registrar, never defining it.
      if (/(?<!function )registerLiaBrainExecutionReportHandler\(/.test(source))
        registrarFiles.push(relative)
      if (/context\.on\(electronLiaBrainExecutionObservation/.test(source))
        handlerFiles.push(relative)
    }

    expect(registrarFiles).toEqual(['main/index.ts'])
    expect(handlerFiles).toEqual(['main/services/lia/brain-execution-report-service.ts'])

    // The composition entry registers it once, with no dependency on the Brain
    // service or on product config.
    const entry = stripComments(readSource('../../index.ts'))
    // 8.0D-10B-4B3: the same registration also receives the lifecycle-owned
    // correlation store - still exactly one registration site.
    // 8.0D-10B-4C4C: the same registration now also receives the lifecycle-owned
    // observer - still exactly one registration site, whitespace-normalized.
    const entryCode = entry.replace(/\s+/g, ' ')
    expect(entryCode.match(/registerLiaBrainExecutionReportHandler\(\{ context, correlationStore: deps\.liaBrainCorrelation, correlationObserver: deps\.liaBrainCorrelationObserver, \}\)/g)).toHaveLength(1)
  })

  it('the Brain channel allowlist is exactly the decision invoke plus the one-way report', () => {
    const shared = readSource('../../../shared/eventa/index.ts')

    // Exactly two Brain-related channels exist, and each has the right shape:
    // one invoke for the read-only decision, one one-way event for the report.
    expect(shared.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []).toEqual([
      'eventa:invoke:lia:brain:chat-decision',
      'eventa:event:lia:brain:execution-observation',
    ])
    expect(shared).toMatch(/export const electronLiaBrainExecutionObservation = defineEventa<LiaBrainExecutionObservationReport>\('eventa:event:lia:brain:execution-observation'\)/)
    // No setter, command, selector, policy or comparison channel was added.
    expect(shared).not.toMatch(/eventa:(?:invoke|event):lia:brain:[a-z-]*(?:set|write|update|command|select|policy|compare|result|match)/)

    // The report payload is the five identities - nothing else travels.
    const reportInterface = shared.slice(shared.indexOf('export interface LiaBrainExecutionObservationReport'), shared.indexOf('export const electronLiaBrainExecutionObservation'))
    expect(reportInterface.match(/^\s{2}(\w+):\s*string$/gm)?.map(field => field.trim()))
      .toEqual(['correlationId: string', 'conversationId: string', 'roundId: string', 'providerId: string', 'modelId: string'])

    // And the whole production tree names no other Lia Brain channel.
    const tags = new Set<string>()
    for (const relative of productionSources(['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src', 'packages/core-agent/src'])) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
  })

  it('the report path stays renderer-execution-only: no decision, no retention, no comparison', () => {
    // The handler is NOT reachable from the decision bridge, and the bridge is
    // NOT reachable from the report handler.
    const handler = stripComments(readSource('./brain-execution-report-service.ts'))
    const bridge = stripComments(readSource('./brain-decision-service.ts'))
    expect(handler).not.toMatch(/brain-decision-service|brain-shadow/)
    expect(bridge).not.toMatch(/brain-execution-report-service|execution-observation/)

    // The reporter is the only production emitter, and it names no decision.
    expect(productionSourcesMatching(
      ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src'],
      /electronLiaBrainExecutionObservation/,
    )).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      'apps/stage-tamagotchi/src/renderer/services/lia/execution-reporter.ts',
      'apps/stage-tamagotchi/src/shared/eventa/index.ts',
    ].sort())

    // NO COMPARISON YET: no production module joins a decision to an execution
    // identity, and there is no match/mismatch/divergence/comparison surface.
    // (Unrelated pre-existing words like an asset-cookie MISMATCH are not part
    // of this surface, so the guard names the forbidden JOIN, not the word.)
    const comparisonPattern = /executionMatches|matchesExecution|decisionVsExecution|executionVsDecision|comparisonState|pendingComparison|compareBrain|brainVsExecution|liaBrainComparison|executionObservationMatches|brainDecisionComparison/i
    expect(productionSourcesMatching(
      ['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src', 'packages/core-agent/src'],
      comparisonPattern,
    )).toEqual([])

    // Neither module of the report path can express `if (brain.x === execution.y)`:
    // the reporter knows no decision at all and the handler knows no Brain entry
    // point, so the two identities never meet in one scope.
    expect(reporterMentionsDecision()).toBe(false)

    function reporterMentionsDecision(): boolean {
      return /LiaBrainChatDecision|electronLiaBrainChatDecision|automaticPolicy|engineId|route/i.test(
        readFileSync(new URL('../../../renderer/services/lia/execution-reporter.ts', import.meta.url), 'utf-8'),
      )
    }
  })

  it('regression: stage-ui and core-agent stay Brain-blind, the execution carrier is untouched', () => {
    const brainIpcPattern = /electronLiaBrain|LiaBrainExecutionObservation|execution-observation|LiaBrainChatDecision|brain-shadow|observeLiaBrainDecisionForChatTurn/
    expect(productionSourcesMatching(['packages/stage-ui/src'], brainIpcPattern)).toEqual([])
    expect(productionSourcesMatching(['packages/core-agent/src'], brainIpcPattern)).toEqual([])

    // The execution carrier from 3B1/3B2 is unchanged: the report only READS
    // the observation, which still carries the same fields.
    const runtime = stripComments(readSource('../../../../../../packages/stage-ui/src/stores/chat/chat-provider-runtime.ts'))
    expect(runtime).toMatch(/export interface ChatRequestStartedObservation/)
    for (const field of ['correlationId?: string', 'conversationId: string', 'roundId: string', 'providerId: string', 'modelId: string'])
      expect(runtime).toContain(field)

    // The renderer emitter copies the five fields and nothing else.
    const reporter = stripComments(readSource('../../../renderer/services/lia/execution-reporter.ts'))
    expect(reporter.match(/observation\.\w+/g)).toEqual([
      'observation.conversationId',
      'observation.roundId',
      'observation.providerId',
      'observation.modelId',
    ])
  })
})

describe('lia execution report handler - dual trigger (Phase 8.0D-10B-4C4C)', () => {
  it('l/m/n: an accepted report is recorded once and then observed once, with its exact key', () => {
    const order: string[] = []
    mocks.recordExecution.mockImplementationOnce(() => {
      order.push('recordExecution')
    })
    mocks.observe.mockImplementationOnce(() => {
      order.push('observe')
    })
    registerHandler()

    deliver(VALID_REPORT)

    // L: exactly one diagnostic write and one observation per accepted report.
    expect(mocks.recordExecution).toHaveBeenCalledTimes(1)
    expect(mocks.observe).toHaveBeenCalledTimes(1)
    // M: the observation receives the sanitized report's own key - the exact
    // string, forwarded verbatim.
    expect(mocks.observe).toHaveBeenCalledWith('logical-send-X')
    expect((mocks.observe.mock.calls[0] as unknown[])[0]).toBe((mocks.recordExecution.mock.calls[0] as [{ correlationId: string }])[0].correlationId)
    // N: the write completes BEFORE the observation.
    expect(order).toEqual(['recordExecution', 'observe'])
  })

  it('o: an unusable report records nothing and observes nothing', () => {
    registerHandler()

    for (const report of [undefined, null, {}, { ...VALID_REPORT, correlationId: '' }, { ...VALID_REPORT, correlationId: 42 }])
      deliver(report)

    expect(mocks.recordExecution).not.toHaveBeenCalled()
    expect(mocks.observe).not.toHaveBeenCalled()
  })

  it('p: a report that cannot be recorded is never observed', () => {
    registerHandler(correlationStoreDouble({
      recordExecution: () => {
        throw new Error('diagnostic memory is gone')
      },
    }))

    expect(() => deliver(VALID_REPORT)).not.toThrow()
    // P: the failed write did not reach the trigger - no synthetic observation,
    // no retry.
    expect(mocks.observe).not.toHaveBeenCalled()
  })

  it('q: a hostile observer cannot escape the one-way handler', () => {
    registerHandler(correlationStoreDouble(), correlationObserverDouble(() => {
      throw new Error('hostile observer')
    }))

    // Q: the write happened, the observer threw, and the handler stays silent -
    // no exception into chat execution and nothing emitted back.
    expect(() => deliver(VALID_REPORT)).not.toThrow()
    expect(mocks.recordExecution).toHaveBeenCalledTimes(1)
    expect(mocks.emitted).toEqual([])
    // The handler remains repeatable after a hostile observation.
    expect(() => deliver({ ...VALID_REPORT, roundId: 'round-b' })).not.toThrow()
    expect(mocks.emitted).toEqual([])
  })

  it('r/s: extra fields still never reach the stored report, and nothing is emitted', () => {
    registerHandler()

    // R: only the five contract fields are recorded, whichever extra renderer
    // fields arrived...
    deliver({ ...VALID_REPORT, text: 'private prompt', apiKey: 'sk-secret', execution: { providerId: 'anthropic' } })

    const stored = (mocks.recordExecution.mock.calls[0] as [Record<string, unknown>])[0]
    expect(Object.keys(stored).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
    // ...and the observation is keyed by the SANITIZED report only.
    expect(mocks.observe).toHaveBeenCalledWith('logical-send-X')
    // S: the handler produces no response, command or emission of any kind.
    expect(mocks.emitted).toEqual([])
  })

  it('t: the handler knows only observe(correlationId) - no reader, no mapping, no facts', () => {
    const source = stripComments(readSource('./brain-execution-report-service.ts'))

    // Type-only coupling: the contract arrives as a type, never as a factory,
    // a reader, a mapping or a facts module.
    expect(source).toContain(`import type { LiaBrainCorrelationObserver } from './brain-correlation-observer'`)
    expect(source).not.toMatch(/createLiaBrainCorrelationObserver|brain-correlation-reader|readLiaBrainExecutionIdentityFacts|brain-expected-route|LIA_BRAIN_ENGINE_PROVIDER_MAPPING|brain-execution-identity-facts|providerIdentityEqual|modelIdentityEqual/)

    // Exactly ONE trigger, as a bare statement with the report's OWN key - the
    // void return is never assigned, awaited, inspected or branched on.
    expect(source.match(/correlationObserver\.\w+/g)).toEqual(['correlationObserver.observe'])
    expect(source).toMatch(/^\s*correlationObserver\.observe\(report\.correlationId\)$/m)
    expect(source).not.toMatch(/=\s*correlationObserver|await correlationObserver/)

    // Synchronous, same-tick, no queue and no second memory.
    expect(source).not.toMatch(/async |await |Promise|queueMicrotask|setTimeout|setInterval|requestAnimationFrame/)
    expect(source).not.toMatch(/\bnew Map\b|\bnew Set\b|pending|dedupe|retry|triggerQueue|lastObserved/i)
  })
})
