/**
 * Encerramento cooperativo — duas pontas, um contrato.
 *
 * O defeito original era de ordem: `taskkill /T /F` era o PRIMEIRO gesto, não
 * o último. Isso mata o processo no meio de uma escrita de log, deixa
 * arquivos de áudio abertos e não dá ao Stage a chance de rodar seus próprios
 * hooks. A sequência correta é:
 *
 *   1. pedir o encerramento (comando autenticado no canal de controle);
 *   2. rodar os hooks do próprio Runtime;
 *   3. fechar logs, áudio, janelas e recursos;
 *   4. sair;
 *   5. esperar até o prazo configurado;
 *   6. só então forçar.
 *
 * Os passos 2–4 acontecem DENTRO do Runtime (`runCooperativeExit`). O passo 5
 * e o 6 acontecem no Launcher (`stopRuntimeCooperatively`), porque quem espera
 * não pode ser o processo que está morrendo.
 */

import type { RuntimeControlTarget } from './control.ts'

import { ControlError, invokeRuntimeControl, pingRuntime } from './control.ts'

export type ShutdownStepOutcome = 'failed' | 'ok' | 'timeout'

export interface ShutdownStep {
  error?: string
  ms: number
  name: string
  outcome: ShutdownStepOutcome
}

export interface RuntimeShutdownReport {
  forced: boolean
  steps: ShutdownStep[]
  timedOut: boolean
  totalMs: number
}

/* ------------------------------------------------------------------ */
/* Lado do Runtime                                                    */
/* ------------------------------------------------------------------ */

export interface CooperativeExitDeps {
  /**
   * Trabalho de limpeza do próprio Runtime. Roda em ordem, antes do pedido de
   * saída. Um hook que falha não impede os seguintes: encerrar é
   * melhor-esforço-tudo, nunca tudo-ou-nada.
   */
  hooks?: Array<{ name: string, run: () => Promise<unknown> | unknown }>
  /** `app.quit()`/`handleAppExit` — o caminho que o produto já usa. */
  requestExit: () => Promise<unknown> | unknown
  /** `app.exit(code)` — último recurso, depois do prazo. */
  forceExit: (code: number) => void
  /** Prazo total do encerramento cooperativo. Padrão: 15 s. */
  timeoutMs?: number
  now?: () => number
  onStep?: (step: ShutdownStep) => void
}

const DEFAULT_EXIT_TIMEOUT_MS = 15_000

function messageOf(error: unknown): string {
  if (error instanceof Error)
    return error.name
  return typeof error === 'string' ? error : 'unknown'
}

/**
 * Executa a sequência cooperativa e devolve o que aconteceu.
 *
 * Quando `requestExit` resolve sem que o processo tenha saído, o prazo começa
 * a contar: quem chama não fica preso para sempre a um `quit` que não quitou.
 * Se o processo sair de verdade, o timer morre com ele.
 */
export async function runCooperativeExit(deps: CooperativeExitDeps): Promise<RuntimeShutdownReport> {
  const now = deps.now ?? (() => Date.now())
  const started = now()
  const steps: ShutdownStep[] = []
  const timeoutMs = deps.timeoutMs ?? DEFAULT_EXIT_TIMEOUT_MS
  let timedOut = false

  const record = (step: ShutdownStep) => {
    steps.push(step)
    deps.onStep?.(step)
  }

  for (const hook of deps.hooks ?? []) {
    const t0 = now()
    try {
      await hook.run()
      record({ ms: Math.round(now() - t0), name: hook.name, outcome: 'ok' })
    }
    catch (error) {
      record({ error: messageOf(error), ms: Math.round(now() - t0), name: hook.name, outcome: 'failed' })
    }
  }

  const exitAt = now()
  record({ ms: 0, name: 'request-exit', outcome: 'ok' })

  const deadline = new Promise<void>((resolve) => {
    // NÃO unref: enquanto o encerramento está pendente, este prazo é o que
    // garante que o processo não fica preso. Um timer unref'd deixaria o
    // event loop vazio e a saída nunca aconteceria.
    setTimeout(() => {
      timedOut = true
      resolve()
    }, timeoutMs)
  })

  // Não esperamos `requestExit` indefinidamente: o prazo vale também para um
  // quit que trava antes de fechar a primeira janela.
  await Promise.race([
    Promise.resolve(deps.requestExit()).catch(() => {}),
    deadline,
  ])

  if (timedOut) {
    record({ ms: Math.round(now() - exitAt), name: 'force-exit', outcome: 'timeout' })
    deps.forceExit(1)
  }

  // Se o processo não morreu aqui, o relatório ainda é útil para o log; quem
  // encerra de fato é o chamador.
  await Promise.race([deadline, new Promise<void>(resolve => setTimeout(resolve, 0))])

  return {
    forced: timedOut,
    steps,
    timedOut,
    totalMs: Math.round(now() - started),
  }
}

