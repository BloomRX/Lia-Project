/**
 * Política de escrita da seleção de chat (AF-1, 12/11/2026).
 *
 * O produto tem UM campo canônico para "qual provider conversa":
 * `provider.chat.preferred`. Depois do PROMPT-39, o Launcher passou a ser a
 * autoridade declarada desse campo — mas o Stage continuou escrevendo nele por
 * `electronLiaProviderChatConfigSet`, criando dois escritores.
 *
 * Esta função decide, sem I/O e sem Electron, se uma escrita vinda do Stage
 * pode ser aplicada. Ela é a única regra; o bridge apenas a chama e traduz o
 * resultado. Manter a decisão fora do handler é o que permite testá-la em
 * qualquer runner e revisá-la sem abrir uma janela.
 *
 * Regras, em ordem:
 *
 *  1. `incoming` ausente = o usuário está LIMPANDO a seleção. Permitido: é uma
 *     ação explícita e reversível, e é a válvula de saída para quem quer trocar
 *     de provedor sem passar pelo Launcher.
 *  2. Nada persistido = primeira escolha. Permitido: não há estado a proteger.
 *  3. Mesmo alvo = reescrita idêntica (onboarding, toggle de fallback). Permitido.
 *  4. Provider gerenciado pelo Launcher (catálogo `ready`) em qualquer lado =
 *     recusado. O Launcher escreve pelo próprio serviço, que não passa por aqui.
 *  5. Valor lido diferente do valor atual = escrita obsoleta. Recusado, para
 *     que uma tela aberta há minutos não desfaça uma escolha mais recente.
 *
 * Nada aqui converte provedor. Um id desconhecido continua desconhecido: ele é
 * apenas "não gerenciado", e segue as regras 1–3 e 5 como sempre.
 */

import { findLiaAiProviderByStageProviderId } from '../../../../../../lia/core/src/providers/catalog'

export interface LiaSelectionTarget {
  providerId: string
  modelId?: string
}

export type LiaSelectionWriteCode = 'selection-owned-by-launcher' | 'stale-selection'

export type LiaSelectionWriteDecision = { ok: true } | { ok: false, code: LiaSelectionWriteCode }

/**
 * Um provider é gerenciado quando o catálogo do Launcher o declara `ready` e o
 * liga a um provider de execução do Stage. Hoje isso é exatamente `groq`.
 *
 * A consulta é estática de propósito: depender de ler `lia-transports.json`
 * faria a proteção desaparecer quando o arquivo estivesse ilegível, que é
 * justamente quando uma escrita concorrente é mais perigosa.
 */
export function isLauncherManagedProvider(providerId: string): boolean {
  const definition = findLiaAiProviderByStageProviderId(providerId)
  return definition?.availability === 'ready'
}

function sameTarget(left: LiaSelectionTarget | undefined, right: LiaSelectionTarget | undefined): boolean {
  if (!left || !right)
    return left === right
  return left.providerId === right.providerId && (left.modelId ?? '') === (right.modelId ?? '')
}

export interface LiaSelectionWriteInput {
  /** O que está persistido agora, lido imediatamente antes da escrita. */
  persisted?: LiaSelectionTarget
  /** O que o chamador quer gravar. Ausente = limpar a seleção. */
  incoming?: LiaSelectionTarget
  /** O que o chamador leu quando montou a tela. Ausente = chamador antigo. */
  expected?: LiaSelectionTarget | null
  /** Injetável para teste; padrão é o catálogo real. */
  managed?: (providerId: string) => boolean
}

export function decideSelectionWrite(input: LiaSelectionWriteInput): LiaSelectionWriteDecision {
  const { persisted, incoming } = input
  const managed = input.managed ?? isLauncherManagedProvider

  // 1. Limpar é sempre uma ação explícita do usuário.
  if (!incoming)
    return { ok: true }

  // 2. Primeira escolha: não existe estado anterior a proteger.
  if (!persisted)
    return { ok: true }

  // 3. Reescrita idêntica não disputa autoridade com ninguém.
  if (sameTarget(incoming, persisted))
    return { ok: true }

  // 4. Provider gerenciado: só o Launcher muda a seleção.
  if (managed(incoming.providerId) || managed(persisted.providerId))
    return { ok: false, code: 'selection-owned-by-launcher' }

  // 5. Escrita obsoleta: o chamador confirmou o que leu, e o mundo mudou.
  if (input.expected !== undefined && !sameTarget(input.expected ?? undefined, persisted))
    return { ok: false, code: 'stale-selection' }

  return { ok: true }
}
