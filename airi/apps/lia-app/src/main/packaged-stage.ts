import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export const PACKAGED_STAGE_EXECUTABLE = 'LiaStage.exe'

export interface PackagedStageInvocation {
  command: string
  args: string[]
  cwd: string
}

/** Fixed installation resource, never an executable supplied by the renderer. */
export function resolvePackagedStage(resourcesPath: string): PackagedStageInvocation {
  if (!isAbsolute(resourcesPath))
    throw new Error('Não foi possível localizar a instalação da Lia. Reinstale o aplicativo.')

  const cwd = join(resourcesPath, 'stage')
  const command = join(cwd, PACKAGED_STAGE_EXECUTABLE)
  for (const file of [command, join(cwd, 'resources', 'app.asar'), join(cwd, 'icudtl.dat')]) {
    try {
      if (!statSync(file).isFile())
        throw new Error('not a file')
    }
    catch {
      throw new Error('A instalação da personagem está incompleta. Reinstale a Lia para corrigir.')
    }
  }
  return { command, args: [], cwd }
}
