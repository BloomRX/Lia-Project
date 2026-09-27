// @vitest-environment happy-dom

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

/**
 * Phase 8.0D-10B-4D4C1: the Lia terminal execution reporter.
 *
 * The reporter under test is the REAL one; the generic settled-round seam is
 * the REAL seam (`registerChatRoundSettledObserver` /
 * `notifyChatRoundSettled`); only the Electron context is intercepted, so the
 * assertions are about the report the renderer would actually push.
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

const { electronLiaBrainExecutionTerminalObservation } = await import('../../../shared/eventa')
const {
  registerLiaBrainExecutionTerminalObserver,
  reportLiaBrainExecutionTerminalObservation,
} = await import('./execution-terminal-reporter')
const {
  getChatRequestStartedObserver,
  getChatRoundSettledObserver,
  notifyChatRoundSettled,
  resetChatProviderRuntimeExtensionsForTesting,
} = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')

/** The observation the seam forwards, taken from the notifier it is built on. */
type ChatRoundSettledObservation = Parameters<typeof notifyChatRoundSettled>[0]

beforeEach(() => {
  setActivePinia(createPinia())
  resetChatProviderRuntimeExtensionsForTesting()
  electron.context.emit.mockClear()
})

afterEach(() => resetChatProviderRuntimeExtensionsForTesting())

function settled(overrides: Partial<ChatRoundSettledObservation> = {}): ChatRoundSettledObservation {
  return { correlationId: 'logical-send-77', outcome: 'succeeded', roundId: 'round-a', ...overrides }
}

function emittedReports(): Array<Record<string, unknown>> {
  return electron.context.emit.mock.calls.map(([, report]) => report as Record<string, unknown>)
}

function emittedOutcomes(): unknown[] {
  return emittedReports().map(report => report.outcome)
}

