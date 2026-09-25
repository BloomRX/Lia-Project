// @vitest-environment happy-dom
import type { ChatRequestStartedObservation } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

/**
 * Phase 8.0D-10B-4A: the Lia execution reporter.
 *
 * The reporter under test is the REAL one; the generic request-start seam is
 * the REAL seam (`registerChatRequestStartedObserver` /
 * `notifyChatRequestStarted`); only the Electron context is intercepted, so the
 * assertions are about the report the renderer would actually push.
 *
 * Two harnesses:
 *   - direct: observations handed to the observer (A-K, R-Q of the contract)
 *   - store: the REAL chat store send with a fallback resolver, which is the
 *     existing request-start harness (multi-attempt proof L-Q)
 */

const electron = vi.hoisted(() => ({
  emit: vi.fn(),
  context: { emit: vi.fn() },
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaContext: () => ref(electron.context),
}))

// The stage-ui modules the REAL chat store reads while sending. Only the
// provider/model identities and the stream are doubled - the send path, the
// fallback loop and the request-start notification are the real ones.
const storeMocks = vi.hoisted(() => ({
  getChatProviderInstance: vi.fn(),
  llmStream: vi.fn(),
}))

/**
 * The live selection the real chat store reads through `storeToRefs`. A
 * `reactive` wrapper is essential: the fallback flow assigns
 * `consciousnessStore.activeProvider = next.providerId`, and only a reactive
 * holder propagates that to the ref the send path already captured.
 */
const activeProvider = ref('mock-provider')
const activeModel = ref('gpt-test')

vi.hoisted(() => {
  ;(globalThis as any).window ??= {}
  ;(globalThis as any).window.location ??= { origin: 'http://localhost' }
})

const sessionState = vi.hoisted(() => ({
  messages: { } as Record<string, any[]>,
  generation: 1,
}))

const seamMocks = vi.hoisted(() => ({
  ingestContextMessage: vi.fn(),
  getContextsSnapshot: vi.fn(),
  loadSession: vi.fn(),
}))

