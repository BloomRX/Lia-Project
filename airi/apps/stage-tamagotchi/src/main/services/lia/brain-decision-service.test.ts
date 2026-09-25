import type { LiaBrainRoutingDecision } from '@lia/core'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainService } from './lia-brain-service'

/**
 * Phase 8.0D-7, corrected by 8.0D-7A: the read-only Brain decision bridge.
 *
 * Real behavior throughout. The requirement builder is a spy-wrapped copy of
 * the real implementation and the service is either a spy double (call
 * contract) or the REAL Stage service built over a real product snapshot
 * (end-to-end outcome proofs). The tests pin the authority boundary: renderer
 * input reaches capability REQUIREMENTS only, never route identity or policy.
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

/** The shared contract's Brain section, comments included. */
function brainSection(): string {
  const shared = readSource('../../../shared/eventa/index.ts')
  const marker = shared.indexOf('Lia Brain chat decision')
  expect(marker).toBeGreaterThan(-1)
  return shared.slice(marker, shared.indexOf('export { electron }', marker))
}

/** The declared body of the request interface. */
function requestContract(): string {
  const section = brainSection()
  const declaration = section.slice(section.indexOf('export interface LiaBrainChatDecisionRequest'))
  return declaration.slice(0, declaration.indexOf('}'))
}

/** The first argument of every recorded `decide` call. */
interface DecideInput { automaticPolicy?: unknown, requirement: { required: string[] } }

