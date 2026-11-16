import type { RuntimeControlServer } from '@lia/contracts/runtime'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createRuntimeRecord, createRuntimeRegistry, runtimeEndpointFor, startRuntimeControlServer } from '@lia/contracts/runtime'
import { discoverRuntime, stopDiscoveredRuntime } from './runtime-discovery'

/**
 * O caso que motivou estes testes: depois de fechar e reabrir, o Launcher não
 * tem mais um `ChildProcess` — só o registro. "Parar Runtime" precisa funcionar
 * por DESCOBERTA, senão a janela reaberta mostra um Runtime que ela não
 * consegue controlar.
 */

let stateDir = ''

beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'lia-discovery-'))
})

afterAll(async () => {
  await rm(stateDir, { force: true, recursive: true })
})

async function startRuntime(): Promise<{ server: RuntimeControlServer, instanceId: string }> {
  const instanceId = globalThis.crypto.randomUUID()
  const server = await startRuntimeControlServer({
    endpoint: runtimeEndpointFor(process.platform, stateDir, instanceId),
    handle: async (request) => request.command === 'runtime.ping'
      ? { instanceId, pid: process.pid, uptimeMs: 1 }
      : { ok: true },
    instanceId,
    // Um Runtime de verdade remove o registro e fecha o canal ao sair: é o
    // que faz a descoberta enxergar "parado".
    onShutdownRequested: async () => {
      await createRuntimeRegistry(stateDir).remove(instanceId)
      await server.close()
    },
  })
  const registry = createRuntimeRegistry(stateDir)
  await registry.publish(createRuntimeRecord({
    appVersion: '0.0.0-test',
    endpoint: server.endpoint,
    instanceId,
    pid: process.pid,
    publicKey: server.publicKey,
    startedBy: 'launcher',
  }))
  return { instanceId, server }
}

describe('descoberta do Runtime', () => {
  it('sem registro, não há Runtime', async () => {
    const discovery = await discoverRuntime(join(stateDir, 'vazio'))
    expect(discovery.status).toBe('none')
  })

  it('registro cujo endpoint não responde é "stale", não "vivo"', async () => {
    const instanceId = globalThis.crypto.randomUUID()
    const registry = createRuntimeRegistry(join(stateDir, 'orfao'))
    await registry.publish(createRuntimeRecord({
      appVersion: '0.0.0-ghost',
      endpoint: runtimeEndpointFor(process.platform, join(stateDir, 'orfao'), instanceId),
      instanceId,
      pid: 999_999,
      publicKey: Buffer.alloc(32, 1).toString('base64'),
      startedBy: 'user',
    }))
    const discovery = await discoverRuntime(join(stateDir, 'orfao'))
    expect(discovery.status).toBe('stale')
  })

  it('registro vivo é encontrado e mantém a identidade', async () => {
    const { server, instanceId } = await startRuntime()
    try {
      const discovery = await discoverRuntime(stateDir)
      expect(discovery.status).toBe('live')
      expect(discovery.status === 'live' ? discovery.record.instanceId : '').toBe(instanceId)
    }
    finally {
      await server.close()
    }
  })

  it('para um Runtime ADOTADO (sem filho) de forma cooperativa', async () => {
    await startRuntime()
    // Sem `ChildProcess` nenhum: a parada é por descoberta.
    const result = await stopDiscoveredRuntime(stateDir, { pollMs: 25, timeoutMs: 3_000 })
    expect(result.acknowledged).toBe(true)
    expect(result.stopped).toBe(true)
    expect(result.forced).toBe(false)
    expect((await discoverRuntime(stateDir)).status).toBe('none')
  })

  it('não inventa parada quando não há Runtime', async () => {
    const result = await stopDiscoveredRuntime(join(stateDir, 'ninguem'), { timeoutMs: 200 })
    expect(result).toEqual({ acknowledged: false, forced: false, stopped: true, waitedMs: 0 })
  })
})
