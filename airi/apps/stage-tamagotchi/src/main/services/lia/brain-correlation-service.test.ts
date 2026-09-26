import type { LiaBrainRoutingDecision } from '@lia/core'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createContainer, provide, resolve } from 'injeca'
import { describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationService, LIA_BRAIN_CORRELATION_MAX_ENTRIES, LIA_BRAIN_CORRELATION_TTL_MS } from './brain-correlation-service'

/**
 * Phase 8.0D-10B-4B2: production lifecycle ownership of the ephemeral
 * correlation store.
 *
 * Two kinds of proof, both against the REAL artifacts:
 * - the composition contract, read straight from the Stage-main entry (the
 *   entry itself cannot be imported here - importing it would launch Electron -
 *   so its wiring is pinned structurally, the same way the other composition
 *   guards in this app work);
 * - the ownership contract, exercised through the REAL Injeca container the
 *   lifecycle uses (no second DI framework, no hand-rolled registry) with the
 *   REAL service factory.
 *
 * The store is still record-free by design: nothing wires a handler into it,
 * and materialization leaves it empty.
 */

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** The Stage-main entry, as the lifecycle actually ships it. */
const mainEntry = (): string => readSource('../../index.ts')

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

/**
 * Production sources whose CODE (comments stripped) matches the pattern, in
 * stable order - a doc comment that merely names a factory is not a call site.
 */
