import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { electronLiaBrainChatDecision } from '../../../shared/eventa'
import { chatTurnFactsFromSend, observeLiaBrainDecisionForChatTurn } from './brain-shadow'

/**
 * Phase 8.0D-9: the shadow Brain observer.
 *
 * Real behavior: the helper runs for real, only the renderer invoke seam is a
 * spy - so these tests pin the channel, the exact request shape, the
 * fire-and-forget contract and the failure isolation.
 */

const electron = vi.hoisted(() => ({
  invoke: vi.fn(),
  useElectronEventaInvoke: vi.fn(),
}))

vi.mock('@proj-airi/electron-vueuse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/electron-vueuse')>()
  return {
    ...actual,
    useElectronEventaInvoke: electron.useElectronEventaInvoke,
  }
})

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Flushes microtasks/macrotasks so a fire-and-forget call settles. */
async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

const FACTS = { hasImageInput: true, reasoningRequested: false, usesTools: true }

beforeEach(() => {
  vi.clearAllMocks()
  electron.useElectronEventaInvoke.mockReturnValue(electron.invoke)
  electron.invoke.mockResolvedValue({ status: 'automaticPolicyMissing' })
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('shadow brain observer (Phase 8.0D-9)', () => {
  it('a: it invokes exactly the existing Brain decision channel', async () => {
    observeLiaBrainDecisionForChatTurn(FACTS)
    await flush()

    expect(electron.useElectronEventaInvoke).toHaveBeenCalledTimes(1)
    expect(electron.useElectronEventaInvoke).toHaveBeenCalledWith(electronLiaBrainChatDecision)
  })

  it('b: the request is exactly { facts } - the same facts object is handed over', async () => {
    observeLiaBrainDecisionForChatTurn(FACTS)
    await flush()

    expect(electron.invoke).toHaveBeenCalledTimes(1)
    const [request] = electron.invoke.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(request)).toEqual(['facts'])
    expect(request.facts).toBe(FACTS)
    expect(electron.invoke).toHaveBeenCalledWith({ facts: FACTS })
  })

  it('c/d: no policy, no route identity, no descriptors ever leave the renderer', async () => {
    observeLiaBrainDecisionForChatTurn(FACTS)
    await flush()

    const payload = JSON.stringify(electron.invoke.mock.calls[0])
    expect(payload).not.toMatch(/automaticPolicy|routes|engineId|modelId|providerId|descriptor/i)
    // The helper cannot even name them: nothing policy-shaped exists in code.
    const source = stripComments(readSource('./brain-shadow.ts'))
    expect(source).not.toMatch(/automaticPolicy|engineId|modelId|providerId|routes/)
  })

  it('e: the decision is observational only - the helper returns nothing to consume', async () => {
    electron.invoke.mockResolvedValueOnce({
      selection: { status: 'selected' },
      status: 'automatic',
    })

    const result = observeLiaBrainDecisionForChatTurn(FACTS)
    await flush()

    // No return channel at all: a caller cannot await or branch on a decision.
    expect(result).toBeUndefined()
    expect(electron.invoke).toHaveBeenCalledTimes(1)
    // It reached the diagnostic line instead.
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[LIA-BRAIN] shadow decision status=automatic selection=selected'))
  })

  it('f: a rejected invoke is caught and reduced to a diagnostic line', async () => {
    electron.invoke.mockRejectedValueOnce(new Error('no handler registered'))

    expect(() => observeLiaBrainDecisionForChatTurn(FACTS)).not.toThrow()
    await flush()

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[LIA-BRAIN] shadow unavailable'))
    const [, line] = (console.info as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1) ?? []
    if (line !== undefined)
      expect(line).not.toMatch(/no handler registered/)
  })

  it('f: a synchronously throwing invoke seam is isolated too', async () => {
    electron.useElectronEventaInvoke.mockImplementationOnce(() => {
      throw new Error('context unavailable')
    })

    expect(() => observeLiaBrainDecisionForChatTurn(FACTS)).not.toThrow()
    await flush()

    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[LIA-BRAIN] shadow unavailable'))
  })

  it('g: no unhandled rejection path remains, whatever the bridge does', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      electron.invoke.mockRejectedValueOnce(new Error('bridge down'))
      observeLiaBrainDecisionForChatTurn(FACTS)
      await flush()
      // A slow bridge that resolves late must be harmless as well.
      electron.invoke.mockImplementationOnce(() => new Promise(() => {}))
      observeLiaBrainDecisionForChatTurn(FACTS)
      await flush()
    }
    finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(unhandled).toEqual([])
  })

  it('h/i: no provider, model, config, storage or session mutation', async () => {
    const source = stripComments(readSource('./brain-shadow.ts'))

    // H: nothing provider/model-shaped is reachable from here.
    expect(source).not.toMatch(/groq|gpt-oss|openai|anthropic|qwen|ollama|model\.|provider\./i)
    expect(source).not.toMatch(/providerId|modelId|selectModel|setProvider/)
    // I: no state ownership of any kind.
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|defineStore|useStore|pinia/)
    expect(source).not.toMatch(/config|updateLiaProductConfig|brainSelectionUpdate|brainRoutingModeUpdate/)
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process)['/]/)
    expect(source).not.toMatch(/\bfetch\(|WebSocket|axios/)

    // Behavioral: observing writes nothing anywhere. This project runs
    // without DOM globals, so storage is either absent (nothing to write) or
    // present and unchanged.
    const storageBefore = typeof localStorage === 'undefined' ? null : localStorage.length
    observeLiaBrainDecisionForChatTurn(FACTS)
    await flush()
    if (storageBefore !== null)
      expect(localStorage.length).toBe(storageBefore)
  })

  it('j: no vendor or model literal exists in the production helper', () => {
    const source = readSource('./brain-shadow.ts')

    expect(source).not.toMatch(/groq|gpt-oss|qwen|anthropic|gemini|claude|openai|mistral|ollama/i)
    expect(source).not.toMatch(/openai\/|gpt-/i)
    // The only channel it knows is the renderer-facing decision request.
    expect(source.match(/electronLiaBrainChatDecision/g)).toHaveLength(2)
  })

  it('logs statuses only - never ids, payloads or prompt text', async () => {
    const cases: [unknown, RegExp][] = [
      [{ selection: { status: 'noCandidates' }, status: 'automatic' }, /status=automatic selection=noCandidates$/],
      [{ readiness: { status: 'configurationRequired' }, resolution: { status: 'resolvedModel' }, status: 'manual' }, /status=manual resolution=resolvedModel readiness=configurationRequired$/],
      [{ status: 'disabled' }, /status=disabled$/],
      [{ status: 'modeUnspecified' }, /status=modeUnspecified$/],
    ]

    for (const [decision, pattern] of cases) {
      vi.clearAllMocks()
      electron.useElectronEventaInvoke.mockReturnValue(electron.invoke)
      electron.invoke.mockResolvedValueOnce(decision)
      observeLiaBrainDecisionForChatTurn(FACTS)
      await flush()

      const line = (console.info as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)?.[0] ?? ''
      expect(line).toMatch(/^\[LIA-BRAIN\] shadow decision /)
      expect(line).toMatch(pattern)
      // Statuses only: no engine/model identities, no sizes, no text.
      expect(line).not.toMatch(/engineId|modelId|providerId|groq|gpt|openai|ak-|sk-/i)
    }
  })

  it('facts come from the outgoing values - attachments, tools and the reasoning flag', () => {
    // No image, no tools, no reasoning: the baseline describes exactly that.
    expect(chatTurnFactsFromSend({ attachments: [], reasoning: false, tools: [] }))
      .toEqual({ hasImageInput: false, reasoningRequested: false, usesTools: false })

    // Each signal is independent and read as a boolean of the actual values.
    expect(chatTurnFactsFromSend({ attachments: [{}], reasoning: false, tools: [] })).toEqual({
      hasImageInput: true,
      reasoningRequested: false,
      usesTools: false,
    })
    expect(chatTurnFactsFromSend({ attachments: [], reasoning: true, tools: [] })).toEqual({
      hasImageInput: false,
      reasoningRequested: true,
      usesTools: false,
    })
    expect(chatTurnFactsFromSend({ attachments: [], reasoning: false, tools: [{ name: 'a' }] })).toEqual({
      hasImageInput: false,
      reasoningRequested: false,
      usesTools: true,
    })

    // Combined.
    expect(chatTurnFactsFromSend({ attachments: [{}], reasoning: true, tools: [{ name: 'a' }] })).toEqual({
      hasImageInput: true,
      reasoningRequested: true,
      usesTools: true,
    })

    // The input is never mutated, and the facts object carries exactly the
    // three canonical keys.
    const input = { attachments: [{}], reasoning: true, tools: [{ name: 'a' }] }
    const before = JSON.stringify(input)
    expect(Object.keys(chatTurnFactsFromSend(input)).sort()).toEqual(['hasImageInput', 'reasoningRequested', 'usesTools'])
    expect(JSON.stringify(input)).toBe(before)
  })
})
