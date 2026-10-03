import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { authoredSourceEntry, isGeneratedRepoPath, normalizeLineEndings, repoRelativePosix } from './test-helpers'

describe('test-helpers production import guard (D2B9-A1)', () => {
  it('no production file imports src/test-helpers', () => {
    const airiRoot = fileURLToPath(new URL('../../..', import.meta.url))
    const roots = ['apps/stage-tamagotchi/src', 'packages/lia-core/src', 'packages/stage-ui/src']
    const offenders: string[] = []
    for (const root of roots) {
      const base = join(airiRoot, root)
      try {
        for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || !/\.(?:ts|vue)$/.test(entry.name) || entry.name.includes('.test.') || entry.name === 'test-helpers.ts' || entry.name === 'test-helpers.test.ts' || entry.name === 'test-helpers-guard.test.ts' || entry.name.includes('windows-portability'))
            continue
          const file = join(entry.parentPath, entry.name)
          const content = normalizeLineEndings(readFileSync(file, 'utf-8'))
          if (content.includes('test-helpers')) {
            offenders.push(repoRelativePosix(airiRoot, file))
          }
        }
      }
      catch {}
    }
    expect(offenders, `production files must not import test-helpers: ${offenders.join(', ')}`).toEqual([])
  })
})

/**
 * Synthetic Windows fixtures (D2B9-D).
 *
 * The Stage source guards failed on a real Windows checkout with values such as
 * `apps\stage-tamagotchi\src\renderer/main.ts` and counted a vendored SDK sample
 * under `renderer\.cache\...` as a production producer. These cases run on Linux
 * as pure fixtures so the derivation is proven without a Windows host.
 */
describe('test-helpers Windows path portability (D2B9-D)', () => {
  const WINDOWS_REPO_ROOT = 'C:\\repo\\airi'
  const CUBISM_RELATIVE = 'apps/stage-tamagotchi/src/renderer/.cache/assets/js/CubismSdkForWeb-5-r.3/Samples/TypeScript/Demo/src/lappsubdelegate.ts'

  function dirent(parentPath: string, name: string, isFile = true) {
    return { isFile: () => isFile, name, parentPath }
  }

  it('derives a POSIX repo-relative path from native Windows paths', () => {
    expect(repoRelativePosix(
      WINDOWS_REPO_ROOT,
      'C:\\repo\\airi\\apps\\stage-tamagotchi\\src\\renderer\\main.ts',
    )).toBe('apps/stage-tamagotchi/src/renderer/main.ts')
  })

  it('derives the same POSIX path from mixed separators', () => {
    expect(repoRelativePosix(
      WINDOWS_REPO_ROOT,
      'C:/repo/airi/apps\\stage-tamagotchi/src/renderer\\services\\lia/send-terminal-reporter.ts',
    )).toBe('apps/stage-tamagotchi/src/renderer/services/lia/send-terminal-reporter.ts')
  })

  it('never emits a backslash, whatever the host separators were', () => {
    const derived = repoRelativePosix(WINDOWS_REPO_ROOT, 'C:\\repo\\airi\\packages\\lia-core\\src\\brain\\runtime.ts')
    expect(derived).toBe('packages/lia-core/src/brain/runtime.ts')
    expect(derived).not.toContain('\\')
  })

  it('classifies a generated .cache path as generated in POSIX and native form', () => {
    expect(isGeneratedRepoPath(CUBISM_RELATIVE)).toBe(true)
    expect(isGeneratedRepoPath(CUBISM_RELATIVE.replace(/\//g, '\\'))).toBe(true)
  })

  it('classifies every required generated segment, and only those', () => {
    for (const segment of ['.cache', 'dist', 'node_modules', 'coverage', '.turbo']) {
      expect(isGeneratedRepoPath(`apps/stage-tamagotchi/src/${segment}/nested/file.ts`), segment).toBe(true)
    }
    expect(isGeneratedRepoPath('apps/stage-tamagotchi/src/renderer/main.ts')).toBe(false)
    expect(isGeneratedRepoPath('packages/stage-ui/src/stores/chat.ts')).toBe(false)
  })

  it('resolves an authored Windows entry to a POSIX repo-relative path', () => {
    const authored = authoredSourceEntry(
      WINDOWS_REPO_ROOT,
      dirent('C:\\repo\\airi\\apps\\stage-tamagotchi\\src\\renderer', 'main.ts'),
    )
    expect(authored).not.toBeNull()
    expect(authored!.relativePosix).toBe('apps/stage-tamagotchi/src/renderer/main.ts')
    expect(authored!.relativePosix).not.toContain('\\')
  })

  it('excludes the generated CubismSdk sample BEFORE it can be read', () => {
    const authored = authoredSourceEntry(
      WINDOWS_REPO_ROOT,
      dirent(
        'C:\\repo\\airi\\apps\\stage-tamagotchi\\src\\renderer\\.cache\\assets\\js\\CubismSdkForWeb-5-r.3\\Samples\\TypeScript\\Demo\\src',
        'lappsubdelegate.ts',
      ),
    )
    expect(authored).toBeNull()
  })

  it('excludes directories and every generated segment for native entries', () => {
    expect(authoredSourceEntry(WINDOWS_REPO_ROOT, dirent('C:\\repo\\airi\\apps', 'stage-tamagotchi', false))).toBeNull()
    for (const segment of ['.cache', 'dist', 'node_modules', 'coverage', '.turbo']) {
      expect(
        authoredSourceEntry(WINDOWS_REPO_ROOT, dirent(`C:\\repo\\airi\\apps\\stage-tamagotchi\\src\\${segment}\\deep`, 'file.ts')),
        segment,
      ).toBeNull()
    }
  })
})
