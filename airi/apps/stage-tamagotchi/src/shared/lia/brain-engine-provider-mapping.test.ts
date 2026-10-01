import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { normalizeLineEndings, repoRelativePosix } from '../../test-helpers'

const REPO_ROOT = new URL('../../../../../', import.meta.url)
const REPO_ROOT_PATH = fileURLToPath(REPO_ROOT)

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function productionSources(roots: string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    for (const entry of readdirSync(new URL(root, REPO_ROOT), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.'))
        continue
      files.push(`${repoRelativePosix(REPO_ROOT_PATH, entry.parentPath)}/${entry.name}`)
    }
  }
  return files
}

const BRAIN_ROOTS = ['apps/stage-tamagotchi/src', 'packages/stage-ui/src', 'packages/core-agent/src', 'packages/lia-core/src']

describe('brain engine provider mapping — process safety (D2B1-F)', () => {
  it('renderer Lia adapter imports zero src/main modules', () => {
    const adapterPath = 'apps/stage-tamagotchi/src/renderer/services/lia/brain-send-route-candidate.ts'
    const source = stripComments(normalizeLineEndings(readFileSync(new URL(adapterPath, REPO_ROOT), 'utf-8')))
    // No import path resolving into /main/
    expect(source).not.toMatch(/from ['"]\.\.\/\.\.\/\.\.\/main\//)
    expect(source).not.toMatch(/\/main\//)
    expect(source).not.toMatch(/src\/main\//)
    // Must import from shared
    expect(source).toContain(`from '../../../shared/lia/brain-engine-provider-mapping'`)
  })

  it('single canonical engine→provider mapping definition', () => {
    const all = productionSources(BRAIN_ROOTS)
    const withLiteral = all.filter((relative) => {
      const s = stripComments(normalizeLineEndings(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')))
      return s.includes(`PRODUCTION_ENGINE_PROVIDER_IDS`) || s.includes(`['groq', GROQ_STAGE_CHAT_PROVIDER_ID]`)
    })
    // Only the shared owner defines the literal table
    expect(withLiteral).toEqual(['apps/stage-tamagotchi/src/shared/lia/brain-engine-provider-mapping.ts'])
  })

  it('shared mapping is the sole LIA_BRAIN_ENGINE_PROVIDER_MAPPING definition', () => {
    const all = productionSources(BRAIN_ROOTS)
    const defining = all.filter((relative) => {
      const s = stripComments(normalizeLineEndings(readFileSync(new URL(relative, REPO_ROOT), 'utf-8')))
      // Definition is `export const LIA_BRAIN_ENGINE_PROVIDER_MAPPING = Object.freeze`
      return s.includes(`export const LIA_BRAIN_ENGINE_PROVIDER_MAPPING`)
    })
    expect(defining).toEqual(['apps/stage-tamagotchi/src/shared/lia/brain-engine-provider-mapping.ts'])
  })

  it('main expected-route re-exports the shared mapping (no duplication)', () => {
    const expectedRoute = stripComments(normalizeLineEndings(readFileSync(new URL('apps/stage-tamagotchi/src/main/services/lia/brain-expected-route.ts', REPO_ROOT), 'utf-8')))
    expect(expectedRoute).toContain(`from '../../../shared/lia/brain-engine-provider-mapping'`)
    expect(expectedRoute).toContain(`export { GROQ_STAGE_CHAT_PROVIDER_ID, LIA_BRAIN_ENGINE_PROVIDER_MAPPING }`)
    // No duplicate literal table in expected-route
    expect(expectedRoute).not.toMatch(/PRODUCTION_ENGINE_PROVIDER_IDS/)
    expect(expectedRoute).not.toMatch(/\['groq', GROQ_STAGE_CHAT_PROVIDER_ID\]/)
  })
})
