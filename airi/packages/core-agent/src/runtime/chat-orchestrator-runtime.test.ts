import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import type { ChatHistoryItem, ContextMessage, StreamingAssistantMessage } from '../types/chat'
import type { StreamEvent, StreamOptions } from '../types/llm'
import type { ChatRoundOutcome, ChatRoundSettledObservation } from './chat-orchestrator-runtime'

import { readFileSync } from 'node:fs'

import { ContextUpdateStrategy } from '@proj-airi/server-shared/types'
import { describe, expect, it, vi } from 'vitest'

import { createChatOrchestratorRuntime } from './chat-orchestrator-runtime'
// TEST-ONLY helper: keep source guards stable across CRLF/LF checkouts
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

const provider = {
  chat: () => ({ baseURL: 'https://example.com/' }),
} as unknown as ChatProvider

function createHarness(options: { getActiveProvider?: () => string | undefined } = {}) {
  const sessionMessages: Record<string, ChatHistoryItem[]> = {
    'session-1': [
      {
        role: 'system',
        content: 'system prompt',
        createdAt: new Date(2026, 3, 25, 18, 0).getTime(),
        id: 'system',
      },
    ],
  }
  const contextSnapshot: Record<string, ContextMessage[]> = {}
  const foregroundPatches: StreamingAssistantMessage[] = []
  const foregroundResets: StreamingAssistantMessage[] = []
  const lifecycleRecords: unknown[] = []
  const promptProjections: unknown[] = []
  const userAppended: unknown[] = []
  const assistantAppended: unknown[] = []
  const userTurns: unknown[] = []
  const assistantTurns: unknown[] = []
  const stateChanges: unknown[] = []
  const chatRoundSettled: unknown[] = []
  const sendSettledSessions: string[] = []
  let chatRoundSettledError: unknown
  let sendSettledError: unknown
  let stateChangeArmed = false
  let stateChangeError: unknown
  let chatActivationSucceededError: unknown
  let beforeAssistantAppended: (() => void) | undefined
  let beforeSnapshot: (() => void) | undefined
  let ensureSessionError: unknown
  const telemetry = {
    chatActivationStarted: [] as unknown[],
    chatActivationSucceeded: [] as unknown[],
    chatActivationFailed: [] as unknown[],
    messageSendStarted: [] as unknown[],
    llmRequestStarted: [] as unknown[],
    llmFirstToken: [] as unknown[],
    assistantResponseRendered: [] as unknown[],
    llmGeneration: [] as unknown[],
    messageRound: [] as unknown[],
    messageRoundFailed: [] as unknown[],
  }
  const stream = vi.fn(async (_model: string, _chatProvider: ChatProvider, _messages: Message[], options?: StreamOptions) => {
    await options?.onStreamEvent?.({ type: 'text-delta', text: 'assistant reply' })
    await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
  })
  const ids = ['stream-context', 'assistant-id', 'user-id', 'fallback-id']
  // Counts every live-store provider read so a test can prove that carrying the
  // identity adds no additional provider resolution.
  const activeProviderSpy = vi.fn(options.getActiveProvider ?? (() => 'mock-provider'))
  let systemPromptSupplement: string | undefined
  let nowValue = new Date(2026, 3, 25, 18, 47).getTime()
  let monotonicNowValues = [1000]
  let generation = 1

  const runtime = createChatOrchestratorRuntime({
    session: {
      ensureSession: (sessionId) => {
        if (ensureSessionError !== undefined)
          throw ensureSessionError
        sessionMessages[sessionId] ??= []
      },
      getSessionMessages: sessionId => sessionMessages[sessionId] ?? [],
      appendSessionMessage: (sessionId, message) => {
        sessionMessages[sessionId] ??= []
        sessionMessages[sessionId].push(message)
      },
      getSessionGeneration: () => generation,
    },
    context: {
      ingest: vi.fn(),
      snapshot: () => {
        beforeSnapshot?.()
        return structuredClone(contextSnapshot)
      },
    },
    foregroundStream: {
      patch: message => foregroundPatches.push(message),
      reset: () => foregroundResets.push({ role: 'assistant', content: '', slices: [], tool_results: [] }),
    },
    llm: {
      stream,
    },
    getActiveSessionId: () => 'session-1',
    getActiveProvider: activeProviderSpy,
    getSystemPromptSupplement: () => systemPromptSupplement,
    now: () => nowValue,
    monotonicNow: () => monotonicNowValues.shift() ?? 1000,
    createId: () => ids.shift() ?? 'generated-id',
    onLifecycle: record => lifecycleRecords.push(record),
    onPromptProjection: payload => promptProjections.push(payload),
    onUserMessageAppended: event => userAppended.push(event),
    onAssistantMessageAppended: (event) => {
      beforeAssistantAppended?.()
      assistantAppended.push(event)
    },
    onUserTurnReady: event => userTurns.push(event),
    onAssistantTurnReady: event => assistantTurns.push(event),
    onStateChange: (state) => {
      stateChanges.push(state)
      if (stateChangeArmed)
        throw stateChangeError
    },
    onChatActivationStarted: event => telemetry.chatActivationStarted.push(event),
    onChatActivationSucceeded: (event) => {
      telemetry.chatActivationSucceeded.push(event)
      if (chatActivationSucceededError !== undefined)
        throw chatActivationSucceededError
    },
    onChatActivationFailed: event => telemetry.chatActivationFailed.push(event),
    onMessageSendStarted: event => telemetry.messageSendStarted.push(event),
    onLlmRequestStarted: event => telemetry.llmRequestStarted.push(event),
    onLlmFirstToken: event => telemetry.llmFirstToken.push(event),
    onAssistantResponseRendered: event => telemetry.assistantResponseRendered.push(event),
    onLlmGeneration: event => telemetry.llmGeneration.push(event),
    onMessageRound: event => telemetry.messageRound.push(event),
    onMessageRoundFailed: event => telemetry.messageRoundFailed.push(event),
    onSendSettled: (event) => {
      sendSettledSessions.push(event.sessionId)
      if (sendSettledError !== undefined)
        throw sendSettledError
    },
    onChatRoundSettled: (observation) => {
      chatRoundSettled.push(observation)
      if (chatRoundSettledError !== undefined)
        throw chatRoundSettledError
    },
  })

  return {
    activeProviderSpy,
    assistantAppended,
    assistantTurns,
    contextSnapshot,
    foregroundPatches,
    foregroundResets,
    generation: {
      set: (next: number) => {
        generation = next
      },
    },
    lifecycleRecords,
    now: {
      set: (next: number) => {
        nowValue = next
      },
    },
    monotonicNow: {
      set: (next: number[]) => {
        monotonicNowValues = [...next]
      },
    },
    knobs: {
      beforeAssistantAppended: (fn: () => void) => {
        beforeAssistantAppended = fn
      },
      beforeSnapshot: (fn: () => void) => {
        beforeSnapshot = fn
      },
      chatActivationSucceededThrows: (error: unknown) => {
        chatActivationSucceededError = error
      },
      ensureSessionThrows: (error: unknown) => {
        ensureSessionError = error
      },
      onSendSettledThrows: (error: unknown) => {
        sendSettledError = error
      },
      stateChangeThrows: (error: unknown) => {
        stateChangeArmed = true
        stateChangeError = error
      },
    },
    promptProjections,
    runtime,
    sendSettledSessions,
    sessionMessages,
    settled: {
      calls: chatRoundSettled,
      throwOn: (error: unknown) => {
        chatRoundSettledError = error
      },
    },
    stateChanges,
    stream,
    systemPromptSupplement: {
      set: (next: string | undefined) => {
        systemPromptSupplement = next
      },
    },
    telemetry,
    userAppended,
    userTurns,
  }
}

