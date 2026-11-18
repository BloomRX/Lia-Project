/**
 * Guardas da superfície pública de `@lia/contracts` (F2 / D-05).
 *
 * Estes testes existem porque a fronteira já foi furada uma vez: 23 arquivos
 * de aplicação alcançavam `lia/core/src` por caminho relativo, e nada impedia
 * que a contagem crescesse. Um teste que nunca falhou não protege nada, então
 * cada guarda aqui foi verificada com uma violação plantada (ver o relatório
 * da rodada 18).
 *
 * S1 — nenhum consumidor volta ao caminho relativo.
 * S2 — todo subpath importado existe em `exports`.
 * S3 — subpath node-only não entra em renderer/shared.
 * S4 — o pacote não importa Electron nem `@proj-airi/*`.
 * S5 — o pacote continua com zero dependências.
 */

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const repoRoot = join(packageRoot, '..', '..')
const appsRoot = join(repoRoot, 'airi', 'apps')

/** Subpaths servidos por `exports` e sua pureza declarada. */
const PUBLIC_SURFACE: Record<string, { nodeOnly: boolean }> = {
  './credentials/destination': { nodeOnly: false },
  './credentials/owner-channel': { nodeOnly: true },
  './presence': { nodeOnly: false },
  './providers': { nodeOnly: false },
  './providers/catalog': { nodeOnly: false },
  './providers/selection-write-policy': { nodeOnly: false },
  './runtime': { nodeOnly: true },
  './transports': { nodeOnly: false },
  './transports/repository': { nodeOnly: true },
  '.': { nodeOnly: false },
}

/** `@lia/contracts/x` -> `./x`; `@lia/contracts` -> `.`. */
function exportKeyFor(specifier: string): string {
  const rest = specifier.slice('@lia/contracts'.length)
  return rest === '' ? '.' : `.${rest}`
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out' || entry === '.turbo')
      continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory())
      walk(full, out)
    else if (/\.(?:ts|tsx|mts|vue)$/.test(entry))
      out.push(full)
  }
  return out
}

function appFiles(): string[] {
  const files: string[] = []
  for (const app of readdirSync(appsRoot)) {
    const src = join(appsRoot, app, 'src')
    try {
      if (statSync(src).isDirectory())
        walk(src, files)
    }
    catch { /* app sem src */ }
  }
  return files
}

/** Extrai especificadores de `from '...'` e `import('...')`. */
function specifiers(text: string): string[] {
  const found: string[] = []
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s+['"]([^'"]+)['"]/g]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1])
        found.push(match[1])
    }
  }
  return found
}

describe('S1 — nenhum import relativo para lia/core/src', () => {
  it('os apps só conhecem o pacote pelo nome', () => {
    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of appFiles()) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (specifier.includes('lia/core/src'))
          offenders.push({ file: relative(repoRoot, file), specifier })
      }
    }
    assert.deepEqual(offenders, [])
  })
})

describe('S2 — todo subpath importado está publicado', () => {
  it('nenhum consumidor depende de um caminho que não existe em exports', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { exports?: Record<string, string> }
    assert.ok(manifest.exports, 'o pacote precisa declarar exports')
    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of appFiles()) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (!specifier.startsWith('@lia/contracts'))
          continue
        if (!(exportKeyFor(specifier) in manifest.exports))
          offenders.push({ file: relative(repoRoot, file), specifier })
      }
    }
    assert.deepEqual(offenders, [])
  })

  it('o mapa de testes e o package.json descrevem a mesma superfície', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { exports: Record<string, string> }
    assert.deepEqual(Object.keys(manifest.exports).sort(), Object.keys(PUBLIC_SURFACE).sort())
  })
})

describe('S3 — subpath node-only não vaza para renderer/shared', () => {
  it('renderer e shared usam apenas subpaths puros', () => {
    const nodeOnly = Object.entries(PUBLIC_SURFACE)
      .filter(([, value]) => value.nodeOnly)
      .map(([key]) => (key === '.' ? '@lia/contracts' : `@lia/contracts${key.slice(1)}`))
    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of appFiles()) {
      const normalized = file.replace(/\\/g, '/')
      const scope = /\/(?:src\/renderer|src\/shared)\//.test(normalized)
      if (!scope)
        continue
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (nodeOnly.includes(specifier))
          offenders.push({ file: relative(repoRoot, file), specifier })
      }
    }
    assert.deepEqual(offenders, [])
  })
})

describe('S4 — o pacote de contratos não conhece Electron nem AIRI', () => {
  it('nenhum arquivo de src importa electron ou @proj-airi', () => {
    const offenders: Array<{ file: string, specifier: string }> = []
    for (const file of walk(join(packageRoot, 'src'), [])) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (specifier === 'electron' || specifier.startsWith('electron/') || specifier.startsWith('@proj-airi/'))
          offenders.push({ file: relative(packageRoot, file), specifier })
      }
    }
    assert.deepEqual(offenders, [])
  })
})

describe('S5 — zero dependências', () => {
  it('dependencies e peerDependencies continuam vazios', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    assert.deepEqual(manifest.dependencies ?? {}, {})
    assert.deepEqual(manifest.peerDependencies ?? {}, {})
  })
})
