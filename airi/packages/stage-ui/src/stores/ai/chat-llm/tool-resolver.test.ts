import type { Tool } from '@xsai/shared-chat'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { executeToolCallRerun } from '../../tool-call-rerun'
import { isResolvedToolAllowed, resolveLlmTools, toolNameFrom } from './tool-resolver'
import { useLlmToolsStore } from './tools'

beforeEach(() => setActivePinia(createPinia()))

// The default (non-injected) web-search branch reads the module store and the
// tools barrel; mock both so the configured-gate + key-trim logic can be
// exercised without real Pinia state or a live Tavily factory.
const { createWebSearchToolsMock, useWebSearchStoreMock } = vi.hoisted(() => ({
  createWebSearchToolsMock: vi.fn(),
  useWebSearchStoreMock: vi.fn(),
}))

vi.mock('../../../tools', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, createWebSearchTools: createWebSearchToolsMock }
})

vi.mock('../../modules/web-search', () => ({
  useWebSearchStore: useWebSearchStoreMock,
}))

function createTool(name: string, description = `${name} description`): Tool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    execute: vi.fn(),
  } as Tool
}

describe('toolNameFrom', () => {
  it('reads function.name', () => {
    expect(toolNameFrom(createTool('runtime_read_context'))).toBe('runtime_read_context')
  })
})

describe('resolveLlmTools', () => {
  it('prefers a later runtime tool with the same name over an earlier built-in tool', async () => {
    const builtInTool = createTool('duplicate_tool', 'Built-in version.')
    const runtimeTool = createTool('duplicate_tool', 'Runtime version.')

    const tools = await resolveLlmTools({
      builtInTools: [builtInTool],
      debugTools: [],
      sparkCommandTools: [],
      webSearchTools: [],
      activeTools: [runtimeTool],
    })

    expect(tools).toHaveLength(1)
    expect(tools[0]?.function).toEqual(runtimeTool.function)
  })

  it('places custom tools before active runtime tools so runtime tools can win by name', async () => {
    const builtInTool = createTool('built_in_tool')
    const customTool = createTool('duplicate_tool', 'Custom version.')
    const runtimeTool = createTool('duplicate_tool', 'Runtime version.')

    const tools = await resolveLlmTools({
      builtInTools: [builtInTool],
      debugTools: [],
      sparkCommandTools: [],
      webSearchTools: [],
      customTools: [customTool],
      activeTools: [runtimeTool],
    })

    expect(tools.map(tool => tool.function)).toEqual([builtInTool.function, runtimeTool.function])
  })

  it('includes injected web-search tools in the resolved list', async () => {
    const builtInTool = createTool('built_in_tool')
    const webSearchTool = createTool('web_search')

    const tools = await resolveLlmTools({
      builtInTools: [builtInTool],
      debugTools: [],
      sparkCommandTools: [],
      webSearchTools: [webSearchTool],
      activeTools: [],
    })

    expect(tools.map(tool => tool.function)).toEqual([builtInTool.function, webSearchTool.function])
  })

  describe('default web-search branch (module store gate)', () => {
    beforeEach(() => {
      createWebSearchToolsMock.mockReset()
      useWebSearchStoreMock.mockReset()
    })

    it('omits web_search when the web-search module is not configured', async () => {
      useWebSearchStoreMock.mockReturnValue({ configured: false, apiKey: '' })
      const builtInTool = createTool('built_in_tool')

      // webSearchTools is intentionally omitted so resolveWebSearchTools falls
      // through to the module store instead of the injected source.
      const tools = await resolveLlmTools({
        builtInTools: [builtInTool],
        debugTools: [],
        sparkCommandTools: [],
        activeTools: [],
      })

      expect(tools.map(tool => tool.function)).toEqual([builtInTool.function])
      expect(createWebSearchToolsMock).not.toHaveBeenCalled()
    })

    it('mounts web_search with a trimmed key when the module is configured', async () => {
      const webSearchTool = createTool('web_search')
      createWebSearchToolsMock.mockResolvedValue([webSearchTool])
      // A key pasted with surrounding whitespace still reads as configured, so
      // the resolver must trim it before handing it to the factory.
      useWebSearchStoreMock.mockReturnValue({ configured: true, apiKey: '  tvly-key\n' })
      const builtInTool = createTool('built_in_tool')

      const tools = await resolveLlmTools({
        builtInTools: [builtInTool],
        debugTools: [],
        sparkCommandTools: [],
        activeTools: [],
      })

      expect(createWebSearchToolsMock).toHaveBeenCalledWith({ apiKey: 'tvly-key' })
      expect(tools.map(tool => tool.function)).toEqual([builtInTool.function, webSearchTool.function])
    })
  })
})

