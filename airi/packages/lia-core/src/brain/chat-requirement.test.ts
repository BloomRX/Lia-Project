import type { LiaBrainCapability } from './capabilities'
import type { LiaChatTurnBrainFacts } from './chat-requirement'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { brainRequirementForChatTurn } from './chat-requirement'

/**
 * Phase 8.0D-6: the chat-turn requirement contract - what a turn needs, and
 * nothing about what should serve it.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** The canonical capability order of the domain, used to check stability. */
const CANONICAL_ORDER: readonly LiaBrainCapability[] = [
  'textInput',
  'imageInput',
  'audioInput',
  'videoInput',
  'textOutput',
  'audioOutput',
  'reasoning',
  'toolCalling',
  'realtime',
]

/** The three turn-dependent signals, as every combination of on/off. */
const SIGNALS = ['hasImageInput', 'reasoningRequested', 'usesTools'] as const

function combinations(): LiaChatTurnBrainFacts[] {
  const facts: LiaChatTurnBrainFacts[] = []
  for (let mask = 0; mask < 8; mask += 1) {
    const entry: LiaChatTurnBrainFacts = {}
    SIGNALS.forEach((signal, index) => {
      if (mask & (1 << index))
        entry[signal] = true
    })
    facts.push(entry)
  }
  return facts
}

