import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { LIA_MAIN_WEB_PREFERENCES } from './web-preferences'

/**
 * SEC-1 — the Launcher window's security baseline (12/11/2026).
 *
 * These are static guards, not a runtime proof: the sandbox only truly shows
 * up in a real window. What they do guarantee is that nobody silently turns
 * `sandbox` back off or teaches the preload to import Node built-ins, which is
 * the only thing that would make the sandbox unsafe to keep.
 */

const here = dirname(fileURLToPath(import.meta.url))

describe('launcher window security baseline', () => {
  it('keeps the renderer sandboxed with isolation on and Node off', () => {
    expect(LIA_MAIN_WEB_PREFERENCES).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    })
  })

  it('keeps the preload a pure contextBridge (no Node built-ins)', async () => {
    const source = await readFile(join(here, '..', 'preload', 'index.ts'), 'utf8')
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1])
    expect(specifiers).toEqual(['electron'])
    expect(source).not.toMatch(/require\(|import\(/)
  })

  it('wires the pinned preferences into the window instead of inlining them', async () => {
    const source = await readFile(join(here, 'index.ts'), 'utf8')
    expect(source).toContain('...LIA_MAIN_WEB_PREFERENCES')
    // A literal `sandbox:` inside this file would bypass the pinned object.
    expect(source).not.toMatch(/^\s+sandbox:/m)
  })
})
