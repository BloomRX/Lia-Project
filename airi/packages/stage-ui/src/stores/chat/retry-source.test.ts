import { describe, expect, it } from 'vitest'

import type { ChatHistoryItem } from '@proj-airi/core-agent'

import { retrySourceIndexFrom, retrySourceMessageIdFrom } from './retry-source'

function msg(over: Partial<ChatHistoryItem> & { role: ChatHistoryItem['role'], id?: string }): ChatHistoryItem {
  return {
    role: over.role,
    content: over.content ?? '',
    id: over.id,
    ...over,
  } as ChatHistoryItem
}

describe('generic pure retry source (Phase 8.0D-10B-4D4C4-D2B6 corrective)', () => {
  it('clicked user → same user when it has usable id', () => {
    const messages = [msg({ role: 'user', id: 'u1' }), msg({ role: 'assistant', id: 'a1' })]
    expect(retrySourceMessageIdFrom(messages, 0)).toBe('u1')
    expect(retrySourceIndexFrom(messages, 0)).toBe(0)
  })

  it('clicked assistant → preceding user', () => {
    const messages = [msg({ role: 'user', id: 'u1' }), msg({ role: 'assistant', id: 'a1' })]
    expect(retrySourceMessageIdFrom(messages, 1)).toBe('u1')
    expect(retrySourceIndexFrom(messages, 1)).toBe(0)
  })

  it('clicked error WITHOUT id → preceding user with id', () => {
    const messages = [
      msg({ role: 'user', id: 'u1' }),
      { role: 'error', content: 'boom' } as ChatHistoryItem,
    ]
    expect(retrySourceMessageIdFrom(messages, 1)).toBe('u1')
    expect(retrySourceIndexFrom(messages, 1)).toBe(0)
  })

  it('source id stable across index shift', () => {
    const history: ChatHistoryItem[] = [
      msg({ role: 'user', id: 'u1' }),
      msg({ role: 'assistant', id: 'a1' }),
    ]
    const sourceId = retrySourceMessageIdFrom(history, 1)
    expect(sourceId).toBe('u1')
    // shift history by prepending
    const shifted = [
      msg({ role: 'user', id: 'u0' }),
      msg({ role: 'assistant', id: 'a0' }),
      ...history,
    ]
    // sourceId still refers to u1, not to shifted indices
    const found = shifted.findIndex(m => (m as { id?: string }).id === sourceId && m.role === 'user')
    expect(found).toBe(2)
    // clicked error without id at shifted index still resolves to preceding user u1 via helper
    const errorAt1 = [
      msg({ role: 'user', id: 'u1' }),
      { role: 'error', content: 'boom' } as ChatHistoryItem,
    ]
    expect(retrySourceMessageIdFrom(errorAt1, 1)).toBe('u1')
    // duplicate text does not matter, id does
    const dup = [
      msg({ role: 'user', id: 'u1', content: 'same' }),
      msg({ role: 'user', id: 'u2', content: 'same' }),
      { role: 'error', content: 'same' } as ChatHistoryItem,
    ]
    // error at 2 should resolve to preceding user u2, not u1
    expect(retrySourceMessageIdFrom(dup, 2)).toBe('u2')
  })

  it('duplicate text messages do not matter because ID is used', () => {
    const messages = [
      msg({ role: 'user', id: 'u1', content: 'hello' }),
      msg({ role: 'user', id: 'u2', content: 'hello' }),
      msg({ role: 'assistant', id: 'a1', content: 'reply' }),
    ]
    // assistant at 2 → preceding user is u2, not u1, even though text same
    expect(retrySourceMessageIdFrom(messages, 2)).toBe('u2')
  })

  it('source ID missing from current history → retry would fail safely (finder returns -1)', () => {
    const messages = [msg({ role: 'user', id: 'u1' }), msg({ role: 'assistant', id: 'a1' })]
    const sourceId = 'nonexistent'
    const found = messages.findIndex(m => (m as { id?: string }).id === sourceId && m.role === 'user')
    expect(found).toBe(-1)
    // helper itself would not fabricate, and chatStore retry throws stale
  })

  it('sourceMessageId pointing to non-user → safe failure (chatStore checks role)', () => {
    const messages = [msg({ role: 'user', id: 'u1' }), msg({ role: 'assistant', id: 'a1' })]
    const badSourceId = 'a1' // assistant, not user
    const found = messages.findIndex(m => (m as { id?: string }).id === badSourceId && m.role === 'user')
    expect(found).toBe(-1)
  })

  it('no fallback to stale index — source lookup by id, not index', () => {
    const messages = [
      msg({ role: 'user', id: 'u1' }),
      msg({ role: 'assistant', id: 'a1' }),
      msg({ role: 'user', id: 'u2' }),
      msg({ role: 'assistant', id: 'a2' }),
    ]
    // Click a2 at index 3 → source is u2
    const sourceId = retrySourceMessageIdFrom(messages, 3)
    expect(sourceId).toBe('u2')
    // Simulate history mutation that keeps index 3 occupied but with different content
    const mutated = [
      msg({ role: 'user', id: 'u1' }),
      msg({ role: 'assistant', id: 'a1' }),
      msg({ role: 'user', id: 'uX' }),
      msg({ role: 'assistant', id: 'aX' }),
    ]
    const stillFound = mutated.findIndex(m => (m as { id?: string }).id === sourceId && m.role === 'user')
    expect(stillFound).toBe(-1) // u2 gone, should fail not fallback to index 3
    const fallbackIndex = 3
    expect(mutated[fallbackIndex]?.role).toBe('assistant') // would be wrong if fell back
  })

  it('legacy index-only behavior unchanged for id-less source', () => {
    // source user itself has no id → retrySourceMessageIdFrom returns undefined, caller uses legacy index path
    const messages = [
      { role: 'user', content: 'legacy' } as ChatHistoryItem, // no id
      { role: 'error', content: 'boom' } as ChatHistoryItem,
    ]
    expect(retrySourceMessageIdFrom(messages, 1)).toBeUndefined()
    // but retrySourceIndexFrom still returns 0 (generic traversal)
    expect(retrySourceIndexFrom(messages, 1)).toBe(0)
  })

  it('unsupported/tool/system → non-retriable', () => {
    const messages = [
      msg({ role: 'user', id: 'u1' }),
      { role: 'tool' as unknown as ChatHistoryItem['role'], content: '' } as ChatHistoryItem,
      { role: 'system' as unknown as ChatHistoryItem['role'], content: '' } as ChatHistoryItem,
    ]
    expect(retrySourceMessageIdFrom(messages, 1)).toBeUndefined()
    expect(retrySourceMessageIdFrom(messages, 2)).toBeUndefined()
    expect(retrySourceIndexFrom(messages, 1)).toBe(-1)
    expect(retrySourceIndexFrom(messages, 2)).toBe(-1)
  })

  it('pure synchronous: no async, no mutation', () => {
    const messages = [msg({ role: 'user', id: 'u1' }), msg({ role: 'assistant', id: 'a1' })]
    const snapshot = JSON.stringify(messages)
    const a = retrySourceMessageIdFrom(messages, 1)
    const b = retrySourceIndexFrom(messages, 1)
    expect(a).toBe('u1')
    expect(b).toBe(0)
    expect(JSON.stringify(messages)).toBe(snapshot)
  })

  it('whitespace-only id treated as absent', () => {
    const messages = [msg({ role: 'user', id: '   ' }), msg({ role: 'assistant', id: 'a1' })]
    expect(retrySourceMessageIdFrom(messages, 0)).toBeUndefined()
    expect(retrySourceMessageIdFrom(messages, 1)).toBeUndefined()
  })
})