/**
 * LIA A-1 (14/11/2026) — the production composition, not just the store.
 *
 * Both the chat send and the tool-call rerun build their tool list as
 * `resolveLlmTools({ customTools: store.getToolsByNames(...) })`. These cases
 * run that exact expression so a future refactor cannot reintroduce a path
 * that ignores enablement.
 */
describe('resolveLlmTools + enablement', () => {
  const toolOptions = {} as Parameters<Tool['execute']>[1]

  function registeredTool(id: string, name: string, execute: () => Promise<unknown> = vi.fn(async () => ({ ok: true }))) {
    return {
      type: 'function' as const,
      id,
      defaultActive: false,
      function: {
        name,
        description: `${name} description`,
        parameters: { type: 'object', properties: {} },
      },
      execute,
    }
  }

  function resolveFor(name: string) {
    const store = useLlmToolsStore()
    return resolveLlmTools({
      builtInTools: [],
      debugTools: [],
      sparkCommandTools: [],
      webSearchTools: [],
      customTools: store.getToolsByNames(name),
      activeTools: [], // ambient is asserted separately; isolate explicit selection
    })
  }

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('sends an enabled tool the request selects explicitly', async () => {
    const store = useLlmToolsStore()
    store.addTools(registeredTool('tamagotchi:get_weather', 'get_weather'))

    const tools = await resolveFor('get_weather')

    expect(tools.map(toolNameFrom)).toEqual(['get_weather'])
  })

  it('does not send a disabled tool the request selects explicitly', async () => {
    const store = useLlmToolsStore()
    store.addTools(registeredTool('tamagotchi:get_weather', 'get_weather'))
    store.setToolEnabled('tamagotchi:get_weather', false)

    const tools = await resolveFor('get_weather')

    expect(tools).toEqual([])
  })

  it('does not execute a disabled tool through the rerun composition', async () => {
    const store = useLlmToolsStore()
    const execute = vi.fn(async () => ({ weather: 'sunny' }))
    store.addTools(registeredTool('tamagotchi:get_weather', 'get_weather', execute))
    store.setToolEnabled('tamagotchi:get_weather', false)

    const messages = [{
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '',
      slices: [{
        type: 'tool-call' as const,
        toolCall: {
          toolCallId: 'call-weather',
          toolCallType: 'function' as const,
          toolName: 'get_weather',
          args: '{"location":"Tokyo"}',
        },
      }],
      tool_results: [],
    }]

    const next = await executeToolCallRerun({
      messages,
      payload: {
        messageId: 'assistant-1',
        toolCallId: 'call-weather',
        toolName: 'get_weather',
        args: '{"location":"Tokyo"}',
      },
      resolveTools: () => resolveFor('get_weather'),
    })

    expect(execute).not.toHaveBeenCalled()
    expect(next[0]).toMatchObject({
      tool_results: [{
        id: 'call-weather',
        isError: true,
        result: 'Tool "get_weather" is not available for rerun in this runtime.',
      }],
    })
  })

  it('still executes an enabled tool through the rerun composition', async () => {
    const store = useLlmToolsStore()
    const execute = vi.fn(async () => ({ weather: 'sunny' }))
    store.addTools(registeredTool('tamagotchi:get_weather', 'get_weather', execute))

    const messages = [{
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '',
      slices: [{
        type: 'tool-call' as const,
        toolCall: {
          toolCallId: 'call-weather',
          toolCallType: 'function' as const,
          toolName: 'get_weather',
          args: '{"location":"Tokyo"}',
        },
      }],
      tool_results: [],
    }]

    const next = await executeToolCallRerun({
      messages,
      payload: {
        messageId: 'assistant-1',
        toolCallId: 'call-weather',
        toolName: 'get_weather',
        args: '{"location":"Tokyo"}',
      },
      resolveTools: () => resolveFor('get_weather'),
    })

    expect(execute).toHaveBeenCalledTimes(1)
    expect(next[0]).toMatchObject({
      tool_results: [{
        id: 'call-weather',
        result: '{"weather":"sunny"}',
      }],
    })
  })

  it('keeps ambient inclusion and enablement independent', async () => {
    const store = useLlmToolsStore()
    store.addTools(
      registeredTool('tamagotchi:get_weather', 'get_weather'),
      { ...registeredTool('plugin:chess:play', 'play_chess'), defaultActive: true },
    )

    const ambient = () => resolveLlmTools({
      builtInTools: [],
      debugTools: [],
      sparkCommandTools: [],
      webSearchTools: [],
      customTools: [],
      activeTools: store.activeTools,
    })

    expect((await ambient()).map(toolNameFrom)).toEqual(['play_chess'])

    store.setToolEnabled('plugin:chess:play', false)
    expect((await ambient()).map(toolNameFrom)).toEqual([])

    // The on-demand tool was never ambient and is untouched.
    expect(store.isToolEnabled('tamagotchi:get_weather')).toBe(true)
    expect((await resolveFor('get_weather')).map(toolNameFrom)).toEqual(['get_weather'])
  })

  it('rechecks enablement after an asynchronous source resolves', async () => {
    const store = useLlmToolsStore()
    store.addTools({ ...registeredTool('plugin:sample', 'sample'), defaultActive: true })
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const resolving = resolveLlmTools({
      builtInTools: [], debugTools: [], sparkCommandTools: [], webSearchTools: [],
      customTools: async () => { await pending; return [] },
    })
    await Promise.resolve()
    store.setToolEnabled('plugin:sample', false)
    release()
    expect(await resolving).toEqual([])
  })

  it('does not expose or execute a colliding fallback for a disabled registration', async () => {
    const store = useLlmToolsStore()
    const fallback = createTool('builtIn_mcpCallTool')
    store.addTools({ ...registeredTool('mcp:builtIn_mcpCallTool', 'builtIn_mcpCallTool'), defaultActive: true })
    store.setToolEnabled('mcp:builtIn_mcpCallTool', false)
    const tools = await resolveLlmTools({
      builtInTools: [fallback], debugTools: [], sparkCommandTools: [], webSearchTools: [],
      customTools: store.getToolsByNames('builtIn_mcpCallTool'),
    })
    expect(tools).toEqual([])
    expect(fallback.execute).not.toHaveBeenCalled()
  })

  it('blocks same-name registered tools in explicit reruns when any is disabled', async () => {
    const store = useLlmToolsStore()
    const first = registeredTool('plugin:first', 'shared')
    const second = registeredTool('plugin:second', 'shared')
    store.addTools(first, second)
    const captured = store.getToolsByNames('shared')[0]!
    store.setToolEnabled(first.id, false)
    expect(store.getToolsByNames('shared')).toEqual([])
    expect(() => captured.execute({}, toolOptions)).toThrow()
    expect(second.execute).not.toHaveBeenCalled()
  })

  it('revokes a previously resolved fallback at dispatch and execution', async () => {
    const store = useLlmToolsStore()
    const fallback = createTool('duplicate')
    store.addTools(registeredTool('plugin:duplicate', 'duplicate'))
    const [captured] = await resolveLlmTools({
      builtInTools: [fallback], debugTools: [], sparkCommandTools: [], webSearchTools: [],
    })
    expect(isResolvedToolAllowed(captured!)).toBe(true)
    store.setToolEnabled('plugin:duplicate', false)
    expect(isResolvedToolAllowed(captured!)).toBe(false)
    expect(() => captured!.execute({}, toolOptions)).toThrow('disabled or unavailable')
    expect(fallback.execute).not.toHaveBeenCalled()
  })
})