describe('createChatOrchestratorRuntime', () => {
  // ROOT CAUSE:
  //
  // The marker parser buffered 24 literal characters plus its marker-safety tail.
  // Providers that emitted small, slow deltas therefore showed no visible text for several seconds.
  //
  // We fixed this by keeping only the marker-safety tail before the first foreground update.
  it('updates the foreground stream before a slow response reaches 24 characters', async () => {
    const harness = createHarness()
    let patchesBeforeFinish = 0

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      for (const text of '1234567890')
        await options?.onStreamEvent?.({ type: 'text-delta', text })

      patchesBeforeFinish = harness.foregroundPatches.length
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('show a slow response', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(patchesBeforeFinish).toBeGreaterThan(1)
    expect(harness.foregroundPatches.some(message => message.content === '1234')).toBe(true)
  })

  it('stores tool names with the user message and omits them from provider messages', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('use a widget', {
      model: 'gpt-test',
      chatProvider: provider,
      toolReferences: [{ name: 'stage_widgets' }],
    })

    const storedUserMessage = harness.sessionMessages['session-1']?.find(message => message.role === 'user')
    const providerMessages = harness.stream.mock.calls[0]?.[2]
    const providerUserMessage = providerMessages?.find(message => message.role === 'user')

    expect(storedUserMessage).toMatchObject({
      role: 'user',
      tools: [{ name: 'stage_widgets' }],
    })
    expect(providerUserMessage).not.toHaveProperty('tools')
  })

  // ROOT CAUSE:
  //
  // xsAI kept the assistant tool call and tool result in its private message copy.
  // AIRI stored only UI slices, then removed those slices from the next provider request.
  //
  // We fixed this by storing the provider transcript on the finalized UI message.
  // The next request expands that transcript back into chronological provider messages.
  it('includes completed tool rounds in the next provider request', async () => {
    const harness = createHarness()

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      await options?.onStreamEvent?.({
        type: 'tool-call',
        toolCallId: 'call-weather',
        toolName: 'weather',
        args: '{}',
      } as StreamEvent)
      await options?.onStreamEvent?.({
        type: 'tool-result',
        toolCallId: 'call-weather',
        result: 'sunny',
      } as StreamEvent)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'The weather is sunny.' })

      await (options as StreamOptions & { onMessages?: (messages: Message[]) => void })?.onMessages?.([
        ...messages,
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-weather',
              type: 'function',
              function: {
                name: 'weather',
                arguments: '{}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call-weather',
          content: 'sunny',
        },
        {
          role: 'assistant',
          content: 'The weather is sunny.',
        },
      ])
    })

    await harness.runtime.ingest('What is the weather?', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    await harness.runtime.ingest('Can you repeat that?', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const messages = harness.stream.mock.calls[1]?.[2]

    expect(messages?.map(message => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ])
    expect(messages?.[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-weather',
          type: 'function',
          function: {
            name: 'weather',
            arguments: '{}',
          },
        },
      ],
    })
    expect(messages?.[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call-weather',
      content: 'sunny',
    })
    expect(messages?.[4]).toEqual({
      role: 'assistant',
      content: 'The weather is sunny.',
    })
  })

  it('keeps hook order and appends context prompt to the latest user message', async () => {
    const harness = createHarness()
    harness.contextSnapshot['system:weather'] = [
      {
        id: 'weather',
        contextId: 'system:weather',
        strategy: ContextUpdateStrategy.ReplaceSelf,
        text: 'sunny',
        createdAt: 1,
      },
    ]
    const hookOrder: string[] = []
    let composedMessages: Message[] = []

    harness.runtime.hooks.onBeforeMessageComposed(async () => {
      hookOrder.push('before-compose')
    })
    harness.runtime.hooks.onAfterMessageComposed(async () => {
      hookOrder.push('after-compose')
    })
    harness.runtime.hooks.onBeforeSend(async () => {
      hookOrder.push('before-send')
    })
    harness.runtime.hooks.onTokenLiteral(async () => {
      hookOrder.push('token-literal')
    })
    harness.runtime.hooks.onStreamEnd(async () => {
      hookOrder.push('stream-end')
    })
    harness.runtime.hooks.onAssistantResponseEnd(async () => {
      hookOrder.push('assistant-end')
    })
    harness.runtime.hooks.onAfterSend(async () => {
      hookOrder.push('after-send')
    })
    harness.runtime.hooks.onAssistantMessage(async () => {
      hookOrder.push('assistant-message')
    })
    harness.runtime.hooks.onChatTurnComplete(async () => {
      hookOrder.push('turn-complete')
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(hookOrder).toEqual([
      'before-compose',
      'after-compose',
      'before-send',
      'token-literal',
      'stream-end',
      'assistant-end',
      'after-send',
      'assistant-message',
      'turn-complete',
    ])
    expect(composedMessages).toHaveLength(2)
    expect(composedMessages[0]).toMatchObject({ role: 'system', content: 'system prompt' })
    expect(composedMessages[1]).toMatchObject({ role: 'user' })
    expect(composedMessages[1]?.content).toEqual([
      {
        type: 'text',
        text: '[2026-04-25 18:47] hello from user',
      },
      {
        type: 'text',
        text: '\n[Context]\n- system:weather: sunny',
      },
    ])
    expect(harness.lifecycleRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'before-compose' }),
      expect.objectContaining({ phase: 'prompt-context-built' }),
      expect.objectContaining({ phase: 'after-compose' }),
    ]))
    expect(harness.promptProjections).toHaveLength(1)
  })

  // ROOT CAUSE:
  //
  // Speech-muted consumers dispatch plugin CALL markers without a TTS
  // session. If the hook context has no turn id, a locally unhandled call
  // cannot be correlated and relayed to another Electron renderer.
  it('preserves the round turn id on special-token hooks', async () => {
    const harness = createHarness()
    let specialTurnId = ''

    harness.runtime.hooks.onTokenSpecial(async (_special, context) => {
      specialTurnId = context.turnId
    })
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '<|CALL ["plugin.action"]|>' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('trigger special', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(specialTurnId).toBe('user-id')
    expect(harness.telemetry.messageSendStarted).toEqual([
      expect.objectContaining({ roundId: specialTurnId }),
    ])
  })

  it('keeps timestamp prefixes stable for legacy user messages without createdAt', async () => {
    const harness = createHarness()
    const legacyUserMessage: ChatHistoryItem = {
      role: 'user' as const,
      content: 'legacy prompt',
      id: 'legacy-user',
    }
    harness.sessionMessages['session-1'] = [
      { role: 'system', content: 'system prompt', createdAt: 1, id: 'system' },
      legacyUserMessage,
    ]
    const firstMessages: Message[][] = []
    const secondMessages: Message[][] = []

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      firstMessages.push(structuredClone(messages))
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })
    harness.now.set(new Date(2026, 3, 25, 18, 47).getTime())

    await harness.runtime.ingest('first send', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      secondMessages.push(structuredClone(messages))
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })
    harness.now.set(new Date(2026, 3, 25, 19, 12).getTime())

    await harness.runtime.ingest('second send', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(firstMessages[0]?.[1]?.content).toBe('[2026-04-25 18:47] legacy prompt')
    expect(secondMessages[0]?.[1]?.content).toBe('[2026-04-25 18:47] legacy prompt')
    expect(legacyUserMessage.createdAt).toBe(new Date(2026, 3, 25, 18, 47).getTime())
  })

  it('appends system prompt supplement to the provider system message', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.systemPromptSupplement.set('Plugin toolset guidance.')
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(composedMessages[0]).toMatchObject({
      role: 'system',
      content: 'system prompt\n\nPlugin toolset guidance.',
    })
  })

  it('creates a system message when only a system prompt supplement is available', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.sessionMessages['session-1'] = []
    harness.systemPromptSupplement.set('Plugin toolset guidance.')
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'hello' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('hello from user', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(composedMessages[0]).toMatchObject({
      role: 'system',
      content: 'Plugin toolset guidance.',
    })
    expect(composedMessages[1]).toMatchObject({ role: 'user' })
  })

  it('emits telemetry milestones for a successful voice-backed message round', async () => {
    const harness = createHarness()
    harness.monotonicNow.set([100, 150, 250, 400, 460])
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'assistant reply' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
      await options?.onUsage?.({
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        source: 'reported',
      })
    })

    await harness.runtime.ingest('hello from voice', {
      model: 'gpt-test',
      chatProvider: provider,
      input: {
        type: 'input:text:voice',
        data: {
          transcription: 'hello from voice',
        },
      },
    })

    expect(harness.telemetry.messageSendStarted).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      source: 'voice',
      model: 'gpt-test',
      turnIndex: 1,
    }])
    expect(harness.telemetry.llmRequestStarted).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      provider: 'mock-provider',
      hasVoice: true,
      turnIndex: 1,
    }])
    expect(harness.telemetry.llmFirstToken).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      ttfbMs: 100,
      turnIndex: 1,
    }])
    expect(harness.telemetry.assistantResponseRendered).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      latencyMs: 250,
      turnIndex: 1,
    }])
    expect(harness.telemetry.llmGeneration).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      model: 'gpt-test',
      provider: 'mock-provider',
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      usageSource: 'reported',
      turnIndex: 1,
    }])
    expect(harness.telemetry.messageRound).toEqual([{
      conversationId: 'session-1',
      roundId: 'user-id',
      durationMs: 360,
      hasVoice: true,
      inputTokens: 12,
      model: 'gpt-test',
      outputTokens: 8,
      totalTokens: 20,
      turnIndex: 1,
      usageSource: 'reported',
    }])
    expect(harness.telemetry.chatActivationStarted).toEqual([{
      conversationId: 'session-1',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'voice',
      turnIndex: 1,
    }])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([{
      conversationId: 'session-1',
      durationMs: 360,
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'voice',
      turnIndex: 1,
    }])
    expect(harness.telemetry.chatActivationFailed).toEqual([])
  })

  // Review: https://github.com/moeru-ai/airi/pull/2325
  it('pr #2325 treats input:text metadata as text telemetry', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('hello from text input', {
      model: 'gpt-test',
      chatProvider: provider,
      input: {
        type: 'input:text',
        data: {
          text: 'hello from text input',
        },
      },
    })

    expect(harness.telemetry.messageSendStarted).toEqual([
      expect.objectContaining({ source: 'text' }),
    ])
    expect(harness.telemetry.llmRequestStarted).toEqual([
      expect.objectContaining({ hasVoice: false }),
    ])
    expect(harness.telemetry.messageRound).toEqual([
      expect.objectContaining({ hasVoice: false }),
    ])
    expect(harness.userAppended).toEqual([
      expect.objectContaining({ source: 'text' }),
    ])
  })

  // ROOT CAUSE:
  //
  // Activation callbacks were emitted for every chat round, so production
  // `chat_activation_*` volume tracked message traffic instead of the first
  // successful assistant response in a conversation.
  it('emits activation milestones only until the conversation gets its first assistant response', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('first turn', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    await harness.runtime.ingest('second turn', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    expect(harness.telemetry.chatActivationStarted).toHaveLength(1)
    expect(harness.telemetry.chatActivationSucceeded).toHaveLength(1)
    expect(harness.telemetry.chatActivationFailed).toHaveLength(0)
    expect(harness.telemetry.messageSendStarted).toHaveLength(2)
    expect(harness.telemetry.messageRound).toHaveLength(2)
  })

  it('emits chat activation failure telemetry without raw provider messages', async () => {
    const harness = createHarness()
    harness.stream.mockRejectedValueOnce(new Error('provider rejected with sensitive details'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('provider rejected')

    expect(harness.telemetry.chatActivationStarted).toEqual([{
      conversationId: 'session-1',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'text',
      turnIndex: 1,
    }])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([])
    expect(harness.telemetry.chatActivationFailed).toEqual([{
      conversationId: 'session-1',
      errorCode: 'llm_response_failed',
      failureStage: 'llm_response',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'text',
      turnIndex: 1,
    }])
    expect(harness.telemetry.messageRoundFailed).toEqual([{
      conversationId: 'session-1',
      errorCode: 'llm_response_failed',
      failureStage: 'llm_response',
      model: 'gpt-test',
      provider: 'mock-provider',
      roundId: 'user-id',
      source: 'text',
      turnIndex: 1,
    }])
  })

  it('emits a round failure for later turns without repeating activation failure', async () => {
    const harness = createHarness()

    await harness.runtime.ingest('first turn succeeds', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    harness.stream.mockRejectedValueOnce(new Error('later turn rejected'))

    await expect(harness.runtime.ingest('second turn fails', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('later turn rejected')

    expect(harness.telemetry.chatActivationFailed).toEqual([])
    expect(harness.telemetry.messageRoundFailed).toEqual([
      expect.objectContaining({
        conversationId: 'session-1',
        errorCode: 'llm_response_failed',
        failureStage: 'llm_response',
        roundId: expect.any(String),
        turnIndex: 2,
      }),
    ])
  })

  it('rejects cancelled queued sends before they start', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest('cancel me', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.runtime.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  // https://github.com/moeru-ai/airi/pull/2086#discussion_r3714754876
  it('suppresses completion hooks when an active send session is deleted for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // Generation checks protected message mutation during a stream, but the
    // runtime still emitted completion hooks and success analytics after the
    // provider returned for a deleted session.
    const harness = createHarness()
    const completionHook = vi.fn()
    harness.runtime.hooks.onStreamEnd(completionHook)
    harness.runtime.hooks.onAssistantResponseEnd(completionHook)
    harness.runtime.hooks.onAfterSend(completionHook)
    harness.runtime.hooks.onAssistantMessage(completionHook)
    harness.runtime.hooks.onChatTurnComplete(completionHook)

    let finishStream: (() => void) | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await new Promise<void>((resolve) => {
        finishStream = resolve
      })
      options?.onUsage?.({
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        source: 'reported',
      })
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'deleted reply' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    const pendingSend = harness.runtime.ingest('delete this chat', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    harness.generation.set(2)
    finishStream?.()
    await pendingSend

    expect(completionHook).not.toHaveBeenCalled()
    expect(harness.assistantAppended).toEqual([])
    expect(harness.assistantTurns).toEqual([])
    expect(harness.telemetry.assistantResponseRendered).toEqual([])
    expect(harness.telemetry.llmGeneration).toEqual([])
    expect(harness.telemetry.messageRound).toEqual([])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([])
  })

  it('rejects stale generation sends before they start', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest('stale request', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.generation.set(2)
    releaseFirstSend?.()

    await firstSend
    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    expect(harness.stream).toHaveBeenCalledTimes(1)
  })

  it('keeps sending externally writable for UI facades', () => {
    const harness = createHarness()

    harness.runtime.setSending(true)
    expect(harness.runtime.getSending()).toBe(true)
    expect(harness.stateChanges.at(-1)).toEqual({
      activeSendSessionId: 'session-1',
      activeStreamingMessage: undefined,
      sending: true,
      pendingQueuedSendCount: 0,
    })

    harness.runtime.setSending(false)
    expect(harness.runtime.getSending()).toBe(false)
    expect(harness.stateChanges.at(-1)).toEqual({
      activeSendSessionId: undefined,
      activeStreamingMessage: undefined,
      sending: false,
      pendingQueuedSendCount: 0,
    })
  })

  // https://github.com/moeru-ai/airi/issues/2085
  it('reports the queued send target while a background session is sending for Issue #2085', async () => {
    // ROOT CAUSE:
    //
    // Runtime state exposed only a global sending boolean. A window-level sync
    // layer therefore had to infer the owner from the authority's visible
    // session, which is wrong when a follower targets a background session.
    const harness = createHarness()
    let finishSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'background reply' })
      await new Promise<void>((resolve) => {
        finishSend = resolve
      })
    })

    const pendingSend = harness.runtime.ingest('background request', {
      model: 'gpt-test',
      chatProvider: provider,
    }, 'session-2')

    await vi.waitFor(() => {
      expect(harness.stateChanges).toContainEqual(expect.objectContaining({
        activeSendSessionId: 'session-2',
        activeStreamingMessage: expect.objectContaining({
          role: 'assistant',
          createdAt: expect.any(Number),
        }),
        sending: true,
        pendingQueuedSendCount: 0,
      }))
    })
    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.stateChanges).toContainEqual(expect.objectContaining({
        activeSendSessionId: 'session-2',
        activeStreamingMessage: expect.objectContaining({ content: expect.stringContaining('background') }),
      }))
    })

    finishSend?.()
    await pendingSend

    expect(harness.stateChanges.at(-1)).toEqual({
      activeSendSessionId: undefined,
      activeStreamingMessage: undefined,
      sending: false,
      pendingQueuedSendCount: 0,
    })
  })

  it('returns pending queued send snapshots with public fields', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const queuedMessage = 'queued-message-'.repeat(12)
    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const secondSend = harness.runtime.ingest(queuedMessage, {
      model: 'gpt-test',
      chatProvider: provider,
      attachments: [
        {
          type: 'image',
          data: 'aW1hZ2U=',
          mimeType: 'image/png',
        },
      ],
      input: {
        type: 'input:text',
        data: {
          text: 'queued input',
        },
      },
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })

    expect(harness.runtime.getPendingQueuedSendSnapshot()).toEqual([
      {
        sessionId: 'session-1',
        generation: 1,
        cancelled: false,
        messagePreview: queuedMessage.slice(0, 120),
        hasAttachments: true,
        inputType: 'input:text',
      },
    ])

    harness.runtime.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(secondSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend
  })

  it('handles attachments, reasoning deltas, tool events, and assistant finalization', async () => {
    const harness = createHarness()
    let composedMessages: Message[] = []
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, messages, options) => {
      composedMessages = messages
      await options?.onStreamEvent?.({ type: 'reasoning-delta', text: 'thinking' })
      await options?.onStreamEvent?.({
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'weather',
        args: {},
      } as StreamEvent)
      await options?.onStreamEvent?.({
        type: 'tool-result',
        toolCallId: 'tool-1',
        result: 'sunny',
      } as StreamEvent)
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'visible reply' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    await harness.runtime.ingest('see image', {
      model: 'gpt-test',
      chatProvider: provider,
      attachments: [
        {
          type: 'image',
          data: 'aW1hZ2U=',
          mimeType: 'image/png',
        },
      ],
    })

    expect(composedMessages[1]?.content).toEqual([
      {
        type: 'text',
        text: '[2026-04-25 18:47] see image',
      },
      {
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,aW1hZ2U=',
        },
      },
    ])
    const assistant = harness.sessionMessages['session-1']?.at(-1)
    expect(assistant).toMatchObject({
      role: 'assistant',
      content: 'visible reply',
      categorization: {
        reasoning: 'thinking',
      },
    })
    expect((assistant as StreamingAssistantMessage).slices).toEqual([
      expect.objectContaining({
        type: 'tool-call',
        toolCall: expect.objectContaining({
          toolCallId: 'tool-1',
        }),
      }),
      {
        type: 'text',
        text: 'visible reply',
      },
    ])
    expect((assistant as StreamingAssistantMessage).tool_results).toEqual([
      {
        type: 'tool-call-result',
        id: 'tool-1',
        result: 'sunny',
      },
    ])
    expect(harness.assistantAppended).toHaveLength(1)
    expect(harness.foregroundResets).toHaveLength(1)
  })
})

