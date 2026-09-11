import type { JsonSchema } from 'xsschema'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { describe, expect, it, vi } from 'vitest'

import { createSparkCommandTool } from './spark-command'
import { sparkCommandContextSchema } from './spark-command-shared'

function isJsonSchema(value: JsonSchema | boolean | undefined): value is JsonSchema {
  return Boolean(value && typeof value === 'object')
}

function getObjectSchema(schema?: JsonSchema) {
  if (!schema)
    return undefined

  if (schema.type === 'object')
    return schema

  const candidates = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].filter(isJsonSchema)
  return candidates.find(candidate => candidate?.type === 'object')
}

function getArraySchema(schema?: JsonSchema) {
  if (!schema)
    return undefined

  if (schema.type === 'array')
    return schema

  const candidates = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].filter(isJsonSchema)
  return candidates.find(candidate => candidate?.type === 'array')
}

function findObjectSchema(schema: JsonSchema | undefined, predicate: (schema: JsonSchema) => boolean): JsonSchema | undefined {
  if (!schema)
    return undefined

  const objectSchema = getObjectSchema(schema)
  if (objectSchema && predicate(objectSchema))
    return objectSchema

  for (const candidate of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])].filter(isJsonSchema)) {
    const found = findObjectSchema(candidate, predicate)
    if (found)
      return found
  }

  return undefined
}

describe('tools/character/orchestrator/spark-command', () => {
  it('emits a strict parameter schema', async () => {
    const tools = await createSparkCommandTool({
      sendSparkCommand: () => undefined,
    })

    expect(tools[0].function.name).toBe('builtIn_emitSparkCommand')
    expect(tools[0].function.parameters.additionalProperties).toBe(false)
  })

  it('avoids propertyNames in provider-facing schema', async () => {
    const tools = await createSparkCommandTool({
      sendSparkCommand: () => undefined,
    })

    const schema = tools[0].function.parameters as JsonSchema
    const guidance = getObjectSchema(schema.properties?.guidance as JsonSchema)
    const guidancePersona = guidance?.properties?.persona as JsonSchema
    const contexts = getArraySchema(schema.properties?.contexts as JsonSchema)
    const contextItem = contexts?.items as JsonSchema
    const metadata = contextItem.properties?.metadata as JsonSchema

    expect(guidancePersona.propertyNames).toBeUndefined()
    expect(metadata.propertyNames).toBeUndefined()
  })

  it('preserves heterogeneous nullable metadata values as anyOf', async () => {
    const tools = await createSparkCommandTool({
      sendSparkCommand: () => undefined,
    })

    const schema = tools[0].function.parameters as JsonSchema
    const contexts = getArraySchema(schema.properties?.contexts as JsonSchema)
    const contextItem = contexts?.items as JsonSchema
    const metadata = getArraySchema(contextItem.properties?.metadata as JsonSchema)
    const metadataItem = metadata?.items as JsonSchema
    const metadataValue = metadataItem.properties?.value as JsonSchema

    // ROOT CAUSE:
    //
    // A global normalizer collapsed this union into `type: ['string', 'number',
    // 'boolean', 'null']`. The Gemini conversion in OpenRouter then removed the
    // metadata properties but kept the `required` keys.
    //
    // The tool now keeps the canonical `anyOf`. Provider adapters can convert
    // this schema when their target rejects the canonical form.
    expect(metadataValue.type).toBeUndefined()
    expect(metadataValue.anyOf).toEqual([
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'null' },
    ])
  })

  it('uses explicit required keys for nested strict option objects', async () => {
    const tools = await createSparkCommandTool({
      sendSparkCommand: () => undefined,
    })

    const schema = tools[0].function.parameters as JsonSchema
    expect(schema.required).toEqual([
      'destinations',
      'interrupt',
      'priority',
      'intent',
      'ack',
      'parentEventId',
      'guidance',
      'contexts',
    ])
    const guidance = getObjectSchema(schema.properties?.guidance as JsonSchema)
    const options = guidance?.properties?.options as JsonSchema
    const optionItem = options.items as JsonSchema
    const contexts = getArraySchema(schema.properties?.contexts as JsonSchema)
    const contextItem = contexts?.items as JsonSchema
    const destinations = contextItem.properties?.destinations as JsonSchema
    const destinationsFilter = findObjectSchema(
      destinations,
      candidate => Boolean(candidate.properties?.include || candidate.properties?.exclude),
    )

    expect(guidance?.required).toEqual([
      'type',
      'persona',
      'options',
    ])
    expect(optionItem.required).toEqual([
      'label',
      'steps',
      'rationale',
      'possibleOutcome',
      'risk',
      'fallback',
      'triggers',
    ])
    expect(contextItem.required).toEqual([
      'lane',
      'ideas',
      'hints',
      'strategy',
      'text',
      'destinations',
      'metadata',
    ])
    expect(destinationsFilter?.required).toEqual([
      'include',
      'exclude',
    ])
  })

  it('builds and dispatches spark commands with generated ids', async () => {
    const sendSparkCommand = vi.fn()
    const tools = await createSparkCommandTool({
      sendSparkCommand,
    })

    const result = await tools[0].execute({
      destinations: ['minecraft'],
      interrupt: 'soft',
      priority: 'high',
      intent: 'proposal',
      ack: 'check this',
      parentEventId: 'parent-1',
      guidance: {
        type: 'instruction',
        persona: [
          { traits: 'bravery', strength: 'high' },
        ],
        options: [{
          label: 'Move',
          steps: ['Walk forward'],
          rationale: 'Closer inspection',
          possibleOutcome: null,
          risk: null,
          fallback: null,
          triggers: null,
        }],
      },
      contexts: [{
        lane: 'game',
        ideas: null,
        hints: null,
        strategy: ContextUpdateStrategy.AppendSelf,
        text: 'Zombie nearby',
        destinations: ['memory'],
        metadata: [
          { key: 'threat', value: 'zombie' },
          { key: 'urgent', value: true },
        ],
      }],
    }, { messages: [], toolCallId: 'tool-call-id' })

    expect(sendSparkCommand).toHaveBeenCalledTimes(1)
    expect(sendSparkCommand).toHaveBeenCalledWith(expect.objectContaining({
      parentEventId: 'parent-1',
      interrupt: 'soft',
      priority: 'high',
      intent: 'proposal',
      ack: 'check this',
      destinations: ['minecraft'],
      guidance: {
        type: 'instruction',
        persona: {
          bravery: 'high',
        },
        options: [{
          label: 'Move',
          steps: ['Walk forward'],
          rationale: 'Closer inspection',
          possibleOutcome: undefined,
          risk: undefined,
          fallback: undefined,
          triggers: undefined,
        }],
      },
      contexts: [expect.objectContaining({
        lane: 'game',
        strategy: ContextUpdateStrategy.AppendSelf,
        text: 'Zombie nearby',
        destinations: ['memory'],
        metadata: {
          threat: 'zombie',
          urgent: true,
        },
      })],
    }))

    const command = sendSparkCommand.mock.calls[0][0]
    expect(command.id).toEqual(expect.any(String))
    expect(command.eventId).toEqual(expect.any(String))
    expect(command.commandId).toEqual(expect.any(String))
    expect(command.contexts?.[0].id).toEqual(expect.any(String))
    expect(command.contexts?.[0].contextId).toEqual(expect.any(String))
    expect(result).toContain('spark:command sent')
    expect(result).toContain(command.commandId)
  })

  it('reports a broadcast without crashing when the channel sender clears destinations', async () => {
    // The real sendSparkCommand (stores/ai/chat-llm/llm.ts) deletes command.destinations to broadcast to every
    // authenticated peer; the success message must not then call .join on undefined.
    const sendSparkCommand = vi.fn((command: { destinations?: unknown }) => {
      delete command.destinations
    })
    const tools = await createSparkCommandTool({ sendSparkCommand })

    const result = await tools[0].execute({
      destinations: [],
      interrupt: 'soft',
      priority: 'normal',
      intent: 'action',
      ack: null,
      parentEventId: null,
      guidance: null,
      contexts: null,
    }, { messages: [], toolCallId: 'tool-call-id' })

    expect(sendSparkCommand).toHaveBeenCalledOnce()
    expect(result).toContain('spark:command sent')
    expect(result).toContain('broadcast')
  })
})

