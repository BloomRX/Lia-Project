import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'
import type { LiaBrainCorrelationReadFacts } from './brain-correlation-reader'
import type { LiaBrainExecutionIdentitySnapshot } from './brain-execution-identity-facts'

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaBrainCorrelationObserver } from './brain-correlation-observer'
import { createLiaBrainCorrelationService } from './brain-correlation-service'
import { formatLiaBrainDiagnosticEntry, logLiaBrainDiagnostic, selectLiaBrainDiagnosticLog } from './brain-diagnostic-log'

/**
 * Phase 8.0D-10B-4D2B: the focused proof of the diagnostic LOG ADAPTER.
 *
 * The formatter is pure and deterministic, so most of this file asserts exact
 * strings for every factual state. The logger itself is mocked at the module
 * boundary: what matters is that ONE entry causes exactly ONE informational
 * call carrying exactly the formatted line - never a second call, never a
 * warning and never an error.
 */

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
}))

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({ useGlobalConfig: () => ({ info: mocks.info }) }),
}))

const GROQ_ENGINE_ID = 'groq'
const GROQ_MODEL_ID = 'openai/gpt-oss-120b'

function attempt(overrides: Partial<{ arrivalIndex: number, modelId: string, providerId: string, roundId: string }> = {}) {
  return { arrivalIndex: 0, modelId: GROQ_MODEL_ID, providerId: GROQ_ENGINE_ID, roundId: 'A', ...overrides }
}

/** One structured entry for an arbitrary factual state. */
function entry(facts: LiaBrainCorrelationReadFacts, correlationId = 'X'): LiaBrainDiagnosticEntry {
  return { correlationId, facts }
}

beforeEach(() => {
  mocks.info.mockClear()
})

