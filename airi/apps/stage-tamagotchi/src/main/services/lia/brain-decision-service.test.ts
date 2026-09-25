import type { LiaBrainAutomaticSelectionPolicy, LiaBrainRoutingDecision } from '@lia/core'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainService } from './lia-brain-service'

/**
 * Phases 8.0D-7/7A/8: the read-only Brain decision bridge.
 *
 * Real behavior throughout. The Lia Core entry points are spy-wrapped copies
 * of the real implementations (so the trusted policy content is the REAL
 * product policy) and the service is either a spy double (call contract) or
 * the REAL Stage service over real product snapshots (outcome proofs).
 *
 * The authority boundary these tests pin:
 *   renderer -> requirements ONLY
 *   trusted product/main layer -> the automatic policy
 *   canonical router -> the decision
 */

const channels = vi.hoisted(() => ({
  decision: { id: 'eventa:invoke:lia:brain:chat-decision' },
}))

const mocks = vi.hoisted(() => ({
  handlers: new Map<unknown, (...args: never[]) => unknown>(),
  requirementForChatTurn: vi.fn(),
  automaticPolicy: vi.fn(),
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
  // The real implementations are the contract under test: spy-wrapped, not faked.
  mocks.requirementForChatTurn.mockImplementation(actual.brainRequirementForChatTurn)
  mocks.automaticPolicy.mockImplementation(actual.createProductionBrainAutomaticPolicy)
  return {
    ...actual,
    brainRequirementForChatTurn: mocks.requirementForChatTurn,
    createProductionBrainAutomaticPolicy: mocks.automaticPolicy,
  }
})

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** Code without comments - guards must only find the words in real code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Any production reference to the Lia Brain IPC surface or its shadow observer. */
const BRAIN_IPC_PATTERN = /electronLiaBrainChatDecision|LiaBrainChatDecision|registerLiaBrainDecisionBridge|brain:chat-decision|brain-shadow|observeLiaBrainDecisionForChatTurn|chatTurnFactsFromSend/

/** Any production reference to a Brain decision or its shadow observer. */
const BRAIN_DECISION_PATTERN = /brain-shadow|observeLiaBrainDecisionForChatTurn|chatTurnFactsFromSend|LiaBrainChatDecision|brain:chat-decision/

const REPO_ROOT = new URL('../../../../../../', import.meta.url)

/** Every production (non-test) `.ts`/`.vue` file under the airi-relative roots. */
function productionSources(roots: string[]): string[] {
  const repoRoot = fileURLToPath(REPO_ROOT)
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      files.push(`${entry.parentPath}/${entry.name}`.slice(repoRoot.length))
    }
  }
  return files.sort()
}

