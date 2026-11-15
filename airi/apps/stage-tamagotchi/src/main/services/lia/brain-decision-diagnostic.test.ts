import type { LiaBrainEngineDescriptor, LiaBrainModelDescriptor, LiaBrainRoutingDecision } from '@lia/core'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authoredSourceEntry, normalizeLineEndings } from '../../../test-helpers'
import {
  formatLiaBrainDecisionDiagnostic,
  logLiaBrainDecisionDiagnostic,
  selectLiaBrainDecisionDiagnosticLog,
} from './brain-decision-diagnostic'

/**
 * Phase 8.0D-M2: the focused proof of the DECISION diagnostic adapter.
 *
 * The per-send correlation line reports the EXECUTION identity of a send, and
 * every decision carrying no route collapses there into one factual state.
 * This adapter publishes the decision's OWN status, so the canonical routing
 * outcome of a turn is readable directly instead of being inferred from an
 * execution-side state - which is exactly what the first Windows gate of the
 * multimodal route had to do.
 *
 * The formatter is pure and deterministic, so every factual state is asserted
 * as an exact string. The logger is mocked at the module boundary: what matters
 * is that ONE decision causes exactly ONE informational call carrying exactly
 * the formatted line.
 */

/** Block and line comments removed, so a scan reads the code and not its prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const mocks = vi.hoisted(() => ({
  log: vi.fn(),
}))

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => ({ log: mocks.log }) }),
}))

const CAPABILITIES = {
  audioInput: false,
  audioOutput: false,
  imageInput: true,
  realtime: false,
  reasoning: true,
  textInput: true,
  textOutput: true,
  toolCalling: true,
  videoInput: false,
}

const ENGINE: LiaBrainEngineDescriptor = {
  availability: 'available',
  capabilities: CAPABILITIES,
  id: 'groq',
  modelIds: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
  name: 'Groq',
}

const TEXT_MODEL: LiaBrainModelDescriptor = {
  capabilities: { ...CAPABILITIES, imageInput: false },
  engineId: 'groq',
  id: 'openai/gpt-oss-120b',
  name: 'GPT-OSS 120B',
}

const VISION_MODEL: LiaBrainModelDescriptor = {
  capabilities: CAPABILITIES,
  engineId: 'groq',
  id: 'qwen/qwen3.8-27b',
  name: 'Qwen3.8 27B',
}

beforeEach(() => {
  mocks.log.mockClear()
})

describe('lia brain decision diagnostic - formatting (Phase 8.0D-M2)', () => {
  it('a: every no-route status is printed by its OWN name - never collapsed', () => {
    // This is the whole point of the adapter: these four states are
    // indistinguishable in the execution-identity line and distinct here.
    for (const decision of [
      { status: 'modeUnspecified' },
      { status: 'disabled' },
      { status: 'automaticPolicyMissing' },
    ] as LiaBrainRoutingDecision[]) {
      expect(formatLiaBrainDecisionDiagnostic(decision))
        .toBe(`[LIA-BRAIN-DECISION] status="${decision.status}"`)
    }
  })

  it('b: an automatic decision with no selected route reports the selector state and no route', () => {
    for (const selection of [{ status: 'noCandidates' }, { status: 'noPolicyMatch' }] as const) {
      const line = formatLiaBrainDecisionDiagnostic({ selection, status: 'automatic' })
      expect(line).toBe(`[LIA-BRAIN-DECISION] status="automatic" selection="${selection.status}"`)
      expect(line).not.toMatch(/selectedEngineId|selectedModelId/)
    }
  })

  it('c: an automatic decision with an ambiguous selection reports the state and no identities', () => {
    const line = formatLiaBrainDecisionDiagnostic({
      selection: { ref: { engineId: 'groq', modelId: 'openai/gpt-oss-120b' }, status: 'ambiguous' },
      status: 'automatic',
    })
    expect(line).toBe('[LIA-BRAIN-DECISION] status="automatic" selection="ambiguous"')
    expect(line).not.toMatch(/selectedEngineId|selectedModelId/)
  })

  it('d: a selected automatic route reports the engine and model ids verbatim', () => {
    expect(formatLiaBrainDecisionDiagnostic({
      selection: { route: { engine: ENGINE, model: VISION_MODEL }, status: 'selected' },
      status: 'automatic',
    })).toBe('[LIA-BRAIN-DECISION] status="automatic" selection="selected" selectedEngineId="groq" selectedModelId="qwen/qwen3.8-27b"')

    expect(formatLiaBrainDecisionDiagnostic({
      selection: { route: { engine: ENGINE, model: TEXT_MODEL }, status: 'selected' },
      status: 'automatic',
    })).toBe('[LIA-BRAIN-DECISION] status="automatic" selection="selected" selectedEngineId="groq" selectedModelId="openai/gpt-oss-120b"')
  })

  it('e: a manual decision reports the resolution and readiness states', () => {
    expect(formatLiaBrainDecisionDiagnostic({
      readiness: { status: 'notResolved' },
      resolution: { status: 'noPreference' },
      status: 'manual',
    })).toBe('[LIA-BRAIN-DECISION] status="manual" resolution="noPreference" readiness="notResolved"')

    // A not-found resolution carries no engine identity to report.
    expect(formatLiaBrainDecisionDiagnostic({
      readiness: { status: 'notResolved' },
      resolution: { preferredEngineId: 'mystery', status: 'engineNotFound' },
      status: 'manual',
    })).toBe('[LIA-BRAIN-DECISION] status="manual" resolution="engineNotFound" readiness="notResolved"')
  })

  it('f: a resolved manual route reports exactly the identities the resolution names', () => {
    expect(formatLiaBrainDecisionDiagnostic({
      readiness: { status: 'ready' },
      resolution: { engine: ENGINE, model: TEXT_MODEL, status: 'resolvedModel' },
      status: 'manual',
    })).toBe('[LIA-BRAIN-DECISION] status="manual" resolution="resolvedModel" readiness="ready" resolvedEngineId="groq" resolvedModelId="openai/gpt-oss-120b"')

    // An engine-only resolution reports the engine and no fabricated model.
    expect(formatLiaBrainDecisionDiagnostic({
      readiness: { status: 'ready' },
      resolution: { engine: ENGINE, status: 'resolvedEngine' },
      status: 'manual',
    })).toBe('[LIA-BRAIN-DECISION] status="manual" resolution="resolvedEngine" readiness="ready" resolvedEngineId="groq"')

    // An ineligible engine keeps its optional absent model absent.
    expect(formatLiaBrainDecisionDiagnostic({
      readiness: { status: 'configurationRequired' },
      resolution: { engine: ENGINE, status: 'engineIneligible' },
      status: 'manual',
    })).toBe('[LIA-BRAIN-DECISION] status="manual" resolution="engineIneligible" readiness="configurationRequired" resolvedEngineId="groq"')
  })

  it('g: the line is deterministic and single-line', () => {
    const decision: LiaBrainRoutingDecision = {
      selection: { route: { engine: ENGINE, model: VISION_MODEL }, status: 'selected' },
      status: 'automatic',
    }
    const first = formatLiaBrainDecisionDiagnostic(decision)
    const second = formatLiaBrainDecisionDiagnostic(decision)
    expect(first).toBe(second)
    expect(first.split('\n')).toHaveLength(1)
    // No timestamp, no clock, no environment value.
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|GMT|Z\b/)
  })

  it('h: the input decision is read, never mutated', () => {
    const decision: LiaBrainRoutingDecision = {
      selection: { route: { engine: ENGINE, model: VISION_MODEL }, status: 'selected' },
      status: 'automatic',
    }
    const before = JSON.stringify(decision)
    formatLiaBrainDecisionDiagnostic(decision)
    expect(JSON.stringify(decision)).toBe(before)
  })

  it('i: a quoted id cannot break the line', () => {
    const hostile = 'a" b\\ c'
    const line = formatLiaBrainDecisionDiagnostic({
      selection: {
        route: { engine: { ...ENGINE, id: hostile }, model: { ...VISION_MODEL, id: hostile } },
        status: 'selected',
      },
      status: 'automatic',
    })
    expect(line).toContain(`selectedEngineId=${JSON.stringify(hostile)}`)
    expect(line).toContain(`selectedModelId=${JSON.stringify(hostile)}`)
    expect(line.split('\n')).toHaveLength(1)
  })

  it('j: no verdict, comparison or recommendation vocabulary exists', () => {
    const line = formatLiaBrainDecisionDiagnostic({
      selection: { route: { engine: ENGINE, model: VISION_MODEL }, status: 'selected' },
      status: 'automatic',
    })
    expect(line).not.toMatch(/Matches|mismatch|divergence|aligned|correct|incorrect|verdict|score|recommendation|should|expected/i)
  })
})

describe('lia brain decision diagnostic - sink and dev gate (Phase 8.0D-M2)', () => {
  it('k: one decision causes exactly one informational call carrying exactly the line', () => {
    const decision: LiaBrainRoutingDecision = { status: 'modeUnspecified' }
    logLiaBrainDecisionDiagnostic(decision)

    expect(mocks.log).toHaveBeenCalledTimes(1)
    expect(mocks.log).toHaveBeenCalledWith(formatLiaBrainDecisionDiagnostic(decision))
    expect(mocks.log.mock.calls[0][0]).toBe('[LIA-BRAIN-DECISION] status="modeUnspecified"')
  })

  it('l: the dev gate returns the sink in dev and nothing otherwise', () => {
    expect(selectLiaBrainDecisionDiagnosticLog(true)).toBe(logLiaBrainDecisionDiagnostic)
    expect(selectLiaBrainDecisionDiagnosticLog(false)).toBeUndefined()
    // Stateless: the same function every dev call.
    expect(selectLiaBrainDecisionDiagnosticLog(true)).toBe(selectLiaBrainDecisionDiagnosticLog(true))
  })

  it('m: the adapter has no authority and no data path of its own', () => {
    const source = stripComments(normalizeLineEndings(readFileSync(fileURLToPath(new URL('./brain-decision-diagnostic.ts', import.meta.url)), 'utf-8')))

    // No product config, no Brain call, no correlation memory, no mapping.
    expect(source).not.toMatch(/updateLiaProductConfig|readLiaProductConfig|brainRoutingModeUpdate|readBrainRoutingMode|decideBrainRoute|createProductionBrainCatalog|LIA_BRAIN_ENGINE_PROVIDER_MAPPING|providerIdForEngine/)
    // No IPC, no filesystem, no network, no timers, no environment.
    expect(source).not.toMatch(/from ['"](?:node:)?(fs|net|https?|child_process|dns|dgram|os)['/]/)
    expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|axios|setTimeout|setInterval|process\.env|ipcMain|ipcRenderer/)
    // No secret or payload surface.
    expect(source).not.toMatch(/vault|apiKey|secret|credential|prompt|attachment|messages|toolCall/i)
    // No provider or model identity is baked in: the ids are copied from the
    // decision, never matched against a list.
    expect(source).not.toMatch(/groq|gpt-oss|qwen|anthropic|gemini|claude|openrouter/i)
    // One logger handle for the module, never one per decision.
    expect(source.match(/useLogg\(/g)).toHaveLength(1)
    // Synchronous by construction: no promise is created or awaited.
    expect(source).not.toMatch(/\basync\b|\bawait\b|Promise</)
  })

  it('n: the module is not reachable from the renderer or the preload', () => {
    const stageSrc = fileURLToPath(new URL('../../../', import.meta.url))
    const importers: string[] = []
    for (const entry of readdirSync(stageSrc, { recursive: true, withFileTypes: true })) {
      // Production source only: a test may name the module it proves.
      if (entry.name.includes('.test.'))
        continue
      const authored = authoredSourceEntry(stageSrc, entry)
      if (!authored)
        continue
      if (normalizeLineEndings(readFileSync(authored.file, 'utf-8')).includes('brain-decision-diagnostic'))
        importers.push(authored.relativePosix)
    }
    // The composition root is the ONLY production importer: nothing in the
    // renderer, the preload or any other service can reach this adapter.
    expect(importers).toEqual(['main/index.ts'])
  })
})
