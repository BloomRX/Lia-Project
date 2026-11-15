import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createStageWebPreferences } from './secure-web-preferences'

describe('Stage window security preferences', () => {
  it('enables sandboxing and context isolation while disabling Node integration', () => {
    expect(createStageWebPreferences('C:\\Lia\\preload\\index.cjs')).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      preload: 'C:\\Lia\\preload\\index.cjs',
      sandbox: true,
    })
  })

  it('routes every current BrowserWindow through the shared security contract', () => {
    const windows = [
      './about/index.ts',
      './beat-sync/index.ts',
      './caption/index.ts',
      './chat/index.ts',
      './dashboard/index.ts',
      './devtools/index.ts',
      './editor/index.ts',
      './inlay/index.ts',
      './main/index.ts',
      './notice/index.ts',
      './onboarding/index.ts',
      './settings/index.ts',
      './spotlight/index.ts',
      './widgets/index.ts',
      './desktop-overlay/window-contract.ts',
    ]

    for (const relativePath of windows) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
      expect(source, relativePath).toContain('createStageWebPreferences(')
    }
  })
})