describe('chat turn brain requirement (8.0D-6)', () => {
  it('a: a plain text turn requires exactly textInput and textOutput', () => {
    expect(brainRequirementForChatTurn({})).toEqual({ required: ['textInput', 'textOutput'] })
  })

  it('b: an image-bearing turn adds imageInput', () => {
    expect(brainRequirementForChatTurn({ hasImageInput: true }))
      .toEqual({ required: ['textInput', 'imageInput', 'textOutput'] })
  })

  it('c: a tool-bearing turn adds toolCalling', () => {
    expect(brainRequirementForChatTurn({ usesTools: true }))
      .toEqual({ required: ['textInput', 'textOutput', 'toolCalling'] })
  })

  it('d: a reasoning-enabled turn adds reasoning', () => {
    expect(brainRequirementForChatTurn({ reasoningRequested: true }))
      .toEqual({ required: ['textInput', 'textOutput', 'reasoning'] })
  })

  it('e: image + tools combines with the baseline', () => {
    expect(brainRequirementForChatTurn({ hasImageInput: true, usesTools: true }))
      .toEqual({ required: ['textInput', 'imageInput', 'textOutput', 'toolCalling'] })
  })

  it('f: reasoning + tools combines with the baseline', () => {
    expect(brainRequirementForChatTurn({ reasoningRequested: true, usesTools: true }))
      .toEqual({ required: ['textInput', 'textOutput', 'reasoning', 'toolCalling'] })
  })

  it('g: all currently-supported optional signals combine correctly', () => {
    expect(brainRequirementForChatTurn({ hasImageInput: true, reasoningRequested: true, usesTools: true }))
      .toEqual({ required: ['textInput', 'imageInput', 'textOutput', 'reasoning', 'toolCalling'] })
  })

  it('h/i/j: absent OR explicitly false facts never become requirements', () => {
    const baseline = ['textInput', 'textOutput']
    // Absent...
    expect(brainRequirementForChatTurn({}).required).toEqual(baseline)
    // ...and explicit false are the same honest answer.
    expect(brainRequirementForChatTurn({ hasImageInput: false }).required).toEqual(baseline)
    expect(brainRequirementForChatTurn({ usesTools: false }).required).toEqual(baseline)
    expect(brainRequirementForChatTurn({ reasoningRequested: false }).required).toEqual(baseline)
    expect(brainRequirementForChatTurn({ hasImageInput: false, reasoningRequested: false, usesTools: false }).required)
      .toEqual(baseline)
  })

  it('k/l/m/n: audioInput, videoInput, audioOutput and realtime are never invented', () => {
    const never: readonly LiaBrainCapability[] = ['audioInput', 'videoInput', 'audioOutput', 'realtime']
    for (const facts of combinations()) {
      const required = brainRequirementForChatTurn(facts).required
      for (const capability of never)
        expect(required, `${capability} for ${JSON.stringify(facts)}`).not.toContain(capability)
    }
    // Even a turn that carries every supported signal stays free of them.
    expect(brainRequirementForChatTurn({ hasImageInput: true, reasoningRequested: true, usesTools: true }).required)
      .toEqual(['textInput', 'imageInput', 'textOutput', 'reasoning', 'toolCalling'])
  })

  it('o: the required order is stable and follows the canonical capability order', () => {
    for (const facts of combinations()) {
      const required = brainRequirementForChatTurn(facts).required
      const positions = required.map(capability => CANONICAL_ORDER.indexOf(capability))
      expect(positions, JSON.stringify(facts)).toEqual([...positions].sort((a, b) => a - b))
      expect(positions).not.toContain(-1)
      // textInput always leads, textOutput always follows the input block.
      expect(required[0]).toBe('textInput')
      expect(required.indexOf('textOutput')).toBeGreaterThan(required.indexOf('textInput'))
    }
  })

  it('p: duplicate capability entries cannot occur', () => {
    for (const facts of combinations()) {
      const required = brainRequirementForChatTurn(facts).required
      expect(new Set(required).size, JSON.stringify(facts)).toBe(required.length)
    }
  })

  it('q: the facts object is never mutated, and answers are deterministic', () => {
    const facts = Object.freeze({ hasImageInput: true, reasoningRequested: true, usesTools: true })
    const before = JSON.stringify(facts)
    const first = brainRequirementForChatTurn(facts)
    const second = brainRequirementForChatTurn(facts)
    expect(JSON.stringify(facts)).toBe(before)
    expect(first).toEqual(second)
    // A frozen caller object is accepted as-is.
    expect(first.required).toEqual(['textInput', 'imageInput', 'textOutput', 'reasoning', 'toolCalling'])
  })

  it('r: no provider/model identity exists in the helper', () => {
    const source = readSource('./chat-requirement.ts')
    expect(source).not.toMatch(/groq|gpt-oss|qwen|openai|anthropic|gemini|claude|mistral|ollama|deepseek|cerebras/i)
  })

  it('s: no Brain-service, router, config, network or filesystem side effects exist', () => {
    const source = readSource('./chat-requirement.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|electron)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env/)
    // It neither decides nor orchestrates: no service, no catalog, no router,
    // no product config, no eligibility.
    expect(source).not.toMatch(/LiaBrainService|decideBrainRoute|createProductionBrainCatalog|createBrainEngineRegistry/)
    expect(source).not.toMatch(/readLiaProductConfig|updateLiaProductConfig|satisfiesBrainCapabilities/)
    // Value imports: none. The single import is the erased requirement type.
    expect(source.split('\n').filter(line => line.startsWith('import ')))
      .toEqual(['import type { LiaBrainCapability, LiaBrainCapabilityRequirement } from \'./capabilities\''])
  })

  it('t: the current chat execution path neither routes through Brain nor consumes this helper yet', () => {
    // The real chat turn path: the send store, the runtime that turns turn
    // attachments into content parts, and the renderer send site.
    const chatPath = [
      '../../../../packages/stage-ui/src/stores/chat.ts',
      '../../../../packages/core-agent/src/runtime/chat-orchestrator-runtime.ts',
      '../../../../apps/stage-tamagotchi/src/renderer/components/InteractiveArea.vue',
    ]
    for (const relative of chatPath) {
      const source = readSource(relative)
      expect(source, relative).not.toMatch(/LiaBrainService|liaBrain\b|decideBrainRoute|brainRequirementForChatTurn/)
    }

    // And the helper's ONLY consumer outside lia-core is the read-only Brain
    // decision bridge (Phase 8.0D-7), which maps chat facts in main. Nothing
    // in a chat execution path consumes it: the helper defines the contract,
    // the bridge exposes it, and no conversation code calls either yet.
    const airiDir = fileURLToPath(new URL('../../../../', import.meta.url))
    const consumers: string[] = []
    for (const root of ['apps', 'packages']) {
      for (const workspace of readdirSync(`${airiDir}/${root}`, { withFileTypes: true })) {
        if (!workspace.isDirectory() || workspace.name === 'lia-core')
          continue
        const srcDir = `${airiDir}/${root}/${workspace.name}/src`
        let entries
        try {
          entries = readdirSync(srcDir, { recursive: true, withFileTypes: true })
        }
        catch {
          continue
        }
        for (const entry of entries) {
          if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
            continue
          const file = `${entry.parentPath}/${entry.name}`
          if (/brainRequirementForChatTurn|LiaChatTurnBrainFacts/.test(readFileSync(file, 'utf-8')))
            consumers.push(file.slice(airiDir.length))
        }
      }
    }
    expect(consumers.sort()).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
      'apps/stage-tamagotchi/src/shared/eventa/index.ts',
    ])
  })
})
