/**
 * Contrato de host — fronteira entre a Lia e o runtime de desktop.
 *
 * A decisão de arquitetura de 12/11/2026 (`docs/reports/
 * LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`) manteve Electron como host
 * nesta fase, mas condicionou essa escolha a uma fronteira explícita: o Core
 * não pergunta "qual runtime?", pergunta "qual capacidade?".
 *
 * Este módulo é o vocabulário dessa pergunta. Ele é DADO e VALIDAÇÃO PURA:
 * nenhuma dependência de Electron, de janela ou de processo. Os hosts
 * (Electron hoje, outro amanhã) declaram o que sabem fazer; o Core decide o
 * que é possível com o que foi declarado, e recusa com um motivo legível em
 * vez de falhar em runtime.
 *
 * O que este contrato NÃO faz (e não deve fingir que faz):
 *  - não valida o payload de cada comando (isso pertence ao handler do host,
 *    que conhece a operação; aqui só o envelope é garantido);
 *  - não transporta segredo: nenhum comando carrega valor de credencial, e o
 *    vault continua sendo do Main;
 *  - não escolhe host. Ele descreve e compara capacidades.
 */

import { negotiate } from '../protocol.ts'

/** Versão do contrato de host. MAJOR incompatível é recusado por `negotiate`. */
export const HOST_CONTRACT_VERSION = '1.0.0'

/**
 * Capacidades que um host pode declarar. Lista fechada: um host que inventa
 * uma capacidade não a torna disponível - `isHostCapability` a recusa.
 */
export const HOST_CAPABILITIES = [
  'windows',
  'tray',
  'audio',
  'screen',
  'power',
  'shortcuts',
  'notifications',
  'tools',
] as const

export type LiaHostCapability = typeof HOST_CAPABILITIES[number]

/** Identidade de implementação. `headless` existe para testes e para o Core em CI. */
export type LiaHostKind = 'electron' | 'headless' | 'native' | 'tauri' | 'unknown'

export const HOST_KINDS: readonly LiaHostKind[] = ['electron', 'headless', 'native', 'tauri', 'unknown']

export interface LiaHostDescriptor {
  /** Nome estável da implementação, para diagnóstico. Nunca um caminho. */
  id: string
  kind: LiaHostKind
  /** Versão do próprio host (não do contrato). */
  version: string
  capabilities: readonly LiaHostCapability[]
}

/** Uma necessidade declarada por um recurso do produto, com o porquê. */
export interface LiaHostRequirement {
  capability: LiaHostCapability
  /** Texto curto para diagnóstico. Nunca inclui segredo nem caminho do usuário. */
  reason: string
}

export type LiaHostCompatibility
  = | { ok: true }
    | { ok: false, missing: readonly LiaHostCapability[], reason: string }

/**
 * Lista fechada de comandos que o Core pode pedir a um host. Todo comando é
 * declarativo e de escopo pequeno: nenhum deles executa comando arbitrário.
 */
export const HOST_COMMANDS = [
  'window.show',
  'window.hide',
  'presence.set-budget',
  'stage.spawn',
  'stage.stop',
  'audio.list-devices',
  'tool.execute',
] as const

export type LiaHostCommandType = typeof HOST_COMMANDS[number]

export interface LiaHostCommand<P = unknown> {
  contract: string
  type: LiaHostCommandType
  id: string
  payload?: P
}

export type LiaHostParseResult<P = unknown>
  = | { ok: true, command: LiaHostCommand<P> }
    | { ok: false, reason: string }

export function isHostCapability(value: unknown): value is LiaHostCapability {
  return typeof value === 'string' && (HOST_CAPABILITIES as readonly string[]).includes(value)
}

