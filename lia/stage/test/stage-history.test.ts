import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStageHistory } from '../src/main/stage-history.ts'

test('history is opt-in, bounded, route-scoped and clearable', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'lia-stage-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'lia-chat-history.json')
  const route = 'a'.repeat(64)
  const turn = { route, user: 'Oi', assistant: 'Olá', reusable: true }
  const history = createStageHistory(path)
  await history.append(turn)
  assert.deepEqual(await history.get(), { enabled: false, turns: [] })
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
  assert.deepEqual(await reopened.get(), { enabled: true, turns: [] })
  await reopened.append(turn)
  await reopened.setEnabled(false)
  assert.deepEqual(await history.get(), { enabled: false, turns: [] })
})