vi.mock('@proj-airi/stage-ui/stores/chat/session-store', () => ({
  useChatSessionStore: () => ({
    activeSessionId: ref('session-1'),
    sessionMessages: sessionState.messages,
    ensureSession: (sessionId: string) => {
      sessionState.messages[sessionId] ??= [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }]
    },
    appendSessionMessage: (sessionId: string, message: unknown) => {
      sessionState.messages[sessionId] ??= []
      sessionState.messages[sessionId].push(message)
    },
    cleanupMessages: (sessionId: string) => {
      sessionState.messages[sessionId] = []
    },
    getSessionMessages: (sessionId: string) => sessionState.messages[sessionId] ?? [],
    getSessionMessagesIfLoaded: (sessionId: string) => sessionState.messages[sessionId],
    loadSession: (...args: unknown[]) => seamMocks.loadSession(...args),
    deleteSession: vi.fn(),
    initialize: vi.fn(),
    dispose: vi.fn(),
    ensureCurrentSession: vi.fn().mockResolvedValue('session-1'),
    persistSessionMessages: vi.fn(),
    getSessionGeneration: () => sessionState.generation,
    setSessionMessages: (sessionId: string, messages: any[]) => {
      sessionState.messages[sessionId] = messages
    },
    forkSession: vi.fn(),
    pushMessageToCloud: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/chat/stream-store', () => ({
  useChatStreamStore: () => ({
    streamingMessage: ref({ role: 'assistant', content: '', slices: [], tool_results: [] }),
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/chat/context-store', () => ({
  useChatContextStore: () => ({
    ingestContextMessage: seamMocks.ingestContextMessage,
    getContextsSnapshot: seamMocks.getContextsSnapshot,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/chat/context-providers', () => ({
  createMinecraftContext: () => undefined,
  createLiaCapabilitiesContext: () => null,
}))

vi.mock('@proj-airi/stage-ui/libs/analytics', () => ({
  getAnalytics: () => ({
    emit: () => false,
    recordFirstMessage: () => {},
  }),
}))

vi.mock('@proj-airi/stage-ui/composables/use-io-tracer', () => ({
  activeTurnSpan: ref(undefined),
  startSpan: () => ({ addEvent: vi.fn(), end: vi.fn(), setAttribute: vi.fn() }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/consciousness', () => ({
  useConsciousnessStore: () => reactive({
    activeModel,
    activeProvider,
    getChatProviderInstance: storeMocks.getChatProviderInstance,
  }),
}))

vi.mock('@proj-airi/stage-ui/stores/ai/chat-llm/llm', () => ({
  useLLM: () => ({ stream: storeMocks.llmStream }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => ({ activeCard: undefined }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/artistry-autonomous', () => ({
  useAutonomousArtistryStore: () => ({ runArtistTask: vi.fn() }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/web-search', () => ({
  useWebSearchStore: () => ({}),
}))

vi.mock('@proj-airi/stage-ui/stores/ai/chat-llm/tools', () => ({
  useLlmToolsStore: () => ({ getToolsByNames: () => [] }),
}))

vi.mock('@proj-airi/stage-ui/stores/ai/chat-llm/toolset-prompts', () => ({
  useLlmToolsetPromptsStore: () => ({ activeToolsetPrompt: '' }),
}))

const { registerLiaBrainExecutionObserver, reportLiaBrainExecutionObservation } = await import('./execution-reporter')
const { registerChatFallbackResolver, resetChatProviderRuntimeExtensionsForTesting } = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')
const { electronLiaBrainExecutionObservation } = await import('../../../shared/eventa')

/** An observation carrying every forbidden payload a hostile runtime could add. */
function correlatedObservation(overrides: Partial<ChatRequestStartedObservation> = {}): ChatRequestStartedObservation & Record<string, unknown> {
  return {
    correlationId: 'logical-send-77',
    conversationId: 'conversation-1',
    roundId: 'round-a',
    providerId: 'mock-provider',
    modelId: 'gpt-test',
    // Never reportable - present only to prove the report ignores them.
    text: 'private prompt text',
    messages: [{ role: 'user', content: 'secret' }],
    attachments: [{ type: 'image', data: 'base64-image' }],
    tools: [{ name: 'danger' }],
    apiKey: 'sk-secret',
    baseURL: 'https://example.invalid/',
    chatProvider: { chat: () => ({}) },
    decision: { status: 'automatic' },
    ...overrides,
  } as ChatRequestStartedObservation & Record<string, unknown>
}

function emittedReports(): Array<Record<string, unknown>> {
  return electron.context.emit.mock.calls.map(([, report]) => report as Record<string, unknown>)
}

/** The reporter's source, read from disk (happy-dom gives no file: import.meta.url). */
function reporterSource(): string {
  return readFileSync(join(process.cwd(), 'src/renderer/services/lia/execution-reporter.ts'), 'utf-8')
}

beforeEach(() => {
  setActivePinia(createPinia())
  electron.context.emit.mockClear()
  storeMocks.getChatProviderInstance.mockReset()
  storeMocks.llmStream.mockReset()
  resetChatProviderRuntimeExtensionsForTesting()
  seamMocks.loadSession.mockReset().mockResolvedValue(true)
  seamMocks.getContextsSnapshot.mockReset().mockReturnValue({})
  for (const key of Object.keys(sessionState.messages))
    delete sessionState.messages[key]
  sessionState.messages['session-1'] = [{ role: 'system', content: 'system prompt', createdAt: 1, id: 'system' }]
  activeProvider.value = 'mock-provider'
  activeModel.value = 'gpt-test'
})

describe('lia execution reporter (Phase 8.0D-10B-4A)', () => {
  it('a: exactly ONE Lia production registration SITE installs the observer', () => {
    // Repo-wide, over every production layer the send path crosses: Stage,
    // stage-ui and core-agent. The OLD invariant was "zero production
    // registrations"; this phase evolves it into exactly ONE legitimate Lia
    // site - the registration signal is the generic seam call, not the module
    // that defines it.
    const airiRoot = join(process.cwd(), '..', '..')
    const roots = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src']
    const registrarSites: string[] = []
    const observerSites: string[] = []
    for (const root of roots) {
      for (const entry of readdirSync(join(airiRoot, root), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
          continue
        const file = `${entry.parentPath}/${entry.name}`
        const source = readFileSync(file, 'utf-8')
        const relative = file.slice(join(airiRoot, '/').length)
        // The registration SIGNAL: CALLING the installer, never defining it.
        if (/(?<!function )registerLiaBrainExecutionObserver\(\)/.test(source))
          registrarSites.push(relative)
        // Same distinction: calling the generic seam, never defining it.
        if (/(?<!function )registerChatRequestStartedObserver\(/.test(source))
          observerSites.push(relative)
      }
    }

    // Exactly one production site, in the renderer composition root - and no
    // second observer registry anywhere in the shared layers.
    expect(registrarSites).toEqual(['apps/stage-tamagotchi/src/renderer/main.ts'])
    expect(observerSites).toEqual(['apps/stage-tamagotchi/src/renderer/services/lia/execution-reporter.ts'])
    // The generic registry module still DEFINES the seam and registers nothing.
    expect(readFileSync(join(airiRoot, 'packages/stage-ui/src/stores/chat/chat-provider-runtime.ts'), 'utf-8'))
      .toContain('export function registerChatRequestStartedObserver')
  })

  it('b/d/e/k: one correlated attempt reports exactly the five identities, verbatim', () => {
    reportLiaBrainExecutionObservation(correlatedObservation())

    expect(electron.context.emit).toHaveBeenCalledTimes(1)
    const [channel, report] = electron.context.emit.mock.calls[0] as [unknown, Record<string, unknown>]
    expect(channel).toBe(electronLiaBrainExecutionObservation)
    // D: exactly five fields.
    expect(Object.keys(report).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
    // E: every value forwarded verbatim.
    expect(report).toEqual({
      correlationId: 'logical-send-77',
      conversationId: 'conversation-1',
      roundId: 'round-a',
      providerId: 'mock-provider',
      modelId: 'gpt-test',
    })
    // K: no prompt, message, attachment, tool, credential, endpoint, provider
    // object or decision leaks into the report.
    const serialized = JSON.stringify(report)
    for (const forbidden of ['private prompt text', 'secret', 'base64-image', 'danger', 'sk-secret', 'example.invalid', 'automatic'])
      expect(serialized).not.toContain(forbidden)
  })

  it('e2: opaque values are copied as-is - never parsed, trimmed or interpreted', () => {
    reportLiaBrainExecutionObservation(correlatedObservation({
      correlationId: ' logical-send-77 ',
      providerId: 'engineId=openai;modelId=gpt-5.4',
      modelId: '',
    }))

    expect(emittedReports()[0]).toMatchObject({
      correlationId: ' logical-send-77 ',
      providerId: 'engineId=openai;modelId=gpt-5.4',
      modelId: '',
    })
  })

  it('c: uncorrelated observations are never reported', () => {
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: undefined }))
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: '' }))
    // Tolerant filter: a non-string key reads as "uncorrelated", never as a report.
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: 42 as unknown as string }))
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: null as unknown as string }))

    expect(electron.context.emit).not.toHaveBeenCalled()
  })

  it('f/g: the reporter reads no Brain decision and performs no provider/model lookup', async () => {
    const source = reporterSource()

    // No Brain surface at all: no decision, no channel, no service, no catalog.
    expect(source).not.toMatch(/LiaBrainChatDecision|electronLiaBrainChatDecision|LiaBrainService|decide|brain-shadow|automaticPolicy/)
    // No provider/model resolution of its own: the runtime resolved the
    // attempt long before the observation arrived. The only provider/model
    // words in the module are the direct field copies.
    expect(source).not.toMatch(/getChatProviderInstance|getActiveProvider|useProviderStore|useConsciousnessStore|useLLM|listModels|createProvider|resolveProvider/)
    expect(source.match(/providerId: observation\.providerId/g)).toHaveLength(1)
    expect(source.match(/modelId: observation\.modelId/g)).toHaveLength(1)
    // And the only Lia Core entry point stays the shared fact type - which this
    // module does not even import.
    expect(source).not.toMatch(/@lia\/core|@proj-airi\/stage-ui\/stores\/providers/)

    // Runtime proof: a report never touches the provider resolution seam.
    reportLiaBrainExecutionObservation(correlatedObservation())
    expect(storeMocks.getChatProviderInstance).not.toHaveBeenCalled()
    expect(electron.emit).not.toHaveBeenCalled()
  })

  it('h: the reporter stores no state between reports', () => {
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: 'send-1', roundId: 'round-1' }))
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: 'send-2', roundId: 'round-2' }))
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: 'send-1', roundId: 'round-3' }))

    // Every report stands alone: no dedupe by correlationId, no accumulation,
    // no memory of what was reported before.
    expect(emittedReports().map(report => [report.correlationId, report.roundId])).toEqual([
      ['send-1', 'round-1'],
      ['send-2', 'round-2'],
      ['send-1', 'round-3'],
    ])
  })

  it('h2: the module holds no storage surface at all', async () => {
    const source = reporterSource()

    expect(source).not.toMatch(/new Map\(|new Set\(|localStorage|sessionStorage|lastExecution|pendingExecution|history|cache|TTL/)
    expect(source).not.toMatch(/Array\.from|new Array|\.push\(/)
  })

  it('i: a failing dispatch is isolated - the observer never throws and never rejects', async () => {
    electron.context.emit.mockImplementationOnce(() => {
      throw new Error('no listener / channel is gone')
    })

    expect(() => reportLiaBrainExecutionObservation(correlatedObservation())).not.toThrow()
    // The very next report still works: a failure is not latched.
    reportLiaBrainExecutionObservation(correlatedObservation({ correlationId: 'send-after-failure' }))
    expect(emittedReports().at(-1)?.correlationId).toBe('send-after-failure')

    // A missing Electron context is equally isolated (web/pocket renderers).
    const electronVueuse = await import('@proj-airi/electron-vueuse')
    const spy = vi.spyOn(electronVueuse, 'useElectronEventaContext').mockImplementationOnce(() => {
      throw new Error('Electron ipcRenderer is not available')
    })
    expect(() => reportLiaBrainExecutionObservation(correlatedObservation())).not.toThrow()
    spy.mockRestore()
  })

  it('j: the observer and the installer both return void', () => {
    expect(reportLiaBrainExecutionObservation(correlatedObservation())).toBeUndefined()
    expect(registerLiaBrainExecutionObserver()).toBeUndefined()
  })

  it('j2: the installed observer is the reporter, wired through the generic seam only', async () => {
    const seam = await import('@proj-airi/stage-ui/stores/chat/chat-provider-runtime')
    registerLiaBrainExecutionObserver()

    expect(seam.getChatRequestStartedObserver()).toBe(reportLiaBrainExecutionObservation)
    // Nothing is reported until the runtime says a request is starting, and a
    // correlated start is reported once.
    expect(electron.context.emit).not.toHaveBeenCalled()
    seam.notifyChatRequestStarted(correlatedObservation())
    seam.notifyChatRequestStarted(correlatedObservation({ correlationId: undefined }))
    expect(electron.context.emit).toHaveBeenCalledTimes(1)
  })
})

describe('lia execution reporter across provider attempts (Phase 8.0D-10B-4A)', () => {
  /** The REAL chat store send: one logical send, a fallback resolver, two attempts. */
  async function sendWithFallbackOnce(): Promise<void> {
    const { useChatStore } = await import('@proj-airi/stage-ui/stores/chat')
    storeMocks.llmStream.mockImplementation(async () => {
      if (storeMocks.llmStream.mock.calls.length === 1)
        throw new Error('provider a is down')
      return undefined
    })
    registerChatFallbackResolver(() => ({ providerId: 'fallback-provider', modelId: 'fallback-model' }))

    await useChatStore().send({ sessionId: 'session-1', text: 'hello', correlationId: 'logical-send-X' })
  }

  it('l/m/n/o/p/q: fallback attempts are reported separately, never deduplicated', async () => {
    const provider = { chat: () => ({ baseURL: 'https://example.com/' }) }
    storeMocks.getChatProviderInstance.mockImplementation((providerId: string) => ({ provider, providerId }))
    // The observer under test is the REAL production registration.
    registerLiaBrainExecutionObserver()

    await sendWithFallbackOnce()

    const reports = emittedReports()
    // Q/L/M: one report per attempt - the second attempt is NOT lost because
    // the correlationId repeats.
    expect(reports.map(report => report.correlationId)).toEqual(['logical-send-X', 'logical-send-X'])
    expect(reports).toHaveLength(2)
    // N: identical join key on both reports.
    expect(new Set(reports.map(report => report.correlationId)).size).toBe(1)
    // O: distinct round ids - these are two different attempts.
    const roundIds = reports.map(report => report.roundId)
    expect(new Set(roundIds).size).toBe(2)
    for (const roundId of roundIds)
      expect(String(roundId).length).toBeGreaterThan(0)
    // P: provider/model match the attempt they describe, in order.
    expect(reports.map(report => [report.providerId, report.modelId])).toEqual([
      ['mock-provider', 'gpt-test'],
      ['fallback-provider', 'fallback-model'],
    ])
    // The report never invents extra identity for the attempts.
    for (const report of reports)
      expect(Object.keys(report).sort()).toEqual(['conversationId', 'correlationId', 'modelId', 'providerId', 'roundId'])
  })

  it('q2: an uncorrelated send of the same shape reports nothing', async () => {
    const provider = { chat: () => ({ baseURL: 'https://example.com/' }) }
    storeMocks.getChatProviderInstance.mockImplementation((providerId: string) => ({ provider, providerId }))
    storeMocks.llmStream.mockImplementation(async () => undefined)
    registerLiaBrainExecutionObserver()

    const { useChatStore } = await import('@proj-airi/stage-ui/stores/chat')
    await useChatStore().send({ sessionId: 'session-1', text: 'voice or spotlight send' })

    expect(electron.context.emit).not.toHaveBeenCalled()
    // Sanity: the send itself really did start a request (the seam fired).
    expect(storeMocks.llmStream).toHaveBeenCalledTimes(1)
  })
})
