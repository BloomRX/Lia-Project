import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStageHistory } from '../src/main/stage-history.ts'

test('removing one saved message keeps its partner visible and excludes the incomplete turn from context', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-stage-history-remove-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'history.json')
  const route = 'a'.repeat(64)
  const history = createStageHistory(path)
  await history.setEnabled(true)
  await history.append({ route, user: 'Pergunta A', assistant: 'Resposta A', reusable: true })
  const original = await history.get()
  const other = await history.changeConversation('create')
  assert.ok(other)
  await history.setEnabled(true)
  await history.append({ route, user: 'Pergunta B', assistant: 'Resposta B', reusable: true })
  assert.equal(await history.removeMessage(original.activeId, original.revision, 0, 'user'), undefined)

  const returned = await history.changeConversation('select', original.activeId)
  assert.ok(returned)
  const removed = await history.removeMessage(returned.activeId, returned.revision, 0, 'user')
  assert.ok(removed)
  assert.deepEqual(removed.turns, [{ user: '', assistant: 'Resposta A' }])
  assert.notEqual(removed.revision, returned.revision)
  assert.equal(await history.removeMessage(returned.activeId, returned.revision, 0, 'assistant'), undefined)
  const reopened = createStageHistory(path)
  assert.deepEqual(await reopened.recall(route), [])
  assert.deepEqual((await reopened.get()).turns, removed.turns)
  assert.deepEqual((await reopened.changeConversation('select', other.activeId))?.turns,
    [{ user: 'Pergunta B', assistant: 'Resposta B' }])
})

test('history is opt-in, bounded, route-scoped and clearable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-stage-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'lia-chat-history.json')
  const route = 'a'.repeat(64)
  const turn = { route, user: 'Oi', assistant: 'Olá', reusable: true }
  const history = createStageHistory(path)
  await history.append(turn)
  assert.equal((await history.get()).enabled, false)
  assert.deepEqual((await history.get()).turns, [])
  await history.setEnabled(true)
  await history.append(turn)
  await history.append({ ...turn, reusable: false, assistant: 'Com nota pessoal' })
  const reopened = createStageHistory(path)
  assert.equal((await reopened.get()).turns.length, 2)
  assert.deepEqual(await reopened.recall(route), [{ user: 'Oi', assistant: 'Olá' }])
  assert.deepEqual(await reopened.recall('b'.repeat(64)), [])
  for (let i = 0; i < 25; i++)
    await reopened.append({ ...turn, user: String(i) })
  assert.equal((await reopened.get()).turns.length, 24)
  assert.equal((await reopened.get()).turns[0]?.user, '1')
  await reopened.clear()
  assert.equal((await reopened.get()).enabled, true)
  assert.deepEqual((await reopened.get()).turns, [])
  await reopened.append(turn)
  await reopened.setEnabled(false)
  assert.equal((await history.get()).enabled, false)
  assert.deepEqual((await history.get()).turns, [])
})

test('migrates existing history and keeps transcript, opt-in and model context separate', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-stage-conversations-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'lia-chat-history.json')
  const turn = { route: 'a'.repeat(64), user: 'Primeira conversa', assistant: 'Olá', reusable: true }
  await writeFile(path, JSON.stringify({ version: 1, enabled: true, turns: [turn] }))
  const history = createStageHistory(path)
  const first = await history.get()
  const second = await history.changeConversation('create')
  assert.ok(second)
  assert.equal(second.enabled, false)
  assert.deepEqual(await history.recall(turn.route), [])
  await history.append({ ...turn, user: 'Sem autorização para guardar' })
  assert.deepEqual((await history.get()).turns, [])
  assert.equal(await history.changeConversation('select', '../foreign'), undefined)
  assert.equal((await createStageHistory(path).get()).activeId, second.activeId)
  const restored = await history.changeConversation('select', first.activeId)
  assert.deepEqual(restored?.turns, first.turns)
  assert.equal(restored?.enabled, true)
  assert.deepEqual(await history.recall(turn.route), first.turns)
  const deleted = await history.changeConversation('delete')
  assert.equal(deleted?.activeId, second.activeId)
  assert.equal(await history.changeConversation('select', first.activeId), undefined)
  for (let i = 1; i < 12; i++)
    assert.ok(await history.changeConversation('create'))
  assert.equal(await history.changeConversation('create'), undefined)
})

test('legacy imports preserve current turns and never become model context', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-stage-history-import-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const history = createStageHistory(join(root, 'lia-chat-history.json'))
  const imported = { user: 'Pergunta anterior', assistant: 'Resposta anterior' }
  const payload = JSON.stringify({
    format: 'chat-sessions-index:v1',
    sessions: {
      obsolete: { meta: { updatedAt: 1 }, messages: [] },
      recent: {
        meta: { updatedAt: 2 },
        messages: [
          { role: 'system', content: 'Private configuration' },
          { role: 'user', content: imported.user },
          { role: 'assistant', content: imported.assistant },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }] },
          { role: 'assistant', content: 'Image reply' },
        ],
      },
    },
  })
  assert.deepEqual(await history.importLegacy(payload), [])
  await history.setEnabled(true)
  const recent = { user: 'Agora', assistant: 'Resposta atual' }
  const route = 'b'.repeat(64)
  await history.append({ ...recent, reusable: true, route })
  assert.deepEqual(await history.importLegacy(payload), [imported])
  assert.deepEqual(await history.importLegacy(payload), [])
  assert.deepEqual((await history.get()).turns, [imported, recent])
  assert.deepEqual(await history.recall(route), [recent])
  await assert.rejects(history.importLegacy('{}'))
})