/** The production sources under the roots whose content matches the pattern. */
function productionSourcesMatching(roots: string[], pattern: RegExp): string[] {
  return productionSources(roots)
    .filter(relative => pattern.test(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')))
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
  return stripComments(declaration.slice(0, declaration.indexOf('}')))
}

/** The first argument of every recorded `decide` call. */
interface DecideInput { automaticPolicy?: unknown, requirement: { required: string[] } }

function decideCalls(): DecideInput[] {
  return (mocks.decide.mock.calls as unknown as [unknown][]).map(([argument]) => argument as never)
}

type Handler = (request?: unknown) => LiaBrainRoutingDecision

/** Registers the bridge against an injected Brain surface. */
async function register(brain: unknown): Promise<Handler> {
  mocks.handlers.clear()
  const { registerLiaBrainDecisionBridge } = await import('./brain-decision-service')
  registerLiaBrainDecisionBridge({ brain: brain as never, context: {} as never })
  const handler = mocks.handlers.get(channels.decision)
  expect(handler).toBeTypeOf('function')
  return handler as Handler
}

/** The bridge over a spy service, so calls are observable. */
function loadBridge(): Promise<Handler> {
  return register({ decide: mocks.decide })
}

/** A config owner shaped like the canonical Stage product config provider. */
function configOwner(snapshot: unknown) {
  return { get: () => snapshot as never }
}

/** The bridge over the REAL Stage service for one real product snapshot. */
function realServiceBridge(snapshot: unknown): Promise<Handler> {
  return register(createLiaBrainService({ liaProductConfig: configOwner(snapshot) }))
}

/** Narrowing helper: fails loudly instead of silently passing. */
function automaticSelection(decision: LiaBrainRoutingDecision) {
  if (decision.status !== 'automatic')
    throw new Error(`expected an automatic decision, got '${decision.status}'`)
  return decision.selection
}

/** A decision the spy service returns, standing in for the real one. */
const SENTINEL: LiaBrainRoutingDecision = {
  readiness: { status: 'notResolved' },
  resolution: { status: 'noPreference' },
  status: 'manual',
}

/** The trusted production policy, as the product factory declares it. */
const TRUSTED_POLICY: LiaBrainAutomaticSelectionPolicy = {
  routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lia brain decision bridge (Phase 8.0D-8)', () => {
  it('k/o: the renderer request contract is facts plus ONE optional opaque key', () => {
    const body = requestContract()

    expect(body).toContain('facts: LiaBrainChatTurnFacts')
    expect(body).toContain('correlationId?: string')
    // No policy crosses this boundary - not even an optional one.
    expect(body).not.toContain('automaticPolicy')
    expect(body).not.toMatch(/routes|policy/i)
    for (const forbidden of ['engineId', 'modelId', 'providerId', 'apiKey', 'baseUrl', 'endpoint', 'options'])
      expect(body, forbidden).not.toContain(forbidden)
    // Exactly TWO fields are declared: the facts and the opaque join key.
    const fields = body.slice(body.indexOf('{') + 1).split('\n').map(line => line.trim()).filter(Boolean)
    expect(fields).toEqual(['correlationId?: string', 'facts: LiaBrainChatTurnFacts'])

    // The request type cannot name a policy type or a route ref either.
    expect(brainSection()).not.toMatch(/LiaCoreBrainAutomaticSelectionPolicy|LiaBrainAutomaticSelectionPolicy|LiaBrainRouteRef/)
  })

  it('p/q: renderer-supplied policy and route identity are ignored, in any shape', async () => {
    const injections: [unknown, string[]][] = [
      [{ automaticPolicy: TRUSTED_POLICY, facts: {} }, ['textInput', 'textOutput']],
      [{ automaticPolicy: { routes: [{ engineId: 'openai', modelId: 'gpt-5.4' }] }, facts: { usesTools: true } }, ['textInput', 'textOutput', 'toolCalling']],
      [{ engineId: 'groq', facts: {}, modelId: 'openai/gpt-oss-120b', providerId: 'groq', routes: [{ engineId: 'openai', modelId: 'x' }] }, ['textInput', 'textOutput']],
      [{ automaticPolicy: { routes: [{ engineId: 42 }] }, facts: { hasImageInput: 'yes' } }, ['textInput', 'textOutput']],
    ]

    for (const [request, expected] of injections) {
      vi.clearAllMocks()
      mocks.decide.mockReturnValueOnce(SENTINEL)
      const handler = await loadBridge()
      handler(request)

      const [call] = decideCalls()
      // The requirement is built from validated FACTS only - the injected
      // route identity never adds or removes a capability...
      expect(call.requirement, JSON.stringify(request)).toEqual({ required: expected })
      // ...and the policy is the trusted product one, never the injected one.
      expect(call.automaticPolicy).toEqual(TRUSTED_POLICY)
      expect(call.automaticPolicy).toBe(mocks.automaticPolicy.mock.results.at(-1)?.value)
      expect(JSON.stringify(call)).not.toMatch(/gpt-5\.4|providerId|"routes":\[\{"engineId":42/)
    }
  })

  it('d/e: malformed and extra facts keys are ignored - only canonical booleans count', async () => {
    const cases: [unknown, string[]][] = [
      [{}, ['textInput', 'textOutput']],
      [{ facts: { hasImageInput: 'yes', nested: { usesTools: true }, providerId: 'groq' } }, ['textInput', 'textOutput']],
      [{ facts: { hasImageInput: 1, reasoningRequested: 'true', usesTools: null } }, ['textInput', 'textOutput']],
      [{ facts: { hasImageInput: true, reasoningRequested: true, usesTools: true } }, ['textInput', 'imageInput', 'textOutput', 'reasoning', 'toolCalling']],
      [{ facts: { hasImageInput: false, reasoningRequested: false, usesTools: false } }, ['textInput', 'textOutput']],
    ]

    for (const [request, expected] of cases) {
      vi.clearAllMocks()
      mocks.decide.mockReturnValueOnce(SENTINEL)
      const handler = await loadBridge()
      handler(request)

      const [call] = decideCalls()
      expect(call.requirement, JSON.stringify(request)).toEqual({ required: expected })
    }
  })

  it('f/g: sanitized facts feed the canonical builder, whose exact requirement reaches decide', async () => {
    const handler = await loadBridge()
    mocks.decide.mockReturnValueOnce(SENTINEL)

    handler({ facts: { hasImageInput: true, junk: 'x', usesTools: true } })

    expect(mocks.requirementForChatTurn).toHaveBeenCalledTimes(1)
    expect(mocks.requirementForChatTurn).toHaveBeenCalledWith({ hasImageInput: true, usesTools: true })
    const [factsArg] = mocks.requirementForChatTurn.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(factsArg).sort()).toEqual(['hasImageInput', 'usesTools'])
    const [call] = decideCalls()
    expect(call.requirement).toBe(mocks.requirementForChatTurn.mock.results.at(-1)?.value)
    expect(Object.keys(call).sort()).toEqual(['automaticPolicy', 'requirement'])
  })

  it('p/q/r/s/t/u/v/w: the opaque correlation key is tolerated metadata with zero authority', async () => {
    // P + Q + U: any shape reads the same way - present, absent, non-string,
    // empty, or containing routing-looking text. The requirement, the policy and
    // the decision are byte-for-byte identical in every case.
    const shapes: unknown[] = [
      undefined,
      'logical-send-1',
      '',
      42,
      { correlationId: 'nested' },
      ['logical-send-1'],
      'engineId=openai;modelId=gpt-5.4',
      'providerId',
    ]

    const observed: string[] = []
    for (const correlationId of shapes) {
      vi.clearAllMocks()
      mocks.decide.mockReturnValueOnce(SENTINEL)
      const handler = await loadBridge()

      const request = correlationId === undefined
        ? { facts: { hasImageInput: true, usesTools: true } }
        : { correlationId, facts: { hasImageInput: true, usesTools: true } }
      const result = handler(request)

      // W: the response is the canonical decision, returned unchanged - never
      // wrapped, never echoed with an id.
      expect(result).toBe(SENTINEL)

      const [call] = decideCalls()
      // R: the requirement builder receives FACTS ONLY (the key is never an
      // input to it).
      expect(mocks.requirementForChatTurn).toHaveBeenCalledTimes(1)
      expect(Object.keys(mocks.requirementForChatTurn.mock.calls[0]?.[0] as object).sort())
        .toEqual(['hasImageInput', 'usesTools'])
      // S + T: decide receives exactly the trusted policy and the requirement -
      // the key is not part of the call in any position.
      expect(Object.keys(call).sort()).toEqual(['automaticPolicy', 'requirement'])
      expect(call.automaticPolicy).toEqual(TRUSTED_POLICY)
      expect(JSON.stringify(call)).not.toMatch(/logical-send|correlationId|engineId=openai/)
      observed.push(JSON.stringify({ requirement: call.requirement, status: (result as LiaBrainRoutingDecision).status }))
    }

    // Every shape produced the identical decision input.
    expect(new Set(observed).size).toBe(1)
  })

  it('v/v2: nothing about a decision or its request is retained', async () => {
    const handler = await loadBridge()
    mocks.decide.mockReturnValue(SENTINEL)

    handler({ correlationId: 'logical-send-retained?', facts: { usesTools: true } })
    handler({ correlationId: 'logical-send-retained?', facts: { usesTools: true } })

    // V: each request is an independent evaluation - no memoization, no replay
    // of a previous answer, and the key was not used to deduplicate anything.
    expect(mocks.decide).toHaveBeenCalledTimes(2)

    // No retention surface exists in the bridge source at all.
    const source = stripComments(readSource('./brain-decision-service.ts'))
    expect(source).not.toMatch(/\bMap\b|\bSet\b|lastDecision|pendingComparison|cache|history|store\b/i)
    // The only code reference to the key is the tolerant read that is
    // immediately discarded - no variable holds it, nothing returns it.
    expect(source.match(/correlationId/g)).toHaveLength(1)
    expect(source).toContain('void readCorrelationId(request?.correlationId)')
  })

  it('l/m/n/o: the trusted policy is built once per registration and reused, not per request', async () => {
    const handler = await loadBridge()

    // L/M: created through the Lia Core product factory, exactly once.
    expect(mocks.automaticPolicy).toHaveBeenCalledTimes(1)

    mocks.decide.mockReturnValue(SENTINEL)
    handler({ facts: {} })
    handler({ facts: { usesTools: true } })
    handler({ facts: { reasoningRequested: true } })

    // Still ONE policy for the whole bridge lifetime - nothing per-request.
    expect(mocks.automaticPolicy).toHaveBeenCalledTimes(1)

    // N/O: every call received that same trusted policy object, whose content
    // is the declared production route.
    const calls = decideCalls()
    expect(calls).toHaveLength(3)
    const trusted = mocks.automaticPolicy.mock.results[0]?.value
    for (const call of calls) {
      expect(call.automaticPolicy).toBe(trusted)
      expect(call.automaticPolicy).toEqual(TRUSTED_POLICY)
    }

    // A second registration owns its own fresh policy (one per bridge).
    await loadBridge()
    expect(mocks.automaticPolicy).toHaveBeenCalledTimes(2)
    expect(mocks.automaticPolicy.mock.results[1]?.value).not.toBe(trusted)
  })

  it('r/s: automatic mode + plain text selects the production Groq/GPT-OSS route', async () => {
    const handler = await realServiceBridge({ brain: { mode: 'automatic' } })

    const decision = handler({ facts: {} })
    expect(decision.status).toBe('automatic')
    const selection = automaticSelection(decision)

    expect(selection.status).toBe('selected')
    if (selection.status !== 'selected')
      return
    // S: the selected route IS the shipped production descriptor pair.
    expect(selection.route.engine.id).toBe('groq')
    expect(selection.route.model.id).toBe('openai/gpt-oss-120b')
    expect(selection.route.model.engineId).toBe('groq')

    // And it is the catalog's own descriptor, not a restated copy.
    const { createProductionBrainCatalog } = await import('@lia/core')
    const catalog = createProductionBrainCatalog()
    expect(selection.route.engine).toEqual(catalog.engines[0])
    expect(selection.route.model).toEqual(catalog.models[0])

    // Tool/reasoning facts stay eligible for this route.
    for (const facts of [{ usesTools: true }, { reasoningRequested: true }]) {
      const rich = handler({ facts })
      expect(automaticSelection(rich).status).toBe('selected')
    }
  })

  it('t: automatic mode + image facts reports noCandidates - no fallback to an ineligible route', async () => {
    const handler = await realServiceBridge({ brain: { mode: 'automatic' } })

    const decision = handler({ facts: { hasImageInput: true } })

    expect(decision).toEqual({ selection: { status: 'noCandidates' }, status: 'automatic' })
    // The policy keeps naming the route; eligibility simply excludes it.
    expect(mocks.automaticPolicy).toHaveBeenCalled()
  })

  it('u/v/w: manual, disabled and unspecified modes keep their canonical semantics', async () => {
    // W: no mode persisted - nothing is routed, nothing is inferred.
    expect(await realServiceBridge({}).then(handler => handler({ facts: {} }))).toEqual({ status: 'modeUnspecified' })

    // V: disabled is data, not an exception.
    expect(await realServiceBridge({ brain: { mode: 'disabled' } }).then(handler => handler({ facts: {} })))
      .toEqual({ status: 'disabled' })

    // U: manual resolves the persisted preference; the automatic policy is
    // not consulted at all - not even when the renderer injects a different one.
    const manual = { brain: { engine: { preferred: 'groq' }, mode: 'manual', model: { preferred: 'openai/gpt-oss-120b' } } }
    const handler = await realServiceBridge(manual)
    const decision = handler({ automaticPolicy: { routes: [{ engineId: 'openai', modelId: 'gpt-5.4' }] }, facts: {} })

    expect(decision.status).toBe('manual')
    if (decision.status !== 'manual')
      return
    expect(decision.resolution.status).toBe('resolvedModel')
    if (decision.resolution.status !== 'resolvedModel')
      return
    expect(decision.resolution.engine.id).toBe('groq')
    expect(decision.resolution.model.id).toBe('openai/gpt-oss-120b')
    // Phase 8.0C-4's additive readiness travels unchanged through the bridge.
    expect(decision.readiness).toEqual({ status: 'ready' })
  })

  it('x: the bridge never inspects the routing mode itself', () => {
    const source = stripComments(readSource('./brain-decision-service.ts'))

    // No mode read, no mode literal, no mode branch - the router owns that.
    expect(source).not.toMatch(/readBrainRoutingMode|\.mode\b|modeUnspecified|brain\.mode/)
    expect(source).not.toMatch(/'automatic'|'disabled'|'manual'/)
    expect(source).not.toMatch(/LiaBrainRoutingMode|isBrainRoutingMode/)
    // The only Lia Core entry points used are the requirement builder and the
    // product policy factory - one type-only import (the facts shape, erased
    // at runtime) and one value import, each declared exactly as written.
    const imports = source.slice(0, source.indexOf('defineInvokeHandler'))
    expect(imports.match(/from '@lia\/core'/g)).toHaveLength(2)
    expect(imports).toContain('import { brainRequirementForChatTurn, createProductionBrainAutomaticPolicy } from \'@lia/core\'')
    expect(imports).toMatch(/import type \{\s*LiaChatTurnBrainFacts,\s*\} from '@lia\/core'/)
  })

  it('8.0D-9 caller guard: exactly ONE legitimate production caller, and it holds no execution authority', () => {
    const stageSrc = fileURLToPath(new URL('../../../', import.meta.url))
    const callers: string[] = []
    for (const entry of readdirSync(stageSrc, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const file = `${entry.parentPath}/${entry.name}`
      const relative = file.slice(stageSrc.length)
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
    // 8.0D-7A proved "zero production callers". 8.0D-9 legitimately evolves
    // that invariant into exactly ONE: the Stage renderer's shadow observation
    // of the normal user send. Nothing else in production knows the bridge.
    expect(callers).toEqual(['renderer/services/lia/brain-shadow.ts'])

    // The one caller observes and nothing else: void by contract (no result to
    // await, branch on, store or execute with), no chat store, no send - and
    // no provider, model, policy or route plumbing of its own.
    const shadow = stripComments(readSource('../../../renderer/services/lia/brain-shadow.ts'))
    expect(shadow).toMatch(/export function observeLiaBrainDecisionForChatTurn\(input: LiaBrainShadowObservationInput\): void/)
    // 8.0D-10B-3B2: it forwards the caller's opaque key and nothing else new.
    expect(shadow).toMatch(/correlationId === undefined \? \{\} : \{ correlationId: input\.correlationId \}/)
    expect(shadow).not.toMatch(/chatStore|useChatStore|\.send\(|getChatProviderInstance|useChatProvider/)
    expect(shadow).not.toMatch(/automaticPolicy|engineId|modelId|providerId|routes/)

    // The provider identity stays out of the renderer-facing paths too: the
    // renderer can never name what the policy selects - provider/model ids
    // remain the chat stack's own business, and no Brain identity leaks in.
    for (const relative of [
      '../../../../../../packages/stage-ui/src/stores/chat.ts',
      '../../../../../../packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
      '../../../../../../packages/core-agent/src/runtime/llm-service.ts',
      '../../../renderer/components/InteractiveArea.vue',
    ]) {
      expect(readSource(relative), relative).not.toMatch(/liaBrain|brainDecision|electronLiaBrainChatDecision|brain:chat-decision|createProductionBrainAutomaticPolicy/)
    }
  })

  it('the bridge stays read-only, provider-neutral and uses the injected service', () => {
    const source = stripComments(readSource('./brain-decision-service.ts'))

    // The service arrives as a dependency - the lifecycle owns the instance.
    expect(source).toContain('brain: Pick<LiaBrainService, \'decide\'>')
    expect(source.match(/brain\.decide\(/g)).toHaveLength(1)
    // No second service, catalog or registry is built here.
    expect(source).not.toMatch(/createLiaBrainService|createProductionBrainCatalog|createBrainEngineRegistry/)
    // No vendor identity or route plumbing of its own: the policy is imported
    // by name from the product layer and passed through untouched.
    expect(source).not.toMatch(/groq|gpt-oss|qwen|anthropic|gemini|claude|openrouter/i)
    expect(source).not.toMatch(/readPolicy|sanitizePolicy|engineId|modelId|providerId|routes/)
    expect(source.match(/automaticPolicy: trustedAutomaticPolicy/g)).toHaveLength(1)
    // Read-only: no config write, no network, no SDK, no chat state.
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env|vault|apiKey|secret/i)
    expect(source).not.toMatch(/updateLiaProductConfig|brainRoutingModeUpdate|brainSelectionUpdate|readLiaProductConfig/)
    expect(source).not.toMatch(/registry\.register|satisfiesBrainCapabilities/)

    // The response type is canonical and unmapped, and the contract exposes
    // exactly one read-only Brain channel - no setter, no second seam.
    const shared = readSource('../../../shared/eventa/index.ts')
    expect(shared).toContain('export type LiaBrainChatDecision = LiaCoreBrainRoutingDecision')
    expect(shared.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []).toEqual(['eventa:invoke:lia:brain:chat-decision'])
    expect(shared).not.toMatch(/eventa:(?:invoke|event):lia:brain:[a-z-]*(?:set|write|update)/)
    expect(readSource('../../../preload/index.ts')).not.toMatch(/brain/i)
  })

  it('the lifecycle keeps owning exactly one service instance, reused by the bridge', () => {
    const entry = stripComments(readSource('../../index.ts'))
    expect(entry.match(/services:lia-brain/g)).toHaveLength(1)
    expect(entry.match(/createLiaBrainService\(/g)).toHaveLength(1)
    expect(entry).toContain('registerLiaBrainDecisionBridge({ context, brain: deps.liaBrain })')
    // The trusted policy is NOT created in the composition entry - the bridge
    // owns that lifecycle, and config is never consulted for it.
    expect(entry).not.toMatch(/createProductionBrainAutomaticPolicy|automaticPolicy/)
  })

  it('isolation y: stage-ui production chat code carries no Lia Brain IPC', () => {
    // The generic chat store the renderer drives stays entirely unaware - it
    // cannot name the bridge, the channel or the shadow observer.
    expect(productionSourcesMatching(['packages/stage-ui/src'], BRAIN_IPC_PATTERN)).toEqual([])
  })

  it('isolation z: core-agent production code carries no Lia Brain IPC', () => {
    // The generic agent runtime executes the chat exactly as before and never
    // learns that a Brain decision exists.
    expect(productionSourcesMatching(['packages/core-agent/src'], BRAIN_IPC_PATTERN)).toEqual([])
  })

  it('isolation aa: provider/model selection never imports or uses the shadow helper', () => {
    // The modules that pick a provider/model stay blind to the observer.
    for (const relative of [
      '../../../../../../packages/stage-ui/src/stores/chat.ts',
      '../../../../../../packages/stage-ui/src/stores/modules/consciousness.ts',
      '../../../../../../packages/stage-ui/src/stores/providers/provider.ts',
      '../../../../../../packages/stage-ui/src/stores/character/orchestrator/store.ts',
      '../../../../../../packages/core-agent/src/runtime/llm-service.ts',
      '../../../../../../packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
    ]) {
      expect(readSource(relative), relative).not.toMatch(BRAIN_DECISION_PATTERN)
    }

    // The helper module is imported by exactly ONE production file: the normal
    // user-send seam. Nothing in the selection or execution path reaches it.
    expect(productionSourcesMatching(
      ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src'],
      /brain-shadow/,
    )).toEqual(['apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue'])
  })

  it('isolation ab: no additional Brain IPC channel was introduced', () => {
    const tags = new Set<string>()
    for (const relative of productionSources(['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src', 'packages/core-agent/src'])) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    // The whole production tree names exactly the single read-only decision
    // channel - no setter, no update channel, no second seam.
    expect([...tags].sort()).toEqual(['eventa:invoke:lia:brain:chat-decision'])
  })

  it('isolation ac: the trusted automatic policy stays Product/main-owned', () => {
    // Declared in Lia Core's product layer - never inside generic brain modules.
    expect(readSource('../../../../../../packages/lia-core/src/product/brain-policy.ts'))
      .toMatch(/export function createProductionBrainAutomaticPolicy/)

    // Production referrers: the product declaration, its public export line and
    // the trusted Stage main bridge - and nothing else.
    expect(productionSourcesMatching(
      ['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src', 'packages/core-agent/src'],
      /createProductionBrainAutomaticPolicy/,
    )).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'packages/lia-core/src/index.ts',
      'packages/lia-core/src/product/brain-policy.ts',
    ])

    // The composition entry does not build it; the renderer never sees it.
    expect(readSource('../../../main/index.ts')).not.toMatch(/createProductionBrainAutomaticPolicy/)
    expect(readSource('../../../renderer/components/InteractiveArea.vue')).not.toMatch(/createProductionBrainAutomaticPolicy/)
  })

  it('isolation ad: the only decision reader is the shadow observer, and it only logs statuses', () => {
    // Across every execution-adjacent production root, exactly ONE file reads a
    // Brain decision: the shadow observer.
    expect(productionSourcesMatching(
      ['apps/stage-tamagotchi/src/renderer', 'packages/stage-ui/src', 'packages/core-agent/src'],
      /LiaBrainChatDecision|brain:chat-decision/,
    )).toEqual(['apps/stage-tamagotchi/src/renderer/services/lia/brain-shadow.ts'])

    // Inside it the decision reaches only the diagnostic line, and only
    // statuses are read - never routes, engines, models or ids to act upon.
    const shadow = stripComments(readSource('../../../renderer/services/lia/brain-shadow.ts'))
    expect(shadow).toContain('const decision = await invoke({')
    expect(shadow).toMatch(/console\.info\(`\[LIA-BRAIN\] shadow decision \$\{describeDecision\(decision\)\}`\)/)
    expect(shadow).not.toMatch(/decision\.(?:selection|resolution|readiness)\.(?:route|engine|model|id)\b/)
    expect(shadow).not.toMatch(/decision\.(?:route|engine|model|provider)\b/)
  })
})
