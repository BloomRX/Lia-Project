import type { PackagedStageInvocation } from './packaged-stage'

import { statSync } from 'node:fs'
import { join } from 'node:path'

export function resolveNativeStage(cwd: string, platform = process.platform): PackagedStageInvocation {
  const entry = join(cwd, 'out', 'main', 'index.js')
  const distribution = join(cwd, 'node_modules', 'electron', 'dist')
  const command = platform === 'win32'
    ? join(distribution, 'electron.exe')
    : platform === 'darwin'
      ? join(distribution, 'Electron.app', 'Contents', 'MacOS', 'Electron')
      : join(distribution, 'electron')
  for (const file of [entry, command, join(cwd, 'out', 'preload', 'index.cjs'), join(cwd, 'out', 'renderer', 'index.html')]) {
    if (!statSync(file, { throwIfNoEntry: false })?.isFile())
      throw new Error('Prepare o Stage próprio antes de abrir a conversa.')
  }
  return { args: [entry], command, cwd }
}
