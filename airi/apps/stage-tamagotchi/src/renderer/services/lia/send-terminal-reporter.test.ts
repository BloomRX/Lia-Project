// @vitest-environment happy-dom

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * Phase 8.0D-10B-4D4C4-B2: the Lia logical-send terminal reporter.
 *
 * The reporter under test is the REAL one; the generic send-settled seam is the
 * REAL seam (`registerChatSendSettledObserver` / `notifyChatSendSettled`); only
 * the Electron context is intercepted, so the assertions are about the report
 * the renderer would actually push.
 *
 * The seam is a one-slot registry shared with the rest of this process, so the
 * generic extension reset runs before and after every test here.
 */

const electron = vi.hoisted(() => ({
  context: { emit: vi.fn() },
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaContext: () => ref(electron.context),
}))

vi.hoisted(() => {
  ;(globalThis as any).window ??= {}
  ;(globalThis as any).window.location ??= { origin: 'http://localhost' }
})

const { electronLiaBrainSendTerminalObservation } = await import('../../../shared/eventa')
const {
  registerLiaBrainSendTerminalObserver,
  reportLiaBrainSendTerminalObservation,
} = await import('./send-terminal-reporter')
const {
  getChatRequestStartedObserver,
  getChatRoundSettledObserver,
  getChatSendSettledObserver,
  notifyChatSendSettled,
  resetChatProviderRuntimeExtensionsForTesting,
} = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')

/** The observation the seam forwards, taken from the notifier it is built on. */
type ChatSendSettledObservation = Parameters<typeof notifyChatSendSettled>[0]

beforeEach(() => {
  setActivePinia(createPinia())
  resetChatProviderRuntimeExtensionsForTesting()
  electron.context.emit.mockClear()
})

afterEach(() => resetChatProviderRuntimeExtensionsForTesting())

function settled(overrides: Partial<ChatSendSettledObservation> = {}): ChatSendSettledObservation {
  return { correlationId: 'logical-send-77', outcome: 'succeeded', ...overrides }
}

function emittedReports(): Array<Record<string, unknown>> {
  return electron.context.emit.mock.calls.map(([, report]) => report as Record<string, unknown>)
}

function emittedOutcomes(): unknown[] {
  return emittedReports().map(report => report.outcome)
}

/** The reporter's source, read from disk (the node project runs from the app root). */
function reporterSource(): string {
  return readFileSync(join(process.cwd(), 'src/renderer/services/lia/send-terminal-reporter.ts'), 'utf-8')
}

/** Production sources under the Brain roots - tests are never scanned. */
function productionSources(roots: string[]): string[] {
  const airiRoot = join(process.cwd(), '..', '..')
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(join(airiRoot, root), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      const file = `${entry.parentPath}/${entry.name}`
      files.push(file.slice(join(airiRoot, '/').length))
    }
  }
  return files
}

const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']