// Phase 8.0D-10B-1: the provider identity the caller resolved for THIS attempt
// travels with the send options and feeds every per-round observational
// milestone, instead of being reconstructed through a live store read.
describe('carried provider identity', () => {
  const usage = { inputTokens: 3, outputTokens: 2, totalTokens: 5, source: 'reported' as const }

  function streamWithUsage(harness: ReturnType<typeof createHarness>) {
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'assistant reply' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
      await options?.onUsage?.(usage)
    })
  }

  it('reports the supplied providerId in per-round metadata and never the divergent store value', async () => {
    const harness = createHarness({ getActiveProvider: () => 'store-provider' })
    streamWithUsage(harness)

    await harness.runtime.ingest('hello', {
      model: 'gpt-carried',
      chatProvider: provider,
      providerId: 'carried-provider',
    })

    // A + B: request start carries exactly the supplied id (the live store had
    // a different value, so this cannot come from the store read).
    expect(harness.telemetry.llmRequestStarted).toEqual([
      expect.objectContaining({ model: 'gpt-carried', provider: 'carried-provider' }),
    ])
    // H: one round cannot report two provider identities.
    expect(harness.telemetry.chatActivationStarted).toEqual([
      expect.objectContaining({ provider: 'carried-provider' }),
    ])
    expect(harness.telemetry.chatActivationSucceeded).toEqual([
      expect.objectContaining({ provider: 'carried-provider' }),
    ])
    expect(harness.telemetry.llmGeneration).toEqual([
      expect.objectContaining({ model: 'gpt-carried', provider: 'carried-provider' }),
    ])
    expect(harness.userAppended).toEqual([
      expect.objectContaining({ provider: 'carried-provider' }),
    ])
  })

  it('leaves the executed provider object and model untouched', async () => {
    const harness = createHarness({ getActiveProvider: () => 'store-provider' })
    streamWithUsage(harness)

    await harness.runtime.ingest('hello', {
      model: 'gpt-carried',
      chatProvider: provider,
      providerId: 'carried-provider',
    })

    // D + E + F + G: same exact model string and the very same provider object
    // identity the caller supplied - the metadata field decides nothing.
    expect(harness.stream).toHaveBeenCalledTimes(1)
    expect(harness.stream.mock.calls[0]?.[0]).toBe('gpt-carried')
    expect(harness.stream.mock.calls[0]?.[1]).toBe(provider)
  })

  it('keeps the live-store fallback when no identity is carried', async () => {
    const harness = createHarness({ getActiveProvider: () => 'store-provider' })
    streamWithUsage(harness)

    await harness.runtime.ingest('hello', {
      model: 'gpt-store',
      chatProvider: provider,
    })

    // C: absent field still resolves through deps.getActiveProvider().
    expect(harness.telemetry.llmRequestStarted).toEqual([
      expect.objectContaining({ model: 'gpt-store', provider: 'store-provider' }),
    ])
    expect(harness.telemetry.llmGeneration).toEqual([
      expect.objectContaining({ provider: 'store-provider' }),
    ])
    expect(harness.stream.mock.calls[0]?.[0]).toBe('gpt-store')
    expect(harness.stream.mock.calls[0]?.[1]).toBe(provider)
  })

  it('reports the carried identity on a failed round too', async () => {
    const harness = createHarness({ getActiveProvider: () => 'store-provider' })
    harness.stream.mockRejectedValueOnce(new Error('provider rejected'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-carried',
      chatProvider: provider,
      providerId: 'carried-provider',
    })).rejects.toThrow('provider rejected')

    expect(harness.telemetry.messageRoundFailed).toEqual([
      expect.objectContaining({ model: 'gpt-carried', provider: 'carried-provider' }),
    ])
    expect(harness.telemetry.chatActivationFailed).toEqual([
      expect.objectContaining({ provider: 'carried-provider' }),
    ])
  })

  it('adds no provider resolution of its own', async () => {
    const carried = createHarness({ getActiveProvider: () => 'store-provider' })
    streamWithUsage(carried)
    await carried.runtime.ingest('hello', {
      model: 'gpt-x',
      chatProvider: provider,
      providerId: 'carried-provider',
    })

    const stored = createHarness({ getActiveProvider: () => 'store-provider' })
    streamWithUsage(stored)
    await stored.runtime.ingest('hello', {
      model: 'gpt-x',
      chatProvider: provider,
    })

    // I: the carried field is not a second resolution path. It removes exactly
    // one live-store read - the request-start milestone's - while the remaining
    // reads (response categorisation) are untouched.
    expect(stored.activeProviderSpy.mock.calls.length - carried.activeProviderSpy.mock.calls.length).toBe(1)
  })
})

