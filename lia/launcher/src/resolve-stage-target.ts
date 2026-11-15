/**
 * Decisao de "qual Stage iniciar", isolada em funcao pura.
 *
 * Existe separada do processo porque o defeito caro do Launcher atual nao foi
 * "chamar o executavel errado" — foi *decidir* errado em qual modo entrar
 * (dev x empacotado) e, em seguida, nao perceber que o processo criado nao
 * ficou pronto. Por isso a decisao e testavel sozinha, sem spawn.
 */

export type StageMode = 'development' | 'packaged'

export interface StageLocationInput {
  /** `app.isPackaged` do Electron, injetado. */
  isPackaged: boolean
  /** Diretorio do app em execucao. */
  appPath: string
  /** Raiz do repositorio, quando conhecida. */
  repoRoot?: string
  /** `LIA_STAGE_MODE` explicito; vence a inferencia. */
  override?: string
  /** Existe um build do Stage em `stageEntry`? Injetado, nao lido aqui. */
  stageEntryExists: boolean
}

export interface StageLocation {
  mode: StageMode
  /** Caminho de entrada do Stage. */
  entry: string
  /** Motivo legivel, para log e para o relatorio. */
  reason: string
}

const OVERRIDES: Record<string, StageMode> = {
  dev: 'development',
  development: 'development',
  prod: 'packaged',
  production: 'packaged',
  packaged: 'packaged',
}

/**
 * Resolve onde esta o Stage. Nunca lanca: devolve sempre uma localizacao, com o
 * motivo. Falha de configuracao vira `mode` explicito + razao, e quem chama
 * decide o que fazer — em vez de um erro opaco na primeira linha da janela.
 */
export function resolveStageTarget(input: StageLocationInput): StageLocation {
  // Espaco em branco e o mesmo que variavel ausente: um .bat que exporta
  // `set LIA_STAGE_MODE=` nao pode virar erro de configuracao.
  if (input.override !== undefined && input.override.trim() !== '') {
    const key = input.override.trim().toLowerCase()
    const mode = OVERRIDES[key]
    if (mode === undefined) {
      return {
        mode: input.isPackaged ? 'packaged' : 'development',
        entry: '',
        reason: `LIA_STAGE_MODE="${input.override}" nao reconhecido; usando inferencia`,
      }
    }
    return {
      mode,
      entry: '',
      reason: `modo forcado por LIA_STAGE_MODE=${key}`,
    }
  }

  if (input.isPackaged) {
    return { mode: 'packaged', entry: '', reason: 'app.isPackaged = true' }
  }

  if (!input.stageEntryExists) {
    return {
      mode: 'development',
      entry: '',
      reason: 'sem build do Stage; modo desenvolvimento',
    }
  }

  return { mode: 'development', entry: '', reason: 'app.isPackaged = false' }
}
