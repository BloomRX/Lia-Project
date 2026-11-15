import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Etapa 0/1 do plano mestre — fronteiras de runtime (12/11/2026).
 *
 * A decisão de arquitetura manteve Electron como host de desktop e tratou o
 * Core como independente de runtime. Isso só continua verdade se o código
 * cobrar a fronteira: este teste falha quando:
 *
 *  - o Core de produto (`@lia/core`) ou os contratos (`@lia/contracts`)
 *    passam a importar Electron ou qualquer pacote de terceiro;
 *  - o Main do Launcher espalha `import 'electron'` para além dos dois
 *    arquivos de host;
 *  - o Renderer passa a importar Electron ou builtins do Node.
 *
 * Ele não mede desempenho e não decide migração. Ele impede que a separação
 * documentada em `docs/reports/LIA-DESKTOP-RUNTIME-ARCHITECTURE-DECISION.md`
 * vire apenas texto.
 */

const MAIN = import.meta.dirname
const PRELOAD = join(MAIN, '..', 'preload')
const RENDERER = join(MAIN, '..', 'renderer')
const LIA_CORE = join(MAIN, '..', '..', '..', '..', 'packages', 'lia-core', 'src')
const CONTRACTS = join(MAIN, '..', '..', '..', '..', '..', 'lia', 'core', 'src')

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules')
        files.push(...await sourceFiles(full))
      continue
    }
    if (!/\.(ts|vue)$/.test(entry.name))
      continue
    // Static tests and browser cases are allowed to use node:fs to read source.
    if (/\.(test|browser)\.(ts|case\.ts)$/.test(entry.name) || entry.name.includes('.browser.case.'))
      continue
    files.push(full)
  }
  return files
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)].map(match => match[1])
}

describe('runtime boundary (decision 12/11/2026)', () => {
  it('a: the product Core never imports Electron', async () => {
    const files = await sourceFiles(LIA_CORE)
    expect(files.length).toBeGreaterThan(10) // not vacuous

    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of files) {
      for (const specifier of importsOf(await readFile(file, 'utf8'))) {
        if (specifier === 'electron' || specifier.startsWith('electron/'))
          offenders.push({ file, specifier })
      }
    }
    expect(offenders).toEqual([])
  })

  it('b: the contracts stay dependency-free (relative or node: builtins only)', async () => {
    const files = await sourceFiles(CONTRACTS)
    expect(files.length).toBeGreaterThan(5)

    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of files) {
      for (const specifier of importsOf(await readFile(file, 'utf8'))) {
        const allowed = specifier.startsWith('.') || specifier.startsWith('node:')
        if (!allowed)
          offenders.push({ file, specifier })
      }
    }
    expect(offenders).toEqual([])
  })

  it('c: the launcher main confines Electron to its two host files', async () => {
    const files = await sourceFiles(MAIN)
    expect(files.length).toBeGreaterThan(10)

    const importers: string[] = []
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (importsOf(source).some(specifier => specifier === 'electron' || specifier.startsWith('electron/')))
        importers.push(file.slice(MAIN.length + 1).replaceAll('\\', '/'))
    }

    expect(importers.sort()).toEqual(['index.ts', 'ipc.ts'])
  })

  it('d: the renderer never reaches Electron or Node', async () => {
    const files = await sourceFiles(RENDERER)
    expect(files.length).toBeGreaterThan(10)

    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of files) {
      for (const specifier of importsOf(await readFile(file, 'utf8'))) {
        if (specifier === 'electron' || specifier.startsWith('electron/') || specifier.startsWith('node:'))
          offenders.push({ file, specifier })
      }
    }
    expect(offenders).toEqual([])
  })

  it('e: the preload exposes a bridge, never ipcRenderer itself', async () => {
    const source = await readFile(join(PRELOAD, 'index.ts'), 'utf8')
    expect(source).toContain('contextBridge.exposeInMainWorld')
    expect(source).not.toMatch(/exposeInMainWorld\([^)]*,\s*ipcRenderer\s*\)/)
    expect(source).not.toMatch(/exposeInMainWorld\([^)]*,\s*\{\s*ipcRenderer/)
  })
})