// Phase 8.0D-10B-3B1: the caller's opaque logical-send key is carried, verbatim,
// into the request-start metadata and decides nothing.
describe('logical send correlation', () => {
  function streamOnce(harness: ReturnType<typeof createHarness>) {
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'assistant reply' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })
  }

  it('p: a supplied correlationId appears unchanged in the request-start event', async () => {
    const harness = createHarness()
    streamOnce(harness)

    await harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
      correlationId: 'logical-send-1',
    })

    expect(harness.telemetry.llmRequestStarted).toEqual([
      expect.objectContaining({ correlationId: 'logical-send-1' }),
    ])
    expect(harness.telemetry.llmRequestStarted[0]).toHaveProperty('correlationId', 'logical-send-1')
  })

  it('q: an absent correlationId stays absent and is never synthesized', async () => {
    const harness = createHarness()
    streamOnce(harness)

    await harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    const [event] = harness.telemetry.llmRequestStarted as [Record<string, unknown>]
    expect(event.correlationId).toBeUndefined()
    expect(Object.keys(event)).not.toContain('correlationId')
    // The per-attempt identity is untouched by the new field.
    expect(event).toMatchObject({ conversationId: 'session-1', model: 'gpt-test', provider: 'mock-provider' })
    expect(typeof event.roundId).toBe('string')
  })

  it('r/s: correlationId alters neither the model nor the provider object', async () => {
    const withId = createHarness()
    streamOnce(withId)
    await withId.runtime.ingest('hello', {
      model: 'gpt-correlated',
      chatProvider: provider,
      correlationId: 'logical-send-2',
    })

    const withoutId = createHarness()
    streamOnce(withoutId)
    await withoutId.runtime.ingest('hello', {
      model: 'gpt-correlated',
      chatProvider: provider,
    })

    for (const harness of [withId, withoutId]) {
      expect(harness.stream).toHaveBeenCalledTimes(1)
      expect(harness.stream.mock.calls[0]?.[0]).toBe('gpt-correlated')
      expect(harness.stream.mock.calls[0]?.[1]).toBe(provider)
    }
  })

  it('t: correlationId does not alter queue ordering or per-send round semantics', async () => {
    const harness = createHarness()
    const started: string[] = []
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementation(async (model, _chatProvider, _messages, options) => {
      started.push(model)
      if (started.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSend = resolve
        })
      }
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'reply' })
      await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
    })

    const firstSend = harness.runtime.ingest('first', {
      model: 'model-a',
      chatProvider: provider,
      correlationId: 'send-a',
    })
    const secondSend = harness.runtime.ingest('second', {
      model: 'model-b',
      chatProvider: provider,
      correlationId: 'send-b',
    })

    await vi.waitFor(() => expect(harness.stream).toHaveBeenCalledTimes(1))
    expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)

    releaseFirstSend?.()
    await Promise.all([firstSend, secondSend])

    // FIFO order is preserved and each send keeps its own key and round.
    expect(started).toEqual(['model-a', 'model-b'])
    const events = harness.telemetry.llmRequestStarted as Array<Record<string, unknown>>
    expect(events.map(event => event.correlationId)).toEqual(['send-a', 'send-b'])
    expect(events[0]?.roundId).not.toBe(events[1]?.roundId)
  })
})

