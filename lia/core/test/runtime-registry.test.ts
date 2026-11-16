import type { RuntimeInstanceRecord } from '../src/runtime/instance.ts'

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createRuntimeRecord, endpointBelongsTo, parseRuntimeRecord, runtimeEndpointFor } from '../src/runtime/instance.ts'
import { createRuntimeRegistry } from '../src/runtime/registry.ts'

const STATE = join(tmpdir(), `lia-registry-test-${process.pid}`)
let tempRoot = STATE

function sample(overrides: Partial<RuntimeInstanceRecord> = {}): RuntimeInstanceRecord {
  const instanceId = overrides.instanceId ?? globalThis.crypto.randomUUID()
  return createRuntimeRecord({
    appVersion: '0.1.0',
    endpoint: runtimeEndpointFor('linux', tempRoot, instanceId),
    instanceId,
    pid: 4321,
    publicKey: Buffer.alloc(32, 7).toString('base64'),
    startedBy: 'launcher',
    ...overrides,
  })
}

describe('registro de instância', () => {
  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'lia-registry-'))
  })
  after(async () => {
    await rm(tempRoot, { force: true, recursive: true })
  })

  it('aceita o registro canônico', () => {
    const record = sample()
    const parsed = parseRuntimeRecord(record)
    assert.equal(parsed.ok, true)
  })

  it('recusa versão desconhecida', () => {
    const parsed = parseRuntimeRecord({ ...sample(), version: 2 })
    assert.equal(parsed.ok, false)
    assert.equal(parsed.ok === false ? parsed.reason : '', 'version')
  })

  it('recusa campo extra — contrato fechado', () => {
    const parsed = parseRuntimeRecord({ ...sample(), extra: true })
    assert.equal(parsed.ok, false)
  })

  it('recusa PID que não é inteiro positivo', () => {
    for (const pid of [0, -1, 1.5, '12', null]) {
      const parsed = parseRuntimeRecord({ ...sample(), pid })
      assert.equal(parsed.ok, false, `pid=${String(pid)}`)
    }
  })

  it('recusa instanceId que não é UUID v4', () => {
    const parsed = parseRuntimeRecord({ ...sample(), instanceId: 'not-a-uuid' })
    assert.equal(parsed.ok === false ? parsed.reason : '', 'instance-id')
  })

  it('recusa chave pública fora do formato de 32 bytes', () => {
    for (const publicKey of ['', 'abc', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64')]) {
      const parsed = parseRuntimeRecord({ ...sample(), publicKey })
      assert.equal(parsed.ok, false, publicKey)
    }
  })

  it('endpoint só pertence ao estado quando é exatamente o canônico', () => {
    const id = globalThis.crypto.randomUUID()
    const endpoint = runtimeEndpointFor('linux', tempRoot, id)
    assert.equal(endpointBelongsTo(endpoint, 'linux', tempRoot, id), true)
    assert.equal(endpointBelongsTo(endpoint, 'linux', tempRoot, globalThis.crypto.randomUUID()), false)
    assert.equal(endpointBelongsTo('/tmp/outro.sock', 'linux', tempRoot, id), false)
    assert.equal(endpointBelongsTo(`${endpoint}/../../etc/passwd`, 'linux', tempRoot, id), false)
  })

  it('usa named pipe no Windows e socket no POSIX', () => {
    const id = globalThis.crypto.randomUUID()
    assert.equal(runtimeEndpointFor('win32', 'C:\\state', id), `\\\\.\\pipe\\lia-runtime-${id}`)
    assert.match(runtimeEndpointFor('linux', '/tmp/state/', id), /\/tmp\/state\/lia-runtime-.*\.sock$/)
  })
})

describe('registro em disco', () => {
  let dir = ''

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lia-registry-disk-'))
  })
  after(async () => {
    await rm(dir, { force: true, recursive: true })
  })

  it('publica, lê e remove o próprio registro', async () => {
    const registry = createRuntimeRegistry(dir)
    const record = sample({ instanceId: globalThis.crypto.randomUUID() })
    await registry.publish(record)
    const read = await registry.read()
    assert.equal(read.ok, true)
    assert.deepEqual(read.ok ? read.record : undefined, record)
    assert.equal(await registry.remove(record.instanceId), true)
    assert.equal((await registry.read()).ok, false)
  })

  it('recusa remover registro de outra instância', async () => {
    const registry = createRuntimeRegistry(dir)
    const record = sample()
    await registry.publish(record)
    assert.equal(await registry.remove(globalThis.crypto.randomUUID()), false)
    const read = await registry.read()
    assert.equal(read.ok, true)
    await registry.remove(record.instanceId)
  })

  it('registro corrompido é um estado, não uma exceção', async () => {
    const registry = createRuntimeRegistry(dir)
    await writeFile(registry.filePath, '{ not json', 'utf8')
    const read = await registry.read()
    assert.equal(read.ok, false)
    assert.equal(read.ok === false ? read.problem : '', 'invalid')
  })

  it('escrita atômica não deixa temporário para trás', async () => {
    const registry = createRuntimeRegistry(dir)
    await registry.publish(sample())
    const { readdir } = await import('node:fs/promises')
    const entries = await readdir(dir)
    assert.equal(entries.filter(name => name.endsWith('.tmp')).length, 0)
    assert.equal(entries.includes('runtime.json'), true)
    const raw = await readFile(registry.filePath, 'utf8')
    assert.match(raw, /"instanceId"/)
    if (process.platform !== 'win32')
      assert.equal((await stat(registry.filePath)).mode & 0o777, 0o600)
  })
})
