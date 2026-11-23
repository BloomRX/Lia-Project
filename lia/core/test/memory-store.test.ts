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
