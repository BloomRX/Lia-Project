import { describe, expect, it } from 'vitest'

import { installMemoryChatContext } from './memory-chat'

describe('request-only memory context', () => {
  it('retrieves on every send without changing persona or persisted history', async () => {
    let hook!: Parameters<Parameters<typeof installMemoryChatContext>[0]['onBeforeSend']>[0]
    const remove = () => {}
    let enabled = true
    const original = [{ role: 'system', content: 'canonical persona' }, { role: 'user', content: 'favorite color?' }]
    expect(installMemoryChatContext({ onBeforeSend: (cb) => {
      hook = cb
      return remove
    } }, async () => enabled ? 'untrusted saved data' : '')).toBe(remove)
    const request = structuredClone(original)
    await hook('favorite color?', { composedMessage: request })
    expect(request).toEqual([original[0], { role: 'user', content: 'untrusted saved data' }, original[1]])
    expect(original).toHaveLength(2)
    enabled = false
    const next = structuredClone(original)
    await hook('favorite color?', { composedMessage: next })
    expect(next).toEqual(original)
  })
})
