import type { LiaBrainAutomaticSelectionPolicy, LiaBrainRoutingDecision } from '@lia/core'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Phase 8.0D-7: the read-only Brain decision bridge.
 *
 * Real behavior throughout: the real `brainRequirementForChatTurn` maps the
 * facts, and the service is a spy double of the shape the lifecycle hands
 * over - so these tests prove the call contract, the untrusted-input handling
 * and the read-only boundary, while confirming nothing constructs a second
 * service or catalog and no production chat code calls the bridge.
 */

const channels = vi.hoisted(() => ({
  decision: { id: 'eventa:invoke:lia:brain:chat-decision' },
}))

const mocks = vi.hoisted(() => ({
  handlers: new Map<unknown, (...args: never[]) => unknown>(),
  requirementForChatTurn: vi.fn(),
  decide: vi.fn(),
}))

vi.mock('@moeru/eventa', () => ({
  defineInvokeHandler: (_context: unknown, channel: unknown, handler: (...args: never[]) => unknown) => {
    mocks.handlers.set(channel, handler)
  },
}))

vi.mock('../../../shared/eventa', () => ({
  electronLiaBrainChatDecision: channels.decision,
}))

vi.mock('@lia/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lia/core')>()
  // The real builder is the contract under test: spy-wrapped, not faked.
  mocks.requirementForChatTurn.mockImplementation(actual.brainRequirementForChatTurn)
  return {
    ...actual,
    brainRequirementForChatTurn: mocks.requirementForChatTurn,
  }
})

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** Code without comments - guards must only find the words in real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The first argument of every recorded `decide` call. */
function decideCalls(): { automaticPolicy?: LiaBrainAutomaticSelectionPolicy, requirement: { required: string[] } }[] {
  return (mocks.decide.mock.calls as unknown as [unknown][]).map(([argument]) => argument as never)
}

async function loadBridge(): Promise<(request?: unknown) => LiaBrainRoutingDecision> {
  mocks.handlers.clear()
  const { registerLiaBrainDecisionBridge } = await import('./brain-decision-service')
  registerLiaBrainDecisionBridge({ brain: { decide: mocks.decide as never }, context: {} as never })
  const handler = mocks.handlers.get(channels.decision)
  expect(handler).toBeTypeOf('function')
  return handler as (request?: unknown) => LiaBrainRoutingDecision
}

