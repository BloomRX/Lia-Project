import type { Tool } from '@xsai/shared-chat'

/**
 * Reads the provider-visible name from an xsai tool.
 *
 * A leaf module on purpose: `tool-call-rerun` needs only this helper, and
 * importing it from `tool-resolver` dragged the whole tool catalog (MCP, web
 * search, spark commands, server SDK) into every consumer and every test.
 */
export function toolNameFrom(tool: Tool): string | undefined {
  const candidate = tool as Tool & {
    name?: string
    function?: {
      name?: string
    }
  }

  return candidate.function?.name ?? candidate.name
}
