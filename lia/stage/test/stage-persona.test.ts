import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStagePersona, defaultTraits, maxPersonaImportBytes, readPackagedAvatar } from '../src/main/stage-persona.ts'

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

test('saves validated traits and renders them without personalizing the user name', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-card-traits-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createStagePersona(root)
  const current = { attributes: { ...defaultTraits.attributes, energy: 0.2 }, contextId: 'serious' }
  const selected = await store.customize(current)
  const saved = await createStagePersona(root).read(selected.id)
  assert.deepEqual(saved?.traits, current)
  assert.match(saved?.prompt ?? '', /energia 0\.2/)
  assert.match(saved?.prompt ?? '', /Contexto base: Assunto sério/)
  assert.doesNotMatch(saved?.prompt ?? '', /gentileza, curiosidade e energia são altas/)
  assert.doesNotMatch(saved?.prompt ?? '', /Dirija-se ao usuário pelo nome/)
  await assert.rejects(store.customize({ ...current, contextId: 'custom' }))
  await assert.rejects(store.customize({ ...current, attributes: { ...current.attributes, energy: Infinity } }))
  assert.deepEqual(await readdir(root), [`${selected.id}.json`])
})

test('reads only the VRM declared by the character package manifest', async () => {
  const archive = await readFile(new URL('./fixtures/personality.ccv3.zip', import.meta.url))
  const avatar = await readPackagedAvatar(archive)
  assert.ok(avatar instanceof Uint8Array)
  const bytes = Buffer.from(avatar)
  assert.equal(bytes.subarray(0, 4).toString(), 'glTF')
  assert.equal(bytes.readUInt32LE(8), bytes.length)
  await assert.rejects(readPackagedAvatar('models/body-model.vrm'))
})

test('recognizes a legacy Live2D reference without loading the resource or blocking the card text', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-card-live2d-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const archive = await readFile(new URL('./fixtures/live2d-reference.ccv3.zip', import.meta.url))
  assert.equal(await readPackagedAvatar(archive), 'live2d-unavailable')
  const store = createStagePersona(root)
  const { id } = await store.import(archive)
  assert.deepEqual(await store.read(id), { name: 'Cartão Live2D sintético', prompt: 'Personalidade independente' })
})


test('does not identify a missing Live2D model as a supported package, while the card text remains importable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-card-live2d-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const archive = await readFile(new URL('./fixtures/live2d-reference.ccv3.zip', import.meta.url))
  const entry = Buffer.from('models/body-model.zip')
  let renamed = 0
  for (let offset = archive.indexOf(entry); offset >= 0; offset = archive.indexOf(entry, offset + entry.length)) {
    const signature = offset >= 46 && archive.readUInt32LE(offset - 46) === 0x02014B50
    if (signature) {
      archive.write('models/absent-vrm.zip', offset)
      renamed++
    }
  }
  assert.equal(renamed, 1)
  await assert.rejects(readPackagedAvatar(archive), /invalid-card-avatar/)
  const store = createStagePersona(root)
  const { id } = await store.import(archive)
  assert.equal((await store.read(id))?.name, 'Cartão Live2D sintético')
})