/** A decision the spy service returns, standing in for the real one. */
const SENTINEL: LiaBrainRoutingDecision = { resolution: { status: 'noPreference' }, status: 'manual' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lia brain decision bridge (8.0D-7)', () => {
  it('a: the shared contract exposes exactly one read-only Brain decision request', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    const brainChannels = shared.match(/define(?:Invoke)?Eventa<[^>]*>\('eventa:(?:invoke|event):lia:brain[^']*'\)/g) ?? []
    expect(brainChannels).toEqual([
      'defineInvokeEventa<LiaBrainChatDecision, LiaBrainChatDecisionRequest>(\'eventa:invoke:lia:brain:chat-decision\')',
    ])
    // No push channel and no second Brain seam anywhere in the contract.
    expect(shared).not.toMatch(/eventa:event:lia:brain/)
    expect(shared).not.toMatch(/electronLiaBrainChatDecisionSet|eventa:invoke:lia:brain:[a-z-]*(?:set|write|update)/)
  })

  it('b: the request carries chat turn facts and nothing else required', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    const contract = shared.slice(shared.indexOf('export interface LiaBrainChatDecisionRequest'))
    const body = contract.slice(0, contract.indexOf('}'))
    expect(body).toContain('facts: LiaBrainChatTurnFacts')
    expect(body).toContain('automaticPolicy?: LiaCoreBrainAutomaticSelectionPolicy')
    // Facts are the canonical Lia Core type, not a renderer copy.
    expect(shared).toContain('export type LiaBrainChatTurnFacts = LiaCoreChatTurnBrainFacts')
    expect(shared).toContain('export type LiaBrainChatDecision = LiaCoreBrainRoutingDecision')
  })

  it('c: the request cannot carry provider/model selection fields', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    const contract = shared.slice(shared.indexOf('export interface LiaBrainChatDecisionRequest'))
    const body = contract.slice(0, contract.indexOf('}'))
    for (const forbidden of ['providerId', 'engineId', 'modelId', 'apiKey', 'baseUrl', 'endpoint', 'options'])
      expect(body, forbidden).not.toContain(forbidden)
    // The bridge code never accepts or forwards provider-facing fields either
    // (comments aside). `engineId`/`modelId` DO appear there - a policy is
    // made of route references - but only as policy entries, never as any
    // provider identity the request could hand over.
    const source = stripComments(readSource('./brain-decision-service.ts'))
    expect(source).not.toMatch(/providerId|apiKey|baseUrl|endpoint|options/)
    const engineIdLines = source.split('\n').filter(line => line.includes('engineId'))
    for (const line of engineIdLines)
      expect(line).toMatch(/entry\.engineId|routes\.push\(\{ engineId/)
  })

  it('d: an explicit automaticPolicy passes through to the service unchanged', async () => {
    const handler = await loadBridge()
    mocks.decide.mockReturnValueOnce(SENTINEL)
    const policy = { routes: [{ engineId: 'engine-a', modelId: 'model-a' }] }

    const result = handler({ automaticPolicy: policy, facts: {} })

    expect(mocks.decide).toHaveBeenCalledTimes(1)
    const [call] = decideCalls()
    expect(call.automaticPolicy).toEqual(policy)
    expect(result).toBe(SENTINEL)
  })

  it('e: the handler calls the canonical brainRequirementForChatTurn with the turn facts', async () => {
    const handler = await loadBridge()
    mocks.decide.mockReturnValueOnce(SENTINEL)

    handler({ facts: { hasImageInput: true, usesTools: true } })

    expect(mocks.requirementForChatTurn).toHaveBeenCalledTimes(1)
    expect(mocks.requirementForChatTurn).toHaveBeenCalledWith({ hasImageInput: true, usesTools: true })
  })

  it('f/j/k/l/m: the EXACT resulting requirement reaches decide - baseline, image, tools, reasoning', async () => {
    const cases = [
      { facts: {}, expected: ['textInput', 'textOutput'] },
      { facts: { hasImageInput: true }, expected: ['textInput', 'imageInput', 'textOutput'] },
      { facts: { usesTools: true }, expected: ['textInput', 'textOutput', 'toolCalling'] },
      { facts: { reasoningRequested: true }, expected: ['textInput', 'textOutput', 'reasoning'] },
      { facts: { hasImageInput: true, reasoningRequested: true, usesTools: true }, expected: ['textInput', 'imageInput', 'textOutput', 'reasoning', 'toolCalling'] },
    ]
    for (const { facts, expected } of cases) {
      vi.clearAllMocks()
      mocks.decide.mockReturnValueOnce(SENTINEL)
      const handler = await loadBridge()
      handler({ facts })

      const [call] = decideCalls()
      expect(call.requirement, JSON.stringify(facts)).toEqual({ required: expected })
      // The very object the builder returned travelled - no re-derivation.
      expect(call.requirement).toBe(mocks.requirementForChatTurn.mock.results.at(-1)?.value)
      expect(call.automaticPolicy).toBeUndefined()
    }
  })

  it('g/h: the bridge constructs neither a service nor a catalog', () => {
    const source = readSource('./brain-decision-service.ts')
    expect(source).not.toMatch(/createLiaBrainService|createProductionBrainCatalog/)
    expect(source).not.toMatch(/groq|gpt-oss|brain\/adapters/)
    // The service arrives as a dependency (injected), never imported as a factory.
    expect(source).toContain('brain: Pick<LiaBrainService, \'decide\'>')
  })

  it('i: the handler returns the exact LiaBrainRoutingDecision, unflattened', async () => {
    const handler = await loadBridge()
    const ambiguous: LiaBrainRoutingDecision = { ref: { engineId: 'engine-a', modelId: 'model-a' }, status: 'ambiguous' }
    const automaticMissing: LiaBrainRoutingDecision = { status: 'automaticPolicyMissing' }

    mocks.decide.mockReturnValueOnce(ambiguous)
    expect(handler({ facts: {} })).toBe(ambiguous)
    mocks.decide.mockReturnValueOnce(automaticMissing)
    expect(handler({ facts: {} })).toBe(automaticMissing)
  })

  it('n/o: an absent policy stays absent, and automaticPolicyMissing passes through as data', async () => {
    const handler = await loadBridge()
    const missing: LiaBrainRoutingDecision = { status: 'automaticPolicyMissing' }
    mocks.decide.mockReturnValueOnce(missing)

    const result = handler({ facts: {} })

    const [call] = decideCalls()
    expect(call.automaticPolicy).toBeUndefined()
    expect(result).toEqual({ status: 'automaticPolicyMissing' })

    // A malformed policy degrades to absent rather than becoming a default.
    vi.clearAllMocks()
    mocks.decide.mockReturnValueOnce(missing)
    handler({ automaticPolicy: { routes: [{ engineId: 42 }] }, facts: {} })
    const [malformed] = decideCalls()
    expect(malformed.automaticPolicy).toBeUndefined()
  })

  it('untrusted input: foreign keys, callbacks and malformed facts never reach the routing stack', async () => {
    const handler = await loadBridge()
    mocks.decide.mockReturnValueOnce(SENTINEL)

    handler({
      // An attacker-style payload: identity, callbacks, paths, non-booleans.
      facts: {
        hasImageInput: 'yes',
        providerId: 'groq',
        reasoningRequested: 1,
        usesTools: () => true,
      },
      providerId: 'groq',
    })

    const [call] = decideCalls()
    // Only honest `true` facts count: everything else reads as "not needed".
    expect(call.requirement).toEqual({ required: ['textInput', 'textOutput'] })
    expect(call.automaticPolicy).toBeUndefined()
    expect(JSON.stringify(call)).not.toMatch(/groq/)
  })

  it('p: the handler performs no config write, network, provider or chat-state work', () => {
    const source = readSource('./brain-decision-service.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env|vault|apiKey|secret/i)
    expect(source).not.toMatch(/updateLiaProductConfig|brainRoutingModeUpdate|brainSelectionUpdate|readLiaProductConfig/)
    expect(source).not.toMatch(/registry\.register|createBrainEngineRegistry|decideBrainRoute|satisfiesBrainCapabilities/)
    // The only real work: map facts -> requirement -> decide -> return.
    expect(source.match(/brain\.decide\(/g)).toHaveLength(1)
  })

  it('q: the renderer-facing contract stays free of provider/model ids', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    const marker = shared.indexOf('Lia Brain chat decision (Phase 8.0D-7)')
    expect(marker).toBeGreaterThan(-1)
    const brainSection = shared.slice(marker, shared.indexOf('export { electron }', marker))
    expect(brainSection).not.toMatch(/groq|gpt-oss|qwen|anthropic|gemini|claude/i)
    // And the preload surface is untouched: it exposes generic Electron only.
    expect(readSource('../../../preload/shared.ts')).not.toMatch(/brain/i)
  })

  it('r/s: no production chat code calls the bridge, and the seam has zero callers', () => {
    const stageSrc = fileURLToPath(new URL('../../../', import.meta.url))
    const callers: string[] = []
    for (const entry of readdirSync(stageSrc, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const file = `${entry.parentPath}/${entry.name}`
      const relative = file.slice(stageSrc.length)
      // The bridge itself, its composition entry (legitimate owner) and the
      // shared contract (the definition site) are not callers.
      if (
        relative.startsWith('main/services/lia/brain-decision-service')
        || relative === 'main/index.ts'
        || relative === 'shared/eventa/index.ts'
      ) {
        continue
      }
      if (/registerLiaBrainDecisionBridge|electronLiaBrainChatDecision|LiaBrainChatDecisionRequest|LiaBrainChatDecision\b/.test(readFileSync(file, 'utf-8')))
        callers.push(relative)
    }
    expect(callers).toEqual([])

    // The chat execution files themselves carry no Brain reference.
    for (const relative of [
      '../../../../../../packages/stage-ui/src/stores/chat.ts',
      '../../../../../../packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
      '../../../renderer/components/InteractiveArea.vue',
    ]) {
      expect(readSource(relative), relative).not.toMatch(/liaBrain|brainDecision|electronLiaBrainChatDecision|LiaBrainService/)
    }
  })

  it('t: the lifecycle keeps owning exactly one service instance, reused by the bridge', () => {
    const entry = readSource('../../index.ts')
    // Still exactly one provider and one construction...
    expect(entry.match(/services:lia-brain/g)).toHaveLength(1)
    expect(entry.match(/createLiaBrainService\(/g)).toHaveLength(1)
    // ...and the bridge receives THAT instance through dependsOn.
    const wiring = entry.slice(entry.indexOf('read-only Brain decision bridge'))
    const invoke = wiring.slice(0, wiring.indexOf('\n  })'))
    expect(invoke).toContain('dependsOn: { liaBrain }')
    expect(invoke).toContain('registerLiaBrainDecisionBridge({ context, brain: deps.liaBrain })')
    expect(invoke).not.toMatch(/createLiaBrainService|createProductionBrainCatalog/)
  })
})
