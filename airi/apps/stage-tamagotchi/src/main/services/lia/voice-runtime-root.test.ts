import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ATSETUP_FORBIDDEN_PATH_CHARS,
  migrateLegacyRuntimeRootSync,
  resolveRuntimeRootLayout,
  sanitizeWindowsRuntimeRelativePath,
  sanitizeWindowsRuntimeSegment,
} from './voice-runtime-root'

/**
 * Round-6 runtime root: the `@` in `@proj-airi` made the Miniconda silent
 * installer exit 2 (proven by the round-5 probe). The sanitizer and the
 * migration live here, dependency-free, so Windows semantics are tested on a
 * POSIX runner - the bug class itself was invisible on Linux.
 */

const win = path.win32
const posix = path.posix

/**
 * The exact character set of the pinned atsetup.bat `findstr` blacklist,
 * copied literally: `[!#\$%&()\*+,;<=>?@\[\]\^`{|}~]`. If this list ever
 * diverges from upstream, the pin fails loudly instead of silently
 * re-exposing the runtime to a character atsetup refuses.
 */
const ATSETUP_BLACKLIST_CHARS = [...'!#$%&()*+,;<=>?@[]^`{|}~']

describe('the atsetup-forbidden-chars regex pin', () => {
  it('covers exactly the atsetup blacklist set', () => {
    const target = '@@proj-airi'
    for (const char of ATSETUP_BLACKLIST_CHARS) {
      expect(char.replace(ATSETUP_FORBIDDEN_PATH_CHARS, '~')).toBe('~', `char ${char} must be blacklisted`)
    }
    expect(target.replace(ATSETUP_FORBIDDEN_PATH_CHARS, '~')).toBe('~proj-airi')
    // Characters that must NOT be touched: plain text, dash, underscore, dot.
    expect('proj-airi_stage.tamagotchi'.replace(ATSETUP_FORBIDDEN_PATH_CHARS, '~')).toBe('proj-airi_stage.tamagotchi')
  })
})

describe('sanitizeWindowsRuntimeSegment', () => {
  it('strips the real offender: the scoped product name', () => {
    expect(sanitizeWindowsRuntimeSegment('@proj-airi')).toBe('proj-airi')
  })

  it('collapses runs of forbidden characters and trims the resulting dashes', () => {
    expect(sanitizeWindowsRuntimeSegment('@@proj~~airi@@')).toBe('proj-airi')
    expect(sanitizeWindowsRuntimeSegment('a!b')).toBe('a-b')
  })

  it('returns an empty segment when nothing legal remains', () => {
    expect(sanitizeWindowsRuntimeSegment('@@@')).toBe('')
  })

  it('leaves clean segments untouched', () => {
    expect(sanitizeWindowsRuntimeSegment('stage-tamagotchi')).toBe('stage-tamagotchi')
  })
})

describe('sanitizeWindowsRuntimeRelativePath', () => {
  it('sanitizes per segment and drops emptied ones', () => {
    expect(sanitizeWindowsRuntimeRelativePath(String.raw`@proj-airi\stage-tamagotchi`)).toBe('proj-airi/stage-tamagotchi')
    expect(sanitizeWindowsRuntimeRelativePath('../@proj-airi')).toBe('../proj-airi')
  })
})

describe('resolveRuntimeRootLayout', () => {
  const appData = String.raw`C:\Users\lucas\AppData\Roaming`
  const userData = String.raw`C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi`

  it('moves the Windows root to the sanitized sibling (the shape that made the probe exit 0)', () => {
    const layout = resolveRuntimeRootLayout({ appDataDir: appData, pathApi: win, platform: 'win32', userDataDir: userData })
    expect(layout.rootDir).toBe(String.raw`C:\Users\lucas\AppData\Roaming\proj-airi\stage-tamagotchi\runtimes\alltalk`)
    expect(layout.legacyRootDir).toBe(String.raw`C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\runtimes\alltalk`)
  })

  it('guarantees no atsetup-blacklisted character survives in the effective root', () => {
    const layout = resolveRuntimeRootLayout({ appDataDir: appData, pathApi: win, platform: 'win32', userDataDir: userData })
    for (const char of ATSETUP_BLACKLIST_CHARS) {
      expect(layout.rootDir.includes(char)).toBe(false)
    }
  })

  it('keeps the legacy root untouched off Windows', () => {
    const layout = resolveRuntimeRootLayout({
      appDataDir: '/home/lia/.config',
      pathApi: posix,
      platform: 'linux',
      userDataDir: '/home/lia/.config/@proj-airi/stage-tamagotchi',
    })
    expect(layout.rootDir).toBe(layout.legacyRootDir)
    expect(layout.rootDir).toBe('/home/lia/.config/@proj-airi/stage-tamagotchi/runtimes/alltalk')
  })
})

