/**
 * Launcher da Lia — fronteira entre o processo principal do Electron e o Stage.
 *
 * Este modulo NAO importa Electron: tudo o que e plataforma entra por
 * `LauncherDeps`. A implementacao concreta continua, por enquanto, em
 * `airi/apps/lia-app/src/main/airi-stage-manager.ts` — a migracao e incremental
 * e reversivel (ver docs/architecture/LIA-MIGRATION-PLAN.md).
 */

import type { StageSnapshot } from '../../core/src/lifecycle.ts'
import type { StageHost } from '../../stage/src/main/stage-host.ts'
import type { StageLocationInput } from './resolve-stage-target.ts'

import { resolveStageTarget } from './resolve-stage-target.ts'

export interface LauncherDeps {
  /** O host do Stage. Injetado para permitir duble em teste. */
  stage: StageHost
  /** Diagnostico. Nunca recebe conteudo de conversa nem segredo. */
  onLog?: (line: string) => void
}

export interface Launcher {
  /** Sobe o Stage e devolve o estado realmente observado. */
  launch: (location: StageLocationInput) => Promise<StageSnapshot>
  shutdown: () => Promise<StageSnapshot>
}

export function createLauncher(deps: LauncherDeps): Launcher {
  const log = deps.onLog ?? (() => {})

  return {
    async launch(location) {
      const target = resolveStageTarget(location)
      log(`stage alvo: mode=${target.mode} (${target.reason})`)

      const snapshot = await deps.stage.start()
      log(`stage fase=${snapshot.phase}`)
      return snapshot
    },
    async shutdown() {
      return deps.stage.stop()
    },
  }
}