/**
 * Strict tool-schema compatibility.
 *
 * Regression for the Groq 400 `invalid_request_error`:
 *
 *   tool builtIn_emitSparkCommand
 *   tools[1].function.parameters:
 *     /properties/contexts/anyOf/0/items/properties/destinations/anyOf
 *   variant 0: properties must be present (or set additionalProperties:false)
 *
 * ROOT CAUSE: `z.union([...]).nullable()` nests the union. The outer `anyOf`
 * variant 0 was then a bare `{ anyOf: [...] }` - no `type`, no `properties`, no
 * `additionalProperties`. Strict validators treat a typeless branch as an object
 * and reject it. The same shape existed on the root `interrupt` field.
 */
describe('builtIn_emitSparkCommand strict tool-schema compatibility', () => {
  async function toolParameters() {
    const tools = await createSparkCommandTool({ sendSparkCommand: () => undefined })
    expect(tools[0].function.name).toBe('builtIn_emitSparkCommand')
    return tools[0].function.parameters as JsonSchema
  }

  function contextItemProperties(schema: JsonSchema) {
    const contexts = getArraySchema(schema.properties?.contexts as JsonSchema)
    return (contexts?.items as JsonSchema).properties as Record<string, JsonSchema>
  }

  /** Every `anyOf`/`oneOf` branch in the schema, with its JSON pointer path. */
  function collectBranches(schema: JsonSchema | undefined, path = '#'): Array<{ branch: JsonSchema, path: string }> {
    if (!schema)
      return []

    const found: Array<{ branch: JsonSchema, path: string }> = []
    for (const key of ['anyOf', 'oneOf'] as const) {
      const branches = [...(schema[key] ?? [])].filter(isJsonSchema)
      branches.forEach((branch, index) => {
        found.push({ branch, path: `${path}/${key}/${index}` })
        found.push(...collectBranches(branch, `${path}/${key}/${index}`))
      })
    }

    for (const [name, value] of Object.entries(schema.properties ?? {})) {
      if (isJsonSchema(value))
        found.push(...collectBranches(value, `${path}/properties/${name}`))
    }

    const items = schema.items
    if (Array.isArray(items))
      items.forEach((item, index) => found.push(...collectBranches(isJsonSchema(item) ? item : undefined, `${path}/items/${index}`)))
    else if (isJsonSchema(items))
      found.push(...collectBranches(items, `${path}/items`))

    return found
  }

  it('finds the tool and exposes its final provider-facing JSON Schema', async () => {
    const parameters = await toolParameters()
    expect(parameters.type).toBe('object')
    expect(parameters.additionalProperties).toBe(false)
  })

  it('keeps every contexts[].destinations.anyOf branch explicitly typed', async () => {
    const destinations = contextItemProperties(await toolParameters()).destinations
    const branches = [...(destinations.anyOf ?? [])].filter(isJsonSchema)

    // array | { all: true } | { include, exclude } | null
    expect(branches.map(branch => branch.type)).toEqual(['array', 'object', 'object', 'null'])

    for (const branch of branches) {
      // The regression: a bare nested `{ anyOf: [...] }` has no `type` at all.
      expect(branch.type, JSON.stringify(branch)).toBeDefined()
      expect(branch.anyOf, `${JSON.stringify(branch)} must not nest another anyOf`).toBeUndefined()
    }
  })

  it('leaves no object branch without properties or additionalProperties:false', async () => {
    const offenders = collectBranches(await toolParameters())
      .filter(({ branch }) => branch.type === 'object')
      .filter(({ branch }) => !branch.properties && branch.additionalProperties !== false)
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('leaves no typeless anyOf/oneOf branch anywhere in the tool schema', async () => {
    const offenders = collectBranches(await toolParameters())
      .filter(({ branch }) => branch.type === undefined)
      .map(({ path }) => path)

    expect(offenders).toEqual([])
  })

  it('keeps the root interrupt field flat as well', async () => {
    const interrupt = (await toolParameters()).properties?.interrupt as JsonSchema
    const branches = [...(interrupt.anyOf ?? [])].filter(isJsonSchema)

    expect(branches.every(branch => branch.type !== undefined && branch.anyOf === undefined)).toBe(true)
    expect(branches.map(branch => branch.const ?? branch.type)).toEqual(['force', 'soft', false, 'null'])
  })

  it('still accepts every destinations form the runtime produces', () => {
    const base = {
      lane: null,
      ideas: null,
      hints: null,
      strategy: ContextUpdateStrategy.AppendSelf,
      text: 'context text',
      metadata: null,
    }

    const accepted = [
      ['character', 'memory'],
      { all: true },
      { include: ['character'], exclude: null },
      { include: null, exclude: ['memory'] },
      null,
    ]

    for (const destinations of accepted)
      expect(sparkCommandContextSchema.safeParse({ ...base, destinations }).success, JSON.stringify(destinations)).toBe(true)
  })

  it('still rejects destinations forms that were never valid', () => {
    const base = {
      lane: null,
      ideas: null,
      hints: null,
      strategy: ContextUpdateStrategy.AppendSelf,
      text: 'context text',
      metadata: null,
    }

    for (const destinations of [{ all: false }, { include: 'character' }, { other: true }, 'character'])
      expect(sparkCommandContextSchema.safeParse({ ...base, destinations }).success, JSON.stringify(destinations)).toBe(false)
  })

  it('keeps the OpenAI-compatible tool envelope used by AIRI', async () => {
    const tools = await createSparkCommandTool({ sendSparkCommand: () => undefined })
    const [tool] = tools as Array<{ type?: string, function: { name: string, description?: string, parameters: JsonSchema } }>

    // xsai sends `{ type: 'function', function: { name, description, parameters } }`.
    expect(tool.type ?? 'function').toBe('function')
    expect(tool.function.name).toBe('builtIn_emitSparkCommand')
    expect(typeof tool.function.description).toBe('string')
    expect(tool.function.parameters.type).toBe('object')
    expect(Array.isArray(tool.function.parameters.required)).toBe(true)
    // A strict provider requires every declared property to be listed as required.
    expect([...(tool.function.parameters.required as string[])].sort())
      .toEqual(Object.keys(tool.function.parameters.properties ?? {}).sort())
  })
})
