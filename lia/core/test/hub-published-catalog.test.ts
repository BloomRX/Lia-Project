import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readPublishedHubCatalog } from '../src/hub/published-catalog.ts'

test('reads the Hub published active catalog and returns only display metadata', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'lia-hub-catalog-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  assert.deepEqual(await readPublishedHubCatalog(home), { status: 'missing' })
  const root = join(home, 'AgentHub override')
  const folder = join(root, 'Comum', 'Capacidades')
  await mkdir(folder, { recursive: true })
  const active = { id: 'capability-smoke', name: 'Capacidade teste', type: 'agent-skill', lifecycle: 'active', description: 'untrusted prose', package: 'path not exposed' }
  await writeFile(join(folder, 'index.json'), JSON.stringify({
    schemaVersion: 1, scope: 'active', capabilities: [active, active, { ...active, id: 'quarantined', lifecycle: 'quarantined' }],
  }))
  assert.deepEqual(await readPublishedHubCatalog(home, root), {
    status: 'ready',
    capabilities: [{ id: active.id, name: active.name, type: active.type }],
  })
  await writeFile(join(folder, 'index.json'), JSON.stringify({ schemaVersion: 2, scope: 'active', capabilities: [] }))
  assert.deepEqual(await readPublishedHubCatalog(home, root), { status: 'unavailable' })
})
