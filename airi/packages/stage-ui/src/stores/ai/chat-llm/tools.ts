import type { Tool } from '@xsai/shared-chat'
import type {} from 'pinia-plugin-synced'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { toolNameFrom } from './tool-name'

/** A serializable tool definition shared between application contexts. */
export interface ToolDefinition extends Omit<Tool, 'execute'> {
  /** A stable application id. This id does not need to match the model-facing name. */
  id: string
  /**
   * Ambient inclusion only: includes this tool when a request does NOT select
   * it explicitly.
   *
   * This is **not** a disable switch. A tool registered with
   * `defaultActive: false` is omitted from {@link activeTools} but still
   * resolvable by name, which is how the Stage offers widgets, weather and the
   * image journal on demand. Enablement is `enabledById` (see
   * {@link useLlmToolsStore}).
   */
  defaultActive?: boolean
}

/** A tool definition with the executor that is available in the current runtime. */
export interface ExecutableTool extends Tool {
  /** A stable application id. This id does not need to match the model-facing name. */
  id: string
  /** Ambient inclusion only — see {@link ToolDefinition.defaultActive}. */
  defaultActive?: boolean
}

function unavailableToolResult(name: string) {
  return `Tool "${name}" is not available now.`
}

/** Raised when something tries to run a tool the user/product disabled. */
export class ToolDisabledError extends Error {
  constructor(readonly toolId: string, readonly toolName: string) {
    super(`Tool "${toolName}" is disabled.`)
    this.name = 'ToolDisabledError'
  }
}

/**
 * Stores serializable tool definitions and leader-local executors.
 *
 * The Pinia state contains definitions and the enablement map only. Call
 * {@link addTools} from an action that already runs in the elected leader. The
 * executor map never enters synchronized state.
 *
 * ## Enablement (LIA A-1, 14/11/2026)
 *
 * Three questions used to be conflated, and only the first two had an answer:
 *
 *  1. **registered?** the definition exists in {@link tools} — inventory;
 *  2. **ambient?** `defaultActive !== false` — included when a request does
 *     not name the tool explicitly (upstream contract, unchanged);
 *  3. **enabled?** {@link enabledById} — the user/product gate that applies to
 *     **every** path, ambient or explicit.
 *
 * `defaultActive` is not a disable switch. It was documented in an audit as if
 * it were, which is how disabled-looking tools kept reaching the model through
 * `getToolsByNames`. `enabledById` is the switch that actually means off:
 * a disabled tool is absent from {@link activeTools}, is not resolvable by
 * {@link getToolsByNames} (the path both the chat send and the tool-call rerun
 * use), and refuses to execute even through a tool object captured before the
 * change.
 *
 * Unknown ids are **enabled** on purpose: registering a tool is already an
 * application decision, and turning that into an implicit opt-in would
 * silently remove working functionality. Only an explicit `false` disables.
 * Re-registering a tool never clears the explicit choice, so a refresh cannot
 * quietly re-enable something the user turned off; removing a tool also keeps
 * the choice, so a plugin that comes back stays off.
 */
export const useLlmToolsStore = defineStore('llm-tools', () => {
  const tools = ref<ToolDefinition[]>([])
  /**
   * Explicit enablement, keyed by tool id. Absent means "enabled" — see the
   * store doc for why the default is on.
   */
  const enabledById = ref<Record<string, boolean>>({})
  const executors = new Map<string, Tool['execute']>()
  // Local provenance for already-resolved objects; never serialized to Pinia.
  const resolvedIds = new WeakMap<Tool, string>()

  /** Whether a registered tool may be shown to the model and executed. */
  function isToolEnabled(id: string): boolean {
    return enabledById.value[id] ?? true
  }

  /**
   * Turns one tool on or off. The only mutation path for enablement; nothing
   * calls it automatically, and no flow re-enables a tool on its own.
   */
  function setToolEnabled(id: string, enabled: boolean): void {
    enabledById.value = { ...enabledById.value, [id]: enabled }
  }

  function isNameBlocked(name: string): boolean {
    return tools.value.some(definition => definition.function.name === name && !isToolEnabled(definition.id))
  }

  function executableToolFrom(definition: ToolDefinition): Tool {
    const execute = (input: Parameters<Tool['execute']>[0], options: Parameters<Tool['execute']>[1]) => {
      // Defense in depth: presentation already filters disabled tools, but a
      // tool object captured before the change (queued send, stored rerun,
      // plugin reference) must not run either.
      if (!isToolEnabled(definition.id) || isNameBlocked(definition.function.name))
        throw new ToolDisabledError(definition.id, definition.function.name)

      const executor = executors.get(definition.id)
      if (!executor)
        return unavailableToolResult(definition.function.name)

      return executor(input, options)
    }

    const result: Tool = {
      type: definition.type,
      function: definition.function,
      execute,
    }
    resolvedIds.set(result, definition.id)
    return result
  }

  /** Fail closed on name collisions with disabled registrations, including
   * other sources. A captured store object also needs its original ID to
   * remain registered and enabled at the last presentation/execution check.
   */
  function isToolAllowed(tool: Tool): boolean {
    const name = toolNameFrom(tool)
    if (name && isNameBlocked(name))
      return false

    const id = resolvedIds.get(tool)
    if (id === undefined)
      return true
    return isToolEnabled(id) && tools.value.some(definition => definition.id === id && definition.function.name === name)
  }

  const activeTools = computed<Tool[]>(() => tools.value
    .filter(tool => tool.defaultActive !== false && isToolEnabled(tool.id) && !isNameBlocked(tool.function.name))
    .map(executableToolFrom))

  /**
   * Resolves registered tools in the requested model-facing name order.
   *
   * Explicit selection wins over `defaultActive` — that is the upstream
   * contract the Stage relies on — but never over enablement: a disabled tool
   * is left out, so a stale name (from a past turn, a stored rerun or a caller
   * that predates the change) cannot resurrect it.
   */
  function getToolsByNames(...names: string[]): Tool[] {
    return names.flatMap((name) => {
      const definition = tools.value.findLast(tool => tool.function.name === name)
      return definition && isToolEnabled(definition.id) && !isNameBlocked(name) ? [executableToolFrom(definition)] : []
    })
  }

  /** Adds tools or replaces existing tools that have the same application id. */
  function addTools(...nextTools: ExecutableTool[]) {
    const definitions = [...tools.value]

    for (const tool of nextTools) {
      const definition = structuredClone<ToolDefinition>({
        id: tool.id,
        type: tool.type,
        function: tool.function,
        ...(tool.defaultActive === undefined ? {} : { defaultActive: tool.defaultActive }),
      })
      const existingIndex = definitions.findIndex(item => item.id === tool.id)

      executors.set(tool.id, tool.execute)
      if (existingIndex >= 0) {
        definitions[existingIndex] = definition
        continue
      }

      definitions.push(definition)
    }

    tools.value = definitions
  }

  /** Removes one tool definition and its local executor. */
  function removeToolById(id: string) {
    removeToolsByIds(id)
  }

  /** Removes tool definitions and their local executors. */
  function removeToolsByIds(...ids: string[]) {
    if (ids.length === 0)
      return

    const idSet = new Set(ids)
    for (const id of idSet)
      executors.delete(id)

    tools.value = tools.value.filter(tool => !idSet.has(tool.id))
  }

  return {
    activeTools,
    addTools,
    enabledById,
    getToolsByNames,
    isToolAllowed,
    isToolEnabled,
    removeToolById,
    removeToolsByIds,
    setToolEnabled,
    tools,
  }
}, {
  synced: {
    state: true,
  },
})
