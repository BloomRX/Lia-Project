import type { LiaProductConfigSnapshot } from '@lia/core'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainService } from './services/lia/lia-brain-service'

/**
 * Phase 8.0D-5: the Brain service's production lifecycle ownership.
 *
 * Two kinds of proof, both against the REAL artifacts:
 * - the composition contract, read straight from the Stage-main entry
 *   (the entry itself cannot be imported here - importing it would launch
 *   Electron - so its wiring is pinned structurally, the same way the other
 *   composition guards in this app work);
 * - the factory contract the composition relies on, exercised through the
 *   real `createLiaBrainService` with the Lia Core entry spied.
 * The service still has ZERO consumers: nothing below makes chat use it.
 */

const core = vi.hoisted(() => ({
  createProductionBrainCatalog: vi.fn(),
}))

vi.mock('@lia/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lia/core')>()
  core.createProductionBrainCatalog.mockImplementation(actual.createProductionBrainCatalog)
  return {
    ...actual,
    createProductionBrainCatalog: core.createProductionBrainCatalog,
  }
})

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

/** The Stage-main entry, as the lifecycle actually ships it. */
const mainEntry = (): string => readSource('./index.ts')

/**
 * Code without comments - the intent comments around the wiring legitimately
 * name the very words ("requirement", "policy", "decide") that the scans
 * below must only find in executable code.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** The exact block that owns the Brain service in the composition. */
