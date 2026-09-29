import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function readChatSource(): string {
  return readFileSync(resolve(__dirname, './chat.ts'), 'utf-8')
}

describe('chat retry stable target (Phase 8.0D-10B-4D4C4-D2B6)', () => {
  it('ChatRetryPayload has optional messageId, correlationId, reasoning, routeOverride', async () => {
    const src = readChatSource()
    expect(src).toMatch(/export interface ChatRetryPayload/)
    expect(src).toMatch(/messageId\?: string/)
    expect(src).toMatch(/correlationId\?: string/)
    expect(src).toMatch(/reasoning\?: boolean/)
    expect(src).toMatch(/routeOverride\?: ChatSendRouteOverride/)
  })

  it('retry resolves messageId to current index and fails safely without fallback to stale index', async () => {
    const src = readChatSource()
    expect(src).toMatch(/if \(payload\.messageId !== undefined\)/)
    expect(src).toMatch(/findIndex\(message => .*\.id === payload\.messageId/)
    expect(src).toMatch(/throw new Error\('Retry target message not found/)
    expect(src).not.toMatch(/payload\.messageId !== undefined.*\?.*payload\.index.*:.*payload\.index/s) // no fallback
  })

  it('forwards correlationId, reasoning, routeOverride when supplied and preserves absence', async () => {
    const src = readChatSource()
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).toMatch(/\.\.\.\(payload\.correlationId === undefined \? \{\} : \{ correlationId: payload\.correlationId \}\)/)
    expect(retryBlock).toMatch(/\.\.\.\(payload\.reasoning === undefined \? \{\} : \{ reasoning: payload\.reasoning \}\)/)
    expect(retryBlock).toMatch(/\.\.\.\(payload\.routeOverride === undefined \? \{\} : \{ routeOverride: payload\.routeOverride \}\)/)
  })

  it('uses retrySourceIndexFrom with targetIndex, not payload.index directly after messageId', async () => {
    const src = readChatSource()
    expect(src).toMatch(/let targetIndex = payload\.index/)
    expect(src).toMatch(/targetIndex = found/)
    expect(src).toMatch(/retrySourceIndexFrom\(currentMessages, targetIndex\)/)
  })
})
