import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

describe('test-helpers production import guard (D2B9-A1)', () => {
  it('no production file imports src/test-helpers', () => {
    const airiRoot = fileURLToPath(new URL('../../..', import.meta.url))
    const roots = ['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src']
    const offenders: string[] = []
    for (const root of roots) {
      const base = join(airiRoot, root)
      try {
        for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.') || entry.name === 'test-helpers.ts' || entry.name === 'test-helpers.test.ts' || entry.name === 'test-helpers-guard.test.ts' || entry.name.includes('windows-portability')) continue
          const file = join(entry.parentPath, entry.name)
          const content = readFileSync(file, 'utf-8')
          if (content.includes('test-helpers')) {
            offenders.push(relative(airiRoot, file))
          }
        }
      } catch {}
    }
    expect(offenders, `production files must not import test-helpers: ${offenders.join(', ')}`).toEqual([])
  })
})