function productionSourcesMatching(roots: string[], pattern: RegExp): string[] {
  return productionSources(roots)
    .filter(relative => pattern.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
    .sort()
}

const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']

/** A canonical decision, so the store has real content to hold. */
function decision(engineId = 'groq'): LiaBrainRoutingDecision {
  return {
    id: 'decision-1',
    mode: 'automatic',
    readiness: { status: 'ready' },
    required: ['textInput', 'textOutput'],
    selection: { engine: { id: engineId }, model: { id: 'openai/gpt-oss-120b' }, status: 'selected' },
    status: 'automatic',
  } as unknown as LiaBrainRoutingDecision
}

function report(correlationId: string, roundId: string) {
  return { correlationId, conversationId: 'conversation-1', roundId, providerId: 'groq', modelId: 'openai/gpt-oss-120b' }
}

/** Builds a container the SAME way the composition does, over the real factory. */
function lifecycleContainer(factory: () => unknown = createLiaBrainCorrelationService) {
  const container = createContainer()
  const service = provide(container, 'services:lia-brain-correlation', factory as never)
  return { container, service }
}

describe('lia brain correlation service - lifecycle ownership (Phase 8.0D-10B-4B2)', () => {
  it('a/b/c/e: the lifecycle provider creates the store once and resolves the SAME instance', async () => {
    const factory = vi.fn(() => createLiaBrainCorrelationService())
    const { container, service } = lifecycleContainer(factory)

    // A: the provider is a real factory - nothing is built before resolution.
    expect(factory).not.toHaveBeenCalled()

    const first = await resolve(container, { service })
    expect(first.service).toBeDefined()
    // A/B: exactly one build per container.
    expect(factory).toHaveBeenCalledTimes(1)
    // E: a freshly materialized store holds nothing.
    expect(first.service.size).toBe(0)

    // C: repeated resolution returns the very same store instance.
    const second = await resolve(container, { service })
    expect(second.service).toBe(first.service)
    expect(factory).toHaveBeenCalledTimes(1)

    // And the resolved object really is the bounded store API, not a wrapper
    // with extra powers.
    expect(Object.keys(first.service).sort()).toEqual(['get', 'recordDecision', 'recordExecution', 'size'])
  })

  it('d: a second independent lifecycle receives a different instance', async () => {
    const a = lifecycleContainer()
    const b = lifecycleContainer()
    const resolvedA = await resolve(a.container, { service: a.service })
    const resolvedB = await resolve(b.container, { service: b.service })

    expect(resolvedA.service).not.toBe(resolvedB.service)
    // Independent state, too: content in one is invisible to the other.
    resolvedA.service.recordDecision('X', decision())
    expect(resolvedA.service.size).toBe(1)
    expect(resolvedB.service.size).toBe(0)
    expect(resolvedB.service.get('X')).toBeUndefined()
  })

  it('f/n: materializing the service performs no action and records nothing', async () => {
    const probe = { decisions: 0, emits: 0 }
    const decider = vi.fn(() => {
      probe.decisions += 1
      return decision()
    })

    const { container, service } = lifecycleContainer(() => {
      // The factory is the only thing that runs during materialization.
      const store = createLiaBrainCorrelationService()
      expect(store.size).toBe(0)
      return store
    })
    const resolved = await resolve(container, { service })

    // F/J/K/L/M/N: boot/build invokes nothing - no decision, no provider or
    // model lookup, no Eventa/IPC emission, no chat action, no entry.
    expect(decider).not.toHaveBeenCalled()
    expect(probe).toEqual({ decisions: 0, emits: 0 })
    expect(resolved.service.size).toBe(0)
    expect(resolved.service.get('anything')).toBeUndefined()

    // No synthetic entry of any shape can appear from materialization alone.
    for (const key of ['X', '', 'boot', 'warmup', 'test'])
      expect(resolved.service.get(key)).toBeUndefined()
    expect(resolved.service.size).toBe(0)
  })
})

describe('lia brain correlation service - production configuration (Phase 8.0D-10B-4B2)', () => {
  it('the production bounds are the named constants, and only the service owns them', () => {
    // The canonical instance uses exactly these bounds - no other value exists
    // in production, and the pure factory never gained a default of its own.
    expect(LIA_BRAIN_CORRELATION_MAX_ENTRIES).toBe(256)
    expect(LIA_BRAIN_CORRELATION_TTL_MS).toBe(900_000)
    expect(LIA_BRAIN_CORRELATION_TTL_MS).toBe(15 * 60 * 1000)

    const service = stripComments(readSource('./brain-correlation-service.ts'))
    expect(service).toContain('maxEntries: LIA_BRAIN_CORRELATION_MAX_ENTRIES')
    expect(service).toContain('ttlMs: LIA_BRAIN_CORRELATION_TTL_MS')
    expect(service.match(/createLiaBrainCorrelationStore\(/g)).toHaveLength(1)
    // No other module CALLS the pure store factory with bounds of its own
    // (the factory's own definition is not a call site).
    expect(productionSourcesMatching(
      ['apps/stage-tamagotchi/src'],
      /(?<!function )createLiaBrainCorrelationStore\(/,
    )).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
    ])
  })

  it('g/h/i: the production bound reaches the pure store', () => {
    const service = createLiaBrainCorrelationService()

    // G: exactly maxEntries distinct keys are permitted.
    for (let index = 0; index < LIA_BRAIN_CORRELATION_MAX_ENTRIES; index += 1)
      service.recordDecision(`send-${index}`, decision())
    expect(service.size).toBe(LIA_BRAIN_CORRELATION_MAX_ENTRIES)
    expect(service.get('send-0')).toBeDefined()

    // H: the 257th key does not grow the store.
    service.recordDecision('send-overflow', decision())
    expect(service.size).toBe(LIA_BRAIN_CORRELATION_MAX_ENTRIES)

    // I: and the entry that made room for it is the OLDEST one - creation
    // order, never a ranking of decisions or providers.
    expect(service.get('send-0')).toBeUndefined()
    expect(service.get('send-1')).toBeDefined()
    expect(service.get('send-overflow')?.decision).toBeDefined()
  })

  it('production TTL configuration: expiry at exactly 15 minutes, proven through the factory seam', () => {
    // The production constants are used by construction; the clock is the only
    // injected piece, so nothing here sleeps and nothing changes in production.
    let current = 1_000_000
    const service = createLiaBrainCorrelationService({ now: () => current })

    service.recordDecision('X', decision())
    service.recordExecution(report('X', 'round-a'))

    current += LIA_BRAIN_CORRELATION_TTL_MS - 1
    expect(service.get('X')).toBeDefined()
    expect(service.size).toBe(1)

    // Expired exactly at the production TTL - the lifespan is measured from
    // creation and is never extended by later reports.
    current += 1
    expect(service.get('X')).toBeUndefined()
    expect(service.size).toBe(0)

    // A later event with the same key starts a fresh entry.
    service.recordExecution(report('X', 'round-b'))
    expect(service.size).toBe(1)
    expect(service.get('X')?.decision).toBeUndefined()
    expect(service.get('X')?.executions.map(execution => execution.roundId)).toEqual(['round-b'])
  })

  it('production uses the default clock and exposes no other knob', () => {
    const source = stripComments(readSource('./brain-correlation-service.ts'))
    // Exactly one optional knob, and it is only spread in when provided - the
    // composition passes nothing, so production runs on the store's own clock.
    expect(source).toMatch(/options: \{ now\?: \(\) => number \} = \{\}/)
    expect(source).toMatch(/\.\.\.\(options\.now === undefined \? \{\} : \{ now: options\.now \}\)/)
    expect(source).not.toMatch(/Date\.now|setInterval|setTimeout/)

    // And the composition never passes a clock.
    const entry = stripComments(mainEntry())
    expect(entry).toContain('createLiaBrainCorrelationService()')
    expect(entry).not.toMatch(/createLiaBrainCorrelationService\(\{/)
  })
})

describe('lia brain correlation service - composition ownership (Phase 8.0D-10B-4B2)', () => {
  it('s/t/u: one provider owns it, and the entry only materializes it', () => {
    const entry = stripComments(mainEntry())

    // S: exactly one factory creates the production store...
    expect(entry.match(/createLiaBrainCorrelationService\(\)/g)).toHaveLength(1)
    // T: exactly one canonical lifecycle provider owns it (the quoted id keeps
    // the sibling observer provider of 8.0D-10B-4C4B from counting here - it is
    // a DIFFERENT provider id, not a second owner of this one)...
    expect(entry.match(/services:lia-brain-correlation'/g)).toHaveLength(1)
    expect(entry).toContain('const liaBrainCorrelation = injeca.provide(\'services:lia-brain-correlation\', () =>')
    // ...registered with the SAME DI mechanism as the Brain service - no second
    // framework, no getter, no module-level instance.
    expect(entry).toContain('injeca.provide(\'services:lia-brain\', {')
    expect(entry).not.toMatch(/new Function|globalThis\.\w*[Cc]orrelation|window\.\w*[Cc]orrelation/)

    // U: the entry materializes it exactly once and records nothing. Since
    // 8.0D-10B-4B3 the SAME handle is also injected into the two registration
    // seams, and since 8.0D-10B-4C4B the observer provider depends on it too -
    // none of those references records through the handle.
    // Since 8.0D-10B-4C4C the two registrations ALSO receive the lifecycle-owned
    // observer, so their dependency sets are the two explicit shapes below; the
    // single-dependency form is left to the observer provider and the boot
    // materialization. Every occurrence is enumerated - nothing is inferred.
    expect(entry.match(/dependsOn: \{ liaBrainCorrelation \}/g)).toHaveLength(2)
    expect(entry.match(/dependsOn: \{ liaBrainCorrelation, liaBrainCorrelationObserver \}/g)).toHaveLength(1)
    expect(entry.match(/dependsOn: \{ liaBrain, liaBrainCorrelation, liaBrainCorrelationObserver \}/g)).toHaveLength(1)
    expect(entry.match(/liaBrainCorrelation \}/g) ?? []).toHaveLength(3)
    // The observer handle of 8.0D-10B-4C4B shares the name prefix, so the
    // materialization counts are pinned with a word boundary on both sides:
    // the correlation service is voided once, the observer once.
    expect(entry.match(/void deps\.liaBrainCorrelation\b/g)).toHaveLength(1)
    expect(entry.match(/void deps\.liaBrainCorrelationObserver/g)).toHaveLength(1)
    // U (record-free boot invariant): every mention of the handle is a bare
    // reference - it is never read, never recorded into.
    const correlationLines = entry.split('\n').filter(line => line.includes('liaBrainCorrelation'))
    expect(correlationLines.length).toBeGreaterThan(1)
    for (const line of correlationLines)
      expect(line).not.toMatch(/recordDecision|recordExecution|\.get\(|\.size/)
  })

  it('v/w: no module-level instance, no second registry, no getter was introduced', () => {
    // The store and the service expose factories, never a ready-made instance.
    for (const relative of ['./brain-correlation-store.ts', './brain-correlation-service.ts']) {
      const source = stripComments(readSource(relative))
      expect(source, relative).not.toMatch(/^export const \w*[Cc]orrelation\w* = create/m)
      expect(source, relative).not.toMatch(/export function get\w*Correlation|export const \w*CorrelationInstance/)
      // No module-level mutable holder either.
      expect(source, relative).not.toMatch(/^(?:const|let) \w+ = new Map|^(?:const|let) \w+Store\b/m)
    }

    // Repo-wide: the store/service names appear in exactly the modules that own
    // them - the pure store, its factory, and the composition entry.
    expect(productionSourcesMatching(BRAIN_ROOTS, /brain-correlation-store|LiaBrainCorrelationStore|createLiaBrainCorrelationStore/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
      ])
    // Since 8.0D-10B-4B3 the two producers legitimately type their injected
    // dependency with the service surface - and still create nothing.
    expect(productionSourcesMatching(BRAIN_ROOTS, /brain-correlation-service|createLiaBrainCorrelationService|LiaBrainCorrelationService/))
      .toEqual([
        'apps/stage-tamagotchi/src/main/index.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-service.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
      ])
  })
})

describe('lia brain correlation service - isolation (Phase 8.0D-10B-4B2)', () => {
  it('o/p/q/r: the handlers, the reporter and the shared contract stay store-blind', () => {
    const storeReference = /brain-correlation-store|createLiaBrainCorrelationStore|LiaBrainCorrelationStore/

    // O/P: neither production handler may reach the STORE module directly - the
    // canonical service arrives as an injected dependency (8.0D-10B-4B3).
    expect(readSource('./brain-decision-service.ts')).not.toMatch(storeReference)
    expect(readSource('./brain-execution-report-service.ts')).not.toMatch(storeReference)
    // Q: the renderer reporter does not either.
    expect(readSource('../../../renderer/services/lia/execution-reporter.ts')).not.toMatch(storeReference)
    // R: and the shared Eventa contract names no correlation surface.
    expect(readSource('../../../shared/eventa/index.ts')).not.toMatch(storeReference)

    // Phase 8.0D-10B-4B3 legitimately wires the two producers into the store,
    // so this phase's invariant is the NARROW one: each producer only WRITES its
    // own side, and neither reads. The bridge has no execution side; the handler
    // has no decision side.
    const bridge = stripComments(readSource('./brain-decision-service.ts'))
    expect(bridge.match(/correlationStore\.recordDecision\(/g)).toHaveLength(1)
    expect(bridge).not.toMatch(/correlationStore\.recordExecution|correlationStore\.get\(|correlationStore\.size/)
    const handler = stripComments(readSource('./brain-execution-report-service.ts'))
    expect(handler.match(/correlationStore\.recordExecution\(/g)).toHaveLength(1)
    expect(handler).not.toMatch(/correlationStore\.recordDecision|correlationStore\.get\(|correlationStore\.size/)
    // The handler still sanitizes first and keeps nothing of its own.
    expect(handler).toContain('sanitizeLiaBrainExecutionObservationReport(')
    expect(handler).not.toMatch(/\.push\(|new Map|new Set/)
  })

  it('no new IPC channel, and the Brain allowlist is unchanged', () => {
    const source = stripComments(readSource('./brain-correlation-service.ts'))
    expect(source).not.toMatch(/eventa|defineEventa|defineInvokeEventa|defineInvokeHandler|ipcMain|ipcRenderer|BrowserWindow|\.emit\(/)

    const tags = new Set<string>()
    for (const relative of productionSources(BRAIN_ROOTS)) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
  })

  it('no comparison vocabulary and no execution authority in the owner', () => {
    const source = stripComments(readSource('./brain-correlation-service.ts'))

    // No interpretation of the facts, and none of the forbidden concepts.
    expect(source).not.toMatch(/match|mismatch|divergence|aligned|winner|verdict|score|expected|actual|compare|agreement/i)
    // No authority: no decision call, no provider/model selection, no policy or
    // config write, no fallback/retry, no chat action.
    expect(source).not.toMatch(/decide\(|LiaBrainService|brainRequirementForChatTurn|automaticPolicy|liaProductConfig|updateLiaProductConfig|fallback|retry|permission|useChatStore|chatStore/)
    expect(source).not.toMatch(/setInterval|setTimeout|from ['"](?:node:)?(fs|net|https?|child_process)['/]|\bfetch\(/)
    // The surface is the store's own four members - nothing was added.
    expect(source).not.toMatch(/recordComparison|reportMismatch|expectedProvider|expectedModel/)
  })

  it('aj/ab: the request-start observer count and the Brain allowlist stay exactly as they were', () => {
    expect(productionSourcesMatching(BRAIN_ROOTS, /(?<!function )registerLiaBrainExecutionObserver\(/))
      .toEqual(['apps/stage-tamagotchi/src/renderer/main.ts'])
    expect(productionSourcesMatching(BRAIN_ROOTS, /(?<!function )registerChatRequestStartedObserver\(/))
      .toEqual(['apps/stage-tamagotchi/src/renderer/services/lia/execution-reporter.ts'])
    expect(productionSourcesMatching(['packages/stage-ui/src'], /electronLiaBrain|LiaBrainChatDecision|brain-shadow|LiaBrainCorrelation/))
      .toEqual([])
    expect(productionSourcesMatching(['packages/core-agent/src'], /electronLiaBrain|LiaBrainChatDecision|brain-shadow|LiaBrainCorrelation/))
      .toEqual([])
    // The trusted automatic policy is still declared by the product layer and
    // created by the bridge - never by the correlation owner.
    expect(readSource('../../services/lia/brain-decision-service.ts')).toContain('createProductionBrainAutomaticPolicy()')
    expect(readSource('./brain-correlation-service.ts')).not.toMatch(/createProductionBrainAutomaticPolicy/)
  })
})
