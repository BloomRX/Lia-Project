/**
 * Registro de instância do Runtime.
 *
 * O Runtime (o Stage) é um processo independente do Launcher. Para que o
 * Launcher consiga reencontrá-lo depois de fechar e reabrir, o Runtime publica
 * um registro com a própria identidade. Este módulo é DADO E VALIDAÇÃO PURA:
 * não toca disco, não abre socket, não conhece Electron.
 *
 * Regra central: **PID não é identidade**. O PID é um indício para diagnóstico
 * e para decidir se vale a pena tentar conectar; a identidade é o
 * `instanceId`, provado pelo handshake com a chave pública publicada aqui. Um
 * registro cujo PID "parece vivo" pode pertencer a outro processo depois de
 * um reboot ou de uma reciclagem de PID — e é exatamente por isso que a
 * descoberta termina numa conexão autenticada, nunca numa checagem de PID.
 */

/** Versão do contrato do registro. Registro de versão desconhecida é recusado. */
export const RUNTIME_RECORD_VERSION = 1

/** Prefixo do named pipe no Windows. Um endpoint fora do prefixo é recusado. */
export const RUNTIME_PIPE_PREFIX = '\\\\.\\pipe\\lia-runtime-'

/** Prefixo do nome do socket Unix (o diretório é o do estado do runtime). */
export const RUNTIME_SOCKET_PREFIX = 'lia-runtime-'

/** Como a instância nasceu. Diagnóstico, nunca autorização. */
export type RuntimeStartedBy = 'launcher' | 'user'

export interface RuntimeInstanceRecord {
  version: typeof RUNTIME_RECORD_VERSION
  /** UUID v4 estável durante toda a vida do processo. */
  instanceId: string
  /** UUID v4 novo a cada inicialização (detecta reaproveitamento de arquivo). */
  bootId: string
  pid: number
  /** Epoch ms da criação. */
  createdAt: number
  /** Named pipe (Windows) ou socket Unix (POSIX) em que o controle atende. */
  endpoint: string
  /** Chave pública X25519 crua, 32 bytes, base64. */
  publicKey: string
  startedBy: RuntimeStartedBy
  /** Versão do produto, só para diagnóstico. */
  appVersion: string
}

export type RuntimeRecordProblem =
  | 'not-an-object'
  | 'version'
  | 'instance-id'
  | 'boot-id'
  | 'pid'
  | 'created-at'
  | 'endpoint'
  | 'public-key'
  | 'started-by'
  | 'app-version'

export type RuntimeRecordParse
  = | { ok: true, record: RuntimeInstanceRecord }
    | { ok: false, reason: RuntimeRecordProblem }

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const base64Key = /^[\w+/]{43}=$/

/**
 * Endereço canônico de uma instância.
 *
 * O caminho deriva SEMPRE do diretório de estado e do `instanceId`, nunca de
 * texto vindo de arquivo: um registro não pode apontar o Launcher para um
 * socket arbitrário. Quem lê valida com `endpointBelongsTo`; quem escreve
 * constrói por aqui.
 */
export function runtimeEndpointFor(platform: NodeJS.Platform, stateDir: string, instanceId: string): string {
  if (platform === 'win32')
    return `${RUNTIME_PIPE_PREFIX}${instanceId}`
  return `${stateDir.replace(/[\\/]+$/, '')}/${RUNTIME_SOCKET_PREFIX}${instanceId}.sock`
}

/**
 * Verdadeiro quando `endpoint` é exatamente o endereço canônico de
 * `instanceId` no diretório de estado dado.
 *
 * Comparação por igualdade, não por prefixo: aceitar um prefixo deixaria
 * `.../runtime-x.sock/../../etc` passar como "sob o diretório".
 */
export function endpointBelongsTo(endpoint: string, platform: NodeJS.Platform, stateDir: string, instanceId: string): boolean {
  return endpoint === runtimeEndpointFor(platform, stateDir, instanceId)
}

/** Validação estrita. Qualquer campo a mais ou a menos reprova o registro. */
export function parseRuntimeRecord(value: unknown): RuntimeRecordParse {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { ok: false, reason: 'not-an-object' }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const expected = [
    'appVersion',
    'bootId',
    'createdAt',
    'endpoint',
    'instanceId',
    'pid',
    'publicKey',
    'startedBy',
    'version',
  ]
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]))
    return { ok: false, reason: 'not-an-object' }
  if (record.version !== RUNTIME_RECORD_VERSION)
    return { ok: false, reason: 'version' }
  if (typeof record.instanceId !== 'string' || !uuidV4.test(record.instanceId))
    return { ok: false, reason: 'instance-id' }
  if (typeof record.bootId !== 'string' || !uuidV4.test(record.bootId))
    return { ok: false, reason: 'boot-id' }
  if (!Number.isInteger(record.pid) || (record.pid as number) <= 0)
    return { ok: false, reason: 'pid' }
  if (!Number.isFinite(record.createdAt) || (record.createdAt as number) <= 0)
    return { ok: false, reason: 'created-at' }
  if (typeof record.endpoint !== 'string' || record.endpoint.length === 0 || record.endpoint.length > 512)
    return { ok: false, reason: 'endpoint' }
  if (typeof record.publicKey !== 'string' || !base64Key.test(record.publicKey))
    return { ok: false, reason: 'public-key' }
  if (record.startedBy !== 'launcher' && record.startedBy !== 'user')
    return { ok: false, reason: 'started-by' }
  if (typeof record.appVersion !== 'string' || record.appVersion.length === 0 || record.appVersion.length > 64)
    return { ok: false, reason: 'app-version' }
  return { ok: true, record: record as unknown as RuntimeInstanceRecord }
}

/**
 * Fábrica de registro. Existe para que os dois lados (teste e produto) usem a
 * mesma forma, e para deixar explícito que `bootId` é sempre novo.
 */
export function createRuntimeRecord(input: {
  instanceId: string
  pid: number
  endpoint: string
  publicKey: string
  startedBy: RuntimeStartedBy
  appVersion: string
  createdAt?: number
  bootId?: string
}): RuntimeInstanceRecord {
  return {
    appVersion: input.appVersion,
    bootId: input.bootId ?? globalThis.crypto.randomUUID(),
    createdAt: input.createdAt ?? Date.now(),
    endpoint: input.endpoint,
    instanceId: input.instanceId,
    pid: input.pid,
    publicKey: input.publicKey,
    startedBy: input.startedBy,
    version: RUNTIME_RECORD_VERSION,
  }
}

/**
 * Diagnóstico legível de uma instância, para log. Nunca inclui caminho de
 * usuário além do que o próprio registro já publica, e nunca segredo.
 */
export function describeInstance(record: RuntimeInstanceRecord): string {
  return `instance=${record.instanceId.slice(0, 8)} pid=${record.pid} startedBy=${record.startedBy} since=${new Date(record.createdAt).toISOString()}`
}
