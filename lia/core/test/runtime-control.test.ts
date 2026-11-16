import type { RuntimeControlServer } from '../src/runtime/control.ts'

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  checkControlPayload,
  ControlError,
  invokeRuntimeControl,
  pingRuntime,
  startRuntimeControlServer,
} from '../src/runtime/control.ts'

let stateDir = ''
let server: RuntimeControlServer | undefined
let instanceId = ''
const received: string[] = []
const shutdowns: string[] = []

function target() {
  assert.ok(server)
  return { endpoint: server.endpoint, instanceId, publicKey: server.publicKey }
}

before(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'lia-control-'))
  instanceId = globalThis.crypto.randomUUID()
  server = await startRuntimeControlServer({
    endpoint: join(stateDir, 'control.sock'),
    handle: async (request) => {
      received.push(request.command)
      if (request.command === 'runtime.ping')
        return { instanceId, pid: process.pid, uptimeMs: 1234 }
      if (request.command === 'runtime.status')
        return { instanceId, windows: 1 }
      return { ok: true }
    },
    instanceId,
    onShutdownRequested: () => shutdowns.push('requested'),
  })
})

after(async () => {
  await server?.close()
  await rm(stateDir, { force: true, recursive: true })
})

describe('canal de controle', () => {
  it('faz handshake autenticado e responde o pulso', async () => {
    const pong = await pingRuntime(target())
    assert.deepEqual(pong, { instanceId, pid: process.pid, uptimeMs: 1234 })
    assert.equal(received.includes('runtime.ping'), true)
  })

  it('recusa comando fora da lista fechada', async () => {
    await assert.rejects(
      invokeRuntimeControl(target(), 'system.exec' as never),
      (error: unknown) => error instanceof ControlError && error.code === 'invalid',
    )
  })

  it('recusa payload com campo desconhecido', () => {
    const check = checkControlPayload('credentials.get', { key: 'apiKey', scope: 'groq', evil: 1 })
    assert.equal(check.ok, false)
  })

  it('recusa escopo de credencial proibido', () => {
    const check = checkControlPayload('credentials.get', { key: 'apiKey', scope: 'lia:main:oidc' })
    assert.equal(check.ok, false)
  })

  it('recusa cliente que não conhece a instância', async () => {
    await assert.rejects(
      invokeRuntimeControl({ ...target(), instanceId: globalThis.crypto.randomUUID() }, 'runtime.ping'),
      (error: unknown) => error instanceof ControlError && error.code === 'denied',
    )
  })

  it('recusa servidor cuja chave não é a publicada', async () => {
    const fakeKey = Buffer.alloc(32, 9).toString('base64')
    await assert.rejects(
      invokeRuntimeControl({ ...target(), publicKey: fakeKey }, 'runtime.ping'),
      (error: unknown) => error instanceof ControlError && error.code === 'denied',
    )
  })

  it('endpoint inexistente é "unreachable", não "denied"', async () => {
    await assert.rejects(
      invokeRuntimeControl({ endpoint: join(stateDir, 'nope.sock'), instanceId, publicKey: server!.publicKey }, 'runtime.ping'),
      (error: unknown) => error instanceof ControlError && error.code === 'unreachable',
    )
  })

  it('não deixa o cliente pendurado quando o endpoint aceita e cala', async () => {
    const { createServer } = await import('node:net')
    const accepted: import('node:net').Socket[] = []
    const silent = createServer((socket) => { accepted.push(socket) })
    const endpoint = join(stateDir, 'silent.sock')
    await new Promise<void>(resolve => silent.listen(endpoint, () => resolve()))
    try {
      await assert.rejects(
        invokeRuntimeControl({ endpoint, instanceId, publicKey: server!.publicKey }, 'runtime.ping', undefined, { timeoutMs: 300 }),
        (error: unknown) => error instanceof ControlError && error.code === 'timeout',
      )
    }
    finally {
      // Sem isso o `close` espera conexões que o servidor mudo nunca encerrou.
      accepted.forEach(socket => socket.destroy())
      await new Promise<void>(resolve => silent.close(() => resolve()))
    }
  })

  it('pedido de shutdown responde e só depois sinaliza', async () => {
    const result = await invokeRuntimeControl(target(), 'runtime.shutdown', { reason: 'test' })
    assert.deepEqual(result, { ok: true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(shutdowns, ['requested'])
  })

  it('um segundo servidor no mesmo endpoint é recusado (instância única)', async () => {
    await assert.rejects(
      startRuntimeControlServer({
        endpoint: target().endpoint,
        handle: async () => null,
        instanceId: globalThis.crypto.randomUUID(),
      }),
    )
  })
})
