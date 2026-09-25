import type { LiaBrainRouteRef } from '../brain/selection'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { GROQ_BRAIN_ENGINE_ID, GROQ_BRAIN_MODEL_ID } from '../brain/adapters/groq'
import { createProductionBrainAutomaticPolicy } from './brain-policy'

/**
 * Phase 8.0D-8: the trusted production automatic Brain policy.
 *
 * Real behavior throughout: the factory is called for real, and every id is
 * compared against the provider adapter's own constants and the production
 * catalog's own descriptors - so the policy can neither drift from the
 * shipped identities nor invent one.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('production automatic brain policy (Phase 8.0D-8)', () => {
  it('a: the policy declares exactly one route', () => {
    const policy = createProductionBrainAutomaticPolicy()
    expect(policy.routes).toHaveLength(1)
    expect(policy.routes[0]).toEqual({ engineId: GROQ_BRAIN_ENGINE_ID, modelId: GROQ_BRAIN_MODEL_ID })
  })

  it('b/c: the route reuses the canonical adapter ids - no restated literals', () => {
    const [route] = createProductionBrainAutomaticPolicy().routes

    // B/C: identity with the provider adapter's own constants.
    expect(route.engineId).toBe(GROQ_BRAIN_ENGINE_ID)
    expect(route.modelId).toBe(GROQ_BRAIN_MODEL_ID)

    // The module imports them instead of spelling them out: no raw vendor
    // string or model literal appears in the policy code at all.
    const source = stripComments(readSource('./brain-policy.ts'))
    expect(source).not.toMatch(/'groq'|"groq"|gpt-oss/i)
    expect(source).toContain('GROQ_BRAIN_ENGINE_ID')
    expect(source).toContain('GROQ_BRAIN_MODEL_ID')
    expect(source).toContain('from \'../brain/adapters/groq\'')
  })

  it('d/e: nothing about the route is derived from catalog, candidate or registry order', () => {
    const source = stripComments(readSource('./brain-policy.ts'))

    // D: no catalog composition, no descriptor array position, no "first".
    expect(source).not.toMatch(/createProductionBrainCatalog|catalog|descriptor/i)
    expect(source).not.toMatch(/\.engines|\.models|\[\s*0\s*\]/)
    // E: no registry, no composed candidates, no ordering operation.
    expect(source).not.toMatch(/registry|routes\.(?:find|filter|map|sort|reverse)|eligibleBrainModelRoutes|selectBrainRouteByPolicy/)
    expect(source).not.toMatch(/\bsort\(|\breverse\(|\bfind\(|\bfilter\(/)
    // The only imports are the erased policy TYPE (from the generic domain)
    // and the adapter's ids - never config, catalog, registry, route
    // composition, selection logic or the runtime bridge.
    expect(source).toContain('from \'../brain/selection\'')
    expect(source).not.toMatch(/from ['"](?:\.\.\/)?(?:product\/config|brain\/(?:catalog|engine-registry|routes|resolver|decision|runtime))['"]/)
    expect(source).not.toMatch(/from ['"](?:\.\.\/)*product\/config['"]/)
  })

  it('f/g/h: every call returns fresh, independently owned policy data', () => {
    const first = createProductionBrainAutomaticPolicy()
    const second = createProductionBrainAutomaticPolicy()

    // F: fresh policy objects; G: fresh routes arrays; and the route refs too.
    expect(first).not.toBe(second)
    expect(first.routes).not.toBe(second.routes)
    expect(first.routes[0]).not.toBe(second.routes[0])

    // H: mutating one result (even brutally) cannot reach a later call - and
    // the module holds no process-global policy object to damage.
    ;(first.routes as LiaBrainRouteRef[]).push({ engineId: 'other-engine', modelId: 'other-model' })
    ;(first.routes[0] as { engineId: string }).engineId = 'mutated'
    const third = createProductionBrainAutomaticPolicy()
    expect(third.routes).toHaveLength(1)
    expect(third.routes[0]).toEqual({ engineId: GROQ_BRAIN_ENGINE_ID, modelId: GROQ_BRAIN_MODEL_ID })
    // The FIRST shape is still the declared one when read through a fresh call.
    expect(createProductionBrainAutomaticPolicy()).toEqual({ routes: [{ engineId: GROQ_BRAIN_ENGINE_ID, modelId: GROQ_BRAIN_MODEL_ID }] })
  })

  it('h: the declaration itself carries no mutable shared array', () => {
    const source = readSource('./brain-policy.ts')
    // The array is built INSIDE the factory (returned literal) - never a
    // module-level constant that callers would share.
    const moduleScope = source.slice(0, source.indexOf('export function'))
    expect(moduleScope).not.toMatch(/=\s*\[|routes\s*:/)
    expect(stripComments(source).match(/return \{/g)).toHaveLength(1)
  })

  it('i: pure declaration - no config, environment, network, filesystem or SDK side effect', () => {
    const source = stripComments(readSource('./brain-policy.ts'))
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|os|path)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios|sdk/i)
    expect(source).not.toMatch(/process\.env|import\.meta\.env|readFile|writeFile|vault|secret|apiKey/i)
    // No product-config, credentials or secret access of any kind.
    expect(source).not.toMatch(/readLiaProductConfig|config|credential|token|key/i)
    // Behavior: calling it repeatedly has no observable side effect beyond
    // returning the same declared value.
    expect(createProductionBrainAutomaticPolicy()).toEqual(createProductionBrainAutomaticPolicy())
  })

  it('j: the generic Brain domain modules stay unaware of any production policy', () => {
    const brainDir = fileURLToPath(new URL('../brain/', import.meta.url))
    const genericFiles = readdirSync(brainDir, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.'))

    const aware: string[] = []
    for (const entry of genericFiles) {
      const source = readFileSync(`${entry.parentPath}/${entry.name}`, 'utf-8')
      if (/createProductionBrainAutomaticPolicy|brain-policy|product\/brain-policy/.test(source))
        aware.push(entry.name)
    }
    expect(aware).toEqual([])

    // The policy type stays generic (it already existed); the product module
    // adds a declaration, not a new domain concept.
    const root = stripComments(readSource('../index.ts'))
    expect(root.match(/createProductionBrainAutomaticPolicy/g)).toHaveLength(1)
    expect(root).toContain('from \'./product/brain-policy\'')
    // Adapter id constants stay internal to Lia Core: not widened at the root.
    expect(root).not.toMatch(/GROQ_BRAIN_ENGINE_ID|GROQ_BRAIN_MODEL_ID/)

    // And the policy module's only in-package consumer is that root entry.
    const srcDir = fileURLToPath(new URL('../', import.meta.url))
    const importers: string[] = []
    for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.includes('.test.') || entry.name === 'brain-policy.ts')
        continue
      const relative = `${entry.parentPath}/${entry.name}`.slice(srcDir.length)
      if (/from '(?:\.\/product\/brain-policy|\.\/brain-policy|\.\.\/product\/brain-policy)'/.test(readFileSync(`${entry.parentPath}/${entry.name}`, 'utf-8')))
        importers.push(relative)
    }
    expect(importers).toEqual(['/index.ts'])
  })
})
