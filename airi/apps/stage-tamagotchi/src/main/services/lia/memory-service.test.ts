import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaMemoryStore } from './memory-service'

vi.mock('electron', () => ({ app: { getPath: () => '/unused' } }))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})
let root: string
let filePath: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lia-memory-'))
  filePath = join(root, 'lia-memory.json')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('main private memory document', () => {
  it('defaults OFF, persists across reopening, edits, removes and clears without touching history', async () => {
    const history = join(root, 'chat-history.json')
    await writeFile(history, 'unrelated history')
    const store = createLiaMemoryStore({ filePath })
    expect(await store.get()).toEqual({ ok: true, value: { schemaVersion: 1, enabled: false, entries: [] } })
    const saved = await store.mutate({ action: 'save', text: 'Gosto de jogos de estratégia' })
    if (!saved.ok)
      throw new Error('save failed')
    const id = saved.value.entries[0].id
    expect(await store.recall('jogos')).toEqual({ ok: true, value: '' })
    await store.mutate({ action: 'enable', enabled: true })
    const reopened = createLiaMemoryStore({ filePath })
    expect((await reopened.recall('jogos'))).toMatchObject({ ok: true, value: expect.stringContaining('estratégia') })
    await reopened.mutate({ action: 'save', id, text: 'Gosto de jogos espaciais' })
    expect(await reopened.recall('estratégia')).toEqual({ ok: true, value: '' })
    await reopened.mutate({ action: 'enable', enabled: false })
    expect(await store.recall('jogos')).toEqual({ ok: true, value: '' })
    expect(await reopened.mutate({ action: 'remove', id })).toMatchObject({ ok: true, value: { entries: [] } })
    await reopened.mutate({ action: 'save', text: 'Gosto de café' })
    expect(await reopened.mutate({ action: 'clear', confirmed: true })).toMatchObject({ ok: true, value: { entries: [] } })
    expect((await createLiaMemoryStore({ filePath }).get())).toMatchObject({ ok: true, value: { entries: [] } })
    expect(await readFile(history, 'utf8')).toBe('unrelated history')
  })
  it('serializes concurrent mutations without losing entries', async () => {
    const store = createLiaMemoryStore({ filePath })
    const otherWindow = createLiaMemoryStore({ filePath })
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? store : otherWindow).mutate({ action: 'save', text: `Lembrança ${index}` })))
    expect(results.every(result => result.ok)).toBe(true)
    const result = await store.get()
    expect(result.ok && result.value.entries.length).toBe(20)
  })
  it('rejects malformed inputs, unknown ids, excessive sizes and unconfirmed wipe', async () => {
    const store = createLiaMemoryStore({ filePath })
    for (const request of [null, {}, { action: 'save', text: '' }, { action: 'save', text: 'a'.repeat(501) }, { action: 'save', text: 'secret\0' }, { action: 'save', id: '../../outside', text: 'x' }, { action: 'enable', enabled: 'yes' }, { action: 'clear', confirmed: false }]) {
      // Boundary receives untrusted JS regardless of TypeScript annotation.
      // @ts-expect-error deliberate hostile IPC input
      expect(await store.mutate(request)).toEqual({ ok: false, code: 'invalid' })
    }
    expect(await store.mutate({ action: 'remove', id: '00000000-0000-4000-8000-000000000000' })).toEqual({ ok: false, code: 'missing' })
    expect(await store.recall('a'.repeat(4001))).toEqual({ ok: false, code: 'invalid' })
  })
  it('does not overwrite corrupt or unsupported stored data', async () => {
    for (const raw of ['{ corrupt', '{"schemaVersion":2,"enabled":true,"entries":[]}', JSON.stringify({ schemaVersion: 1, enabled: true, entries: [{ id: '../../x', text: 'x', updatedAt: '' }] })]) {
      await writeFile(filePath, raw)
      const store = createLiaMemoryStore({ filePath })
      expect(await store.get()).toEqual({ ok: false, code: 'unavailable' })
      expect(await store.mutate({ action: 'enable', enabled: true })).toEqual({ ok: false, code: 'unavailable' })
      expect(await readFile(filePath, 'utf8')).toBe(raw)
    }
  })
  it('keeps existing document after atomic rename failure and recovers its queue', async () => {
    const store = createLiaMemoryStore({ filePath })
    await store.mutate({ action: 'save', text: 'Original' })
    const before = await readFile(filePath, 'utf8')
    vi.mocked(rename).mockRejectedValueOnce(new Error('simulated rename failure'))
    expect(await store.mutate({ action: 'save', text: 'New' })).toEqual({ ok: false, code: 'unavailable' })
    expect(await readFile(filePath, 'utf8')).toBe(before)
    expect(await store.mutate({ action: 'save', text: 'Next' })).toMatchObject({ ok: true })
  })
  it('enforces the entry count and persisted schema limits', async () => {
    await writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      entries: Array.from({ length: 100 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, text: 'Stored', updatedAt: new Date().toISOString() })),
    }))
    const store = createLiaMemoryStore({ filePath })
    expect(await store.mutate({ action: 'save', text: 'One too many' })).toEqual({ ok: false, code: 'limit' })
    const raw = await readFile(filePath, 'utf8')
    const malformed = JSON.parse(raw)
    malformed.entries[1].id = malformed.entries[0].id
    await writeFile(filePath, JSON.stringify(malformed))
    expect(await store.get()).toEqual({ ok: false, code: 'unavailable' })
  })
})