describe('lia terminal execution reporter (Phase 8.0D-10B-4D4C1)', () => {
  it('a/b/c: each valid outcome is reported exactly once, with the exact three keys', () => {
    for (const outcome of ['succeeded', 'failed', 'abandoned'] as const) {
      electron.context.emit.mockClear()
      reportLiaBrainExecutionTerminalObservation(settled({ outcome, roundId: `round-${outcome}` }))

      expect(electron.context.emit).toHaveBeenCalledTimes(1)
      const [channel, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
      // The emitted channel is the NEW one-way contract, never the request-start one.
      expect(channel).toBe(electronLiaBrainExecutionTerminalObservation)
      // The exact three contract fields - no conversation, no provider/model,
      // no turn, no timestamp, no duration, no error, no usage.
      expect(Object.keys(report).sort()).toEqual(['correlationId', 'outcome', 'roundId'])
      expect(report).toEqual({
        correlationId: 'logical-send-77',
        outcome,
        roundId: `round-${outcome}`,
      })
    }
  })

  it('d: the report is a fresh plain object with only copied values', () => {
    const source = settled({ outcome: 'failed', roundId: 'round-d' })
    reportLiaBrainExecutionTerminalObservation(source)

    const [, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
    // A copy, not the observation itself: the runtime keeps its own object.
    expect(report).not.toBe(source)
    expect(report).toEqual({ correlationId: 'logical-send-77', outcome: 'failed', roundId: 'round-d' })
  })

  it('e/f: an absent or unusable correlationId is never reported and never synthesized', () => {
    reportLiaBrainExecutionTerminalObservation(settled({ correlationId: undefined }))
    reportLiaBrainExecutionTerminalObservation(settled({ correlationId: '' }))
    // Hostile shapes the generic seam would forward: still no report.
    reportLiaBrainExecutionTerminalObservation(settled({ correlationId: 42 as unknown as string }))
    reportLiaBrainExecutionTerminalObservation(settled({ correlationId: null as unknown as string }))

    expect(electron.context.emit).not.toHaveBeenCalled()
  })

  it('g: an invalid roundId is never reported - no partial report', () => {
    reportLiaBrainExecutionTerminalObservation(settled({ roundId: '' }))
    reportLiaBrainExecutionTerminalObservation(settled({ roundId: undefined as unknown as string }))
    reportLiaBrainExecutionTerminalObservation(settled({ roundId: 123 as unknown as string }))

    expect(electron.context.emit).not.toHaveBeenCalled()
  })

  it('h: an outcome outside the frozen vocabulary is dropped, never coerced', () => {
    for (const hostile of ['cancelled', 'error', 'completed', 'SUCCEEDED', '', 'succeeded ', 1, null, undefined, {}]) {
      reportLiaBrainExecutionTerminalObservation(settled({ outcome: hostile as never }))
    }

    expect(electron.context.emit).not.toHaveBeenCalled()
  })

  it('i: two identical observations produce two emissions - the reporter is not storage', () => {
    const duplicate = settled({ outcome: 'abandoned', roundId: 'round-dup' })
    reportLiaBrainExecutionTerminalObservation(duplicate)
    reportLiaBrainExecutionTerminalObservation(duplicate)

    expect(electron.context.emit).toHaveBeenCalledTimes(2)
    expect(emittedOutcomes()).toEqual(['abandoned', 'abandoned'])
  })

  it('j: arrival order is preserved verbatim - no sorting, no reordering', () => {
    reportLiaBrainExecutionTerminalObservation(settled({ outcome: 'succeeded', roundId: 'round-1' }))
    reportLiaBrainExecutionTerminalObservation(settled({ outcome: 'failed', roundId: 'round-2' }))

    expect(emittedReports().map(report => report.roundId)).toEqual(['round-1', 'round-2'])
    expect(emittedOutcomes()).toEqual(['succeeded', 'failed'])
  })

  it('k: a terminal report needs no previous request-start report of any kind', () => {
    // No start observation was ever reported for this round, and the reporter
    // keeps no join state: it reports the terminal fact on its own.
    expect(getChatRequestStartedObserver()).toBeUndefined()

    reportLiaBrainExecutionTerminalObservation(settled({ outcome: 'failed', roundId: 'round-never-started' }))

    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    expect(emittedReports()[0]).toEqual({
      correlationId: 'logical-send-77',
      outcome: 'failed',
      roundId: 'round-never-started',
    })
  })

  it('l/o: a throwing or unavailable Electron context is contained, with no retry', () => {
    electron.context.emit.mockImplementationOnce(() => {
      throw new Error('no listener / channel is gone')
    })

    expect(() => reportLiaBrainExecutionTerminalObservation(settled())).not.toThrow()
    // The very next report still works: a failure is not latched.
    reportLiaBrainExecutionTerminalObservation(settled({ roundId: 'round-after-failure' }))
    expect(emittedReports().at(-1)?.roundId).toBe('round-after-failure')
  })

  it('m: the installer registers exactly one settled observer and returns void', async () => {
    expect(registerLiaBrainExecutionTerminalObserver()).toBeUndefined()
    expect(getChatRoundSettledObserver()).toBe(reportLiaBrainExecutionTerminalObservation)
    // Registration alone reports nothing.
    expect(electron.context.emit).not.toHaveBeenCalled()

    notifyChatRoundSettled(settled({ outcome: 'succeeded', roundId: 'round-via-seam' }))
    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    expect(emittedReports()[0]).toEqual({
      correlationId: 'logical-send-77',
      outcome: 'succeeded',
      roundId: 'round-via-seam',
    })

    // A hostile Electron context reached through the seam never escapes into
    // the notifier (which owns the isolation) and never breaks the caller.
    electron.context.emit.mockImplementationOnce(() => {
      throw new Error('emit exploded')
    })
    expect(() => notifyChatRoundSettled(settled())).not.toThrow()
  })

  it('n: an uncorrelated observation crosses the generic seam and is still filtered here', () => {
    registerLiaBrainExecutionTerminalObserver()

    // The generic seam forwards it (B2 contract), and THIS layer is the first
    // one that drops it.
    expect(() => notifyChatRoundSettled({ outcome: 'succeeded', roundId: 'round-unkeyed' })).not.toThrow()

    expect(electron.context.emit).not.toHaveBeenCalled()
  })

  it('p: the reporter is transport only - no state, no interpretation, no output', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/services/lia/execution-terminal-reporter.ts'), 'utf-8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    // No cross-event memory of any kind.
    expect(code).not.toMatch(/\bnew Map\b|\bnew Set\b|\bhistory\b|\bpending\b|\bcache\b|\battempts\b|lastOutcome/)
    // No aggregate/verdict vocabulary, in any casing.
    expect(code).not.toMatch(/finalAttempt|winningAttempt|fallbackObserved|fallbackCount|sendSucceeded|routeMatch|mismatch|divergence|aligned|anyAttempt|verdict|score|recommendation/i)
    // No diagnostics output and no telemetry.
    expect(code).not.toMatch(/console\.|@guiiai\/logg|logger|telemetry|posthog/i)
    // No provider/model/conversation/error/prompt knowledge.
    expect(code).not.toMatch(/providerId|modelId|conversationId|turnIndex|failureStage|errorCode|prompt|messages|toolResults|usage/i)
    // No main-process access, no second channel, no invoke.
    expect(code).not.toMatch(/ipcMain|ipcRenderer|BrowserWindow|\binvoke\(|defineEventa/)
    // Exactly ONE channel literal, and it is the terminal one.
    const channelLiterals = code.match(/eventa:(?:invoke|event):lia:brain[^'"]*/g) ?? []
    expect(channelLiterals).toEqual([])
    // One emit site only: the identifier occurs exactly twice - the import and
    // the single push.
    expect(code.match(/\.emit\(/g)).toHaveLength(1)
    expect(code.match(/electronLiaBrainExecutionTerminalObservation/g)).toHaveLength(2)
    // No new package edge: the observation type is DERIVED from the seam, so
    // this module imports nothing from Core Agent or Lia Core directly.
    expect(code).not.toMatch(/@proj-airi\/(?:core-agent|lia-core)/)
    // No execution authority.
    expect(code).not.toMatch(/setProvider|setModel|activeProvider|activeModel|retry|permission|abort/i)
  })

  it('q: exactly one production registration site and one producer of the new channel', () => {
    const airiRoot = join(process.cwd(), '..', '..')
    const roots = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src']
    const settledRegistrarSites: string[] = []
    const requestStartRegistrarSites: string[] = []
    const terminalChannelSites: string[] = []
    for (const root of roots) {
      for (const entry of readdirSync(join(airiRoot, root), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
          continue
        const file = `${entry.parentPath}/${entry.name}`
        const source = readFileSync(file, 'utf-8')
        const relative = file.slice(join(airiRoot, '/').length)
        // The registration SIGNAL: CALLING the installer, never defining it.
        if (/(?<!function )registerLiaBrainExecutionTerminalObserver\(\)/.test(source))
          settledRegistrarSites.push(relative)
        if (/(?<!function )registerLiaBrainExecutionObserver\(\)/.test(source))
          requestStartRegistrarSites.push(relative)
        if (/electronLiaBrainExecutionTerminalObservation/.test(source))
          terminalChannelSites.push(relative)
      }
    }

    // Exactly one production registration, in the renderer composition root...
    expect(settledRegistrarSites).toEqual(['apps/stage-tamagotchi/src/renderer/main.ts'])
    // ...the request-start installation count is unchanged...
    expect(requestStartRegistrarSites).toEqual(['apps/stage-tamagotchi/src/renderer/main.ts'])
    // ...and the new channel has exactly ONE producer module plus its shared
    // declaration - no second emitter exists yet.
    expect(terminalChannelSites.sort()).toEqual([
      'apps/stage-tamagotchi/src/renderer/services/lia/execution-terminal-reporter.ts',
      'apps/stage-tamagotchi/src/shared/eventa/index.ts',
    ])

    // Zero main-process consumer of the new channel (declaration only, no
    // listener, no handler, no lifecycle provider).
    const mainConsumers = terminalChannelSites.filter(relative => relative.startsWith('apps/stage-tamagotchi/src/main/'))
    expect(mainConsumers).toEqual([])
  })
})

/**
 * Phase 8.0D-10B-4D4C1: the shared IPC contract - one new terminal report, one
 * new one-way channel, and no overload of the request-start contract.
 */
describe('lia terminal execution contract (Phase 8.0D-10B-4D4C1)', () => {
  const SHARED = readFileSync(join(process.cwd(), 'src/shared/eventa/index.ts'), 'utf-8')

  it('the report type is exactly the three contract fields, in that order', () => {
    const start = SHARED.indexOf('export interface LiaBrainExecutionTerminalReport {')
    const end = SHARED.indexOf('export const electronLiaBrainExecutionTerminalObservation', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    const block = SHARED.slice(start, end)
    // Guards read real code only: the doc prose may name the concepts.
    const blockCode = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // Three fields and nothing else: no conversation, no provider/model
    // identity, no turn, no timing, no usage, no error or failure stage.
    expect(blockCode.match(/^\s{2}(\w+):/gm)?.map(field => field.trim()))
      .toEqual(['correlationId:', 'roundId:', 'outcome:'])
    expect(blockCode.replace(/\s+/g, ' ')).toContain('outcome: \'succeeded\' | \'failed\' | \'abandoned\'')
    for (const forbidden of ['conversationId', 'providerId', 'modelId', 'turnIndex', 'timestamp', 'duration', 'error', 'failureStage', 'errorCode', 'prompt', 'messages', 'tools', 'usage', 'cancelled'])
      expect(blockCode).not.toContain(forbidden)
  })

  it('the channel is one one-way push under the frozen tag, declared exactly once', () => {
    expect(SHARED.match(/electronLiaBrainExecutionTerminalObservation/g)).toHaveLength(1)
    expect(SHARED).toMatch(/export const electronLiaBrainExecutionTerminalObservation = defineEventa<LiaBrainExecutionTerminalReport>\('eventa:event:lia:brain:execution-terminal-observation'\)/)
    // The generic Brain allowlist is now exactly three tags: the read-only
    // decision invoke and the two one-way reports.
    expect(SHARED.match(/eventa:(?:invoke|event):lia:brain[^']*/g) ?? []).toEqual([
      'eventa:invoke:lia:brain:chat-decision',
      'eventa:event:lia:brain:execution-observation',
      'eventa:event:lia:brain:execution-terminal-observation',
    ])
  })

  it('the request-start contract is untouched - no union, no shared shape', () => {
    const start = SHARED.indexOf('export interface LiaBrainExecutionObservationReport {')
    const end = SHARED.indexOf('export const electronLiaBrainExecutionObservation', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)

    // The 4A report keeps its five identities, and the outcome union lives in
    // the terminal report only.
    const requestStart = SHARED.slice(start, end)
    expect(requestStart.match(/^\s{2}(\w+):/gm)?.map(field => field.trim()))
      .toEqual(['correlationId:', 'conversationId:', 'roundId:', 'providerId:', 'modelId:'])
    expect(requestStart).not.toContain('outcome')
    // The terminal block sits AFTER the 4A declaration: the pre-existing slice
    // that legacy tests read between those two markers is unchanged.
    expect(SHARED.indexOf('export const electronLiaBrainExecutionTerminalObservation'))
      .toBeGreaterThan(SHARED.indexOf('export const electronLiaBrainExecutionObservation'))
  })
})
