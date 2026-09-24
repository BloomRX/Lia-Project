import type { LiaBrainModelRoute } from './routes'
import type { LiaBrainAutomaticSelectionPolicy, LiaBrainRouteRef } from './selection'
import type { LiaBrainCapabilities, LiaBrainEngineDescriptor, LiaBrainModelDescriptor } from './types'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { selectBrainRouteByPolicy } from './selection'

/**
 * Phase 8.0C-3C: the selection policy - explicit order in, one decision
 * out. No hidden default policy may exist here.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

const CAPS: LiaBrainCapabilities = {
  audioInput: false,
  audioOutput: false,
  imageInput: false,
  realtime: false,
  reasoning: false,
  textInput: true,
  textOutput: true,
  toolCalling: false,
  videoInput: false,
}

function engine(id: string): LiaBrainEngineDescriptor {
  return { availability: 'available', capabilities: CAPS, id, modelIds: [], name: `Engine ${id}` }
}

function model(id: string, engineId: string): LiaBrainModelDescriptor {
  return { capabilities: CAPS, engineId, id, name: `Model ${id}` }
}

function route(engineId: string, modelId: string): LiaBrainModelRoute {
  return { engine: engine(engineId), model: model(modelId, engineId) }
}

function ref(engineId: string, modelId: string): LiaBrainRouteRef {
  return { engineId, modelId }
}

function policy(...routes: LiaBrainRouteRef[]): LiaBrainAutomaticSelectionPolicy {
  return { routes }
}

describe('automatic route selection policy (8.0C-3C)', () => {
  it('a: an empty candidate set -> noCandidates, whatever the policy says', () => {
    expect(selectBrainRouteByPolicy([], policy())).toEqual({ status: 'noCandidates' })
    expect(selectBrainRouteByPolicy([], policy(ref('e-alpha', 'm-alpha')))).toEqual({ status: 'noCandidates' })
  })

  it('b: one candidate the policy names -> selected, with the very route object', () => {
    const only = route('e-alpha', 'm-alpha')
    const result = selectBrainRouteByPolicy([only], policy(ref('e-alpha', 'm-alpha')))
    expect(result.status).toBe('selected')
    if (result.status !== 'selected')
      return
    expect(result.route).toBe(only)
  })

  it('c: several candidates, first policy ref matching -> that exact route is selected', () => {
    const alpha = route('e-alpha', 'm-alpha')
    const beta = route('e-beta', 'm-beta')
    const result = selectBrainRouteByPolicy([alpha, beta], policy(ref('e-alpha', 'm-alpha'), ref('e-beta', 'm-beta')))
    expect(result.status).toBe('selected')
    if (result.status !== 'selected')
      return
    expect(result.route).toBe(alpha)
  })

  it('d: the POLICY order decides - not the candidate array order', () => {
    const alpha = route('e-alpha', 'm-alpha')
    const beta = route('e-beta', 'm-beta')

    // Policy declares beta first; candidates arrive in the opposite order.
    const forward = selectBrainRouteByPolicy([alpha, beta], policy(ref('e-beta', 'm-beta'), ref('e-alpha', 'm-alpha')))
    expect(forward.status).toBe('selected')
    if (forward.status !== 'selected')
      return
    expect(forward.route).toBe(beta)

    // Rotating the candidate array cannot change the decision.
    const reversed = selectBrainRouteByPolicy([beta, alpha], policy(ref('e-beta', 'm-beta'), ref('e-alpha', 'm-alpha')))
    expect(reversed.status).toBe('selected')
    if (reversed.status !== 'selected')
      return
    expect(reversed.route).toBe(beta)
  })

  it('e: candidates exist but the policy names none -> noPolicyMatch', () => {
    const candidates = [route('e-alpha', 'm-alpha'), route('e-beta', 'm-beta')]
    expect(selectBrainRouteByPolicy(candidates, policy(ref('e-ghost', 'm-ghost')))).toEqual({ status: 'noPolicyMatch' })
    expect(selectBrainRouteByPolicy(candidates, policy())).toEqual({ status: 'noPolicyMatch' })
  })

  it('f: ONE candidate the policy does not name -> still noPolicyMatch (no implicit winner)', () => {
    const only = route('e-alpha', 'm-alpha')
    expect(selectBrainRouteByPolicy([only], policy(ref('e-beta', 'm-beta')))).toEqual({ status: 'noPolicyMatch' })
    expect(selectBrainRouteByPolicy([only], policy())).toEqual({ status: 'noPolicyMatch' })
  })

  it('g: a lower-precedence entry decides when earlier entries name nothing', () => {
    const beta = route('e-beta', 'm-beta')
    const result = selectBrainRouteByPolicy(
      [route('e-alpha', 'm-alpha'), beta],
      policy(ref('e-ghost', 'm-ghost'), ref('e-missing', 'm-missing'), ref('e-beta', 'm-beta')),
    )
    expect(result.status).toBe('selected')
    if (result.status !== 'selected')
      return
    expect(result.route).toBe(beta)
  })

  it('h: once a higher-precedence identity matches, later entries are never consulted', () => {
    const alpha = route('e-alpha', 'm-alpha')
    const result = selectBrainRouteByPolicy(
      [alpha, route('e-beta', 'm-beta')],
      policy(ref('e-alpha', 'm-alpha'), ref('e-beta', 'm-beta')),
    )
    expect(result.status).toBe('selected')
    if (result.status !== 'selected')
      return
    expect(result.route).toBe(alpha)

    // Even when the winning identity is ambiguous, the lower entry does not
    // get a chance to rescue the call.
    const stuck = selectBrainRouteByPolicy(
      [route('e-alpha', 'm-alpha'), route('e-alpha', 'm-alpha'), route('e-beta', 'm-beta')],
      policy(ref('e-alpha', 'm-alpha'), ref('e-beta', 'm-beta')),
    )
    expect(stuck.status).toBe('ambiguous')
  })

  it('i: duplicate candidates for the winning identity -> ambiguous, never a silent choice', () => {
    const first = route('e-alpha', 'm-alpha')
    const second = route('e-alpha', 'm-alpha')
    const result = selectBrainRouteByPolicy([first, second], policy(ref('e-alpha', 'm-alpha')))
    expect(result.status).toBe('ambiguous')
    if (result.status !== 'ambiguous')
      return
    expect(result.ref).toEqual(ref('e-alpha', 'm-alpha'))
    // No candidate is handed back at all.
    expect('route' in result).toBe(false)
  })

  it('j: duplicate policy refs stay deterministic', () => {
    const alpha = route('e-alpha', 'm-alpha')

    // The first occurrence already establishes the identity...
    const repeated = selectBrainRouteByPolicy([alpha], policy(ref('e-alpha', 'm-alpha'), ref('e-alpha', 'm-alpha')))
    expect(repeated.status).toBe('selected')
    if (repeated.status !== 'selected')
      return
    expect(repeated.route).toBe(alpha)
    expect(selectBrainRouteByPolicy([alpha], policy(ref('e-alpha', 'm-alpha'), ref('e-alpha', 'm-alpha')))).toEqual(repeated)

    // ...and a repeated miss is still a miss.
    const missed = selectBrainRouteByPolicy([alpha], policy(ref('e-ghost', 'm-ghost'), ref('e-ghost', 'm-ghost')))
    expect(missed).toEqual({ status: 'noPolicyMatch' })
  })

  it('k/L: identity requires the EXACT engineId and the EXACT modelId', () => {
    const candidate = route('e-alpha', 'm-alpha')

    // Engine half must be exact.
    expect(selectBrainRouteByPolicy([candidate], policy(ref('e-alph', 'm-alpha')))).toEqual({ status: 'noPolicyMatch' })
    expect(selectBrainRouteByPolicy([candidate], policy(ref('E-ALPHA', 'm-alpha')))).toEqual({ status: 'noPolicyMatch' })
    expect(selectBrainRouteByPolicy([candidate], policy(ref('', 'm-alpha')))).toEqual({ status: 'noPolicyMatch' })

    // Model half must be exact too.
    expect(selectBrainRouteByPolicy([candidate], policy(ref('e-alpha', 'm-alph')))).toEqual({ status: 'noPolicyMatch' })
    expect(selectBrainRouteByPolicy([candidate], policy(ref('e-alpha', 'M-ALPHA')))).toEqual({ status: 'noPolicyMatch' })
    expect(selectBrainRouteByPolicy([candidate], policy(ref('e-alpha', '')))).toEqual({ status: 'noPolicyMatch' })

    // Both halves together are required - half-matches never select.
    const other = route('e-alpha', 'm-beta')
    expect(selectBrainRouteByPolicy([candidate, other], policy(ref('e-alpha', 'm-gamma')))).toEqual({ status: 'noPolicyMatch' })
  })

  it('m: the candidate array and its routes are never mutated', () => {
    const candidates = [route('e-alpha', 'm-alpha'), route('e-beta', 'm-beta')]
    const before = JSON.parse(JSON.stringify(candidates))

    selectBrainRouteByPolicy(candidates, policy(ref('e-beta', 'm-beta')))
    selectBrainRouteByPolicy(candidates, policy(ref('e-ghost', 'm-ghost')))

    expect(JSON.parse(JSON.stringify(candidates))).toEqual(before)
    expect(candidates[0].model.engineId).toBe('e-alpha')
  })

  it('n: the caller policy array is never mutated (nor its refs)', () => {
    const refs = Object.freeze([
      Object.freeze(ref('e-ghost', 'm-ghost')),
      Object.freeze(ref('e-alpha', 'm-alpha')),
    ])
    const frozenPolicy: LiaBrainAutomaticSelectionPolicy = Object.freeze({ routes: refs })
    const before = JSON.parse(JSON.stringify(frozenPolicy))

    const result = selectBrainRouteByPolicy([route('e-alpha', 'm-alpha')], frozenPolicy)
    expect(result.status).toBe('selected')
    expect(JSON.parse(JSON.stringify(frozenPolicy))).toEqual(before)
    expect(frozenPolicy.routes).toHaveLength(2)
  })

  it('o: display text, capabilities, availability and metadata never influence the decision', () => {
    const source = readSource('./selection.ts')
    // The selector touches ids only - these fields are never read at all.
    expect(source).not.toMatch(/\.name\b|\.metadata\b|\.capabilities\b|\.availability\b|displayName/)

    // Behavioral proof: identical ids decide, whatever the surrounding
    // decoration looks like.
    const decorated: LiaBrainModelRoute = {
      engine: { ...engine('e-alpha'), availability: 'unsupported', capabilities: { ...CAPS, realtime: true }, name: 'Fancier Engine' },
      model: { ...model('m-alpha', 'e-alpha'), metadata: { cost: 0 }, name: 'Fancier Model' },
    }
    const plain = route('e-alpha', 'm-alpha')
    for (const winner of [decorated, plain]) {
      const result = selectBrainRouteByPolicy([winner], policy(ref('e-alpha', 'm-alpha')))
      expect(result.status).toBe('selected')
      if (result.status !== 'selected')
        return
      expect(result.route).toBe(winner)
    }
  })

  it('p: no candidate-order, spelling-based, score-based or otherwise implicit selection exists', () => {
    const source = readSource('./selection.ts')
    expect(source).not.toMatch(/rank|score|priority|weight|fallback|alphabet|sort\(|\bbest\b|\bpick\b|\bchoose\b/i)
    // No positional shortcut over the candidate array either.
    expect(source).not.toMatch(/candidates\[/)
    // The selector takes composed routes + policy ONLY.
    expect(source).not.toMatch(/LiaBrainEngineDescriptor|LiaBrainModelDescriptor/)
    expect(source).toMatch(/selectBrainRouteByPolicy\(\s*candidates: readonly LiaBrainModelRoute\[\],\s*policy: LiaBrainAutomaticSelectionPolicy,?\s*\)/)

    // Behavioral proof: with an unchanged policy, permuting candidates
    // cannot change WHO wins, only which object instance is returned.
    const alpha = route('e-alpha', 'm-alpha')
    const beta = route('e-beta', 'm-beta')
    const first = selectBrainRouteByPolicy([alpha, beta], policy(ref('e-beta', 'm-beta')))
    const second = selectBrainRouteByPolicy([beta, alpha], policy(ref('e-beta', 'm-beta')))
    expect(first.status).toBe('selected')
    expect(second.status).toBe('selected')
    if (first.status !== 'selected' || second.status !== 'selected')
      return
    expect([first.route.engine.id, first.route.model.id]).toEqual([second.route.engine.id, second.route.model.id])
  })

  it('q: no config/network/filesystem/registry side effects, and decisions are deterministic', () => {
    const source = readSource('./selection.ts')
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios/)
    expect(source).not.toMatch(/readFile|writeFile|process\.env/)
    expect(source).not.toContain('createBrainEngineRegistry')

    const candidates = [route('e-alpha', 'm-alpha')]
    const declared = policy(ref('e-alpha', 'm-alpha'))
    expect(selectBrainRouteByPolicy(candidates, declared)).toEqual(selectBrainRouteByPolicy(candidates, declared))
  })
})