describe('lia logical-send terminal reporter (Phase 8.0D-10B-4D4C4-B2)', () => {
  it('a/b: each valid settlement is reported exactly once, with the exact two keys', () => {
    for (const outcome of ['succeeded', 'failed'] as const) {
      electron.context.emit.mockClear()
      reportLiaBrainSendTerminalObservation(settled({ outcome }))

      expect(electron.context.emit).toHaveBeenCalledTimes(1)
      const [channel, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
      // The emitted channel is the NEW one-way send contract, never a round one.
      expect(channel).toBe(electronLiaBrainSendTerminalObservation)
      // The exact two contract fields - no round, no provider/model, no attempt,
      // no timestamp, no duration, no error, no usage.
      expect(Object.keys(report).sort()).toEqual(['correlationId', 'outcome'])
      expect(report).toEqual({ correlationId: 'logical-send-77', outcome })
    }
  })

  it('c: the report is a fresh plain object with only copied values', () => {
    const source = settled({ outcome: 'failed' })
    reportLiaBrainSendTerminalObservation(source)

    const [, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
    // A copy, not the observation itself: the Stage layer keeps its own object.
    expect(report).not.toBe(source)
    expect(report).toEqual({ correlationId: 'logical-send-77', outcome: 'failed' })
  })

  it('d: an absent or unusable correlationId is never reported and never synthesized', () => {
    reportLiaBrainSendTerminalObservation(settled({ correlationId: undefined }))
    reportLiaBrainSendTerminalObservation(settled({ correlationId: '' }))
    // Hostile shapes the generic seam would forward: still no report.
    reportLiaBrainSendTerminalObservation(settled({ correlationId: 42 as unknown as string }))
    reportLiaBrainSendTerminalObservation(settled({ correlationId: null as unknown as string }))
    reportLiaBrainSendTerminalObservation(settled({ correlationId: {} as unknown as string }))
    reportLiaBrainSendTerminalObservation(settled({ correlationId: ['logical-send-77'] as unknown as string }))
    reportLiaBrainSendTerminalObservation(settled({ correlationId: true as unknown as string }))

    expect(electron.context.emit).not.toHaveBeenCalled()
  })

  it('e: a whitespace-only key follows the sibling convention exactly - length only, never trimmed', () => {
    // The sibling reporters filter on `length === 0` alone, so a blank key is
    // reportable and travels exactly as it arrived.
    reportLiaBrainSendTerminalObservation(settled({ correlationId: '   ' }))

    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    const [, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(report).toEqual({ correlationId: '   ', outcome: 'succeeded' })
  })

  it('f: an outcome outside the frozen vocabulary is dropped, never coerced', () => {
    for (const hostile of ['success', 'failure', 'abandoned', 'cancelled', 'superseded', 'completed', 'fallbackExhausted', 'error', 'SUCCEEDED', '', 'succeeded ', 1, null, undefined, {}, []]) {
      reportLiaBrainSendTerminalObservation(settled({ outcome: hostile as never }))
    }

    expect(electron.context.emit).not.toHaveBeenCalled()
  })

  it('g: hostile extra fields are never forwarded - the payload is exactly two keys', () => {
    const hostile = {
      correlationId: 'logical-send-77',
      outcome: 'failed',
      error: 'secret',
      message: 'provider exploded',
      stack: 'at somewhere',
      code: 'E_FAIL',
      failureStage: 'llm_response',
      roundId: 'round-a',
      attemptIndex: 2,
      providerId: 'mock-provider',
      modelId: 'gpt-test',
      prompt: 'private prompt text',
      text: 'private send text',
      messages: [{ role: 'user', content: 'secret' }],
      response: 'assistant text',
      attachments: [{ type: 'image', data: 'base64-image' }],
      tools: [{ name: 'danger' }],
      usage: { total: 1 },
      credentials: { apiKey: 'sk-secret' },
      baseURL: 'https://example.invalid/',
      winner: 'mock-provider',
      finalAttempt: 2,
      extra: { nested: true },
    }
    reportLiaBrainSendTerminalObservation(hostile as unknown as ChatSendSettledObservation)

    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    const [, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(report).toEqual({ correlationId: 'logical-send-77', outcome: 'failed' })
    expect(Object.keys(report).sort()).toEqual(['correlationId', 'outcome'])
  })

  it('h: the incoming observation is never mutated - a frozen input still reports', () => {
    const frozen = Object.freeze({
      correlationId: 'logical-send-frozen',
      outcome: 'succeeded' as const,
      roundId: 'round-frozen',
    })

    expect(() => reportLiaBrainSendTerminalObservation(frozen)).not.toThrow()
    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    // Untouched: the seam's own object keeps its shape after the report.
    expect(frozen).toEqual({ correlationId: 'logical-send-frozen', outcome: 'succeeded', roundId: 'round-frozen' })
    expect(emittedReports()[0]).toEqual({ correlationId: 'logical-send-frozen', outcome: 'succeeded' })
  })

  it('i/j: duplicate and conflicting settlements both forward - the reporter is not storage', () => {
    const duplicate = settled({ outcome: 'failed' })
    reportLiaBrainSendTerminalObservation(duplicate)
    reportLiaBrainSendTerminalObservation(duplicate)

    expect(electron.context.emit).toHaveBeenCalledTimes(2)
    expect(emittedOutcomes()).toEqual(['failed', 'failed'])

    // Same key, opposite settlements: both are forwarded, in arrival order.
    // No conflict is resolved and no winner is picked here.
    electron.context.emit.mockClear()
    reportLiaBrainSendTerminalObservation(settled({ outcome: 'failed' }))
    reportLiaBrainSendTerminalObservation(settled({ outcome: 'succeeded' }))

    expect(electron.context.emit).toHaveBeenCalledTimes(2)
    expect(emittedOutcomes()).toEqual(['failed', 'succeeded'])
  })

  it('k: arrival order is preserved verbatim - no sorting, no reordering', () => {
    reportLiaBrainSendTerminalObservation(settled({ correlationId: 'A', outcome: 'succeeded' }))
    reportLiaBrainSendTerminalObservation(settled({ correlationId: 'B', outcome: 'failed' }))
    reportLiaBrainSendTerminalObservation(settled({ correlationId: 'C', outcome: 'succeeded' }))

    expect(emittedReports().map(report => report.correlationId)).toEqual(['A', 'B', 'C'])
    expect(emittedOutcomes()).toEqual(['succeeded', 'failed', 'succeeded'])
  })

  it('l: separate callbacks produce separate fresh objects - nothing is cached or reused', () => {
    reportLiaBrainSendTerminalObservation(settled({ outcome: 'succeeded' }))
    reportLiaBrainSendTerminalObservation(settled({ outcome: 'succeeded' }))

    const [first] = emittedReports()
    const [second] = emittedReports().slice(1)
    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  it('m: a throwing or unavailable Electron context is contained, with no retry', () => {
    electron.context.emit.mockImplementationOnce(() => {
      throw new Error('no listener / channel is gone')
    })

    expect(() => reportLiaBrainSendTerminalObservation(settled())).not.toThrow()
    // The very next report still works: a failure is not latched.
    reportLiaBrainSendTerminalObservation(settled({ correlationId: 'logical-send-after-failure' }))
    expect(emittedReports().at(-1)?.correlationId).toBe('logical-send-after-failure')
  })

  it('n/o: the installer registers exactly one generic observer and returns void', () => {
    expect(registerLiaBrainSendTerminalObserver()).toBeUndefined()
    expect(getChatSendSettledObserver()).toBe(reportLiaBrainSendTerminalObservation)
    // Registration alone reports nothing, and the sibling slots stay untouched.
    expect(electron.context.emit).not.toHaveBeenCalled()
    expect(getChatRequestStartedObserver()).toBeUndefined()
    expect(getChatRoundSettledObserver()).toBeUndefined()

    notifyChatSendSettled(settled({ outcome: 'succeeded' }))
    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    expect(emittedReports()[0]).toEqual({ correlationId: 'logical-send-77', outcome: 'succeeded' })

    // A hostile Electron context reached through the seam never escapes into
    // the notifier (which owns the isolation) and never breaks the caller.
    electron.context.emit.mockImplementationOnce(() => {
      throw new Error('emit exploded')
    })
    expect(() => notifyChatSendSettled(settled({ outcome: 'failed' }))).not.toThrow()
  })

  it('p/q: generic seam -> reporter -> Eventa, with uncorrelated sends filtered at THIS layer', () => {
    registerLiaBrainSendTerminalObserver()

    // The generic seam forwards the uncorrelated settlement (B1 contract) and
    // this Lia boundary - the first layer that requires the key - drops it.
    expect(() => notifyChatSendSettled({ outcome: 'succeeded' })).not.toThrow()
    expect(() => notifyChatSendSettled({ outcome: 'failed' })).not.toThrow()
    expect(electron.context.emit).not.toHaveBeenCalled()

    // A correlated settlement crosses the real seam and is pushed verbatim.
    notifyChatSendSettled({ correlationId: 'X', outcome: 'failed' })
    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    const [channel, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(channel).toBe(electronLiaBrainSendTerminalObservation)
    expect(report).toEqual({ correlationId: 'X', outcome: 'failed' })
  })

  it('r: the reporter is transport only - no state, no interpretation, no output', () => {
    const source = reporterSource()
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    // No cross-report memory of any kind.
    expect(code).not.toMatch(/\bnew Map\b|\bnew Set\b|\bhistory\b|\bpending\b|\bcache\b|lastOutcome|lastSettlement|dedupe/)
    // No aggregate/verdict vocabulary, in any casing.
    expect(code).not.toMatch(/finalAttempt|winningAttempt|fallbackObserved|fallbackCount|sendSucceeded|sendFailed|anySucceeded|allFailed|routeMatch|mismatch|divergence|aligned|verdict|score|recommendation/i)
    // No diagnostics output and no telemetry.
    expect(code).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    // No round, provider/model, attempt, error, prompt or content knowledge.
    expect(code).not.toMatch(/roundId|attemptIndex|attemptCount|providerId|modelId|conversationId|turnIndex|failureStage|errorCode|prompt|messages|toolResults|usage|credentials|apiKey|baseURL/i)
    // No Core Agent edge: this signal is Stage-owned and derived from the seam.
    expect(code).not.toMatch(/@proj-airi\/core-agent|ChatRoundSettledObservation|executionTerminal/)
    // No main-process access, no second channel, no invoke.
    expect(code).not.toMatch(/ipcMain|ipcRenderer|BrowserWindow|\binvoke\(|defineEventa/)
    // No timer, no async queue, no retry machinery.
    expect(code).not.toMatch(/\basync\b|\bawait\b|Promise|queueMicrotask|setTimeout|setInterval|setImmediate|process\.nextTick/)
    // No listener/observer framework of its own.
    expect(code).not.toMatch(/EventEmitter|subscribers|listeners\.push|\.subscribe\(|\.observe\(/)
    // No correlation store, no facts, no formatter and no diagnostic output.
    expect(code).not.toMatch(/correlationStore|correlationObserver|LiaBrainCorrelation|composeLiaBrainCorrelationDiagnosticFacts|terminalFacts|LIA-BRAIN-DIAG|brain-diagnostic-log/)
    // No execution authority.
    expect(code).not.toMatch(/setProvider|setModel|activeProvider|activeModel|resolver|fallback|permission|abort/i)
    // Exactly ONE emit call, and exactly the import + that emit name the contract.
    expect(code.match(/\.emit\(/g)).toHaveLength(1)
    expect(code.match(/electronLiaBrainSendTerminalObservation/g)).toHaveLength(2)
    // No channel literal here: the contract constant is what travels.
    expect(code.match(/eventa:(?:invoke|event):lia:brain[^'"\n]*/g) ?? []).toEqual([])
  })

  it('s: exactly ONE production registration of the generic seam, in this reporter', () => {
    expect(productionSources(['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src'])
      .filter(relative => /(?<!function )registerChatSendSettledObserver\(/.test(readFileSync(join(process.cwd(), '..', '..', relative), 'utf-8')))
      .sort())
      .toEqual(['apps/stage-tamagotchi/src/renderer/services/lia/send-terminal-reporter.ts'])
    // The registration happens on the seam, and the installer is CALLED once,
    // from the canonical renderer lifecycle only.
    expect(productionSources(BRAIN_ROOTS)
      .filter(relative => /(?<!function )registerLiaBrainSendTerminalObserver\(\)/.test(readFileSync(join(process.cwd(), '..', '..', relative), 'utf-8')))
      .sort())
      .toEqual(['apps/stage-tamagotchi/src/renderer/main.ts'])
  })

  it('t: the new transport has exactly the four approved production references and no main consumer', () => {
    const withContract = productionSources(BRAIN_ROOTS)
      .filter(relative => /electronLiaBrainSendTerminalObservation/.test(readFileSync(join(process.cwd(), '..', '..', relative), 'utf-8')))
      .sort()
    // Exactly three: the shared declaration, this renderer reporter and, since
    // 8.0D-10B-4D4C4-B3B2, the ONE main transport listener that consumes it. No
    // allowlist entry beyond them, and no second main handler.
    expect(withContract).toEqual([
      'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts',
      'apps/stage-tamagotchi/src/renderer/services/lia/send-terminal-reporter.ts',
      'apps/stage-tamagotchi/src/shared/eventa/index.ts',
    ])
    // Since 8.0D-10B-4D4C4-B3B2 exactly ONE main module consumes it - the
    // transport listener - and that is the only main-side reference.
    expect(withContract.filter(relative => relative.includes('/src/main/')))
      .toEqual(['apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-listener.ts'])

    // The payload TYPE itself stays in the shared contract, and since
    // 8.0D-10B-4D4C4-B3A/B3B1 exactly TWO main modules TYPE-import it - the
    // canonical correlation store that retains the fact and the trusted ingress
    // service that sanitizes it. The transport listener needs no payload type at
    // all (it forwards `event.body` untouched), and no fact module, reader or
    // renderer names it.
    expect(productionSources(BRAIN_ROOTS)
      .filter(relative => /LiaBrainSendTerminalReport\b/.test(readFileSync(join(process.cwd(), '..', '..', relative), 'utf-8')))
      .sort())
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-store.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-send-terminal-report-service.ts',
        'apps/stage-tamagotchi/src/shared/eventa/index.ts',
      ])
    // The listener names no payload type at all: it knows only the service.
    expect(readFileSync(join(process.cwd(), 'src/main/services/lia/brain-send-terminal-report-listener.ts'), 'utf-8'))
      .not
      .toMatch(/LiaBrainSendTerminalReport\b/)
  })

  it('u: the main observer triggers stay exactly three - the send signal triggers none', () => {
    expect(productionSources(BRAIN_ROOTS)
      .filter(relative => /correlationObserver\.observe\(/.test(readFileSync(join(process.cwd(), '..', '..', relative), 'utf-8')))
      .sort())
      .toEqual([
        'apps/stage-tamagotchi/src/main/services/lia/brain-decision-service.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-execution-report-service.ts',
        'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-report-service.ts',
      ])

    // And the still-deferred layers hold no send field or send fact of any
    // kind. Since 8.0D-10B-4D4C4-B3A the canonical store is NOT among them: it
    // legitimately retains the optional `sendTerminal` record, and since
    // 8.0D-10B-4D4C4-B4B1 the reader is NOT among them either: its SNAPSHOT
    // contract carries that record structurally. Both are carriage/retention
    // only - still no fact, no composition, no trigger and no formatter.
    for (const relative of [
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-diagnostic-facts.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-execution-terminal-facts.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-diagnostic-log.ts',
      'apps/stage-tamagotchi/src/main/services/lia/brain-correlation-observer.ts',
    ]) {
      expect(readFileSync(join(process.cwd(), '..', '..', relative), 'utf-8'), relative)
        .not
        .toMatch(/sendTerminal|SendTerminal|send-terminal|recordSendTerminal/)
    }
  })
})

/**
 * Phase 8.0D-10B-4D4C4-B2: the fourth IPC contract - one new one-way send report
 * and no overload of the two round-level contracts.
 */
describe('lia logical-send terminal contract (Phase 8.0D-10B-4D4C4-B2)', () => {
  const SHARED = readFileSync(join(process.cwd(), 'src/shared/eventa/index.ts'), 'utf-8')

  it('the report type is exactly the two contract fields, in that order', () => {
    const start = SHARED.indexOf('export interface LiaBrainSendTerminalReport {')
    const end = SHARED.indexOf('export const electronLiaBrainSendTerminalObservation', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const block = SHARED.slice(start, end)
    // Guards read real code only: the doc prose may name the concepts.
    const blockCode = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // Two fields and nothing else: no round, no conversation, no provider/model
    // identity, no attempt, no timing, no usage, no error, no content.
    expect(blockCode.match(/^\s{2}(\w+):/gm)?.map(field => field.trim()))
      .toEqual(['correlationId:', 'outcome:'])
    expect(blockCode.replace(/\s+/g, ' ')).toContain('outcome: \'succeeded\' | \'failed\'')
    for (const forbidden of ['roundId', 'conversationId', 'providerId', 'modelId', 'attemptCount', 'attemptIndex', 'turnIndex', 'timestamp', 'duration', 'error', 'failureStage', 'errorCode', 'prompt', 'text', 'messages', 'response', 'attachments', 'tools', 'usage', 'credentials', 'url', 'abandoned', 'cancelled', 'superseded', 'completed'])
      expect(blockCode, forbidden).not.toContain(forbidden)
  })

  it('the channel is one one-way push under the frozen tag, declared exactly once', () => {
    expect(SHARED.match(/electronLiaBrainSendTerminalObservation/g)).toHaveLength(1)
    expect(SHARED).toMatch(/export const electronLiaBrainSendTerminalObservation = defineEventa<LiaBrainSendTerminalReport>\('eventa:event:lia:brain:send-terminal-observation'\)/)
  })

  it('the Brain contract carries exactly FOUR channels - the three siblings plus this one', () => {
    expect(SHARED.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []).toEqual([
      'eventa:invoke:lia:brain:chat-decision',
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:event:lia:brain:send-terminal-observation',
    ])

    // ...and the whole production tree names those four and no fifth.
    const tags = new Set<string>()
    for (const relative of productionSources(BRAIN_ROOTS)) {
      for (const match of readFileSync(join(process.cwd(), '..', '..', relative), 'utf-8').matchAll(/eventa:(?:invoke|event):lia:brain[^'"\n]*/g))
        tags.add(match[0])
    }
    expect([...tags].sort()).toEqual([
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
      'eventa:event:lia:brain:send-terminal-observation',
      'eventa:invoke:lia:brain:chat-decision',
    ])
  })
})
