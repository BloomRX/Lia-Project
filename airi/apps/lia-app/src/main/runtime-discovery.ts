import type { RuntimeControlTarget } from '@lia/contracts/runtime'
import type { RuntimeInstanceRecord } from '@lia/contracts/runtime'

import { join } from 'node:path'

import { pingRuntime } from '@lia/contracts/runtime'
import { describeInstance } from '@lia/contracts/runtime'
import { createRuntimeRegistry } from '@lia/contracts/runtime'

/**
 * Reencontrar o Runtime depois de fechar e reabrir o Launcher.
 *
 * A descoberta tem três respostas, e a diferença entre elas é o ponto todo:
 *
 *  - `live`: o registro existe E o canal respondeu com a identidade publicada.
 *  - `none`: não há registro (ou ele é ilegível). Não existe Runtime.
 *  - `stale`: há registro, mas ninguém autenticou no endpoint. Pode ser um
 *    crash, um reboot ou um PID reciclado. **Não** é "provavelmente vivo" —
 *    é um resíduo, e o Launcher trata como ausente e limpa.
 *
 * Nunca consultamos a tabela de processos para decidir: um PID vivo não prova
 * que o Runtime é nosso, e um PID morto não prova que ele não é (um processo
 * pode ter sido reiniciado com outro PID enquanto o registro é válido).
 */

export interface RuntimeDiscoveryLive {
  record: RuntimeInstanceRecord
  status: 'live'
  target: RuntimeControlTarget
}

export type RuntimeDiscovery
  = | RuntimeDiscoveryLive
    | { status: 'none' }
    | { record?: RuntimeInstanceRecord, problem: string, status: 'stale' }

export interface DiscoverOptions {
  timeoutMs?: number
  /** Injeção para teste: substitui o pulso real. */
  ping?: (target: RuntimeControlTarget, timeoutMs: number) => Promise<unknown>
}

export function runtimeStateDirFor(userDataDir: string): string {
  return join(userDataDir, 'runtime')
}

export function targetFor(record: RuntimeInstanceRecord): RuntimeControlTarget {
  return { endpoint: record.endpoint, instanceId: record.instanceId, publicKey: record.publicKey }
}

export async function discoverRuntime(stateDir: string, options: DiscoverOptions = {}): Promise<RuntimeDiscovery> {
  const registry = createRuntimeRegistry(stateDir)
  const read = await registry.read()
  if (!read.ok)
    return { status: 'none' }

  const record = read.record
  // O endpoint tem de ser o canônico DESTA instalação. Um registro apontando
  // para outro lugar é descartado sem tentativa de conexão.
  const expected = stateDir
  const endpointOk = record.endpoint.includes(record.instanceId)
    && (record.endpoint.startsWith('\\\\.\\pipe\\lia-runtime-') || record.endpoint.startsWith(expected.replace(/[\\/]+$/, '')))
  if (!endpointOk)
    return { problem: 'endpoint-fora-do-estado', record, status: 'stale' }

  const ping = options.ping ?? (async (target: RuntimeControlTarget, timeoutMs: number) => await pingRuntime(target, timeoutMs))
  try {
    const pong = await ping(targetFor(record), options.timeoutMs ?? 1_500) as { instanceId?: string }
    if (pong?.instanceId !== record.instanceId)
      return { problem: 'identidade-divergente', record, status: 'stale' }
    return { record, status: 'live', target: targetFor(record) }
  }
  catch {
    return { problem: 'sem-resposta', record, status: 'stale' }
  }
}

/** Linha de diagnóstico: nunca inclui segredo nem caminho de usuário. */
export function describeDiscovery(discovery: RuntimeDiscovery): string {
  if (discovery.status === 'live')
    return `live ${describeInstance(discovery.record)}`
  if (discovery.status === 'none')
    return 'none'
  return `stale problem=${discovery.problem}${discovery.record ? ` ${describeInstance(discovery.record)}` : ''}`
}
