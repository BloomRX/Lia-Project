import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStagePersona, maxPersonaImportBytes } from '../src/main/stage-persona.ts'

test('CCv3 import keeps only the reviewed text fields and reopens by content identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-card-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createStagePersona(root)
  const input = JSON.stringify({
    spec: 'chara_card_v3', spec_version: '3.0',
    data: { name: 'Lia teste', description: 'Descrição', personality: 'Estilo', scenario: 'Palco', system_prompt: 'sentinela', extensions: { origin: 'sentinela' } },
  })
  const first = await store.import(input)
  assert.deepEqual(await store.import(input), first)
  assert.equal(first.name, 'Lia teste')
  assert.deepEqual(await createStagePersona(root).read(first.id), { name: 'Lia teste', prompt: 'Descrição\n\nEstilo\n\nPalco' })
  assert.doesNotMatch(await readFile(join(root, `${first.id}.json`), 'utf8'), /sentinela/)
  assert.equal(await store.read('../invalid'), undefined)
  await assert.rejects(store.import('{}'))
  await assert.rejects(store.import('a'.repeat(maxPersonaImportBytes + 1)))
})