export function isHostCommandType(value: unknown): value is LiaHostCommandType {
  return typeof value === 'string' && (HOST_COMMANDS as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Capacidades ausentes para um conjunto de requisitos, em ordem estável e sem
 * duplicatas. Host sem requisitos é compatível por definição.
 */
export function missingCapabilities(
  descriptor: Pick<LiaHostDescriptor, 'capabilities'>,
  requirements: readonly LiaHostRequirement[],
): LiaHostCapability[] {
  const declared = new Set(descriptor.capabilities)
  const missing: LiaHostCapability[] = []
  for (const requirement of requirements) {
    if (!declared.has(requirement.capability) && !missing.includes(requirement.capability))
      missing.push(requirement.capability)
  }
  return missing
}

/**
 * Compatibilidade explícita. A recusa carrega o MOTIVO do requisito mais
 * próximo da primeira capacidade ausente - "faltou `screen` porque a presença
 * acompanha monitores" é acionável; "host incompatível" não é.
 */
export function hostSatisfies(
  descriptor: Pick<LiaHostDescriptor, 'capabilities'>,
  requirements: readonly LiaHostRequirement[],
): LiaHostCompatibility {
  const missing = missingCapabilities(descriptor, requirements)
  if (missing.length === 0)
    return { ok: true }
  const first = requirements.find(requirement => requirement.capability === missing[0])
  return {
    ok: false,
    missing,
    reason: `host sem capacidade '${missing[0]}'${first ? ` (${first.reason})` : ''}`,
  }
}

/**
 * Valida o descritor que o host apresenta no handshake. Recusa sem lançar:
 * um host com descritor inválido é um problema reportável, não um crash.
 */
export function parseHostDescriptor(value: unknown): { ok: true, descriptor: LiaHostDescriptor } | { ok: false, reason: string } {
  if (!isRecord(value))
    return { ok: false, reason: 'descritor ausente' }
  if (Object.keys(value).some(key => !['id', 'kind', 'version', 'capabilities'].includes(key)))
    return { ok: false, reason: 'campo desconhecido no descritor' }
  if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 64 || !/^[\w.:-]+$/.test(value.id))
    return { ok: false, reason: 'id de host inválido' }
  if (!HOST_KINDS.includes(value.kind as LiaHostKind))
    return { ok: false, reason: 'kind de host desconhecido' }
  if (typeof value.version !== 'string' || value.version.length < 1 || value.version.length > 32)
    return { ok: false, reason: 'versão de host inválida' }
  if (!Array.isArray(value.capabilities) || value.capabilities.length > HOST_CAPABILITIES.length)
    return { ok: false, reason: 'capacidades inválidas' }
  if (!value.capabilities.every(isHostCapability))
    return { ok: false, reason: 'capacidade desconhecida' }
  if (new Set(value.capabilities).size !== value.capabilities.length)
    return { ok: false, reason: 'capacidade repetida' }

  return {
    ok: true,
    descriptor: {
      id: value.id,
      kind: value.kind as LiaHostKind,
      version: value.version,
      capabilities: [...value.capabilities] as LiaHostCapability[],
    },
  }
}

/**
 * Valida o envelope de um comando. Mesmo idioma do protocolo Launcher↔Stage:
 * mensagem malformada NÃO derruba quem recebe; ela vira uma recusa tipada.
 *
 * O `payload` é opaco de propósito - cada handler valida o seu, com o schema
 * da própria operação. Este nível garante: versão compatível, tipo conhecido,
 * `id` estável e ausência de campos extras no envelope.
 */
export function parseHostCommand<P = unknown>(value: unknown, localContract: string = HOST_CONTRACT_VERSION): LiaHostParseResult<P> {
  if (!isRecord(value))
    return { ok: false, reason: 'comando ausente' }
  if (Object.keys(value).some(key => !['contract', 'type', 'id', 'payload'].includes(key)))
    return { ok: false, reason: 'campo desconhecido no comando' }
  if (typeof value.contract !== 'string')
    return { ok: false, reason: 'contrato ausente' }
  const negotiated = negotiate(value.contract, localContract)
  if (!negotiated.ok)
    return { ok: false, reason: negotiated.reason ?? 'contrato incompatível' }
  if (!isHostCommandType(value.type))
    return { ok: false, reason: 'tipo de comando desconhecido' }
  if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 128 || !/^[\x21-\x7E]+$/.test(value.id))
    return { ok: false, reason: 'id de comando inválido' }

  return {
    ok: true,
    command: {
      contract: value.contract,
      type: value.type,
      id: value.id,
      ...(Object.hasOwn(value, 'payload') ? { payload: value.payload as P } : {}),
    },
  }
}
