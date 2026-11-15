import type { OidcPrivateValueCheck } from './oidc-session'

const textFields = new Set(['content', 'reasoning_content', 'reasoning', 'arguments', 'delta', 'text'])
const suffixLimit = 16_384

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalText(value: unknown): string | undefined {
  if (value == null)
    return undefined
  if (typeof value !== 'string')
    throw new Error('Invalid stream text')
  return value
}

/** Retain events while a text lane ends with a private-value prefix. Main only. */
export function createOidcTextEgress(privateValue: OidcPrivateValueCheck) {
  const lanes = new Map<string, string>()
  const argumentsByPath = new Map<string, { pending: string, length: number }>()
  const incompleteEscapes = new Set<string>()
  let argumentBytes = 0

  function argumentsText(path: string, fragment: string): string {
    const previous = argumentsByPath.get(path) ?? { pending: '', length: 0 }
    const raw = previous.pending + fragment
    argumentBytes += fragment.length
    const length = previous.length + fragment.length
    if (argumentBytes > 2 * 1024 * 1024 || length > 256 * 1024)
      throw new Error('Tool arguments exceed limit')
    let pending = ''
    incompleteEscapes.delete(path)
    let decoded = ''
    const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', 'b': '\b', 'f': '\f', 'n': '\n', 'r': '\r', 't': '\t' }
    for (let index = 0; index < raw.length; index++) {
      if (raw[index] !== '\\') {
        decoded += raw[index]
        continue
      }
      const escape = raw[index + 1]
      if (escape === undefined || (escape === 'u' && raw.length - index < 6)) {
        incompleteEscapes.add(path)
        pending = raw.slice(index)
        break
      }
      if (escape === 'u') {
        const hex = raw.slice(index + 2, index + 6)
        if (!/^[\da-f]{4}$/i.test(hex))
          throw new Error('Invalid tool argument escape')
        decoded += String.fromCharCode(Number.parseInt(hex, 16))
        index += 5
      }
      else {
        if (!Object.hasOwn(escapes, escape))
          throw new Error('Invalid tool argument escape')
        decoded += escapes[escape]
        index++
      }
    }
    argumentsByPath.set(path, { pending, length })
    return decoded
  }

  function update(path: string, value: string, replace = false) {
    const combined = (replace ? '' : lanes.get(path) ?? '') + value
    if (privateValue(combined))
      throw new Error('Private stream value')
    if (lanes.size >= 256 && !lanes.has(path))
      throw new Error('Too many text lanes')
    lanes.set(path, combined.slice(-suffixLimit))
  }

  function visit(value: unknown, path: string, depth: number) {
    if (depth > 32)
      throw new Error('Stream data too deep')
    if (Array.isArray(value)) {
      for (const [position, item] of value.entries()) {
        const index = item !== null && typeof item === 'object' && 'index' in item && Number.isSafeInteger(item.index) ? item.index : position
        visit(item, `${path}[${index}]`, depth + 1)
      }
    }
    else if (value !== null && typeof value === 'object') {
      for (const [field, item] of Object.entries(value)) {
        if (typeof item === 'string' && textFields.has(field)) {
          const lane = `${path}.${field}`
          update(lane, field === 'arguments' ? argumentsText(lane, item) : item)
        }
        else {
          visit(item, `${path}.${field}`, depth + 1)
        }
      }
    }
  }

  function held() {
    return incompleteEscapes.size > 0 || [...lanes.values()].some(text => privateValue(text, true))
  }

  return {
    inspect(value: unknown): boolean {
      visit(value, '', 0)
      return held()
    },
    inspectTranscription(value: unknown): boolean {
      if (!object(value))
        throw new Error('Invalid transcript event')
      if (value.type === 'transcript.text.delta') {
        const delta = optionalText(value.delta)
        if (delta === undefined)
          throw new Error('Missing transcript delta')
        // The legacy textStream keeps all deltas even after a snapshot.
        update('transcript:delta-stream', delta)
        update('transcript:aggregate', delta)
      }
      else if (value.type === 'transcript.text.snapshot') {
        const snapshot = optionalText(value.text)
        if (snapshot === undefined)
          throw new Error('Missing transcript text')
        update('transcript:aggregate', snapshot, true)
      }
      return held()
    },
    inspectChat(value: unknown): boolean {
      if (!object(value) || (value.choices != null && !Array.isArray(value.choices)))
        throw new Error('Invalid chat event')
      const choice = value.choices?.[0]
      if (choice === undefined)
        return held()
      if (!object(choice) || !object(choice.delta))
        throw new Error('Invalid chat delta')
      const { delta } = choice
      // Match xsAI's first-choice and field precedence, independent of the
      // index advertised by the upstream event.
      const reasoning = optionalText(delta.reasoning) ?? optionalText(delta.reasoning_content)
      if (reasoning !== undefined)
        update('chat:reasoning', reasoning)
      const calls = delta.tool_calls
      if (calls != null && (!Array.isArray(calls) || calls.length > 256))
        throw new Error('Invalid tool deltas')
      if (!calls?.length) {
        const content = optionalText(delta.content) ?? optionalText(delta.refusal)
        if (content !== undefined)
          update('chat:text', content)
      }
      else {
        for (const call of calls) {
          if (!object(call) || typeof call.index !== 'number' || !Number.isSafeInteger(call.index) || call.index < 0 || call.index >= 256 || !object(call.function))
            throw new Error('Invalid tool delta')
          const lane = `chat:tool:${call.index}`
          const fragment = optionalText(call.function.arguments)
          if (fragment === undefined && argumentsByPath.has(lane))
            throw new Error('Missing tool argument delta')
          update(`${lane}:raw`, fragment ?? '')
          update(lane, argumentsText(lane, fragment ?? ''))
        }
      }
      return held()
    },
  }
}
