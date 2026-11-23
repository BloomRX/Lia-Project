import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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

test('imports the legacy ZIP manifest and card without extracting avatar or instructions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-card-zip-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = await readFile(new URL('./fixtures/personality.ccv3.zip', import.meta.url))
  const store = createStagePersona(root)
  const { id } = await store.import(bytes)
  assert.deepEqual(await readdir(root), [`${id}.json`])
  assert.deepEqual(await store.read(id), { name: 'Cartão de teste', prompt: 'Tom da personalidade de teste' })
  await assert.rejects(store.import(new Uint8Array([0, 1, 2])))
})
