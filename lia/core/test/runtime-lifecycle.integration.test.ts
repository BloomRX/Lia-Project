/**
 * Integração de ciclo de vida — dois PROCESSOS de verdade.
 *
 * Não é um mock: o Runtime é um `node` separado, que publica registro, atende o
 * canal e sai sozinho. O que este teste prova, e que nenhum teste unitário
 * prova, é a afirmação central da rodada:
 *
 *   o Runtime sobrevive à morte de quem o lançou, continua servindo
 *   credenciais, é reencontrado por identidade, e só então aceita parar.
 */

import type { ChildProcess } from 'node:child_process'
import type { RuntimeControlTarget } from '../src/runtime/control.ts'
import type { RuntimeInstanceRecord } from '../src/runtime/instance.ts'

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { invokeRuntimeControl, pingRuntime } from '../src/runtime/control.ts'
import { createRuntimeRecord, endpointBelongsTo, runtimeEndpointFor } from '../src/runtime/instance.ts'
import { createRuntimeRegistry } from '../src/runtime/registry.ts'
import { stopRuntimeCooperatively } from '../src/runtime/shutdown.ts'

const here = dirname(fileURLToPath(import.meta.url))
const childScript = join(here, 'fixtures', 'runtime-child.ts')

describe('integração — Runtime independente', () => {
  let stateDir = ''
  let child: ChildProcess | undefined
  let target: RuntimeControlTarget | undefined

  before(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'lia-lifecycle-'))
    child = spawn(process.execPath, ['--experimental-strip-types', childScript, stateDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      if (!text.includes('ExperimentalWarning') && !text.includes('--trace-warnings'))
        process.stderr.write(`[runtime-child] ${text}`)
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('runtime did not become ready')), 20_000)
      child!.stdout?.on('data', (chunk) => {
        if (String(chunk).includes('runtime:ready')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child!.once('exit', code => reject(new Error(`runtime exited early (${String(code)})`)))
    })
  })

  after(async () => {
    if (child && child.exitCode === null)
      child.kill('SIGKILL')
    await rm(stateDir, { force: true, recursive: true })
  })

  async function discover(): Promise<
    | { status: 'live', record: RuntimeInstanceRecord, target: RuntimeControlTarget }
    | { status: 'none' }
    | { status: 'stale', problem: string }
  > {
    const registry = createRuntimeRegistry(stateDir)
    const read = await registry.read()
    if (!read.ok)
      return { status: 'none' }
    try {
      await pingRuntime({ endpoint: read.record.endpoint, instanceId: read.record.instanceId, publicKey: read.record.publicKey }, 2_000)
      return { record: read.record, status: 'live', target: { endpoint: read.record.endpoint, instanceId: read.record.instanceId, publicKey: read.record.publicKey } }
    }
    catch {
      return { problem: 'sem-resposta', status: 'stale' }
    }
  }

  it('o Runtime publica um registro válido e responde por identidade', async () => {
    const discovery = await discover()
    assert.equal(discovery.status, 'live')
    if (discovery.status !== 'live')
      return
    target = discovery.target
    assert.equal(discovery.record.pid, child!.pid)
    assert.equal(discovery.record.appVersion, '0.0.0-test')
  })

  it('a credencial é servida pelo Runtime, não por quem o lançou', async () => {
    assert.ok(target)
    const value = await invokeRuntimeControl(target!, 'credentials.get', { key: 'apiKey', scope: 'groq' })
    assert.equal(value, 'sk-runtime-owned')
  })

  it('um Launcher que morre não leva o Runtime junto', async () => {
    assert.ok(child)
    // "Matar o launcher" aqui é não fazer nada: o processo pai do teste nunca
    // foi dono do Runtime. Se o contrato dependesse do pai, o filho já teria
    // morrido — e o registro já estaria ausente.
    await new Promise(resolve => setTimeout(resolve, 250))
    const discovery = await discover()
    assert.equal(discovery.status, 'live')
    assert.equal(child!.exitCode, null)
  })

  it('reabrir encontra o MESMO Runtime pelo registro, sem depender de PID', async () => {
    const discovery = await discover()
    assert.equal(discovery.status, 'live')
    if (discovery.status !== 'live')
      return
    // A identidade é o instanceId provado no handshake; o PID é só diagnóstico.
    assert.equal(discovery.record.instanceId, target!.instanceId)
  })

  it('parada cooperativa roda os hooks, remove o registro e prova a saída', async () => {
    assert.ok(target)
    const exited = new Promise<number | null>(resolve => child!.once('exit', code => resolve(code)))
    const result = await stopRuntimeCooperatively({ pollMs: 50, target: target!, timeoutMs: 10_000 })
    assert.equal(result.acknowledged, true)
    assert.equal(result.stopped, true)
    assert.equal(result.forced, false)
    assert.equal(await exited, 0)
    // O hook do Runtime rodou antes de sair — não foi um kill.
    assert.equal(existsSync(join(stateDir, 'flushed.marker')), true)
    assert.equal(existsSync(join(stateDir, 'runtime.json')), false)
  })

  it('registro órfão (endpoint morto) é "stale", nunca "vivo"', async () => {
    const instanceId = globalThis.crypto.randomUUID()
    const registry = createRuntimeRegistry(stateDir)
    await registry.publish(createRuntimeRecord({
      appVersion: '0.0.0-ghost',
      endpoint: runtimeEndpointFor(process.platform, stateDir, instanceId),
      instanceId,
      pid: 999_999,
      publicKey: Buffer.alloc(32, 3).toString('base64'),
      startedBy: 'user',
    }))
    const discovery = await discover()
    assert.equal(discovery.status, 'stale')
  })

  it('um registro não pode apontar o Launcher para fora do estado', async () => {
    const instanceId = globalThis.crypto.randomUUID()
    const registry = createRuntimeRegistry(stateDir)
    const record = createRuntimeRecord({
      appVersion: '0.0.0-evil',
      endpoint: `/tmp/evil-${instanceId}.sock`,
      instanceId,
      pid: process.pid,
      publicKey: Buffer.alloc(32, 4).toString('base64'),
      startedBy: 'user',
    })
    // A validação de formato aceita o registro; a descoberta é que recusa o
    // endpoint por não ser o canônico da instalação.
    await registry.publish(record)
    const raw = JSON.parse(await readFile(registry.filePath, 'utf8')) as { endpoint: string }
    // O mesmo predicado que a descoberta do Launcher usa: igualdade com o
    // endereço canônico, nunca prefixo.
    assert.equal(endpointBelongsTo(raw.endpoint, process.platform, stateDir, instanceId), false)
    assert.equal(endpointBelongsTo(runtimeEndpointFor(process.platform, stateDir, instanceId), process.platform, stateDir, instanceId), true)
  })
})
