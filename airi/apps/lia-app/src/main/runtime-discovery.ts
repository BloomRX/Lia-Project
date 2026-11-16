import type { RuntimeControlTarget, RuntimeInstanceRecord } from '@lia/contracts/runtime'

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'

import { createRuntimeRegistry, describeInstance, pingRuntime, stopRuntimeCooperatively } from '@lia/contracts/runtime'

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

/**
 * Parada de um Runtime DESCOBERTO — inclusive um que este Launcher não criou.
 *
 * Este é o caso que o gerenciador de filho não resolve: depois de fechar e
 * reabrir, o Launcher não tem `ChildProcess` nenhum, mas tem o registro. Sem
 * este caminho, "Parar Runtime" numa janela reaberta não pararia nada.
 *
 * A força é o último recurso e re-verifica a identidade imediatamente antes de
 * matar: o PID pode ter sido reciclado entre a descoberta e o kill, e matar o
 * PID errado seria pior que não parar.
 */
export async function stopDiscoveredRuntime(
  stateDir: string,
  options: { timeoutMs?: number, pollMs?: number, platform?: NodeJS.Platform } = {},
): Promise<{ acknowledged: boolean, forced: boolean, stopped: boolean, waitedMs: number }> {
  const discovery = await discoverRuntime(stateDir)
  if (discovery.status !== 'live')
    return { acknowledged: false, forced: false, stopped: true, waitedMs: 0 }

  const expectedInstance = discovery.record.instanceId
  return await stopRuntimeCooperatively({
    pollMs: options.pollMs,
    target: discovery.target,
    timeoutMs: options.timeoutMs,
    forceKill: async () => {
      const again = await discoverRuntime(stateDir)
      if (again.status !== 'live' || again.record.instanceId !== expectedInstance)
        return
      const pid = again.record.pid
      // Nunca matar o próprio processo: um registro corrompido apontando para
      // o Launcher não pode transformar "parar o Runtime" em "fechar à força".
      if (pid === process.pid)
        return
      const platform = options.platform ?? process.platform
      if (platform === 'win32') {
        await new Promise<void>((resolve) => {
          execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 30_000 }, () => resolve())
        })
        return
      }
      try {
        process.kill(pid, 'SIGKILL')
      }
      catch { /* já morreu */ }
    },
  })
}