describe('lia brain diagnostic log - formatting (Phase 8.0D-10B-4D2B)', () => {
  it('a: correlationNotObserved carries the common metadata only', () => {
    expect(formatLiaBrainDiagnosticEntry(entry({ status: 'correlationNotObserved' }, 'logical-send-X')))
      .toBe('[LIA-BRAIN-DIAG] correlationId="logical-send-X" status="correlationNotObserved"')
    // No route placeholder and no synthetic attempt.
    expect(formatLiaBrainDiagnosticEntry(entry({ status: 'correlationNotObserved' }))).not.toMatch(/expected|attempt/)
  })

  it('b: decisionNotObserved reports the observed attempts without expectation or equality', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt()],
      status: 'decisionNotObserved',
    }))

    expect(line).toBe('[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b"')
    // No expectation exists in this state, and equality is never manufactured.
    expect(line).not.toMatch(/expected|IdentityEqual/)
  })

  it('c: noBrainRouteSelected reports the observed attempts the same factual way', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt({ roundId: 'A' })],
      status: 'noBrainRouteSelected',
    }))

    expect(line).toBe('[LIA-BRAIN-DIAG] correlationId="X" status="noBrainRouteSelected" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b"')
    expect(line).not.toMatch(/expected|IdentityEqual/)
  })

  it('d: engineMappingMissing reports the SELECTED route ids - never as expected provider/model', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt()],
      engineId: 'mystery-engine',
      modelId: 'mystery-model',
      status: 'engineMappingMissing',
    }))

    expect(line).toBe('[LIA-BRAIN-DIAG] correlationId="X" status="engineMappingMissing" selectedEngineId="mystery-engine" selectedModelId="mystery-model" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b"')
    // No expected provider/model exists in this state: it is never invented.
    expect(line).not.toMatch(/expected/)
  })

  it('e: noExecutionObserved reports the expected route and NO synthetic attempt', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'noExecutionObserved',
    }))

    expect(line).toBe('[LIA-BRAIN-DIAG] correlationId="X" status="noExecutionObserved" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b"')
    expect(line).not.toMatch(/attempt/)
  })

  it('f: attemptIdentityFacts reports expectation, attempt ids and its own equality booleans', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' }],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }))

    expect(line).toBe('[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true')
  })

  it('g: multiple attempts append in arrival order, each with its own identity pair', () => {
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [
        { arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' },
        { arrivalIndex: 1, modelId: 'claude-x', modelIdentityEqual: false, providerId: 'anthropic', providerIdentityEqual: false, roundId: 'B' },
      ],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    }))

    expect(line).toBe('[LIA-BRAIN-DIAG] correlationId="X" status="attemptIdentityFacts" expectedEngineId="groq" expectedProviderId="groq" expectedModelId="openai/gpt-oss-120b" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt0.providerIdentityEqual=true attempt0.modelIdentityEqual=true attempt1.arrivalIndex=1 attempt1.roundId="B" attempt1.providerId="anthropic" attempt1.modelId="claude-x" attempt1.providerIdentityEqual=false attempt1.modelIdentityEqual=false')
  })

  it('h/i/j/k: the four equality combinations stay independent - no combined field exists', () => {
    const pairs: [boolean, boolean][] = [[true, true], [false, true], [true, false], [false, false]]

    for (const [providerIdentityEqual, modelIdentityEqual] of pairs) {
      const line = formatLiaBrainDiagnosticEntry(entry({
        attempts: [{ arrivalIndex: 0, modelId: 'm', modelIdentityEqual, providerId: 'p', providerIdentityEqual, roundId: 'A' }],
        expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
        status: 'attemptIdentityFacts',
      }))

      // Each boolean is reported verbatim, on its own field...
      expect(line).toContain(`attempt0.providerIdentityEqual=${providerIdentityEqual}`)
      expect(line).toContain(`attempt0.modelIdentityEqual=${modelIdentityEqual}`)
      // ...and no aggregate/verdict vocabulary is ever produced.
      expect(line).not.toMatch(/Matches|Match\b|mismatch|divergence|aligned|correct|incorrect|success|failure|verdict|score|recommendation/i)
    }
  })

  it('l/m/n: duplicate attempts both appear, in array order, prefixed by their OWN arrivalIndex', () => {
    // Two distinct attempts AND a duplicated one: nothing is deduped or sorted.
    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt({ arrivalIndex: 0, roundId: 'A' }), attempt({ arrivalIndex: 1, roundId: 'A' })],
      status: 'decisionNotObserved',
    }))

    expect(line).toBe('[LIA-BRAIN-DIAG] correlationId="X" status="decisionNotObserved" attempt0.arrivalIndex=0 attempt0.roundId="A" attempt0.providerId="groq" attempt0.modelId="openai/gpt-oss-120b" attempt1.arrivalIndex=1 attempt1.roundId="A" attempt1.providerId="groq" attempt1.modelId="openai/gpt-oss-120b"')

    // N: the prefix always agrees with the attempt's own arrivalIndex - a fact
    // object whose indexes are out of positional order is still reported by its
    // OWN value, never by the iteration position.
    const outOfOrder = formatLiaBrainDiagnosticEntry(entry({
      attempts: [attempt({ arrivalIndex: 7, roundId: 'late' }), attempt({ arrivalIndex: 3, roundId: 'early' })],
      status: 'decisionNotObserved',
    }))
    expect(outOfOrder).toContain('attempt7.arrivalIndex=7')
    expect(outOfOrder).toContain('attempt7.roundId="late"')
    expect(outOfOrder).toContain('attempt3.arrivalIndex=3')
    expect(outOfOrder).toContain('attempt3.roundId="early"')
    // The array order is preserved verbatim, even when the indexes descend.
    expect(outOfOrder.indexOf('attempt7')).toBeLessThan(outOfOrder.indexOf('attempt3'))
  })

  it('48: ids with spaces, slashes, colons, equals, quotes and backslashes stay unambiguous', () => {
    const hostile = `odd id "with" spaces / slashes: a=b \\ backslash`

    const line = formatLiaBrainDiagnosticEntry(entry({
      attempts: [{ arrivalIndex: 0, modelId: hostile, modelIdentityEqual: false, providerId: hostile, providerIdentityEqual: false, roundId: hostile }],
      expected: { engineId: hostile, modelId: hostile, providerId: hostile },
      status: 'attemptIdentityFacts',
    }, hostile))

    // Every string leaf is a JSON string literal, so delimiters cannot be
    // confused with the key=value structure.
    expect(line).toContain(`correlationId=${JSON.stringify(hostile)}`)
    expect(line).toContain(`expectedEngineId=${JSON.stringify(hostile)}`)
    expect(line).toContain(`attempt0.roundId=${JSON.stringify(hostile)}`)
    // Round-tripping one field proves the quoting is reversible.
    const field = line.slice(line.indexOf('attempt0.roundId=') + 'attempt0.roundId='.length)
    expect(JSON.parse(field.slice(0, JSON.stringify(hostile).length))).toBe(hostile)
    // And the line stays a single line.
    expect(line.split('\n')).toHaveLength(1)
  })

  it('determinism: the same entry always formats to the exact same string', () => {
    const source = entry({
      attempts: [{ arrivalIndex: 0, modelId: GROQ_MODEL_ID, modelIdentityEqual: true, providerId: GROQ_ENGINE_ID, providerIdentityEqual: true, roundId: 'A' }],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    })

    const first = formatLiaBrainDiagnosticEntry(source)
    const second = formatLiaBrainDiagnosticEntry(source)
    expect(first).toBe(second)
    // No timestamp, no random id, no environment value anywhere in the line.
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|GMT|Z\b/)
    // The field ORDER is fixed: the common metadata leads, attempts follow.
    expect(first.indexOf('correlationId=')).toBeLessThan(first.indexOf('status='))
    expect(first.indexOf('status=')).toBeLessThan(first.indexOf('expectedEngineId='))
    expect(first.indexOf('expectedModelId=')).toBeLessThan(first.indexOf('attempt0.'))
  })
})

