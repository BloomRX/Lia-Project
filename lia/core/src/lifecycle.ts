/**
 * Ciclo de vida do Stage da Lia.
 *
 * Este arquivo nao conhece Electron, processo, janela nem sistema operacional.
 * Ele descreve apenas *quais estados existem* e *quais transicoes sao legais*.
 * A razao de existir separado: o defeito que custou caro no Launcher nao foi
 * "chamar o executavel errado", foi declarar o Stage pronto porque o processo
 * existia. Aqui "existir" e "estar pronto" sao estados diferentes, e a
 * transicao entre eles e explicita.
 */

/** Fases observaveis de uma instancia do Stage. */
export type StagePhase = 'error' | 'running' | 'starting' | 'stopped' | 'stopping'

/** Eventos que movem a fase. */
export type StageEvent = 'spawn' | 'ready' | 'stop' | 'exit' | 'fail'

/** Retrato do estado num instante. Campos ausentes nao existem, nao sao `undefined`. */
export interface StageSnapshot {
  phase: StagePhase
  pid?: number
  startedAt?: number
  readyAt?: number
  stoppedAt?: number
  exitCode?: number
  /** Motivo curto e legivel. Nunca conteudo de conversa, nunca segredo. */
  failure?: string
}

export interface StageTransitionInput {
  pid?: number
  exitCode?: number
  failure?: string
}

interface TransitionRecord {
  from: StagePhase
  event: StageEvent
  to: StagePhase
  at: number
}

/**
 * Tabela de transicoes legais.
 *
 * `error` e terminal para a instancia: nenhum evento a resgata. Um novo `spawn`
 * comeca uma tentativa nova e limpa a falha anterior — e por isso que a falha
 * de uma tentativa nao vaza para a seguinte.
 */
const TRANSITIONS: Record<StagePhase, Partial<Record<StageEvent, StagePhase>>> = {
  stopped: { spawn: 'starting' },
  error: { spawn: 'starting' },
  starting: { ready: 'running', fail: 'error' },
  running: { stop: 'stopping', fail: 'error' },
  stopping: { exit: 'stopped', fail: 'error' },
}

/**
 * Devolve a fase seguinte, ou `null` se a transicao nao for legal.
 *
 * Devolver `null` em vez de lancar e deliberado: quem chama decide. Uma
 * transicao ilegal e um bug de quem chamou, e o registro disso e mais util que
 * uma excecao dentro de um callback de processo.
 */
export function transition(from: StagePhase, event: StageEvent): StagePhase | null {
  return TRANSITIONS[from]?.[event] ?? null
}

/** Verdadeiro apenas quando o Stage esta de fato atendendo. */
export function isServing(phase: StagePhase): boolean {
  return phase === 'running'
}

/** Verdadeiro quando a instancia terminou e nao vai mudar sozinha. */
export function isTerminal(phase: StagePhase): boolean {
  return phase === 'stopped' || phase === 'error'
}

export class Lifecycle {
  #phase: StagePhase = 'stopped'
  #pid: number | undefined
  #startedAt: number | undefined
  #readyAt: number | undefined
  #stoppedAt: number | undefined
  #exitCode: number | undefined
  #failure: string | undefined
  #now: () => number
  #history: TransitionRecord[] = []

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  get phase(): StagePhase {
    return this.#phase
  }

  /** Registro ordenado das transicoes aceitas. Nao inclui as recusadas. */
  get history(): readonly TransitionRecord[] {
    return this.#history
  }

  /**
   * Aplica um evento. Devolve o retrato novo quando a transicao e aceita, ou
   * `null` quando e recusada — e nesse caso **nada** muda, nem o historico.
   */
  apply(event: StageEvent, input: StageTransitionInput = {}): StageSnapshot | null {
    const from = this.#phase
    const to = transition(from, event)
    if (to === null)
      return null

    const at = this.#now()

    // `spawn` numa instancia terminal comeca tentativa limpa.
    if (event === 'spawn') {
      this.#pid = input.pid
      this.#startedAt = at
      this.#readyAt = undefined
      this.#stoppedAt = undefined
      this.#exitCode = undefined
      this.#failure = undefined
    }

    if (event === 'ready')
      this.#readyAt = at

    if (event === 'exit') {
      this.#stoppedAt = at
      this.#exitCode = input.exitCode
    }

    if (event === 'fail')
      this.#failure = input.failure ?? 'falha sem motivo informado'

    this.#phase = to
    this.#history.push({ from, event, to, at })
    return this.snapshot()
  }

  /** Retrato com apenas os campos que existem. */
  snapshot(): StageSnapshot {
    const out: StageSnapshot = { phase: this.#phase }
    if (this.#pid !== undefined)
      out.pid = this.#pid
    if (this.#startedAt !== undefined)
      out.startedAt = this.#startedAt
    if (this.#readyAt !== undefined)
      out.readyAt = this.#readyAt
    if (this.#stoppedAt !== undefined)
      out.stoppedAt = this.#stoppedAt
    if (this.#exitCode !== undefined)
      out.exitCode = this.#exitCode
    if (this.#failure !== undefined)
      out.failure = this.#failure
    return out
  }
}