function decideCalls(): DecideInput[] {
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

/** A config owner shaped like the canonical Stage product config provider. */
function configOwner(snapshot: unknown) {
  return { get: () => snapshot as never }
}

/** A decision the spy service returns, standing in for the real one. */
const SENTINEL: LiaBrainRoutingDecision = { resolution: { status: 'noPreference' }, status: 'manual' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lia brain decision bridge (Phase 8.0D-7A)', () => {
  it('a/b/c: the request contract is facts and nothing else', () => {
    const body = requestContract()

    // A: the turn facts are the request.
    expect(body).toContain('facts: LiaBrainChatTurnFacts')
    // B: no policy ownership crosses the renderer boundary...
    expect(body).not.toContain('automaticPolicy')
    expect(body).not.toMatch(/routes|policy/i)
    // C: ...and no route identity either.
    for (const forbidden of ['engineId', 'modelId', 'providerId', 'apiKey', 'baseUrl', 'endpoint', 'options'])
      expect(body, forbidden).not.toContain(forbidden)

    // The request type cannot even name a policy type or a route ref.
    const section = brainSection()
    expect(section).not.toMatch(/LiaCoreBrainAutomaticSelectionPolicy|LiaBrainAutomaticSelectionPolicy|LiaBrainRouteRef/)
    // Exactly ONE field is declared, and it is the turn facts.
    const fields = body.slice(body.indexOf('{') + 1).split('\n').map(line => line.trim()).filter(Boolean)
    expect(fields).toEqual(['facts: LiaBrainChatTurnFacts'])
    // `automaticPolicyMissing` still appears - as an honest DECISION outcome.
    expect(section).toContain('automaticPolicyMissing')
  })

  it('d/e: malformed and extra renderer keys are ignored, only canonical booleans count', async () => {
    const cases: [unknown, string[]][] = [
      [{}, ['textInput', 'textOutput']],
      // D: unknown/foreign keys - policy blobs, identity, callbacks, paths.
      [{
        automaticPolicy: { routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }] },
        engineId: 'groq',
        facts: { hasImageInput: 'yes', nested: { usesTools: true }, providerId: 'groq' },
        modelId: 'openai/gpt-oss-120b',
        providerId: 'groq',
        routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }],
      }, ['textInput', 'textOutput']],
      // E: only explicit, canonical booleans turn a fact on.
      [{ facts: { hasImageInput: 1, reasoningRequested: 'true', usesTools: null } }, ['textInput', 'textOutput']],
      [{ facts: { hasImageInput: true, reasoningRequested: true, usesTools: true } }, ['textInput', 'imageInput', 'textOutput', 'reasoning', 'toolCalling']],
      [{ facts: { hasImageInput: false, reasoningRequested: false, usesTools: false } }, ['textInput', 'textOutput']],
      // A request shape from the previous phase is not honoured either.
      [{ automaticPolicy: { routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }] }, facts: {} }, ['textInput', 'textOutput']],
    ]

    for (const [request, expected] of cases) {
      vi.clearAllMocks()
      mocks.decide.mockReturnValueOnce(SENTINEL)
      const current = await loadBridge()
      current(request)

      const [call] = decideCalls()
      expect(call.requirement, JSON.stringify(request)).toEqual({ required: expected })
      // H: nothing policy-shaped was forwarded, in any shape.
      expect('automaticPolicy' in call).toBe(false)
      expect(JSON.stringify(call)).not.toMatch(/automaticPolicy|routes|groq|engineId/)
    }
  })

  it('f/g: sanitized facts feed the canonical builder, whose exact requirement reaches decide', async () => {
    const handler = await loadBridge()
    mocks.decide.mockReturnValueOnce(SENTINEL)

    handler({ facts: { hasImageInput: true, junk: 'x', usesTools: true } })

    // F: the builder receives ONLY the sanitized facts, rebuilt fresh.
    expect(mocks.requirementForChatTurn).toHaveBeenCalledTimes(1)
    expect(mocks.requirementForChatTurn).toHaveBeenCalledWith({ hasImageInput: true, usesTools: true })
    const [factsArg] = mocks.requirementForChatTurn.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(factsArg).sort()).toEqual(['hasImageInput', 'usesTools'])
    // G: the very object the builder returned travelled - no re-derivation.
    const [call] = decideCalls()
    expect(call.requirement).toBe(mocks.requirementForChatTurn.mock.results.at(-1)?.value)
    expect(call.requirement).toEqual({ required: ['textInput', 'imageInput', 'textOutput', 'toolCalling'] })
  })

  it('g: every canonical requirement shape survives the bridge unchanged', async () => {
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
    }
  })

  it('h: decide is called with the requirement field and nothing else', async () => {
    const handler = await loadBridge()
    mocks.decide.mockReturnValueOnce(SENTINEL)

    handler({ facts: { reasoningRequested: true } })

    expect(mocks.decide).toHaveBeenCalledTimes(1)
    const [call] = decideCalls()
    expect(Object.keys(call)).toEqual(['requirement'])
    expect(call.automaticPolicy).toBeUndefined()
    expect('automaticPolicy' in call).toBe(false)
  })

  it('i: automatic mode without a trusted policy reports automaticPolicyMissing - the real service path', async () => {
    // The REAL Stage service over a real snapshot in automatic mode. The
    // bridge cannot supply a policy, so no route may be invented.
    const service = createLiaBrainService({ liaProductConfig: configOwner({ brain: { mode: 'automatic' } }) })
    mocks.handlers.clear()
    const { registerLiaBrainDecisionBridge } = await import('./brain-decision-service')
    registerLiaBrainDecisionBridge({ brain: service, context: {} as never })
    const handler = mocks.handlers.get(channels.decision) as (request?: unknown) => LiaBrainRoutingDecision

    expect(handler({ facts: {} })).toEqual({ status: 'automaticPolicyMissing' })
    // Same answer with the richest requirement facts: capability needs never
    // become route precedence.
    expect(handler({ facts: { hasImageInput: true, reasoningRequested: true, usesTools: true } }))
      .toEqual({ status: 'automaticPolicyMissing' })
    // And a renderer-supplied pseudo-policy changes NOTHING (ignored key).
    expect(handler({ automaticPolicy: { routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }] }, facts: {} }))
      .toEqual({ status: 'automaticPolicyMissing' })
  })

  it('i/j: canonical decisions pass through unchanged, response type unmapped', async () => {
    const handler = await loadBridge()
    const decisions: LiaBrainRoutingDecision[] = [
      { status: 'automaticPolicyMissing' },
      { resolution: { status: 'noPreference' }, status: 'manual' },
      { ref: { engineId: 'engine-a', modelId: 'model-a' }, status: 'ambiguous' },
      { status: 'noCandidates' },
      { status: 'disabled' },
    ]

    for (const decision of decisions) {
      mocks.decide.mockReturnValueOnce(decision)
      expect(handler({ facts: {} })).toBe(decision)
    }

    // J: the response is the canonical Lia Core type, not a renderer model.
    const shared = readSource('../../../shared/eventa/index.ts')
    expect(shared).toContain('export type LiaBrainChatDecision = LiaCoreBrainRoutingDecision')
    expect(brainSection()).not.toMatch(/interface LiaBrainChatDecision\b/)
    // I: the field name survives in the decision vocabulary only.
    expect(readSource('./brain-decision-service.ts')).not.toMatch(/flatten|adaptDecision|toRenderer/)
  })

  it('k/l: the bridge reuses the injected service and constructs none', () => {
    const source = stripComments(readSource('./brain-decision-service.ts'))
    // K: the service arrives as a dependency - the lifecycle owns the instance.
    expect(source).toContain('brain: Pick<LiaBrainService, \'decide\'>')
    expect(source).toMatch(/brain\.decide\(\{/)
    // L: no service, no catalog, no engine registry is built here.
    expect(source).not.toMatch(/createLiaBrainService|createProductionBrainCatalog|createBrainEngineRegistry/)
    // R: the lifecycle entry still wires the SAME instance in, unchanged.
    const entry = stripComments(readSource('../../index.ts'))
    expect(entry.match(/services:lia-brain/g)).toHaveLength(1)
    expect(entry.match(/createLiaBrainService\(/g)).toHaveLength(1)
    expect(entry).toContain('registerLiaBrainDecisionBridge({ context, brain: deps.liaBrain })')
  })

  it('m/n: the bridge knows no provider, no model and no route, and does no write', () => {
    const source = stripComments(readSource('./brain-decision-service.ts'))

    // M: no provider/model identity, no route handling, no policy plumbing.
    expect(source).not.toMatch(/groq|gpt-oss|qwen|anthropic|gemini|claude|openrouter/i)
    expect(source).not.toMatch(/readPolicy|sanitizePolicy|automaticPolicy|engineId|modelId|providerId|routes/)
    expect(source).not.toMatch(/brain\/adapters|LiaBrainAutomaticSelectionPolicy/)

    // N: read-only - no config write, no network, no SDK, no chat state.
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env|vault|apiKey|secret/i)
    expect(source).not.toMatch(/updateLiaProductConfig|brainRoutingModeUpdate|brainSelectionUpdate|readLiaProductConfig/)
    expect(source).not.toMatch(/registry\.register|decideBrainRoute|satisfiesBrainCapabilities|select/)
    // Exactly one service call per request: requirement -> decide -> return.
    expect(source.match(/brain\.decide\(/g)).toHaveLength(1)
  })

  it('o: the shared contract exposes exactly one Brain invoke channel and no setter', () => {
    const shared = readSource('../../../shared/eventa/index.ts')
    const brainChannels = shared.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []
    expect(brainChannels).toEqual(['eventa:invoke:lia:brain:chat-decision'])
    expect(shared).not.toMatch(/eventa:(?:invoke|event):lia:brain:[a-z-]*(?:set|write|update)/)
    expect(shared.match(/electronLiaBrainChatDecision\b/g)?.length).toBe(1)

    // The preload surface stays generic: no per-channel renderer exposure.
    expect(readSource('../../../preload/shared.ts')).not.toMatch(/brain/i)
    expect(readSource('../../../preload/index.ts')).not.toMatch(/brain/i)
  })

  it('p/q: no production chat code calls the bridge, and chat execution is untouched', async () => {
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

    // P/Q: the chat execution files carry no Brain reference at all - the
    // renderer never invokes the channel and the paths are untouched.
    for (const relative of [
      '../../../../../../packages/stage-ui/src/stores/chat.ts',
      '../../../../../../packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
      '../../../../../../packages/core-agent/src/runtime/llm-service.ts',
      '../../../renderer/components/InteractiveArea.vue',
    ]) {
      expect(readSource(relative), relative).not.toMatch(/liaBrain|brainDecision|electronLiaBrainChatDecision|brain:chat-decision/)
    }
  })
})