describe('lia brain diagnostic log - selector and logger call (Phase 8.0D-10B-4D2B)', () => {
  it('o/p/q/r: the selector is pure - dev returns the exact adapter, production returns nothing', () => {
    // O: no callback outside dev...
    expect(selectLiaBrainDiagnosticLog(false)).toBeUndefined()
    // P: ...and exactly the adapter function inside dev, directly assignable to
    // the observer's optional callback contract.
    expect(selectLiaBrainDiagnosticLog(true)).toBe(logLiaBrainDiagnostic)
    // Q: repeated selection yields the very same function - no per-call wrapper.
    expect(selectLiaBrainDiagnosticLog(true)).toBe(selectLiaBrainDiagnosticLog(true))
    // R: no state and no side effect: selecting produces no logging at all.
    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('50: one entry causes exactly ONE informational call carrying the formatted line', () => {
    const source = entry({
      attempts: [attempt()],
      expected: { engineId: 'groq', modelId: 'openai/gpt-oss-120b', providerId: 'groq' },
      status: 'attemptIdentityFacts',
    })

    logLiaBrainDiagnostic(source)

    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info).toHaveBeenCalledWith(formatLiaBrainDiagnosticEntry(source))
    // Exactly one line, and never at a higher level: these facts are not errors.
    const [line] = mocks.info.mock.calls[0] as [string]
    expect(line.split('\n')).toHaveLength(1)
    expect(line.startsWith('[LIA-BRAIN-DIAG] ')).toBe(true)
  })

  it('51: the DEV-selected callback + the REAL observer produce one informational call per observation', () => {
    const store = createLiaBrainCorrelationService()
    const snapshot: LiaBrainExecutionIdentitySnapshot = { decision: undefined, executions: [] }
    // A structural reader over a real snapshot keeps this focused: the observer,
    // the adapter, the formatter and the logger seam are all the REAL ones.
    const reader = { get: (correlationId: string) => (correlationId === 'logical-send-X' ? snapshot : undefined) }
    const observer = createLiaBrainCorrelationObserver({ correlationReader: reader, log: selectLiaBrainDiagnosticLog(true) })

    observer.observe('logical-send-X')

    expect(mocks.info).toHaveBeenCalledTimes(1)
    expect(mocks.info).toHaveBeenCalledWith('[LIA-BRAIN-DIAG] correlationId="logical-send-X" status="decisionNotObserved"')

    // A key with no live snapshot is a factual observation too - still one call.
    observer.observe('absent')
    expect(mocks.info).toHaveBeenCalledTimes(2)
    expect(mocks.info.mock.calls[1]![0]).toBe('[LIA-BRAIN-DIAG] correlationId="absent" status="correlationNotObserved"')

    // Duplicates are preserved: two observations, two calls, no dedupe.
    observer.observe('absent')
    expect(mocks.info).toHaveBeenCalledTimes(3)
    expect(store.size).toBe(0)
  })

  it('52: the NON-DEV selection still observes - it simply has no destination', () => {
    const reads: string[] = []
    const reader = {
      get(correlationId: string): undefined {
        reads.push(correlationId)
        return undefined
      },
    }
    const observer = createLiaBrainCorrelationObserver({ correlationReader: reader, log: selectLiaBrainDiagnosticLog(false) })

    // The gate selectors returns nothing, so the observer was built in the
    // reader-only shape...
    expect(selectLiaBrainDiagnosticLog(false)).toBeUndefined()
    // ...and the observation itself is NOT gated: the read still happens, the
    // call returns void and no logger call exists to make.
    expect(observer.observe('logical-send-X')).toBeUndefined()
    expect(reads).toEqual(['logical-send-X'])
    expect(mocks.info).not.toHaveBeenCalled()
  })

  it('proof: a throwing logger is contained by the observer, never by the adapter', () => {
    mocks.info.mockImplementationOnce(() => {
      throw new Error('logger exploded')
    })
    const reader = { get: () => undefined }
    const observer = createLiaBrainCorrelationObserver({ correlationReader: reader, log: selectLiaBrainDiagnosticLog(true) })

    // The observer owns the mandatory isolation boundary - the adapter
    // deliberately has none of its own.
    expect(() => observer.observe('X')).not.toThrow()
    expect(mocks.info).toHaveBeenCalledTimes(1)
  })
})

describe('lia brain diagnostic log - source invariants (Phase 8.0D-10B-4D2B)', () => {
  const REPO_ROOT = new URL('../../../../../../', import.meta.url)
  const DIAGNOSTIC_LOG = 'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts'

  /** Code without comments - guards must only find the words in real code. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  }

  it('55/56: one logger, one entry type, one fixed namespace - and no other capability at all', () => {
    const source = stripComments(readFileSync(new URL(DIAGNOSTIC_LOG, REPO_ROOT), 'utf-8'))

    // The whole import surface: the entry TYPE and the repository logger.
    expect(source.match(/^import .*$/gm)).toEqual([
      `import type { LiaBrainDiagnosticEntry } from './brain-correlation-observer'`,
      `import { useLogg } from '@guiiai/logg'`,
    ])
    // One logger handle, created once, with the FIXED namespace.
    expect(source.match(/useLogg\(/g)).toHaveLength(1)
    expect(source).toContain(`useLogg('lia:brain').useGlobalConfig()`)
    expect(source).not.toMatch(/useLogg\([^')]/)

    // No correlation read/mapping/facts/store/service knowledge: the adapter
    // receives facts that are already final.
    expect(source).not.toMatch(/brain-correlation-reader|brain-execution-identity-facts|brain-expected-route|brain-correlation-store|brain-correlation-service|readLiaBrainExecutionIdentityFacts|LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)
    // No Brain service, provider resolver, config, fallback or permission surface.
    expect(source).not.toMatch(/LiaBrainService|decide\(|createProductionBrain|liaProductConfig|getChatProviderInstance|useProviderStore|activeProvider|activeModel|fallback|retry|permission/i)
    // No IPC/Electron/Eventa, no window RPC, no second log path.
    expect(source).not.toMatch(/eventa|defineEventa|defineInvokeEventa|ipcMain|ipcRenderer|BrowserWindow|electron|ingestMainProcessLog|setupFileLogger|createContext/)
    // No filesystem, network or timers, no async/queue and no state collections.
    expect(source).not.toMatch(/from ['"](?:node:)?(?:fs|net|https?|dns|dgram|child_process|timers)['/]|\bfetch\(|XMLHttpRequest|WebSocket|console\.|process\.stdout/)
    expect(source).not.toMatch(/async |await |Promise|setTimeout|setInterval|queueMicrotask|\bnew Map\b|\bnew Set\b|pending|\bcache\b|history|lastEvent/)
    // No aggregate/verdict vocabulary, in any casing.
    expect(source).not.toMatch(/anyAttemptMatches|finalAttemptMatches|expectedRouteObserved|fallbackDetected|overallStatus|routeMatch|mismatch|divergence|aligned|verdict|score|recommendation/i)
    // No whole-entry serialization: the line is built only from allowlisted fields.
    expect(source).not.toMatch(/JSON\.stringify\((?:entry|facts|decision)\b/)

    // The exported surface is exactly the three audited names.
    expect([...source.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map(match => match[1])).toEqual([
      'formatLiaBrainDiagnosticEntry',
      'logLiaBrainDiagnostic',
      'selectLiaBrainDiagnosticLog',
    ])
  })

  it('31/57: no generic log pipeline file was touched, and the Brain IPC allowlist is still exactly two', () => {
    const roots = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']
    const repoPrefix = `${fileURLToPath(REPO_ROOT).replace(/\/+$/, '')}/`
    const files: string[] = []
    for (const root of roots) {
      for (const item of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
        if (!item.isFile() || !/\.(?:ts|vue)$/.test(item.name) || item.name.includes('.test.'))
          continue
        files.push(`${item.parentPath.slice(repoPrefix.length)}/${item.name}`)
      }
    }

    // The Brain diagnostic adapter is the ONLY new module in this pipeline: the
    // generic log infrastructure keeps its own consumers untouched, and the
    // structured entry never crosses an IPC boundary.
    const structuredEntryConsumers = files
      .filter(relative => /LiaBrainDiagnosticEntry/.test(stripComments(readFileSync(new URL(relative, REPO_ROOT), 'utf-8'))))
      .sort()
    expect(structuredEntryConsumers).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-observer.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts',
    ])

    const tags = new Set<string>()
    for (const relative of files) {
      for (const match of readFileSync(new URL(relative, REPO_ROOT), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
  })
})
