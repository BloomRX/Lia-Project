/**
 * Host do Stage da Lia.
 *
 * Nao depende de Electron por import: toda a plataforma entra por
 * `StageHostDeps`. Esse e o mesmo idioma que o Launcher atual ja usa
 * (`airi-stage-manager.ts` injeta `spawnImpl`/`fuseImpl` explicitamente
 * "for tests"). A consequencia pratica e que o ciclo de vida inteiro roda em
 * teste headless, sem display e sem binario do Electron — que e justamente o
 * que nao existe em CI deste repositorio.
 *
 * O que este host garante, e que os testes cobram:
 *  - `running` so depois do sinal de pronto da plataforma;
 *  - `stopped` so depois do encerramento real observado;
 *  - uma falha de inicializacao termina em `error`, nunca em `running`;
 *  - `stop()` e idempotente e nunca deixa processo orfao silencioso.
 */

import type { StageSnapshot } from '../../../core/src/lifecycle.ts'

import { Lifecycle } from '../../../core/src/lifecycle.ts'

/** Janela abstrata: o que o host precisa da plataforma, e nada mais. */
export interface StageWindow {
  /** Mostra a janela. Chamado apenas depois de a UI estar pronta. */
  show: () => void
  /** Fecha a janela. Deve resolver quando o SO confirmou o fechamento. */
  close: () => Promise<void>
}

export interface StageHostDeps {
  /** Cria a janela do Stage. Rejeitar aqui e falha de inicializacao. */
  createWindow: () => Promise<StageWindow>
  /** Encerra o processo do Stage (o "taskkill /T" do Windows entra aqui). */
  terminate: (pid: number) => Promise<void>
  /** Relogio injetavel para teste. */
  now?: () => number
  /** Diagnostico. Nunca recebe conteudo de conversa nem segredo. */
  onLog?: (line: string) => void
  /** Gerado pelo host; o teste fixa. */
  nextPid?: () => number
}

export interface StageHost {
  start: () => Promise<StageSnapshot>
  stop: () => Promise<StageSnapshot>
  health: () => StageSnapshot
}

export function createStageHost(deps: StageHostDeps): StageHost {
  const lifecycle = new Lifecycle(deps.now ?? Date.now)
  const log = deps.onLog ?? (() => {})
  const nextPid = deps.nextPid ?? (() => Math.floor(Math.random() * 100_000) + 1)

  let window: StageWindow | undefined
  let stopping: Promise<StageSnapshot> | undefined

  async function start(): Promise<StageSnapshot> {
    // single-flight: uma segunda chamada concorrente nao cria outra janela.
    if (lifecycle.phase !== 'stopped' && lifecycle.phase !== 'error') {
      log(`start ignorado: fase ${lifecycle.phase}`)
      return lifecycle.snapshot()
    }

    const pid = nextPid()
    lifecycle.apply('spawn', { pid })
    log(`stage spawn pid=${pid}`)

    try {
      window = await deps.createWindow()
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      lifecycle.apply('fail', { failure: reason })
      log(`stage falhou ao criar janela: ${reason}`)
      return lifecycle.snapshot()
    }

    // A janela existir NAO e o mesmo que estar pronta. So aqui a fase vira
    // `running`, e e este o erro que o relatorio de 20/10 cobrou.
    lifecycle.apply('ready')
    window.show()
    log(`stage pronto pid=${pid}`)
    return lifecycle.snapshot()
  }

  async function stop(): Promise<StageSnapshot> {
    // Idempotente: dois cliques no botao de fechar nao encerram duas vezes.
    if (stopping)
      return stopping

    stopping = (async () => {
      const pid = lifecycle.snapshot().pid

      if (lifecycle.phase === 'running')
        lifecycle.apply('stop')

      try {
        if (window)
          await window.close()
      }
      finally {
        window = undefined
        if (pid !== undefined && lifecycle.phase !== 'stopped') {
          await deps.terminate(pid)
          lifecycle.apply('exit', { exitCode: 0 })
          log(`stage encerrado pid=${pid}`)
        }
      }

      return lifecycle.snapshot()
    })()

    try {
      return await stopping
    }
    finally {
      stopping = undefined
    }
  }

  return { start, stop, health: () => lifecycle.snapshot() }
}
