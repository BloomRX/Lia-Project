import type { Tool } from '@xsai/shared-chat'

import type { ExecutableTool, ToolDefinition } from './tools'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolDisabledError, useLlmToolsStore } from './tools'

function createExecutableTool(id: string, name = id): ExecutableTool {
  return {
    id,
    type: 'function',
    function: {
      name,
      description: `Execute ${name}.`,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    execute: vi.fn(async () => ({ ok: true })),
  }
}

describe('useLlmToolsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('stores serializable definitions and keeps executors outside Pinia state', async () => {
    const store = useLlmToolsStore()
    const executableTool = createExecutableTool('plugin:chess:play', 'play_chess')
    const toolOptions = {} as Parameters<Tool['execute']>[1]

    store.addTools(executableTool)

    expect(store.tools).toEqual([{
      id: 'plugin:chess:play',
      type: 'function',
      function: {
        name: 'play_chess',
        description: 'Execute play_chess.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    }])
    expect(JSON.stringify(store.$state)).not.toContain('execute')
    await expect(store.activeTools[0]?.execute({}, toolOptions)).resolves.toEqual({ ok: true })
  })

  it('replaces a tool with the same id and keeps its list position', async () => {
    const store = useLlmToolsStore()
    const first = createExecutableTool('plugin:chess:play', 'play_chess')
    const second = createExecutableTool('plugin:chess:play', 'play_chess_v2')
    const other = createExecutableTool('mcp:list', 'builtIn_mcpListTools')
    const toolOptions = {} as Parameters<Tool['execute']>[1]

    store.addTools(first, other)
    store.addTools(second)

    expect(store.tools.map(tool => tool.id)).toEqual([
      'plugin:chess:play',
      'mcp:list',
    ])
    expect(store.tools[0]?.function.name).toBe('play_chess_v2')
    // Identity is deliberately NOT asserted any more: every exposed tool goes
    // through the enablement guard, so `execute` is a thin wrapper that
    // delegates to the registered executor. Behaviour is what matters.
    await expect(store.activeTools[0]?.execute({}, toolOptions)).resolves.toEqual({ ok: true })
    expect(second.execute).toHaveBeenCalledTimes(1)
    expect(first.execute).not.toHaveBeenCalled()
  })

  it('removes one or many tools by id', () => {
    const store = useLlmToolsStore()
    store.addTools(
      createExecutableTool('plugin:chess:play'),
      createExecutableTool('plugin:chess:reset'),
      createExecutableTool('mcp:list'),
    )

    store.removeToolById('plugin:chess:play')
    expect(store.tools.map(tool => tool.id)).toEqual([
      'plugin:chess:reset',
      'mcp:list',
    ])

    store.removeToolsByIds('plugin:chess:reset', 'mcp:list')
    expect(store.tools).toEqual([])
    expect(store.activeTools).toEqual([])
  })

  it('returns an unavailable executor when synchronized state has no local executor', () => {
    const store = useLlmToolsStore()
    const definition: ToolDefinition = {
      id: 'plugin:chess:play',
      type: 'function',
      function: {
        name: 'play_chess',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    }
    const toolOptions = {} as Parameters<Tool['execute']>[1]

    store.$patch((state) => {
      state.tools = [definition]
    })

    expect(store.activeTools[0]?.execute({}, toolOptions)).toBe('Tool "play_chess" is not available now.')
  })

  it('keeps explicit tools out of the default list and resolves them by name', () => {
    const store = useLlmToolsStore()
    const defaultTool = createExecutableTool('plugin:chess:play', 'play_chess')
    const explicitTool = {
      ...createExecutableTool('tamagotchi:journal', 'image_journal'),
      defaultActive: false,
    }

    store.addTools(defaultTool, explicitTool)

    expect(store.activeTools.map(tool => tool.function.name)).toEqual(['play_chess'])
    expect(store.getToolsByNames('image_journal').map(tool => tool.function.name)).toEqual(['image_journal'])
  })
})

/**
 * LIA A-1 (14/11/2026) — enablement is a real gate.
 *
 * The audit found that a tool registered with `defaultActive: false` still
 * reached the model through `getToolsByNames`, the path the chat send and the
 * tool-call rerun use. These cases pin the corrected contract: `defaultActive`
 * stays an ambient-only hint, and `enabledById` decides presentation and
 * execution for every path.
 */
describe('useLlmToolsStore enablement', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function explicitTool(id: string, name: string) {
    return { ...createExecutableTool(id, name), defaultActive: false }
  }

  it('keeps the upstream defaultActive contract: ambient off, explicit on', () => {
    const store = useLlmToolsStore()
    store.addTools(explicitTool('tamagotchi:get_weather', 'get_weather'))

    // Not in the ambient list...
    expect(store.activeTools).toEqual([])
    // ...but request-selected resolution still works, exactly as before.
    expect(store.getToolsByNames('get_weather').map(tool => tool.function.name)).toEqual(['get_weather'])
    expect(store.isToolEnabled('tamagotchi:get_weather')).toBe(true)
  })

  it('stops presenting a disabled tool on every resolution path', () => {
    const store = useLlmToolsStore()
    store.addTools(explicitTool('tamagotchi:get_weather', 'get_weather'))

    store.setToolEnabled('tamagotchi:get_weather', false)

    expect(store.getToolsByNames('get_weather')).toEqual([])
    expect(store.activeTools).toEqual([])
    expect(store.isToolEnabled('tamagotchi:get_weather')).toBe(false)
  })

  it('refuses execution through a tool object captured before the change', async () => {
    const store = useLlmToolsStore()
    const executor = createExecutableTool('tamagotchi:stage_widgets', 'stage_widgets')
    const toolOptions = {} as Parameters<Tool['execute']>[1]
    store.addTools(executor)

    // A queued send (or a stored rerun) already holds this object.
    const captured = store.getToolsByNames('stage_widgets')[0]!
    store.setToolEnabled('tamagotchi:stage_widgets', false)

    expect(() => captured.execute({}, toolOptions)).toThrow(ToolDisabledError)
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('re-enables only when asked, and the tool works again', async () => {
    const store = useLlmToolsStore()
    const executor = createExecutableTool('tamagotchi:image_journal', 'image_journal')
    const toolOptions = {} as Parameters<Tool['execute']>[1]
    store.addTools(executor)

    store.setToolEnabled('tamagotchi:image_journal', false)
    expect(store.getToolsByNames('image_journal')).toEqual([])

    store.setToolEnabled('tamagotchi:image_journal', true)
    const tool = store.getToolsByNames('image_journal')[0]
    expect(tool?.function.name).toBe('image_journal')
    await expect(tool!.execute({}, toolOptions)).resolves.toEqual({ ok: true })
  })

  it('survives re-registration: a refresh cannot silently re-enable', () => {
    const store = useLlmToolsStore()
    store.addTools(explicitTool('tamagotchi:get_weather', 'get_weather'))
    store.setToolEnabled('tamagotchi:get_weather', false)

    // Every leadership change calls refresh(), which re-adds the definitions.
    store.addTools(explicitTool('tamagotchi:get_weather', 'get_weather'))

    expect(store.isToolEnabled('tamagotchi:get_weather')).toBe(false)
    expect(store.getToolsByNames('get_weather')).toEqual([])
  })

  it('is per tool: disabling one leaves the others intact', () => {
    const store = useLlmToolsStore()
    store.addTools(
      explicitTool('tamagotchi:get_weather', 'get_weather'),
      explicitTool('tamagotchi:stage_widgets', 'stage_widgets'),
      explicitTool('tamagotchi:image_journal', 'image_journal'),
    )

    store.setToolEnabled('tamagotchi:stage_widgets', false)

    expect(store.getToolsByNames('get_weather', 'stage_widgets', 'image_journal')
      .map(tool => tool.function.name)).toEqual(['get_weather', 'image_journal'])
  })

  it('ignores names that were never registered', () => {
    const store = useLlmToolsStore()
    store.addTools(explicitTool('tamagotchi:get_weather', 'get_weather'))

    expect(store.getToolsByNames('does_not_exist')).toEqual([])
  })

  it('does not auto-enable anything when tools are registered', () => {
    const store = useLlmToolsStore()
    store.addTools(
      explicitTool('tamagotchi:get_weather', 'get_weather'),
      createExecutableTool('plugin:chess:play', 'play_chess'),
    )

    // Only an explicit setToolEnabled writes the map.
    expect(store.enabledById).toEqual({})
  })
})
