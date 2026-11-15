/**
 * Protocolo Launcher <-> Core <-> Stage.
 *
 * Regra central: uma mensagem malformada **nao derruba quem recebe**. Num
 * processo que fala com janela, derrubar por causa de um payload estranho
 * transformaria um bug de rede num fechamento inexplicado — e fechamento
 * inexplicado foi exatamente o tipo de defeito caro nesta base.
 *
 * Os contratos e os niveis estao em docs/architecture/LIA-STAGE-ARCHITECTURE.md §4.
 */

export const PROTOCOL_VERSION = '1.0.0'

/** Lista fechada. Tipo fora dela e recusado. */
export const CONTROL_TYPES = [
  'health.ping',
  'health.pong',
  'stage.stop',
  'stage.stopped',
  'chat.send',
  'chat.delta',
  'chat.done',
  'chat.error',
  'error',
] as const

export type ControlType = typeof CONTROL_TYPES[number]

export interface Envelope<P = unknown> {
  protocol: string
  type: ControlType
  id: string
  from: string
  payload?: P
}

export interface NegotiationResult {
  ok: boolean
  version: string
  reason?: string
}

/**
 * Extrai o MAJOR, exigindo que a versao inteira seja numerica pontuada.
 *
 * Validar so o primeiro segmento aceitaria `1.x.0` — e aceitar uma versao
 * malformada esconde o bug de quem a produziu. Versao estranha e recusada.
 */
function major(version: string): string | null {
  if (!/^\d+(\.\d+)*$/.test(version))
    return null
  return version.split('.')[0] ?? null
}

/**
 * Compara apenas o MAJOR. `1.4.0` e `1.9.3` falam; `2.0.0` nao.
 * Minor e patch sao compativeis por definicao neste contrato.
 */
export function negotiate(remote: string, local: string = PROTOCOL_VERSION): NegotiationResult {
  const remoteMajor = major(remote)
  const localMajor = major(local)

  if (remoteMajor === null)
    return { ok: false, version: local, reason: `versao remota invalida: "${remote}"` }

  if (localMajor === null)
    return { ok: false, version: local, reason: `versao local invalida: "${local}"` }

  if (remoteMajor !== localMajor) {
    return {
      ok: false,
      version: local,
      reason: `major incompativel: remoto ${remoteMajor}, local ${localMajor}`,
    }
  }

  return { ok: true, version: local }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Converte entrada externa em envelope, ou `null`. **Nunca lanca** — inclusive
 * com entrada que nem e objeto, `null`, array ou JSON quebrado em string.
 */
export function parseEnvelope(input: unknown): Envelope | null {
  let value: unknown = input

  // Aceita string JSON por conveniencia; string invalida vira null, nao excecao.
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    }
    catch {
      return null
    }
  }

  if (!isRecord(value))
    return null

  const { protocol, type, id, from, payload } = value

  if (typeof protocol !== 'string' || !negotiate(protocol).ok)
    return null

  if (typeof type !== 'string' || !(CONTROL_TYPES as readonly string[]).includes(type))
    return null

  if (typeof id !== 'string' || id === '')
    return null

  if (typeof from !== 'string' || from === '')
    return null

  const envelope: Envelope = { protocol, type: type as ControlType, id, from }
  if (payload !== undefined)
    envelope.payload = payload
  return envelope
}

/** Monta um envelope valido para envio. */
export function makeEnvelope<P = unknown>(
  type: ControlType,
  from: string,
  payload?: P,
  id: string = `${from}-${type}`,
  protocol: string = PROTOCOL_VERSION,
): Envelope<P> {
  const envelope: Envelope<P> = { protocol, type, id, from }
  if (payload !== undefined)
    envelope.payload = payload
  return envelope
}
