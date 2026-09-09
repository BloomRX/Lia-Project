import type { Card } from '@proj-airi/ccc'

import type { LiaPersona } from '../constants/lia-persona'

/**
 * AIRI-specific runtime configuration embedded in a character card.
 *
 * The extension is persisted with the card. Editor surfaces must preserve
 * fields they do not own so independent runtime modules can evolve without
 * losing each other's configuration.
 */
export interface AiriExtension {
  modules: {
    consciousness: {
      provider: string
      model: string
    }

    vision: {
      provider: string
      model: string
    }

    speech: {
      provider: string
      model: string
      voice_id: string

      pitch?: number
      rate?: number
      ssml?: boolean
      language?: string
    }

    vrm?: {
      source?: 'file' | 'url'
      file?: string
      url?: string
    }

    live2d?: {
      source?: 'file' | 'url'
      file?: string
      url?: string
    }

    /** ID from the display-models store. */
    displayModelId?: string
    activeBackgroundId?: string

    artistry?: {
      enabled?: boolean
      provider?: string
      model?: string
      promptPrefix?: string
      workflowId?: string
      widgetInstruction?: string
      spawnMode?: 'bg' | 'widget' | 'inline' | 'bg_widget'
      options?: Record<string, unknown>
      autonomousEnabled?: boolean
      autonomousThreshold?: number
      autonomousTarget?: 'user' | 'assistant'
    }
  }

  agents: Record<string, {
    prompt: string
    enabled?: boolean
  }>

  /**
   * Persona estruturada do card (modelo de dados — ex.: `LiaPersona`).
   *
   * É a fonte canônica editável da personalidade (a futura tela "Gerenciar
   * personalidade" grava aqui). Os campos de texto que o runtime lê
   * (`description`/`personality`/`scenario`) são projeções serializadas deste
   * objeto. Opcional: cards CCv3 importados/legados não o possuem e continuam
   * funcionando pelos campos de texto.
   */
  persona?: LiaPersona
}

/** Character card normalized with the AIRI extension required by the runtime. */
export interface AiriCard extends Card {
  extensions: {
    airi: AiriExtension
  } & Card['extensions']
}
