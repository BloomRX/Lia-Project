import type { TransportRecord, TransportResult } from '../src/transports/contracts.ts'

import assert from 'node:assert/strict'

import { mkdtemp, open, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, mock } from 'node:test'

import { createTransportRepository, isTransportRecord } from '../src/transports/repository.ts'

function record(id = 'custom/transport:1', providerId = 'compatible'): TransportRecord {
  return {
    id,
    providerId,
    definitionId: 'chat-definition',
    type: 'http',
    protocol: 'chat-completions',
    baseUrl: 'https://service.invalid/custom/v1/',
    adapterOptions: { max_tokens: 41, nested: { enabled: true }, tags: ['option'] },
    modelIds: ['custom/model:Q4'],
    enabled: true,
    metadata: { label: 'Serviço de teste' },
    credentialRef: { scope: providerId, key: 'apiKey' },
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lia-transports-test-'))
  const path = join(root, 'lia-transports.json')
  return { root, path, repository: createTransportRepository(path) }
}

function success(result: TransportResult) {
  assert.equal(result.ok, true)
  if (!result.ok)
    throw new Error('Expected successful mutation')
  return result.snapshot
}

describe('Lia transport repository', () => {
  it('creates, edits, disables, removes and reopens custom records without changing references', async () => {
    const { path, repository } = await fixture()
    assert.equal((await repository.read()).revision, 0)
    const first = success(await repository.mutate({ kind: 'put', expectedRevision: 0, record: record() }))
    assert.equal(first.revision, 1)
    const changed = { ...record(), enabled: false, baseUrl: 'http://127.0.0.1:9876/other/v1/', modelIds: ['personal/model:1'] }
    success(await repository.mutate({ kind: 'put', expectedRevision: 1, record: changed }))
    assert.deepEqual((await createTransportRepository(path).read()).records, [changed])
    const removed = success(await repository.mutate({ kind: 'remove', expectedRevision: 2, id: changed.id }))
    assert.deepEqual(removed.records, [])
    assert.deepEqual(removed.tombstones, [changed.id])
    // Credentials are only references; deletion never touches a vault or other file.
    assert.ok(!(await readFile(path, 'utf8')).includes('synthetic-private-value'))
  })

  it('keeps multiple records of one type isolated and clones returned state', async () => {
    const { repository } = await fixture()
    success(await repository.mutate({ kind: 'put', expectedRevision: 0, record: record('a') }))
    const next = success(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record('b', 'second-service') }))
    next.records[0].baseUrl = 'https://mutated.invalid/'
    next.records[1].adapterOptions.tags = []
    const reopened = await repository.read()
    assert.equal(reopened.records.length, 2)
    assert.equal(reopened.records[0].baseUrl, record().baseUrl)
    assert.deepEqual(reopened.records[1].adapterOptions.tags, ['option'])
  })

  it('serializes concurrent windows with revision conflicts and snapshots mutation input', async () => {
    const { repository } = await fixture()
    const input = record('first')
    const first = repository.mutate({ kind: 'put', expectedRevision: 0, record: input })
    input.baseUrl = 'https://mutated.invalid/'
    const results = await Promise.all([first, repository.mutate({ kind: 'put', expectedRevision: 0, record: record('second') })])
    assert.equal(results.filter(result => result.ok).length, 1)
    assert.deepEqual(results[1], { ok: false, code: 'conflict' })
    assert.equal((await repository.read()).records[0].baseUrl, record().baseUrl)
    success(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record('second') }))
    assert.equal((await repository.read()).records.length, 2)
  })

  it('migrates atomically, is repeatable and preserves newer records and tombstones', async () => {
    const { path, repository } = await fixture()
    const modern = { ...record('existing'), baseUrl: 'https://new-service.invalid/v1/' }
    success(await repository.mutate({ kind: 'put', expectedRevision: 0, record: modern }))
    success(await repository.mutate({ kind: 'remove', expectedRevision: 1, id: 'removed' }))
    const candidates = [record('existing'), record('removed'), record('legacy')]
    const migrated = success(await repository.mutate({ kind: 'migrate', expectedRevision: 2, records: candidates }))
    assert.deepEqual(migrated.records, [modern, record('legacy')])
    assert.deepEqual(migrated.migration, { version: 1, imported: ['legacy'] })
    const repeated = success(await createTransportRepository(path).mutate({ kind: 'migrate', expectedRevision: 3, records: candidates }))
    assert.deepEqual(repeated, migrated)
    // An interrupted pre-rename temp file is never promoted or read as authority.
    await writeFile(`${path}.interrupted.tmp`, '{"private":"partial"')
    assert.deepEqual(await createTransportRepository(path).read(), migrated)
  })

  it('rejects a partially invalid migration without writing a partial document', async () => {
    const { repository } = await fixture()
    const invalid = { ...record('bad'), baseUrl: 'not-a-url' }
    assert.deepEqual(await repository.mutate({ kind: 'migrate', expectedRevision: 0, records: [record('valid'), invalid] }), { ok: false, code: 'invalid' })
    assert.deepEqual((await repository.read()).records, [])
    const migrated = success(await repository.mutate({ kind: 'migrate', expectedRevision: 0, records: [record('valid')] }))
    assert.equal(migrated.revision, 1)
  })

  it('isolates malformed persisted rows and blocks writes until explicit repair', async () => {
    const { path, repository } = await fixture()
    const initial = success(await repository.mutate({ kind: 'put', expectedRevision: 0, record: record('good') }))
    const raw = JSON.stringify({ ...initial, records: [record('good'), { ...record('bad'), baseUrl: '' }, record('good'), null] })
    await writeFile(path, raw)
    assert.deepEqual((await repository.read()).records, [record('good')])
    assert.deepEqual(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record('new') }), { ok: false, code: 'invalid' })
    assert.deepEqual(await repository.mutate({ kind: 'remove', expectedRevision: 1, id: 'good' }), { ok: false, code: 'invalid' })
    assert.deepEqual(await repository.mutate({ kind: 'migrate', expectedRevision: 1, records: [record('legacy')] }), { ok: false, code: 'invalid' })
    assert.equal(await readFile(path, 'utf8'), raw)
    // Simulate explicit repair outside this API; the repository never guesses
    // which malformed data a user would want to retain or delete.
    await writeFile(path, JSON.stringify(initial))
    success(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record('new') }))
  })

  it('keeps duplicate or tombstoned source rows unchanged and prevents silent normalization', async () => {
    const { path, repository } = await fixture()
    const initial = success(await repository.mutate({ kind: 'put', expectedRevision: 0, record: record('good') }))
    for (const broken of [
      { ...initial, records: [record('good'), record('good')] },
      { ...initial, tombstones: ['good'] },
      { ...initial, tombstones: ['removed', 'removed'] },
      { ...initial, migration: { version: 1, imported: ['good', 'good'] } },
    ]) {
      const raw = JSON.stringify(broken)
      await writeFile(path, raw)
      assert.equal((await repository.read()).revision, 1)
      assert.deepEqual(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record('new') }), { ok: false, code: 'invalid' })
      assert.equal(await readFile(path, 'utf8'), raw)
    }
  })

  it('fails closed on unknown versions or corrupt documents and never heals over them', async () => {
    const { path, repository } = await fixture()
    for (const raw of ['{"schemaVersion":99}', 'not json', 'null']) {
      await writeFile(path, raw)
      await assert.rejects(repository.read(), error => error instanceof Error && error.message === 'Transport configuration unavailable' && !('cause' in error))
      assert.deepEqual(await repository.mutate({ kind: 'put', expectedRevision: 0, record: record() }), { ok: false, code: 'storage' })
      assert.equal(await readFile(path, 'utf8'), raw)
    }
  })

  it('returns safe storage failure when a parent path is not writable as a directory', async () => {
    const { root } = await fixture()
    const blocker = join(root, 'parent-is-a-file')
    await writeFile(blocker, 'preserved content')
    const repository = createTransportRepository(join(blocker, 'config.json'))
    const result = await repository.mutate({ kind: 'put', expectedRevision: 0, record: record() })
    assert.deepEqual(result, { ok: false, code: 'storage' })
    assert.equal(await readFile(blocker, 'utf8'), 'preserved content')
  })

  it('preserves the previous committed bytes and cleans its own temp file when syncing fails', async () => {
    const { root, path, repository } = await fixture()
    success(await repository.mutate({ kind: 'put', expectedRevision: 0, record: record('original') }))
    const original = await readFile(path, 'utf8')
    const handle = await open(path, 'r')
    const prototype = Object.getPrototypeOf(handle)
    await handle.close()
    const fault = mock.method(prototype, 'sync', async () => {
      throw new Error('synthetic-private-storage-error')
    })
    try {
      assert.deepEqual(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record('replacement') }), { ok: false, code: 'storage' })
      assert.equal(await readFile(path, 'utf8'), original)
      assert.deepEqual(await readdir(root), ['lia-transports.json'])
      assert.equal((await repository.read()).revision, 1)
    }
    finally {
      fault.mock.restore()
    }
    success(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record('recovered') }))
    assert.equal((await repository.read()).revision, 2)
  })

  it('rejects endpoints with credentials, query, fragment and unsafe schemes', async () => {
    const { repository } = await fixture()
    for (const baseUrl of ['https://user:private@service.invalid/v1/', 'https://service.invalid/?key=private', 'https://service.invalid/#private', 'file:///private', ' https://service.invalid/']) {
      assert.deepEqual(await repository.mutate({ kind: 'put', expectedRevision: 0, record: { ...record(), baseUrl } }), { ok: false, code: 'invalid' })
    }
    assert.equal((await repository.read()).revision, 0)
  })

  it('rejects nested secrets, headers, non-JSON values and alternate credential associations', async () => {
    const unsafeOptions = [
      { apiKey: 'synthetic-private-value' },
      { nested: { access_token: 'synthetic-private-value' } },
      { headers: { Authorization: 'synthetic-private-value' } },
      { nested: [{ password: 'synthetic-private-value' }] },
      { endpoint: 'https://user:private@service.invalid/' },
      { endpoint: 'https://service.invalid/?access_token=private' },
      { invalid: Number.POSITIVE_INFINITY },
      JSON.parse('{"__proto__":{"private":"synthetic-private-value"}}'),
    ]
    for (const adapterOptions of unsafeOptions)
      assert.equal(isTransportRecord({ ...record(), adapterOptions }), false)
    assert.equal(isTransportRecord({ ...record(), credentialRef: { scope: 'different-service', key: 'apiKey' } }), false)
    assert.equal(isTransportRecord({ ...record(), apiKey: 'private' }), false)
    assert.equal(isTransportRecord(record()), true)
  })

  it('cannot reassign stable record identity or credential ownership on edit', async () => {
    const { repository } = await fixture()
    success(await repository.mutate({ kind: 'put', expectedRevision: 0, record: record() }))
    assert.deepEqual(await repository.mutate({ kind: 'put', expectedRevision: 1, record: record(record().id, 'different') }), { ok: false, code: 'invalid' })
    assert.deepEqual(await repository.mutate({ kind: 'put', expectedRevision: 1, record: { ...record(), definitionId: 'different' } }), { ok: false, code: 'invalid' })
    assert.deepEqual((await repository.read()).records, [record()])
  })
})
