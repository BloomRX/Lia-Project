import type { ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { getLiaCapabilitySnapshot } from '../../../libs/capabilities/lia-capability-port'

/**
 * Phase 7.7, Parts 7-11: dynamic capability context for the persona.
 *
 * The Lia once told the user "I still don't have a real voice... you can
 * copy what I write into a TTS" WHILE SHE WAS SPEAKING - the worst kind of
 * product lie, caused by the LLM having zero evidence of what the product
 * can currently do. This provider injects exactly that evidence, computed
 * by the main process (Part 10), refreshed between turns (Part 11),
 * expressed in product language only (Part 7/9).
 *
 * Reading is synchronous (the chat core calls providers synchronously when
 * composing the prompt snapshot); refreshing the port's value is the host's
 * job, done between turns and never mid-generation.
 *
 * The instruction text is pt-BR on purpose: it is the language the persona
 * is supposed to think in (7.5 established), and it doubles as the QA check
 * - the model receives literal sentences it is allowed to act upon.
 */

const LIA_CAPABILITIES_CONTEXT_ID = 'system:lia-capabilities'

/**
 * Renders the snapshot into persona-legal instruction text. Exported and
 * pure so the Part-12 tests (A-E) pin the semantics directly, without any
 * Electron boundary.
 */
export function renderLiaCapabilitiesInstructions(snapshot: {
  voice: { configured: boolean, available: boolean }
  avatar: { available: boolean }
}): string[] {
  const lines: string[] = [
    'Estado atual das suas capacidades (pode mudar entre turnos; responda com o que é verdade agora):',
  ]

  if (snapshot.voice.configured && snapshot.voice.available) {
    lines.push(
      'Você TEM uma voz e as suas respostas são faladas em voz alta para o usuário.',
      'Não diga que você só tem texto, que não consegue falar, nem peça para o usuário copiar suas respostas em outro serviço de voz.',
      'Quando perguntarem se você consegue falar, responda que sim - com a sua personalidade.',
    )
  }
  else if (snapshot.voice.configured && !snapshot.voice.available) {
    lines.push(
      'A sua voz está configurada, mas a saída de voz está temporariamente indisponível neste momento.',
      'Diga apenas que a sua voz não está disponível agora - não diga que você nunca pode falar.',
      'Nada disto é culpa do usuário.',
    )
  }
  else {
    lines.push(
      'No momento você não tem uma voz configurada.',
      'Se perguntarem sobre você falar, não prometa uma voz que ainda não existe; aponte a configuração de voz nas definições.',
    )
  }

  if (snapshot.avatar.available) {
    lines.push('O seu avatar está visível para o usuário.')
  }

  return lines
}

/**
 * Phase 7.7.1, parts A/B: the same rendered truths, delivered as the SYSTEM
 * PROMPT SUPPLEMENT - the strongest instruction authority in the composed
 * prompt. The earlier side-context channel (kept exported below for test
 * shape stability) proved weaker than the model's built-in "I am a text
 * assistant" prior; the QA reasoning trace ("We have a conflict: the system
 * instructions (developer) say never to claim...") is the direct evidence.
 */
export function liaCapabilityPromptSupplement(): string | undefined {
  const snapshot = getLiaCapabilitySnapshot()
  if (!snapshot)
    return undefined
  return renderLiaCapabilitiesInstructions(snapshot).join(' ')
}

export function createLiaCapabilitiesContext(): ContextMessage | null {
  const snapshot = getLiaCapabilitySnapshot()
  if (!snapshot)
    return null

  return {
    id: nanoid(),
    contextId: LIA_CAPABILITIES_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: renderLiaCapabilitiesInstructions(snapshot).join(' '),
    createdAt: Date.now(),
  }
}