describe('chat round settled seam (Phase 8.0D-10B-4D4B1)', () => {
  const SOURCE = normalizeLineEndings(readFileSync(new URL('./chat-orchestrator-runtime.ts', import.meta.url), 'utf-8'))
  /** Source without comments: guards must only find vocabulary in real code. */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const COMPACT = CODE.replace(/\s+/g, ' ')
  /** The exact three-value vocabulary this seam is allowed to report. */
  const OUTCOME_VALUES: readonly ChatRoundOutcome[] = ['succeeded', 'failed', 'abandoned']
  const ROUND_ID = 'user-id'

  function observations(harness: ReturnType<typeof createHarness>): ChatRoundSettledObservation[] {
    return harness.settled.calls as ChatRoundSettledObservation[]
  }

  /** Drives one ordinary successful round and returns its harness. */
  async function successfulRound(correlationId?: string) {
    const harness = createHarness()
    await harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
      ...(correlationId === undefined ? {} : { correlationId }),
    })
    return harness
  }

  it('a/b/c/d/e/f: the observation is exactly the three factual keys, with the frozen union', async () => {
    const harness = await successfulRound('logical-send-1')

    expect(observations(harness)).toEqual([
      { correlationId: 'logical-send-1', outcome: 'succeeded', roundId: ROUND_ID },
    ])
    // Object.keys proves there is no conversationId, turnIndex, providerId,
    // modelId, sessionId, timestamp, duration, error or usage field.
    expect(Object.keys(observations(harness)[0]!).sort()).toEqual(['correlationId', 'outcome', 'roundId'])
    expect(OUTCOME_VALUES).toEqual(['succeeded', 'failed', 'abandoned'])

    // The declared type is exactly that union, and its shape reuses nothing.
    expect(CODE).toContain(`export type ChatRoundOutcome = 'succeeded' | 'failed' | 'abandoned'`)
    const shape = (CODE.match(/export interface ChatRoundSettledObservation \{([\s\S]*?)\}/) ?? [])[1] ?? ''
    expect(shape.replace(/\s+/g, ' ').trim()).toBe('correlationId?: string roundId: string outcome: ChatRoundOutcome')
    expect(shape).not.toMatch(/conversationId|turnIndex|providerId|modelId|sessionId|timestamp|duration|error|usage/)
    expect(CODE).not.toMatch(/ChatRoundSettledObservation\s*=\s*ChatRoundCorrelation|interface ChatRoundSettledObservation extends ChatRoundCorrelation/)
  })

  it('34: one ordinary successful round settles exactly once, as succeeded', async () => {
    const harness = await successfulRound()

    expect(observations(harness)).toEqual([{ outcome: 'succeeded', roundId: ROUND_ID }])
    // The normal return is unchanged and the existing milestones still fire.
    expect(harness.telemetry.messageRound).toHaveLength(1)
    expect(harness.telemetry.messageRoundFailed).toEqual([])
    expect(harness.assistantAppended).toHaveLength(1)
  })

  it('35: a throw after onMessageRound, inside the activation milestone, settles as failed', async () => {
    const harness = createHarness()
    harness.knobs.chatActivationSucceededThrows(new Error('activation milestone exploded'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('activation milestone exploded')

    // The round DID reach the success boundary - which is exactly why the
    // success assignment cannot live there.
    expect(harness.telemetry.messageRound).toHaveLength(1)
    expect(observations(harness)).toEqual([{ outcome: 'failed', roundId: ROUND_ID }])
  })

  it('36: a non-stale stream failure settles once as failed and keeps the original error', async () => {
    const harness = createHarness()
    harness.stream.mockRejectedValueOnce(new Error('provider exploded'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('provider exploded')

    expect(observations(harness)).toEqual([{ outcome: 'failed', roundId: ROUND_ID }])
    expect(harness.telemetry.messageRoundFailed).toHaveLength(1)
    expect(harness.telemetry.messageRound).toHaveLength(0)
  })

  it('37: an error that reaches the catch while the generation went stale stays abandoned', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async () => {
      harness.generation.set(2)
      throw new Error('provider exploded')
    })

    // Current semantics: generation invalidation discards the error entirely.
    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).resolves.toBeUndefined()

    expect(observations(harness)).toEqual([{ outcome: 'abandoned', roundId: ROUND_ID }])
    expect(harness.telemetry.messageRoundFailed).toEqual([])
    expect(harness.telemetry.chatActivationFailed).toEqual([])
  })

  describe('38: every real terminal stale return settles exactly once as abandoned', () => {
    /**
     * One entry per production terminal guard. `run` arms the exact moment the
     * guard under test observes, and returns a check proving the round really
     * stopped THERE (the milestone that would have followed it never happened).
     */
    const STALE_TRIGGERS: Array<{ name: string, run: (harness: ReturnType<typeof createHarness>) => () => void }> = [
      {
        name: 'before the user message is persisted',
        run: (harness) => {
          harness.runtime.hooks.onBeforeMessageComposed(async () => {
            harness.generation.set(2)
          })
          return () => expect(harness.userAppended).toEqual([])
        },
      },
      {
        name: 'after the awaited pre-send hooks',
        run: (harness) => {
          harness.runtime.hooks.onBeforeSend(async () => {
            harness.generation.set(2)
          })
          return () => expect(harness.telemetry.llmRequestStarted).toEqual([])
        },
      },
      {
        name: 'after the provider stream returned',
        run: (harness) => {
          harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
            await options?.onStreamEvent?.({ type: 'text-delta', text: 'stale reply' })
            await options?.onStreamEvent?.({ type: 'finish', finishReason: 'stop' })
            harness.generation.set(2)
          })
          // Nothing after the provider stream ran: no parser finalization, no
          // assistant persistence, no completion hooks.
          return () => expect(harness.assistantAppended).toEqual([])
        },
      },
      {
        name: 'after the parser finalized',
        run: (harness) => {
          harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
            await options?.onStreamEvent?.({ type: 'text-delta', text: 'stale reply' })
            // Queued while the runtime is past the post-stream guard but still
            // awaiting parser finalization, so it lands on the guard AFTER it.
            void Promise.resolve().then(() => Promise.resolve().then(() => {
              harness.generation.set(2)
            }))
          })
          // The neighbouring post-stream guard sees a fresh generation, so this
          // round stops at the guard that follows parser finalization. The two
          // adjacent guards are externally indistinguishable by design (both
          // settle one `abandoned`), so the source pin below covers the pairing.
          return () => expect(harness.assistantAppended).toEqual([])
        },
      },
      {
        name: 'after the assistant message was persisted',
        run: (harness) => {
          harness.knobs.beforeAssistantAppended(() => {
            harness.generation.set(2)
          })
          return () => {
            expect(harness.assistantAppended).toHaveLength(1)
            expect(harness.assistantTurns).toEqual([])
          }
        },
      },
      {
        name: 'after the stream-end hooks',
        run: (harness) => {
          const nextHook = vi.fn()
          harness.runtime.hooks.onStreamEnd(async () => {
            harness.generation.set(2)
          })
          harness.runtime.hooks.onAssistantResponseEnd(nextHook)
          return () => expect(nextHook).not.toHaveBeenCalled()
        },
      },
      {
        name: 'after the assistant-response-end hooks',
        run: (harness) => {
          const nextHook = vi.fn()
          harness.runtime.hooks.onAssistantResponseEnd(async () => {
            harness.generation.set(2)
          })
          harness.runtime.hooks.onAfterSend(nextHook)
          return () => expect(nextHook).not.toHaveBeenCalled()
        },
      },
      {
        name: 'after the after-send hooks',
        run: (harness) => {
          const nextHook = vi.fn()
          harness.runtime.hooks.onAfterSend(async () => {
            harness.generation.set(2)
          })
          harness.runtime.hooks.onAssistantMessage(nextHook)
          return () => expect(nextHook).not.toHaveBeenCalled()
        },
      },
      {
        name: 'after the assistant-message hooks',
        run: (harness) => {
          const nextHook = vi.fn()
          harness.runtime.hooks.onAssistantMessage(async () => {
            harness.generation.set(2)
          })
          harness.runtime.hooks.onChatTurnComplete(nextHook)
          return () => expect(nextHook).not.toHaveBeenCalled()
        },
      },
      {
        name: 'after the chat-turn-complete hooks',
        run: (harness) => {
          harness.runtime.hooks.onChatTurnComplete(async () => {
            harness.generation.set(2)
          })
          return () => expect(harness.assistantTurns).toEqual([])
        },
      },
    ]

    for (const { name, run } of STALE_TRIGGERS) {
      it(`settles abandoned ${name}`, async () => {
        const harness = createHarness()
        const assertStoppedHere = run(harness)

        await expect(harness.runtime.ingest('hello', {
          model: 'gpt-test',
          chatProvider: provider,
        })).resolves.toBeUndefined()

        // The outcome is the same for every guard, and the check proves this
        // round stopped at the guard under test.
        expect(observations(harness)).toEqual([{ outcome: 'abandoned', roundId: ROUND_ID }])
        assertStoppedHere()
        expect(harness.telemetry.messageRoundFailed).toEqual([])
        expect(harness.telemetry.chatActivationFailed).toEqual([])
      })
    }

    it('44: a stale return before the request start still settles once, with no start observation', async () => {
      const harness = createHarness()
      harness.runtime.hooks.onBeforeSend(async () => {
        harness.generation.set(2)
      })

      await harness.runtime.ingest('hello', {
        model: 'gpt-test',
        chatProvider: provider,
      })

      expect(harness.telemetry.llmRequestStarted).toEqual([])
      expect(observations(harness)).toEqual([{ outcome: 'abandoned', roundId: ROUND_ID }])
    })
  })

  it('39: the pre-try stale return settles nothing (limitation pinned)', async () => {
    const harness = createHarness()
    harness.knobs.beforeSnapshot(() => {
      harness.generation.set(2)
    })

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).resolves.toBeUndefined()

    // It returns before the try boundary, so no terminal observation exists for
    // it in this phase - not even a start observation.
    expect(observations(harness)).toEqual([])
    expect(harness.telemetry.llmRequestStarted).toEqual([])
    expect(harness.sendSettledSessions).toEqual([])
  })

  it('40: a throw before the try settles nothing and keeps the original error', async () => {
    const harness = createHarness()
    harness.knobs.ensureSessionThrows(new Error('session port exploded'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('session port exploded')

    expect(observations(harness)).toEqual([])
    expect(harness.sendSettledSessions).toEqual([])
  })

  it('41: a queued cancellation settles nothing of its own', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const cancelledSend = harness.runtime.ingest('cancel me', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.runtime.cancelPendingSends('session-1')
    releaseFirstSend?.()

    await expect(cancelledSend).rejects.toThrow('Chat session was reset before send could start')
    await firstSend

    // Only the send that actually entered the body is observed.
    expect(observations(harness)).toEqual([{ outcome: 'succeeded', roundId: ROUND_ID }])
  })

  it('42: a generation-invalidated pre-start rejection settles nothing of its own', async () => {
    const harness = createHarness()
    let releaseFirstSend: (() => void) | undefined
    harness.stream.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstSend = resolve
      })
    })

    const firstSend = harness.runtime.ingest('hold queue', {
      model: 'gpt-test',
      chatProvider: provider,
    })
    const invalidatedSend = harness.runtime.ingest('generation invalidated request', {
      model: 'gpt-test',
      chatProvider: provider,
    })

    await vi.waitFor(() => {
      expect(harness.stream).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(harness.runtime.getPendingQueuedSendCount()).toBe(1)
    })
    harness.generation.set(2)
    releaseFirstSend?.()

    await firstSend
    await expect(invalidatedSend).rejects.toThrow('Chat session was reset before send could start')

    // The stale first send is the only observed round; the rejected queued item
    // never entered the body, so it owns a second observation that never exists.
    expect(observations(harness)).toEqual([{ outcome: 'abandoned', roundId: ROUND_ID }])
  })

  it('43: an in-try failure before the request start settles as failed, with no start observation', async () => {
    const harness = createHarness()
    harness.runtime.hooks.onAfterMessageComposed(async () => {
      throw new Error('composition hook exploded')
    })

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('composition hook exploded')

    expect(harness.telemetry.llmRequestStarted).toEqual([])
    expect(observations(harness)).toEqual([{ outcome: 'failed', roundId: ROUND_ID }])
  })

  it('49: an absent logical-send key is forwarded as absent, never synthesized', async () => {
    const harness = await successfulRound()

    expect(Object.keys(observations(harness)[0]!).sort()).toEqual(['outcome', 'roundId'])
    expect('correlationId' in observations(harness)[0]!).toBe(false)
  })

  it('45: a throwing settled listener cannot change a successful send', async () => {
    const harness = createHarness()
    harness.settled.throwOn(new Error('settled listener exploded'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).resolves.toBeUndefined()

    expect(observations(harness)).toEqual([{ outcome: 'succeeded', roundId: ROUND_ID }])
  })

  it('46: a throwing settled listener never replaces the original stream error', async () => {
    const harness = createHarness()
    harness.stream.mockRejectedValueOnce(new Error('provider exploded'))
    harness.settled.throwOn(new Error('settled listener exploded'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('provider exploded')

    expect(observations(harness)).toEqual([{ outcome: 'failed', roundId: ROUND_ID }])
  })

  it('47: an onSendSettled failure still escapes and settles the round as failed', async () => {
    const harness = createHarness()
    harness.knobs.onSendSettledThrows(new Error('send settled exploded'))

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('send settled exploded')

    expect(harness.sendSettledSessions).toEqual(['session-1'])
    expect(observations(harness)).toEqual([{ outcome: 'failed', roundId: ROUND_ID }])
  })

  it('48: a failing state-change path still escapes and settles the round as failed', async () => {
    const harness = createHarness()
    harness.stream.mockImplementationOnce(async (_model, _chatProvider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: 'reply' })
      // Make the clear in the finalization the change that fails.
      harness.runtime.setSending(true)
      harness.knobs.stateChangeThrows(new Error('state exploded'))
    })

    await expect(harness.runtime.ingest('hello', {
      model: 'gpt-test',
      chatProvider: provider,
    })).rejects.toThrow('state exploded')

    expect(observations(harness)).toEqual([{ outcome: 'failed', roundId: ROUND_ID }])
  })

  it('50/51/52: one invocation site, no foreign capability, request start untouched', () => {
    // Exactly ONE production invocation site, and exactly one assignment per
    // modelled terminal path.
    expect(CODE.match(/deps\.onChatRoundSettled\?\.\(/g)).toHaveLength(1)
    expect(CODE.match(/terminalOutcome = '/g)).toHaveLength(5)
    expect(CODE.match(/abandonIfStale\(\)/g)).toHaveLength(10)
    // The callback-local guards (and the pre-try one) were NOT converted.
    expect(CODE.match(/if \(shouldAbort\(\)\)/g)).toHaveLength(7)
    // The two adjacent guards around parser finalization are both classified,
    // and the pre-try one stayed exactly as it was.
    expect(COMPACT).toContain('if (abandonIfStale()) return await parser.end() if (abandonIfStale()) return')
    expect(COMPACT).toContain('const abandonIfStale = () => { if (!shouldAbort()) return false terminalOutcome = \'abandoned\' return true }')
    expect(COMPACT).toContain('if (shouldAbort()) return const buildingMessage: StreamingAssistantMessage = {')

    // No foreign capability was imported or added by this seam.
    expect(CODE).not.toMatch(/\bBrain\b|LiaBrain|lia-brain|eventa|electron|BrowserWindow/i)
    expect(CODE).not.toMatch(/new Map|new Set|\bcache\b|history|localStorage/)
    expect(CODE.match(/fallback/gi)).toHaveLength(3)
    expect(CODE).not.toMatch(/retry/i)
    expect(CODE).not.toMatch(/setActiveProvider|switchProvider|activateProvider/)
    expect(CODE).not.toMatch(/console\.(?:info|warn|debug|log)/)
    // The settled observation never inspects an error, a provider or a model.
    const settledRegion = (CODE.match(/const settledOutcome = terminalOutcome[\s\S]*?\n {12}\}/) ?? [''])[0]
    expect(settledRegion).not.toMatch(/error|provider|model|fact|decision|match|winner|final/i)

    // The request-start contract is byte-for-byte the same call, still adjacent
    // to the provider stream call.
    expect(COMPACT).toContain(`deps.onLlmRequestStarted?.({ ...correlation, model: options.model, provider: activeProvider || 'unknown', hasVoice, ...(options.correlationId === undefined ? {} : { correlationId: options.correlationId }), }) await deps.llm.stream(options.model, options.chatProvider,`)
    // The existing generic finalization callback keeps its own contract.
    expect(CODE).toContain('onSendSettled?: (event: { sessionId: string }) => void')
    expect(CODE.match(/deps\.onSendSettled\?\.\(\{ sessionId \}\)/g)).toHaveLength(1)
  })
})
