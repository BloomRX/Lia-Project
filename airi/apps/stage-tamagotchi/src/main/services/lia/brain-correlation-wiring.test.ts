import type { LiaBrainChatDecisionRequest } from '../../../shared/eventa'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { registerLiaBrainDecisionBridge } from './brain-decision-service'
import { registerLiaBrainExecutionReportHandler } from './brain-execution-report-service'

/**
 * Phase 8.0D-10B-4B3: the production wiring of the two already-proven main-side
 * producers into ONE canonical correlation store.
 *
 * This is the integration proof: the REAL decision bridge and the REAL
 * execution report handler are registered through their real registration
 * seams, with the REAL correlation store (the service factory, production
 * bounds, injected clock) wired in exactly as `main/index.ts` wires it.
 *
 * What is asserted is factual presence and order only - no comparison, no
 * verdict, no interpretation of whether a decision and an execution agree.
 */

const channels = vi.hoisted(() => ({
  decision: { id: 'eventa:invoke:lia:brain:chat-decision' },
  executionObservation: { id: 'eventa:event:lia:brain:execution-observation', type: 'event' },
}))

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (payload: unknown, options?: unknown) => unknown>(),
  emitted: [] as unknown[],
  decisions: 0,
}))

vi.mock('../../../shared/eventa', () => ({
  electronLiaBrainChatDecision: channels.decision,
  electronLiaBrainExecutionObservation: channels.executionObservation,
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

/** A context double recording the handlers the two registration seams install. */
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
    decide: vi.fn((input: { requirement: unknown, automaticPolicy: unknown }) => {
      mocks.decisions += 1
      return {
        id: `decision-${mocks.decisions}`,
        mode: 'automatic',
        readiness: { status: 'ready' },
        requirement: input.requirement,
        selection: { engine: { id: 'groq' }, model: { id: 'openai/gpt-oss-120b' }, status: 'selected' },
        status: 'automatic',
      }
    }),
  }
}

const FACTS = { hasImageInput: false, reasoningRequested: true, usesTools: false }

/** The exact production wiring: both seams + ONE store. */
function wireProduction(overrides: { brain?: ReturnType<typeof brainDouble>, store?: ReturnType<typeof createLiaBrainCorrelationService> } = {}) {
  const brain = overrides.brain ?? brainDouble()
  const store = overrides.store ?? createLiaBrainCorrelationService()
  const context = fakeContext()
  registerLiaBrainDecisionBridge({ context, brain: brain as never, correlationStore: store })
  registerLiaBrainExecutionReportHandler({ context, correlationStore: store })
  return { brain, store }
}

/** Calls the decision bridge the way the renderer invoke would. */
function askDecision(request: Partial<LiaBrainChatDecisionRequest>) {
  const handler = mocks.listeners.get(channels.decision.id)
  expect(handler, 'decision bridge must be registered').toBeTypeOf('function')
  return handler!({ facts: FACTS, ...request }) as Record<string, unknown>
}

/** Delivers one execution report the way the renderer one-way emit would. */
function deliverReport(report: Record<string, unknown>) {
  const listener = mocks.listeners.get(channels.executionObservation.id)
  expect(listener, 'execution report handler must be registered').toBeTypeOf('function')
  listener!({ ...channels.executionObservation, body: report })
}

function report(correlationId: string, roundId: string, providerId = 'groq', modelId = 'openai/gpt-oss-120b') {
  return { correlationId, conversationId: 'conversation-1', roundId, providerId, modelId }
}

describe('lia brain correlation production wiring (Phase 8.0D-10B-4B3)', () => {
  it('s/y: both seams receive and use the SAME store instance, and no second store exists', () => {
    const { store } = wireProduction()

    // S: one decision + one report for the same key land in ONE entry, which is
    // only possible if both registrations share the injected store.
    askDecision({ correlationId: 'X' })
    deliverReport(report('X', 'A'))

    expect(store.size).toBe(1)
    expect(store.get('X')?.decision).toBeDefined()
    expect(store.get('X')?.executions).toHaveLength(1)

    // Y: a second, independent wiring (the shape of a second lifecycle) does not
    // touch the first store at all - no hidden third instance exists.
    const second = wireProduction()
    askDecision({ correlationId: 'Y' })
    deliverReport(report('Y', 'A'))
    expect(second.store.size).toBe(1)
    expect(store.size).toBe(1)
    expect(store.get('Y')).toBeUndefined()
  })

  it('t/u/v/w/x: the factual entry fills from both sides, in arrival order', () => {
    const { store } = wireProduction()

    const decision = askDecision({ correlationId: 'X' })
    // T: the shadow decision created the entry with the canonical decision.
    expect(store.size).toBe(1)
    expect(store.get('X')?.decision).toEqual(decision)

    // U: attempt A appends to the same entry.
    deliverReport(report('X', 'A'))
    expect(store.get('X')?.executions.map(execution => execution.roundId)).toEqual(['A'])

    // V: attempt B appends after A.
    deliverReport(report('X', 'B', 'anthropic', 'claude-x'))
    // W: the final factual snapshot holds the decision and both attempts.
    const snapshot = store.get('X')!
    expect(snapshot.decision).toEqual(decision)
    expect(snapshot.executions.map(execution => [execution.roundId, execution.providerId, execution.modelId])).toEqual([
      ['A', 'groq', 'openai/gpt-oss-120b'],
      ['B', 'anthropic', 'claude-x'],
    ])
    // X: arrival order is preserved - no sorting, no ranking.
    expect(snapshot.executions.map(execution => execution.roundId)).toEqual(['A', 'B'])
  })

  it('z/aa: both arrival orders converge on a complete factual entry', () => {
    // Z: decision first, then the attempt.
    const decisionFirst = wireProduction()
    askDecision({ correlationId: 'X' })
    deliverReport(report('X', 'A'))

    // AA: attempt first, then the decision.
    const executionFirst = wireProduction()
    deliverReport(report('Y', 'A'))
    deliverReport(report('Y', 'B'))
    askDecision({ correlationId: 'Y' })

    // Only factual presence is asserted - never whether the two sides agree.
    const x = decisionFirst.store.get('X')!
    const y = executionFirst.store.get('Y')!
    expect(x.decision).toBeDefined()
    expect(x.executions.map(execution => execution.roundId)).toEqual(['A'])
    expect(y.decision).toBeDefined()
    expect(y.executions.map(execution => execution.roundId)).toEqual(['A', 'B'])
    expect(x.executions.every(execution => execution.correlationId === 'X')).toBe(true)
    expect(y.executions.every(execution => execution.correlationId === 'Y')).toBe(true)
  })

  it('ab/ac/ad: first-decision-wins survives the production wiring', () => {
    const { store } = wireProduction()

    const first = askDecision({ correlationId: 'X' })
    deliverReport(report('X', 'A'))

    // AC: a second shadow decision with the SAME key does not replace the first.
    const second = askDecision({ correlationId: 'X' })
    expect(store.size).toBe(1)
    expect(store.get('X')?.decision).toEqual(first)
    expect(store.get('X')?.decision).not.toEqual(second)
    // AB: the retained decision is the FIRST one, and the bridge still answered
    // the renderer with its own canonical decision.
    expect(second).not.toEqual(first)
    // AD: the execution attempts already attached stayed intact.
    expect(store.get('X')?.executions.map(execution => execution.roundId)).toEqual(['A'])
  })

  it('ae/af/ag/ah: multi-attempt reports are all retained, verbatim and undeduplicated', () => {
    const { store } = wireProduction()

    deliverReport(report('X', 'A', 'groq', 'openai/gpt-oss-120b'))
    deliverReport(report('X', 'B', 'anthropic', 'claude-x'))
    // AH: the SAME attempt reported twice is kept twice - no dedupe by key.
    deliverReport(report('X', 'A', 'groq', 'openai/gpt-oss-120b'))

    const executions = store.get('X')!.executions
    expect(executions).toHaveLength(3)
    // AF: distinct rounds stay distinct (and the repeat keeps its own value).
    expect(executions.map(execution => execution.roundId)).toEqual(['A', 'B', 'A'])
    // AG: provider/model stay exactly as reported/sanitized.
    expect(executions.map(execution => [execution.providerId, execution.modelId])).toEqual([
      ['groq', 'openai/gpt-oss-120b'],
      ['anthropic', 'claude-x'],
      ['groq', 'openai/gpt-oss-120b'],
    ])
    // AE: nothing was lost on the way in.
    expect(new Set(executions.map(execution => execution.correlationId))).toEqual(new Set(['X']))
  })

  it('the wiring records nothing but the approved shapes', () => {
    const { store } = wireProduction()

    // A decision without a key: no entry, no synthesized key.
    askDecision({})
    expect(store.size).toBe(0)

    // A report with extra renderer fields: only the five contract fields are stored.
    deliverReport({ ...report('X', 'A'), text: 'private prompt', apiKey: 'sk-secret', baseURL: 'https://example.invalid/', decision: { status: 'manual' } })
    const entry = store.get('X')!
    expect(Object.keys(entry.executions[0]!).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
    expect(JSON.stringify(entry)).not.toContain('private prompt')
    expect(JSON.stringify(entry)).not.toContain('sk-secret')
    expect(JSON.stringify(entry)).not.toContain('example.invalid')
    expect(entry.decision).toBeUndefined()
    expect(store.size).toBe(1)
  })
})

describe('lia brain correlation wiring - diagnostics cannot affect the decision (Phase 8.0D-10B-4B3)', () => {
  it('a broken store cannot change what the renderer receives, nor cause a second decision', () => {
    const brain = brainDouble()
    const store = createLiaBrainCorrelationService()
    const hostileStore = {
      ...store,
      recordDecision: () => {
        throw new Error('diagnostic memory is gone')
      },
    }
    const context = fakeContext()
    registerLiaBrainDecisionBridge({ context, brain: brain as never, correlationStore: hostileStore as never })

    const answer = askDecision({ correlationId: 'X' })
    // The canonical decision still reaches the renderer, and `decide` ran once.
    expect(answer.status).toBe('automatic')
    expect(brain.decide).toHaveBeenCalledTimes(1)
    // No entry was recorded, and no error escaped.
    expect(store.size).toBe(0)
  })

  it('a broken store cannot break the one-way execution handler', () => {
    const store = createLiaBrainCorrelationService()
    const hostileStore = {
      ...store,
      recordExecution: () => {
        throw new Error('diagnostic memory is gone')
      },
    }
    const context = fakeContext()
    registerLiaBrainExecutionReportHandler({ context, correlationStore: hostileStore as never })

    expect(() => deliverReport(report('X', 'A'))).not.toThrow()
    expect(store.size).toBe(0)
    // The handler still emits nothing back.
    expect(mocks.emitted).toEqual([])
  })
})

describe('lia brain correlation wiring - invariants (Phase 8.0D-10B-4B3)', () => {
  const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']

  /** Production sources whose CODE (comments stripped) matches the pattern. */
  function matching(pattern: RegExp): string[] {
    return productionSources(BRAIN_ROOTS)
      .filter(relative => pattern.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()
  }

  it('ai/aj/ak/al/am: one creation site, one provider, and the handlers never build a store', () => {
    // AI: exactly ONE production creation site for the canonical service - the
    // lifecycle provider in the composition entry.
    expect(matching(/(?<!function )createLiaBrainCorrelationService\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/index.ts'])
    // ...and exactly one module creates the pure store: the canonical service.
    expect(matching(/(?<!function )createLiaBrainCorrelationStore\(/))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts'])
    // AL/AM: neither handler builds either one - not the service, not the store.
    for (const relative of [
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
    ]) {
      const source = stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))
      expect(source, relative).not.toMatch(/createLiaBrainCorrelationService\(|createLiaBrainCorrelationStore\(/)
    }
    // The composition entry owns the service call but never the store call.
    const composition = stripComments(readSource('../../index.ts'))
    expect(composition).toContain('createLiaBrainCorrelationService()')
    expect(composition).not.toMatch(/createLiaBrainCorrelationStore\(/)

    // AJ: exactly one lifecycle provider id owns it.
    const entry = stripComments(readSource('../../index.ts'))
    expect(entry.match(/services:lia-brain-correlation'/g)).toHaveLength(1)
    // AK: BOTH registrations receive that lifecycle handle explicitly.
    expect(entry).toMatch(/registerLiaBrainDecisionBridge\(\{[\s\S]*?correlationStore: deps\.liaBrainCorrelation/)
    expect(entry).toMatch(/registerLiaBrainExecutionReportHandler\(\{ context, correlationStore: deps\.liaBrainCorrelation \}\)/)
    expect(entry.match(/correlationStore: deps\.liaBrainCorrelation/g)).toHaveLength(2)

    // AN: no module-global correlation state.
    for (const relative of ['apps/stage-tamagotchi/src/main/index.ts', 'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts', 'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts']) {
      const source = stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))
      expect(source, relative).not.toMatch(/^(?:const|let|var) \w*[Cc]orrelation\w* = (?:new |create)/m)
      expect(source, relative).not.toMatch(/globalThis\.\w*[Cc]orrelation/)
    }
  })

  it('write-only guard: production correlation consumers write and never read', () => {
    // The store/service modules themselves are excluded from the consumer count:
    // they DEFINE the API, they are not consumers of it.
    const storeOwner = 'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts'
    const writers = matching(/recordDecision\(|recordExecution\(/).filter(relative => relative !== storeOwner)
    // Exactly the two producers write - nobody else in the whole tree.
    expect(writers).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
    ])

    // Each writes only its own side, and never reads.
    const bridge = stripComments(readSource('./brain-decision-service.ts'))
    expect(bridge.match(/correlationStore\.recordDecision\(/g)).toHaveLength(1)
    expect(bridge).not.toMatch(/correlationStore\.recordExecution|correlationStore\.get\(|correlationStore\.size/)
    const handler = stripComments(readSource('./brain-execution-report-service.ts'))
    expect(handler.match(/correlationStore\.recordExecution\(/g)).toHaveLength(1)
    expect(handler).not.toMatch(/correlationStore\.recordDecision|correlationStore\.get\(|correlationStore\.size/)

    // No production module reads the store: no `.get(`/`.size` on a correlation
    // handle anywhere except the store's own implementation and this test file.
    const readers = matching(/\w*[Cc]orrelation\w*\.(?:get\(|size\b)/)
    expect(readers).toEqual([])

    // The composition entry only injects/materializes.
    const entry = stripComments(readSource('../../index.ts'))
    for (const line of entry.split('\n').filter(line => line.includes('liaBrainCorrelation')))
      expect(line).not.toMatch(/recordDecision|recordExecution|\.get\(|\.size/)
  })

  it('no comparison logic, and the execution identities gain no authority', () => {
    // The forbidden surface is the JOIN of a decision and an execution identity
    // (and the verdict vocabulary that would come with it) - not pre-existing,
    // unrelated words such as an asset-cookie MISMATCH string.
    const comparisonPattern = /executionMatches|matchesExecution|decisionVsExecution|executionVsDecision|comparisonState|pendingComparison|compareBrain|brainVsExecution|liaBrainComparison|executionObservationMatches|brainDecisionComparison|decisionMatches|matchStatus|comparisonResult|diagnosticVerdict/i
    expect(matching(comparisonPattern)).toEqual([])
    // And nothing in the wired pair can even express a decision/execution
    // comparison: the bridge never touches executions, the handler never
    // touches a decision.
    expect(readSource('./brain-decision-service.ts')).not.toMatch(/executions\b|recordExecution/)
    expect(readSource('./brain-execution-report-service.ts')).not.toMatch(/recordDecision|decide\(/)

    // The execution claim never reaches the decision inputs: the bridge reads
    // facts + key only, and the handler only writes.
    const bridge = stripComments(readSource('./brain-decision-service.ts'))
    expect(bridge).not.toMatch(/executions?\b|recordExecution|providerId: |modelId: /)
    const handler = stripComments(readSource('./brain-execution-report-service.ts'))
    expect(handler).not.toMatch(/decide\(|automaticPolicy|brainRequirement|providerId ===|modelId ===/)

    // Provider-selection modules stay untouched by the wiring.
    for (const relative of [
      'packages/stage-ui/src/stores/chat.ts',
      'packages/stage-ui/src/stores/modules/consciousness.ts',
      'packages/stage-ui/src/stores/providers/provider.ts',
      'packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
      'packages/core-agent/src/runtime/llm-service.ts',
    ]) {
      expect(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')), relative)
        .not
        .toMatch(/LiaBrainCorrelation|correlationStore|brain-correlation/)
    }
  })

  it('the exact two-channel allowlist and the single observer registration are unchanged', () => {
    const tags = new Set<string>()
    for (const relative of productionSources(BRAIN_ROOTS)) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])

    expect(matching(/(?<!function )registerLiaBrainExecutionObserver\(/))
      .toEqual(['apps/stage-tamagotchi/src/renderer/main.ts'])
    expect(matching(/(?<!function )registerChatRequestStartedObserver\(/))
      .toEqual(['apps/stage-tamagotchi/src/renderer/services/lia/execution-reporter.ts'])
    expect(productionSources(['packages/stage-ui/src'])
      .filter(relative => /electronLiaBrain|LiaBrainChatDecision|brain-shadow|LiaBrainCorrelation/.test(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .toEqual([])
    expect(productionSources(['packages/core-agent/src'])
      .filter(relative => /electronLiaBrain|LiaBrainChatDecision|brain-shadow|LiaBrainCorrelation/.test(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .toEqual([])
  })
})
