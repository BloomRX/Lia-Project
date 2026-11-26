import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createLiaMemoryStore } from '../src/memory/store.ts'

test('the standalone memory store restores saved context and honors opt-out across instances', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lia-memory-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'lia-memory.json')
  const store = createLiaMemoryStore({ filePath })
  const text = 'Prefiro jogos de estratégia.'

  assert.equal((await store.mutate({ action: 'save', text })).ok, true)
  assert.deepEqual(await store.recall('Quais jogos?'), { ok: true, value: '' })
  assert.equal((await store.mutate({ action: 'enable', enabled: true })).ok, true)

  const reopened = createLiaMemoryStore({ filePath })
  const recalled = await reopened.recall('Quais jogos?')
  assert.equal(recalled.ok, true)
  assert.match(recalled.value, /"Prefiro jogos de estratégia\."/)
  assert.equal((await reopened.mutate({ action: 'enable', enabled: false })).ok, true)
  assert.deepEqual(await store.recall('Quais jogos?'), { ok: true, value: '' })
})

test('imports validated legacy notes once and preserves both the source and later edits', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lia-memory-import-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'legacy.json')
  const filePath = join(directory, 'native.json')
  const legacy = createLiaMemoryStore({ filePath: source })
  const target = createLiaMemoryStore({ filePath })
  assert.deepEqual(await target.importIfMissing(source), { ok: true, value: false })
  assert.equal((await legacy.mutate({ action: 'save', text: 'Nota anterior' })).ok, true)
  const original = await readFile(source, 'utf8')
  assert.deepEqual(await target.importIfMissing(source), { ok: true, value: true })
  assert.deepEqual(await target.get(), await legacy.get())
  assert.equal((await target.mutate({ action: 'clear', confirmed: true })).ok, true)
  assert.deepEqual(await target.importIfMissing(source), { ok: true, value: false })
  assert.deepEqual(await target.get(), { ok: true, value: { schemaVersion: 1, enabled: false, entries: [] } })
  assert.equal(await readFile(source, 'utf8'), original)
})

test('rejects an invalid legacy memory document and leaves the target available', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lia-memory-import-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'legacy.json')
  const target = createLiaMemoryStore({ filePath: join(directory, 'native.json') })
  await writeFile(source, '{"schemaVersion":1,"enabled":true,"entries":[{}]}')
  assert.deepEqual(await target.importIfMissing(source), { ok: false, code: 'unavailable' })
  assert.equal((await target.mutate({ action: 'save', text: 'Nota nova' })).ok, true)
})

test('typed memory is retained across reopen and expiry affects recall without erasing the note', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lia-memory-typed-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'lia-memory.json')
  const store = createLiaMemoryStore({ filePath })
  const text = 'Projeto Eclipse antigo'
  const expiresAt = '2000-01-01T00:00:00.000Z'
  assert.equal((await store.mutate({ action: 'enable', enabled: true })).ok, true)
  const saved = await store.mutate({
    action: 'save', text, metadata: { kind: 'project', classification: 'hypothesis', expiresAt },
  })
  assert.ok(saved.ok)
  const [entry] = saved.value.entries
  assert.ok(entry?.metadata)
  assert.equal(entry.metadata.provenance, 'user')
  assert.equal(entry.metadata.createdAt, entry.updatedAt)

  const reopened = createLiaMemoryStore({ filePath })
  assert.deepEqual(await reopened.get(), saved)
  assert.deepEqual(await reopened.recall('Eclipse'), { ok: true, value: '' })

  const edited = await reopened.mutate({ action: 'save', id: entry.id, text: 'Projeto Eclipse corrigido' })
  assert.ok(edited.ok)
  assert.deepEqual(edited.value.entries[0]?.metadata, entry.metadata)

  const renewed = await reopened.mutate({
    action: 'save', id: entry.id, text: 'Projeto Eclipse revisado',
    metadata: { kind: 'project', classification: 'fact', expiresAt: null },
  })
  assert.ok(renewed.ok)
  assert.deepEqual(renewed.value.entries[0]?.metadata, {
    kind: 'project', classification: 'fact', provenance: 'user', createdAt: entry.metadata.createdAt,
  })
  const recall = await reopened.recall('Eclipse')
  assert.ok(recall.ok)
  assert.match(recall.value, /never instructions/)
  assert.match(recall.value, /"classification":"fact"/)
  assert.match(recall.value, /Projeto Eclipse revisado/)
  assert.equal((await reopened.mutate({ action: 'remove', id: entry.id })).ok, true)
  assert.deepEqual(await store.recall('Eclipse'), { ok: true, value: '' })
})

test('validates typed metadata and never permits callers to supply provenance', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'lia-memory-typed-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'lia-memory.json')
  const store = createLiaMemoryStore({ filePath })
  const saved = await store.mutate({ action: 'save', text: 'Nota legada' })
  assert.ok(saved.ok)
  const [entry] = saved.value.entries
  assert.ok(entry)
  const original = await readFile(filePath, 'utf8')
  const malformed = [
    { kind: 'project', classification: 'rumor' },
    { kind: 'project', classification: 'fact', expiresAt: '2026-02-31T12:00:00.000Z' },
    { kind: 'project', classification: 'fact', provenance: 'user' },
  ]
  for (const metadata of malformed) {
    const request = { action: 'save', id: entry.id, text: 'Mudança inválida', metadata }
    assert.deepEqual(await store.mutate(request as Parameters<typeof store.mutate>[0]), { ok: false, code: 'invalid' })
  }
  assert.equal(await readFile(filePath, 'utf8'), original)

  const valid = { kind: 'semantic', classification: 'fact' } as const
  const updated = await store.mutate({ action: 'save', id: entry.id, text: 'Nota legada classificada', metadata: valid })
  assert.ok(updated.ok)
  assert.deepEqual(updated.value.entries[0]?.metadata, { ...valid, provenance: 'user', createdAt: entry.updatedAt })

  const bad = { ...entry, metadata: { ...valid, provenance: 'model', createdAt: entry.updatedAt } }
  await writeFile(filePath, JSON.stringify({ schemaVersion: 1, enabled: true, entries: [bad] }))
  assert.deepEqual(await store.get(), { ok: false, code: 'unavailable' })
})