function brainProvideBlock(source: string): string {
  const start = source.indexOf('const liaBrain = injeca.provide(\'services:lia-brain\'')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('\n  })', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end + 5)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('lia brain service lifecycle ownership (Phase 8.0D-5)', () => {
  it('a/b: the Stage composition owns the service through the canonical config dependency', () => {
    const block = brainProvideBlock(mainEntry())
    // The factory is reached through its own module...
    expect(mainEntry()).toContain('import { createLiaBrainService } from \'./services/lia/lia-brain-service\'')
    // ...created with the EXISTING canonical product-config owner...
    expect(block).toContain('dependsOn: { liaProductConfig }')
    expect(block).toContain('createLiaBrainService({ liaProductConfig: dependsOn.liaProductConfig })')
    // ...and the catalog is NOT built here: its ownership stays inside the factory.
    expect(mainEntry()).not.toContain('createProductionBrainCatalog')
  })

  it('c: the lifecycle owns exactly ONE Brain service instance', () => {
    const source = mainEntry()
    // One provider registration for the whole main process...
    // The EXACT id, not a prefix: 8.0D-10B-4B2 adds a sibling provider
    // (`services:lia-brain-correlation`) that must not be confused with this one.
    expect(source.match(/services:lia-brain'/g)).toHaveLength(1)
    expect(source.match(/services:lia-brain-correlation'/g)).toHaveLength(1)
    // ...and exactly five references to the handle: its declaration, the boot
    // invoke that materializes it, that invoke's touch, and the read-only
    // decision bridge (8.0D-7) that receives the SAME instance - its invoke
    // dependency plus the handle it passes on. No other seam receives it.
    expect(source.match(/\bliaBrain\b/g)).toHaveLength(5)
    expect(source.match(/dependsOn: \{ liaBrain \}/g)).toHaveLength(2)
    expect(source.match(/createLiaBrainService\(/g)).toHaveLength(1)
    // No module-global singleton outside the container's ownership.
    const block = brainProvideBlock(source)
    expect(block).not.toMatch(/let |var |globalThis|module\.exports/)
  })

  it('d/e/f/g: boot materializes the service without evaluating any routing input', () => {
    const source = stripComments(mainEntry())
    const boot = source.slice(source.indexOf('injeca.invoke({', source.lastIndexOf('const liaBrain')))
    const bootInvoke = boot.slice(0, boot.indexOf('injeca.start()'))

    // The boot path touches the handle and nothing else: no decision call,
    // no capability requirement, no automatic policy, no mode/preference read.
    expect(bootInvoke).toContain('void deps.liaBrain')
    expect(bootInvoke).not.toMatch(/\.decide\(/)
    expect(bootInvoke).not.toMatch(/requirement|automaticPolicy|policy/i)
    expect(bootInvoke).not.toMatch(/mode|preferred/i)
    // Nowhere in the whole entry is a Brain decision requested.
    expect(source).not.toMatch(/decideBrainRoute|\.decide\(/)
    // No requirement or policy literal is defined anywhere in the lifecycle.
    expect(source).not.toMatch(/automaticPolicy|required:/)
  })

  it('h/i: the lifecycle stays provider-neutral', () => {
    const source = mainEntry()
    expect(source).not.toMatch(/groq|gpt-oss|qwen|descriptors?\b/i)
    expect(source).not.toMatch(/groqBrainDescriptors|brain\/adapters|createBrainEngineRegistry/)
    // The single Brain import is the host service module.
    expect(source.match(/from '\.\/services\/lia\/lia-brain/g)).toHaveLength(1)
  })

  it('j: the Brain renderer surface is the read-only decision request plus the one-way execution report', () => {
    // Phase 8.0D-7 added exactly one renderer-facing Brain seam: a read-only
    // invoke. Phase 8.0D-10B-4A adds exactly one more, and it is a one-way
    // REPORT (renderer -> main, no response, no authority). Nothing else may
    // cross: no setter, no command, no selector, no comparison result, no
    // catalog or registry exposure, no service handle.
    const shared = readSource('../shared/eventa/index.ts')
    const brainChannels = shared.match(/eventa:(?:invoke|event:):?lia:brain[^']*/g) ?? []
    expect(brainChannels).toEqual([
      'eventa:invoke:lia:brain:chat-decision',
      'eventa:event:lia:brain:execution-observation',
    ])
    expect(shared).not.toMatch(/eventa:event:lia:brain:(?!execution-observation)/)
    expect(shared).not.toMatch(/electronLiaBrainChatDecisionSet/)
    for (const relative of ['../preload/index.ts', '../renderer/stores/lia/provider.ts']) {
      expect(readSource(relative), relative).not.toMatch(/brain/i)
    }
    // The service module itself imports no Electron/Eventa seam: the bridge
    // is a separate module that receives the service as a dependency.
    const service = readSource('./services/lia/lia-brain-service.ts')
    expect(service).not.toMatch(/electron|eventa|ipcMain|ipcRenderer|defineInvokeHandler/)
  })

  it('k/l: no chat/provider module imports the service or calls a decision', () => {
    const stageSrc = fileURLToPath(new URL('../', import.meta.url))
    const offenders: string[] = []
    for (const entry of readdirSync(stageSrc, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const file = `${entry.parentPath}/${entry.name}`
      const relative = file.slice(stageSrc.length)
      // Host-side Brain modules are the legitimate holders: the service
      // itself, the composition entry that owns it, and the read-only bridge
      // that receives it as a dependency.
      if (
        relative.startsWith('main/services/lia/lia-brain-service.ts')
        || relative === 'main/index.ts'
        || relative.startsWith('main/services/lia/brain-decision-service.ts')
      ) {
        continue
      }
      const source = readFileSync(file, 'utf-8')
      if (/LiaBrainService|createLiaBrainService|liaBrain\b|decideBrainRoute/.test(source))
        offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })

  it('m: the current chat/provider behavior is structurally unchanged', () => {
    // Provider-config bridge: still exactly the config owner dependency it had.
    const source = mainEntry()
    const providerBridge = source.slice(source.indexOf('registerLiaProviderConfigBridge({ context'))
    expect(providerBridge.slice(0, 200)).toContain('liaProductConfig: deps.liaProductConfig')

    // The chat/provider paths carry no Brain reference at all.
    for (const relative of [
      './services/lia/provider-config-service.ts',
      './services/lia/lia-voice-service.ts',
      './services/lia/main-window-voice-runtime.ts',
    ]) {
      expect(readSource(relative), relative).not.toMatch(/brain/i)
    }
    // And the composition wires the Brain service into nothing chat-related.
    const block = brainProvideBlock(source)
    expect(block).not.toMatch(/provider|chat|voice|persona/i)
  })

  it('n: a catalog invariant failure is never swallowed into an empty service', () => {
    // Construction failure propagates out of the factory...
    const invariantFailure = new Error('[lia:brain-catalog] engine \'x\' was refused (duplicate-engine-id)')
    core.createProductionBrainCatalog.mockImplementationOnce(() => {
      throw invariantFailure
    })
    expect(() => createLiaBrainService({ liaProductConfig: { get: () => undefined } }))
      .toThrow(invariantFailure)

    // ...and the composition neither catches it nor substitutes a fallback:
    // no try/catch around the provider block, no null/empty service literal.
    const source = mainEntry()
    const block = brainProvideBlock(source)
    expect(block).not.toMatch(/catch|try/)
    expect(block).not.toMatch(/null|undefined \?\?|fallback/i)
  })

  it('the factory contract the lifecycle depends on: one catalog per instance, no config read before decide', () => {
    // Construction composes the production catalog exactly once...
    const snapshot: LiaProductConfigSnapshot = { brain: { mode: 'manual' } }
    const get = vi.fn(() => snapshot)
    const service = createLiaBrainService({ liaProductConfig: { get } })
    expect(core.createProductionBrainCatalog).toHaveBeenCalledTimes(1)
    // ...and reads NOTHING from the product document: startup cannot evaluate
    // mode or preferences because it never asks for them.
    expect(get).toHaveBeenCalledTimes(0)

    // A second lifecycle instance is a distinct ownership boundary.
    const second = createLiaBrainService({ liaProductConfig: { get } })
    expect(core.createProductionBrainCatalog).toHaveBeenCalledTimes(2)
    expect(second).not.toBe(service)
    expect(get).toHaveBeenCalledTimes(0)

    // Only an explicit decide(...) reads the current document.
    service.decide({ requirement: { required: ['textInput'] } })
    expect(get).toHaveBeenCalledTimes(1)
  })
})
