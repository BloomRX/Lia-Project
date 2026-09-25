import type { LiaBrainRoutingDecision, LiaBrainRoutingDecisionInput } from '@lia/core'

import type { LiaBrainDecisionRequest } from './lia-brain-service'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainService } from './lia-brain-service'

/**
 * Phase 8.0D-4: the observational Brain host service.
 *
 * Real behavior throughout: the two Lia Core entry points are spy-wrapped
 * versions of the actual implementations, so these tests prove BOTH the
 * call contract (who is called, once, with what) and that a real product
 * snapshot produces a real routing decision - while confirming nothing in
 * the host layer knows an engine, a model or a policy of its own.
 */

const core = vi.hoisted(() => ({
  createProductionBrainCatalog: vi.fn(),
  decideBrainRouteFromProductState: vi.fn(),
}))

vi.mock('@lia/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lia/core')>()
  core.createProductionBrainCatalog.mockImplementation(actual.createProductionBrainCatalog)
  core.decideBrainRouteFromProductState.mockImplementation(actual.decideBrainRouteFromProductState)
  return {
    ...actual,
    createProductionBrainCatalog: core.createProductionBrainCatalog,
    decideBrainRouteFromProductState: core.decideBrainRouteFromProductState,
  }
})

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** A minimal config owner; `get` is a spy so snapshot reads are observable. */
function configOwner(snapshots: (unknown | undefined)[] = [undefined]) {
  let index = 0
  const get = vi.fn(() => {
    const snapshot = snapshots[Math.min(index, snapshots.length - 1)]
    index += 1
    return snapshot as never
  })
  return { get }
}

