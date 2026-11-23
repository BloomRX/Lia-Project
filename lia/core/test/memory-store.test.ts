import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
