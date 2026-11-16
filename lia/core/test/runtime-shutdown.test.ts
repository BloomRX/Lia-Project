import assert from 'node:assert/strict'

import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { runCooperativeExit, runtimeEndpointFor, startRuntimeControlServer, stopRuntimeCooperatively } from '@lia/contracts/runtime'

let stateDir = ''

before(async () => {
  stateDir = await mkdtemp(join(tmpdir(), 'lia-shutdown-'))
})
after(async () => {
  await rm(stateDir, { force: true, recursive: true })
})

describe('encerramento cooperativo — lado do Runtime', () => {
  it('roda os hooks em ordem e só então pede a saída', async () => {
    const order: string[] = []
    const report = await runCooperativeExit({
      forceExit: () => order.push('force'),
      hooks: [
        { name: 'audio', run: () => order.push('audio') },
        { name: 'logs', run: () => order.push('logs') },
      ],
      requestExit: () => order.push('quit'),
      timeoutMs: 1_000,
    })
    assert.deepEqual(order, ['audio', 'logs', 'quit'])
    assert.equal(report.timedOut, false)
    assert.deepEqual(report.steps.map(step => step.outcome), ['ok', 'ok', 'ok'])
  })

  it('um hook que falha não impede os seguintes', async () => {
    const ran: string[] = []
    const report = await runCooperativeExit({
      forceExit: () => {},
      hooks: [
        { name: 'broken', run: () => { throw new Error('boom') } },
        { name: 'after', run: () => ran.push('after') },
      ],
      requestExit: () => ran.push('quit'),
      timeoutMs: 1_000,
    })
    assert.deepEqual(ran, ['after', 'quit'])
    assert.equal(report.steps[0]?.outcome, 'failed')
    assert.equal(report.steps[0]?.error, 'Error')
  })

  it('força a saída quando o pedido cooperativo não termina no prazo', async () => {
    const forced: number[] = []
    const report = await runCooperativeExit({
      forceExit: code => forced.push(code),
      requestExit: () => new Promise(() => {}),
      timeoutMs: 100,
    })
    assert.deepEqual(forced, [1])
    assert.equal(report.timedOut, true)
    assert.equal(report.forced, true)
  })
})

describe('encerramento cooperativo — lado do Launcher', () => {
  async function startRuntime(options: { onShutdownRequested?: () => void } = {}) {
    const instanceId = globalThis.crypto.randomUUID()
    const server = await startRuntimeControlServer({
      endpoint: runtimeEndpointFor(process.platform, stateDir, instanceId),
      handle: async () => ({ ok: true }),
      instanceId,
      ...(options.onShutdownRequested ? { onShutdownRequested: options.onShutdownRequested } : {}),
    })
    return { instanceId, server, target: { endpoint: server.endpoint, instanceId, publicKey: server.publicKey } }
  }

  it('pede, espera a saída e reporta parado sem forçar', async () => {
    let closed = false
    const runtime = await startRuntime({
      onShutdownRequested: () => {
        closed = true
      },
    })
    try {
      const result = await stopRuntimeCooperatively({
        pollMs: 20,
        target: runtime.target,
        timeoutMs: 3_000,
        // O runtime "sai" fechando o canal, que é o que o Launcher observa.
        forceKill: async () => {},
      })
      // O servidor continua de pé neste teste: o runtime não morreu de fato.
      assert.equal(closed, true)
      assert.equal(result.acknowledged, true)
      assert.equal(result.stopped, false)
    }
    finally {
      await runtime.server.close()
    }
  })

  it('observa a saída real e reporta parado', async () => {
    const runtime = await startRuntime({
      onShutdownRequested: () => {
        void runtime.server.close()
      },
    })
    const result = await stopRuntimeCooperatively({ pollMs: 20, target: runtime.target, timeoutMs: 3_000 })
    assert.equal(result.acknowledged, true)
    assert.equal(result.stopped, true)
    assert.equal(result.forced, false)
  })

  it('força só depois do prazo e prova a saída', async () => {
    const runtime = await startRuntime()
    let forced = false
    try {
      const result = await stopRuntimeCooperatively({
        forceKill: async () => {
          forced = true
          await runtime.server.close()
        },
        pollMs: 20,
        target: runtime.target,
        timeoutMs: 150,
      })
      assert.equal(forced, true)
      assert.equal(result.forced, true)
      assert.equal(result.stopped, true)
    }
    finally {
      await runtime.server.close().catch(() => {})
    }
  })

  it('runtime já morto não é "parado por nós"', async () => {
    const instanceId = globalThis.crypto.randomUUID()
    const result = await stopRuntimeCooperatively({
      pollMs: 20,
      target: { endpoint: runtimeEndpointFor(process.platform, stateDir, instanceId), instanceId, publicKey: Buffer.alloc(32).toString('base64') },
      timeoutMs: 200,
    })
    assert.deepEqual(result, { acknowledged: false, forced: false, stopped: true, waitedMs: 0 })
  })
})
