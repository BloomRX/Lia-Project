import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function readChatSource(): string {
  return readFileSync(resolve(__dirname, './chat.ts'), 'utf-8')
}

describe('chat retry stable source target (Phase 8.0D-10B-4D4C4-D2B6 corrective)', () => {
  it('ChatRetryPayload has optional sourceMessageId, correlationId, reasoning, routeOverride', async () => {
    const src = readChatSource()
    expect(src).toMatch(/export interface ChatRetryPayload/)
    expect(src).toMatch(/sourceMessageId\?: string/)
    expect(src).not.toMatch(/messageId\?: string/)
    expect(src).toMatch(/correlationId\?: string/)
    expect(src).toMatch(/reasoning\?: boolean/)
    expect(src).toMatch(/routeOverride\?: ChatSendRouteOverride/)
  })

  it('retry resolves sourceMessageId to CURRENT user index and fails safely without fallback to stale index', async () => {
    const src = readChatSource()
    expect(src).toMatch(/if \(payload\.sourceMessageId !== undefined\)/)
    expect(src).toMatch(/\.id === payload\.sourceMessageId/)
    expect(src).toMatch(/message\.role === 'user'/)
    expect(src).toMatch(/findIndex/)
    expect(src).toMatch(/throw new Error\('Retry target has no retriable source message: stale sourceMessageId'\)/)
    // ensure no fallback to payload.index when sourceMessageId present
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).not.toMatch(/payload\.sourceMessageId !== undefined.*\?.*payload\.index.*:.*payload\.index/s)
  })

  it('forwards correlationId, reasoning, routeOverride when supplied and preserves absence', async () => {
    const src = readChatSource()
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).toMatch(/\.\.\.\(payload\.correlationId === undefined \? \{\} : \{ correlationId: payload\.correlationId \}\)/)
    expect(retryBlock).toMatch(/\.\.\.\(payload\.reasoning === undefined \? \{\} : \{ reasoning: payload\.reasoning \}\)/)
    expect(retryBlock).toMatch(/\.\.\.\(payload\.routeOverride === undefined \? \{\} : \{ routeOverride: payload\.routeOverride \}\)/)
  })

  it('uses retrySourceIndexFrom only for legacy index path, not after sourceMessageId', async () => {
    const src = readChatSource()
    expect(src).toMatch(/import \{ retrySourceIndexFrom \} from '\.\/chat\/retry-source'/)
    // sourceMessageId branch sets sourceIndex = found directly
    expect(src).toMatch(/sourceIndex = found/)
    // legacy branch uses helper
    expect(src).toMatch(/retrySourceIndexFrom\(currentMessages, payload\.index\)/)
  })

  it('legacy index-only behavior preserved when sourceMessageId absent', async () => {
    const src = readChatSource()
    const retryBlock = src.slice(src.indexOf('async function retry'))
    expect(retryBlock).toMatch(/else \{/)
    expect(retryBlock).toMatch(/retrySourceIndexFrom\(currentMessages, payload\.index\)/)
  })
})