/* ------------------------------------------------------------------ */
/* Lado do Launcher                                                   */
/* ------------------------------------------------------------------ */

export interface StopRuntimeDeps {
  target: RuntimeControlTarget
  reason?: string
  /** Quanto esperar pela saída antes de forçar. Padrão: 15 s. */
  timeoutMs?: number
  /** Intervalo entre pulsos de verificação. Padrão: 250 ms. */
  pollMs?: number
  /**
   * Encerramento forçado — `taskkill /T /F` no Windows, SIGKILL no POSIX.
   * Só é chamado depois que o prazo cooperativo expirou.
   */
  forceKill?: () => Promise<void> | void
  /** Quanto esperar depois do forçado. Padrão: 5 s. */
  forceWaitMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface StopRuntimeResult {
  acknowledged: boolean
  forced: boolean
  stopped: boolean
  waitedMs: number
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function stillAlive(target: RuntimeControlTarget): Promise<boolean> {
  try {
    await pingRuntime(target, 750)
    return true
  }
  catch (error) {
    // Um runtime que responde "denied" está vivo (alguém atende o endpoint).
    if (error instanceof ControlError && error.code === 'denied')
      return true
    return false
  }
}

/**
 * Pede o encerramento e PROVA a saída.
 *
 * "Parado" só é reportado depois de o endpoint parar de responder — o mesmo
 * critério honesto do gerenciador do Stage. `acknowledged` e `stopped` são
 * fatos separados de propósito: um runtime pode aceitar o pedido e travar
 * depois, e esconder isso transformaria um travamento num "fechou normal".
 */
export async function stopRuntimeCooperatively(deps: StopRuntimeDeps): Promise<StopRuntimeResult> {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? defaultSleep
  const started = now()
  const timeoutMs = deps.timeoutMs ?? DEFAULT_EXIT_TIMEOUT_MS
  const pollMs = deps.pollMs ?? 250

  if (!(await stillAlive(deps.target)))
    return { acknowledged: false, forced: false, stopped: true, waitedMs: 0 }

  let acknowledged = false
  try {
    await invokeRuntimeControl(deps.target, 'runtime.shutdown', deps.reason ? { reason: deps.reason } : undefined, { timeoutMs: 5_000 })
    acknowledged = true
  }
  catch {
    acknowledged = false
  }

  const waitUntil = now() + timeoutMs
  while (now() < waitUntil) {
    if (!(await stillAlive(deps.target)))
      return { acknowledged, forced: false, stopped: true, waitedMs: Math.round(now() - started) }
    await sleep(pollMs)
  }

  if (deps.forceKill) {
    await Promise.resolve(deps.forceKill()).catch(() => {})
    const forceUntil = now() + (deps.forceWaitMs ?? 5_000)
    while (now() < forceUntil) {
      if (!(await stillAlive(deps.target)))
        return { acknowledged, forced: true, stopped: true, waitedMs: Math.round(now() - started) }
      await sleep(pollMs)
    }
  }

  // Não fingir: se ainda responde, não parou.
  return { acknowledged, forced: Boolean(deps.forceKill), stopped: false, waitedMs: Math.round(now() - started) }
}
