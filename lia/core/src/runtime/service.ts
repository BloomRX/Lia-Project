import type { RuntimeSecretStore } from './credentials.ts'
import type { RuntimeInstanceRecord } from './instance.ts'

import process from 'node:process'

import { ControlError, startRuntimeControlServer } from './control.ts'
import { createCredentialHandler } from './credentials.ts'
import { createRuntimeRecord, runtimeEndpointFor } from './instance.ts'
import { createRuntimeRegistry } from './registry.ts'
import { runCooperativeExit } from './shutdown.ts'

/**
 * O Runtime como processo independente.
 *
 * Este serviço é o que transforma o Stage em um Runtime de verdade: ele se
 * anuncia (registro), atende comandos autenticados (canal de controle), é dono
 * do cofre de credenciais e se encerra de forma cooperativa quando alguém pede.
 *
 * Antes disto, o Stage era um FILHO do Launcher: nascia quando o Launcher
 * mandava, morria quando o Launcher fechava, e as credenciais vinham do
 * processo do Launcher por um pipe que caía junto. O contrato de vida agora é
 * próprio — o Launcher é um cliente que pode ir embora.
 */

export interface LiaRuntimeServiceDeps {
  /** Diretório de estado (registro + sockets). Derivado do dado do produto. */
  stateDir: string
  appVersion: string
  startedBy: 'launcher' | 'user'
  /** Cofre opcional. Sem ele, o Runtime atende apenas comandos de ciclo de vida. */
  vault?: RuntimeSecretStore
  /** O caminho de saída que o produto já usa (`handleAppExit`). */
  requestExit: () => Promise<unknown> | unknown
  /** Último recurso, depois do prazo cooperativo. */
  forceExit: (code: number) => void
  /** Retrato para diagnóstico (janelas abertas, fase...), sem segredo. */
  status?: () => Record<string, unknown>
  log?: (line: string) => void
  platform?: NodeJS.Platform
  /** Injeção para teste. */
  instanceId?: string
  shutdownTimeoutMs?: number
}

export interface LiaRuntimeService {
  instanceId: string
  endpoint: string
  record: RuntimeInstanceRecord
  /** Fecha o canal e remove o registro — parte do encerramento normal. */
  stop: () => Promise<void>
  isServing: () => boolean
}

export type LiaRuntimeServiceStart
  = | { ok: true, service: LiaRuntimeService }
    | { ok: false, reason: 'already-running' | 'endpoint-denied' | 'failed', detail?: string }

/**
 * Sobe o Runtime e publica a identidade usada pelo cliente de controle.
 * O endpoint é exclusivo por instância. O chamador coordena a seleção
 * do processo que ocupa o diretório de estado.
 */
export async function startLiaRuntimeService(deps: LiaRuntimeServiceDeps): Promise<LiaRuntimeServiceStart> {
  const platform = deps.platform ?? process.platform
  const log = deps.log ?? (() => {})
  const instanceId = deps.instanceId ?? globalThis.crypto.randomUUID()
  const endpoint = runtimeEndpointFor(platform, deps.stateDir, instanceId)
  const registry = createRuntimeRegistry(deps.stateDir)
  const startedAt = Date.now()
  let serving = false

  const previous = await registry.read()
  if (previous.ok) {
    // Registro antigo não é prova de vida. O Launcher confirma a identidade
    // pelo canal de controle antes de adotar uma instância.
    log(`[lia:runtime] registro anterior instance=${previous.record.instanceId.slice(0, 8)} — verificando`)
  }

  const credentials = deps.vault && createCredentialHandler(deps.vault)

  // Fechar o canal pode ser pedido enquanto o `listen` ainda está voltando;
  // a referência mutável evita depender da ordem exata da inicialização.
  let stopControl: () => Promise<void> = async () => {}

  let server: Awaited<ReturnType<typeof startRuntimeControlServer>>
  try {
    server = await startRuntimeControlServer({
      endpoint,
      handle: async (request, signal) => {
        if (request.command === 'runtime.ping') {
          return {
            instanceId,
            pid: process.pid,
            startedAt,
            uptimeMs: Date.now() - startedAt,
          }
        }
        if (request.command === 'runtime.status') {
          return {
            instanceId,
            pid: process.pid,
            startedAt,
            uptimeMs: Date.now() - startedAt,
            ...deps.status?.(),
          }
        }
        if (request.command === 'runtime.shutdown') {
          // O trabalho de encerramento é agendado pelo servidor DEPOIS de a
          // resposta sair; aqui só reconhecemos o pedido.
          return { accepted: true }
        }
        if (!credentials)
          throw new ControlError('unsupported', request.command)
        return await credentials(request, signal)
      },
      instanceId,
      log,
      onShutdownRequested: () => {
        log('[lia:runtime] encerramento cooperativo solicitado')
        void runCooperativeExit({
          forceExit: deps.forceExit,
          hooks: [
            { name: 'close-control-channel', run: async () => await stopControl() },
          ],
          requestExit: deps.requestExit,
          timeoutMs: deps.shutdownTimeoutMs ?? 15_000,
          onStep: step => log(`[lia:shutdown] ${step.name}: ${step.outcome}${step.error ? ` (${step.error})` : ''} em ${step.ms}ms`),
        })
      },
    })
    serving = true
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const denied = (error as { code?: string }).code === 'denied'
    log(`[lia:runtime] canal de controle indisponível: ${detail}`)
    return { detail, ok: false, reason: denied ? 'already-running' : 'failed' }
  }

  stopControl = async () => {
    serving = false
    await server.close().catch(() => {})
    await registry.remove(instanceId).catch(() => {})
  }

  const record = createRuntimeRecord({
    appVersion: deps.appVersion,
    createdAt: startedAt,
    endpoint,
    instanceId,
    pid: process.pid,
    publicKey: server.publicKey,
    startedBy: deps.startedBy,
  })
  try {
    await registry.publish(record)
  }
  catch {
    await stopControl()
    return { ok: false, reason: 'failed' }
  }
  log(`[lia:runtime] servindo instance=${instanceId.slice(0, 8)} endpoint=${platform === 'win32' ? 'named-pipe' : 'unix-socket'}`)

  const service: LiaRuntimeService = {
    endpoint,
    instanceId,
    isServing: () => serving,
    record,
    async stop() {
      if (!serving)
        return
      await stopControl()
      log('[lia:runtime] canal fechado e registro removido')
    },
  }
  return { ok: true, service }
}

/**
 * Resolve o diretório de estado compartilhado entre Launcher e Runtime.
 *
 * `LIA_RUNTIME_STATE_DIR` é o contrato; o padrão fica ao lado do documento de
 * produto para que os dois processos cheguem ao mesmo arquivo sem combinar
 * caminho por conta própria.
 */
export function resolveRuntimeStateDir(input: {
  env?: Record<string, string | undefined>
  productConfigFile?: string
  fallback: string
}): string {
  const fromEnv = input.env?.LIA_RUNTIME_STATE_DIR?.trim()
  if (fromEnv)
    return fromEnv
  if (input.productConfigFile) {
    const separator = Math.max(input.productConfigFile.lastIndexOf('/'), input.productConfigFile.lastIndexOf('\\'))
    if (separator > 0)
      return `${input.productConfigFile.slice(0, separator)}/runtime`
  }
  return input.fallback
}