function createFsHarness(initialPaths: string[]) {
  const existing = new Set(initialPaths)
  const calls: string[] = []
  const logs: unknown[] = []
  return {
    calls,
    deps: {
      existsSync: (target: string) => existing.has(target),
      log: (entry: unknown) => { logs.push(entry) },
      mkdirSync: (target: string) => { calls.push(`mkdir:${target}`) },
      renameSync: (from: string, to: string) => {
        calls.push(`rename:${from}->${to}`)
        if (!existing.has(from)) {
          throw new Error(`ENOENT: no such file or directory, rename '${from}' -> '${to}'`)
        }
        existing.delete(from)
        existing.add(to)
      },
    },
    existing,
    logs,
  }
}

const WIN_LAYOUT = {
  legacyRootDir: String.raw`C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\runtimes\alltalk`,
  rootDir: String.raw`C:\Users\lucas\AppData\Roaming\proj-airi\stage-tamagotchi\runtimes\alltalk`,
}

describe('migrateLegacyRuntimeRootSync', () => {
  it('moves the legacy tree in one rename (no re-download of the 97/85 MB payloads)', () => {
    const harness = createFsHarness([WIN_LAYOUT.legacyRootDir])
    const facts = migrateLegacyRuntimeRootSync(WIN_LAYOUT, harness.deps)
    expect(facts).toEqual({ from: WIN_LAYOUT.legacyRootDir, migrated: true, to: WIN_LAYOUT.rootDir })
    // Parents are created BEFORE the rename, and the rename is issued exactly once.
    expect(harness.calls).toEqual([
      `mkdir:${String.raw`C:\Users\lucas\AppData\Roaming\proj-airi\stage-tamagotchi\runtimes`}`,
      `rename:${WIN_LAYOUT.legacyRootDir}->${WIN_LAYOUT.rootDir}`,
    ])
    expect(harness.existing.has(WIN_LAYOUT.rootDir)).toBe(true)
    expect(harness.existing.has(WIN_LAYOUT.legacyRootDir)).toBe(false)
    const entry = harness.logs[0] as { detail?: string, event?: string }
    expect(entry.event).toBe('migrated')
    expect(entry.detail).toContain('@proj-airi')
    expect(entry.detail).toContain('proj-airi\\stage-tamagotchi')
  })

  it('is a no-op when the new root already exists (post-migration steady state)', () => {
    const harness = createFsHarness([WIN_LAYOUT.rootDir, WIN_LAYOUT.legacyRootDir])
    const facts = migrateLegacyRuntimeRootSync(WIN_LAYOUT, harness.deps)
    expect(facts).toEqual({ from: WIN_LAYOUT.legacyRootDir, migrated: false, reason: 'root-present', to: WIN_LAYOUT.rootDir })
    expect(harness.calls).toEqual([])
  })

  it('is a no-op on a fresh install (nothing to move)', () => {
    const harness = createFsHarness([])
    const facts = migrateLegacyRuntimeRootSync(WIN_LAYOUT, harness.deps)
    expect(facts.reason).toBe('legacy-absent')
    expect(facts.migrated).toBe(false)
    expect(harness.calls).toEqual([])
  })

  it('never renames when both roots are the same path (non-Windows layout)', () => {
    const same = { legacyRootDir: WIN_LAYOUT.rootDir, rootDir: WIN_LAYOUT.rootDir }
    const harness = createFsHarness([WIN_LAYOUT.rootDir])
    const facts = migrateLegacyRuntimeRootSync(same, harness.deps)
    expect(facts).toEqual({ from: WIN_LAYOUT.rootDir, migrated: false, reason: 'same-path', to: WIN_LAYOUT.rootDir })
    expect(harness.calls).toEqual([])
  })

  it('propagates a failed rename instead of silently resurrecting the @ path', () => {
    // Harness sees the legacy dir as present but refuses the actual rename.
    const harness = createFsHarness([WIN_LAYOUT.legacyRootDir])
    harness.deps.renameSync = () => {
      throw new Error('EPERM: operation not permitted')
    }
    expect(() => migrateLegacyRuntimeRootSync(WIN_LAYOUT, harness.deps)).toThrow('EPERM')
    expect(harness.logs).toEqual([])
  })
})
