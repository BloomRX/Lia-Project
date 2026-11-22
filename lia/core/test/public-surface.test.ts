/**
 * Guardas da superfície pública de `@lia/contracts` (F2 / D-05).
 *
 * Estes testes existem porque a fronteira já foi furada uma vez: 23 arquivos
 * de aplicação alcançavam `lia/core/src` por caminho relativo, e nada impedia
 * que a contagem crescesse. Um teste que nunca falhou não protege nada, então
 * cada guarda aqui foi verificada com uma violação plantada (ver o relatório
 * da rodada 18).
 *
 * S4 — o pacote não importa Electron nem AIRI.
 * S5 — o pacote continua com zero dependências.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'

import { packageRoot, PUBLIC_SURFACE, specifiers, walk } from './public-surface-helpers.ts'

it('o mapa de testes e o package.json descrevem a mesma superfície', () => {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { exports: Record<string, string> }
  assert.deepEqual(Object.keys(manifest.exports).sort(), Object.keys(PUBLIC_SURFACE).sort())
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
