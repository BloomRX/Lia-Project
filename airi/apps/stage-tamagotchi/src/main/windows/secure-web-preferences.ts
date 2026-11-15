import type { WebPreferences } from 'electron'

export function createStageWebPreferences(preload: string): WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    preload,
    sandbox: true,
  }
}