const TEXT_ONLY: LiaBrainDecisionRequest = { requirement: { required: ['textInput'] } }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lia brain host service (Phase 8.0D-4)', () => {
  it('a: construction builds the production Brain catalog', () => {
    createLiaBrainService({ liaProductConfig: configOwner() })
    expect(core.createProductionBrainCatalog).toHaveBeenCalledTimes(1)
  })

  it('b: the catalog is created ONCE per service instance, not per decision', () => {
    const service = createLiaBrainService({ liaProductConfig: configOwner() })
    service.decide(TEXT_ONLY)
    service.decide(TEXT_ONLY)
    service.decide(TEXT_ONLY)
    expect(core.createProductionBrainCatalog).toHaveBeenCalledTimes(1)

    // A second instance owns its own catalog (fresh ownership boundary).
    createLiaBrainService({ liaProductConfig: configOwner() })
    expect(core.createProductionBrainCatalog).toHaveBeenCalledTimes(2)
  })

  it('c: every decide(...) reads the CURRENT product snapshot through the canonical owner', () => {
    const config = configOwner([{ brain: { mode: 'disabled' } }, { brain: { mode: 'manual' } }])
    const service = createLiaBrainService({ liaProductConfig: config })

    expect(config.get).toHaveBeenCalledTimes(0)
    service.decide(TEXT_ONLY)
    expect(config.get).toHaveBeenCalledTimes(1)
    service.decide(TEXT_ONLY)
    expect(config.get).toHaveBeenCalledTimes(2)
  })

  it('d: that snapshot is forwarded verbatim to decideBrainRouteFromProductState', () => {
    const first = { brain: { mode: 'disabled' } }
    const second = { brain: { mode: 'disable' }, persona: { activeCardId: 'lia' } }
    const service = createLiaBrainService({ liaProductConfig: configOwner([first, second]) })

    service.decide(TEXT_ONLY)
    service.decide(TEXT_ONLY)

    const calls = core.decideBrainRouteFromProductState.mock.calls as unknown as [LiaBrainRoutingDecisionInput][]
    expect(calls).toHaveLength(2)
    expect(calls[0][0].snapshot).toBe(first)
    expect(calls[1][0].snapshot).toBe(second)
  })

  it('e/f/g: requirement and automaticPolicy pass through unchanged, absence included', () => {
    const service = createLiaBrainService({ liaProductConfig: configOwner([{ brain: { mode: 'automatic' } }]) })
    const requirement = { required: ['textInput', 'toolCalling'] as const }
    const policy = { routes: [{ engineId: 'some-engine', modelId: 'some-model' }] }

    service.decide({ automaticPolicy: policy, requirement })
    service.decide({ requirement })

    const calls = core.decideBrainRouteFromProductState.mock.calls as unknown as [LiaBrainRoutingDecisionInput][]
    expect(calls[0][0].requirement).toBe(requirement)
    expect(calls[0][0].automaticPolicy).toBe(policy)
    expect(calls[1][0].requirement).toBe(requirement)
    // Absent stays absent - no production policy is invented.
    expect(calls[1][0].automaticPolicy).toBeUndefined()
    // ...which the canonical decision reports truthfully.
    expect(service.decide({ requirement }).status).toBe('automaticPolicyMissing')
  })

  it('h: the returned LiaBrainRoutingDecision is passed through unchanged', () => {
    const sentinel: LiaBrainRoutingDecision = { selection: { status: 'noCandidates' }, status: 'automatic' }
    core.decideBrainRouteFromProductState.mockReturnValueOnce(sentinel)

    const service = createLiaBrainService({ liaProductConfig: configOwner() })
    expect(service.decide(TEXT_ONLY)).toBe(sentinel)
  })

  it('i: a later decide(...) observes a NEWER snapshot than construction time', () => {
    // The service is constructed while nothing is configured; the user then
    // selects the production route and only afterwards does the next call run.
    const unconfigured = { brain: undefined }
    const manual = { brain: { engine: { preferred: 'groq' }, mode: 'manual', model: { preferred: 'openai/gpt-oss-120b' } } }
    const service = createLiaBrainService({ liaProductConfig: configOwner([unconfigured, manual]) })

    expect(service.decide(TEXT_ONLY)).toEqual({ status: 'modeUnspecified' })

    const decision = service.decide(TEXT_ONLY)
    expect(decision.status).toBe('manual')
    if (decision.status !== 'manual')
      return
    expect(decision.resolution.status).toBe('resolvedModel')

    const calls = core.decideBrainRouteFromProductState.mock.calls as unknown as [LiaBrainRoutingDecisionInput][]
    expect(calls[1][0].snapshot).toBe(manual)
  })

  it('observational end-to-end: the real catalog + real bridge answer real product states', () => {
    const disabled = { brain: { mode: 'disabled' } }
    const automatic = { brain: { mode: 'automatic' } }
    const service = createLiaBrainService({ liaProductConfig: configOwner([disabled, automatic, automatic]) })

    // The service really owns the production catalog (one engine/model today).
    expect(service.catalog.engines.map(engine => engine.id)).toEqual(['groq'])
    expect(service.catalog.models.map(model => model.id)).toEqual(['openai/gpt-oss-120b'])

    // disabled is data, not an exception.
    expect(service.decide(TEXT_ONLY)).toEqual({ status: 'disabled' })

    // automatic + explicit caller policy naming the production route selects it.
    const selected = service.decide({
      automaticPolicy: { routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }] },
      requirement: { required: ['textInput', 'reasoning'] },
    })
    expect(selected.status).toBe('automatic')
    if (selected.status !== 'automatic')
      return
    expect(selected.selection.status).toBe('selected')

    // A requirement the production route cannot satisfy yields no candidate -
    // and still no exception.
    const unsupported = service.decide({
      automaticPolicy: { routes: [{ engineId: 'groq', modelId: 'openai/gpt-oss-120b' }] },
      requirement: { required: ['imageInput'] },
    })
    expect(unsupported).toEqual({ selection: { status: 'noCandidates' }, status: 'automatic' })
  })

  it('j: the service never traverses snapshot.brain fields itself', () => {
    const source = readSource('./lia-brain-service.ts')
    expect(source).not.toMatch(/\.brain\b/)
    expect(source).not.toMatch(/\.mode\b|\.preferred\b/)
    expect(source).not.toMatch(/readBrainRoutingMode|readPreferredBrainEngineId|readPreferredBrainModelId/)
    // The snapshot is handed over exactly as the canonical owner produced it.
    expect(source).toContain('snapshot: deps.liaProductConfig.get() ?? {}')
  })

  it('k: Stage carries no provider-specific Brain knowledge', () => {
    const source = readSource('./lia-brain-service.ts')
    expect(source).not.toMatch(/groq|gpt-oss|qwen|openai|anthropic|gemini/i)
    expect(source).not.toMatch(/groqBrainDescriptors|adapters\//)
    expect(source).not.toMatch(/registry\.register|createBrainEngineRegistry|Descriptor/)
    // Engine/model identities enter only through the production catalog.
    expect(source).toContain('createProductionBrainCatalog()')
  })

  it('l: no provider SDK, credential, environment or network access exists', () => {
    const source = readSource('./lia-brain-service.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|existsSync|process\.env|vault|apiKey|api_key|secret/i)
  })

  it('m: no renderer IPC or UI surface was added', () => {
    const source = readSource('./lia-brain-service.ts')
    expect(source).not.toMatch(/electron|eventa|ipcMain|ipcRenderer|defineInvokeHandler|BrowserWindow/)
    // The shared IPC contract carries no Brain channel at all.
    const eventa = readFileSync(fileURLToPath(new URL('../../../shared/eventa/index.ts', import.meta.url)), 'utf-8')
    expect(eventa).not.toMatch(/brain/i)
  })

  it('n/o: no current chat/provider code consumes the service, and those paths are untouched', () => {
    // Zero production callers: no source file outside this service's own
    // module/test mentions it, and the chat/provider files carry no Brain
    // reference whatsoever.
    const stageSrc = fileURLToPath(new URL('../../../', import.meta.url))
    const consumers: string[] = []
    for (const entry of readdirSync(stageSrc, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name))
        continue
      const file = `${entry.parentPath}/${entry.name}`
      if (file.endsWith('lia-brain-service.ts') || file.endsWith('lia-brain-service.test.ts'))
        continue
      if (/createLiaBrainService|LiaBrainDecisionRequest|LiaBrainService\b/.test(readFileSync(file, 'utf-8')))
        consumers.push(file.slice(stageSrc.length))
    }
    expect(consumers).toEqual([])

    for (const relative of [
      './provider-config-service.ts',
      './lia-voice-service.ts',
      './main-window-voice-runtime.ts',
    ]) {
      expect(readSource(relative), relative).not.toMatch(/brain/i)
    }
    // The renderer provider store (chat provider/model selection) is equally
    // free of Brain routing.
    const rendererStore = readFileSync(fileURLToPath(new URL('../../../renderer/stores/lia/provider.ts', import.meta.url)), 'utf-8')
    expect(rendererStore).not.toMatch(/brain/i)
  })
})
