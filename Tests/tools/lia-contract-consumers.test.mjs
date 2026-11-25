import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, it } from 'node:test'

import { packageRoot, PUBLIC_SURFACE, specifiers, walk } from '../../lia/core/test/public-surface-helpers.ts'

const repoRoot = join(packageRoot, '..', '..')

/** `@lia/contracts/x` -> `./x`; `@lia/contracts` -> `.`. */
function exportKeyFor(specifier) {
  const rest = specifier.slice('@lia/contracts'.length)
  return rest === '' ? '.' : `.${rest}`
}

function appFiles() {
  return ['desktop', 'stage'].flatMap(app => walk(join(repoRoot, 'lia', app, 'src')))
}

describe('S1 — nenhum import relativo para lia/core/src', () => {
  it('os apps só conhecem o pacote pelo nome', () => {
    const offenders = []
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
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    assert.ok(manifest.exports, 'o pacote precisa declarar exports')
    const offenders = []
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
})

describe('S3 — subpath node-only não vaza para renderer/shared', () => {
  it('renderer e shared usam apenas subpaths puros', () => {
    const nodeOnly = Object.entries(PUBLIC_SURFACE)
      .filter(([, value]) => value.nodeOnly)
      .map(([key]) => (key === '.' ? '@lia/contracts' : `@lia/contracts${key.slice(1)}`))
    const offenders = []
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
