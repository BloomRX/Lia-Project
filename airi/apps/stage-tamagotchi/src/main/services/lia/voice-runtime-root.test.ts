import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ATSETUP_FORBIDDEN_PATH_CHARS,
  migrateLegacyRuntimeRootsSync,
  resolveRuntimeRootLayout,
  sanitizeWindowsRuntimeRelativePath,
  sanitizeWindowsRuntimeSegment,
} from './voice-runtime-root'

/**
 * The round-7 runtime root: `%LOCALAPPDATA%\Lia\runtimes\alltalk`.
 *
 * Round 5 proved the `@` in `@proj-airi` made the Miniconda silent installer
 * exit 2; round 7 (product decision) moved the multi-GB tree out of Roaming
 * into the local profile directory. Everything here is dependency-free with
 * an injectable path api, so Windows semantics are tested on a POSIX runner.
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

const WIN_INPUT = {
  appDataDir: String.raw`C:\Users\lucas\AppData\Roaming`,
  localAppDataDir: String.raw`C:\Users\lucas\AppData\Local`,
  pathApi: win,
  platform: 'win32',
  userDataDir: String.raw`C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi`,
} as const

describe('resolveRuntimeRootLayout', () => {
  it('roots the Windows runtime at %LOCALAPPDATA%\\Lia - local, not roaming, no blacklist chars', () => {
    const layout = resolveRuntimeRootLayout(WIN_INPUT)
    expect(layout.rootDir).toBe(String.raw`C:\Users\lucas\AppData\Local\Lia\runtimes\alltalk`)
    for (const char of ATSETUP_BLACKLIST_CHARS) {
      expect(layout.rootDir.includes(char)).toBe(false)
    }
  })

  it('keeps BOTH previous roots as migration candidates, most recent first', () => {
    const layout = resolveRuntimeRootLayout(WIN_INPUT)
    expect(layout.legacyRootDirs).toEqual([
      String.raw`C:\Users\lucas\AppData\Roaming\proj-airi\stage-tamagotchi\runtimes\alltalk`,
      String.raw`C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\runtimes\alltalk`,
    ])
  })

  it('keeps the userData root untouched off Windows, with nothing to migrate', () => {
    const layout = resolveRuntimeRootLayout({
      appDataDir: '/home/lia/.config',
      localAppDataDir: '',
      pathApi: posix,
      platform: 'linux',
      userDataDir: '/home/lia/.config/@proj-airi/stage-tamagotchi',
    })
    expect(layout.rootDir).toBe('/home/lia/.config/@proj-airi/stage-tamagotchi/runtimes/alltalk')
    expect(layout.legacyRootDirs).toEqual([])
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

const LAYOUT = resolveRuntimeRootLayout(WIN_INPUT)
const ROUND_SIX_ROOT = LAYOUT.legacyRootDirs[0]
const ORIGINAL_ROOT = LAYOUT.legacyRootDirs[1]

describe('migrateLegacyRuntimeRootsSync', () => {
  it('moves the most recent legacy tree in one rename - installer and state come along, no re-download', () => {
    const harness = createFsHarness([ROUND_SIX_ROOT])
    const facts = migrateLegacyRuntimeRootsSync(LAYOUT, harness.deps)
    expect(facts).toEqual({ from: ROUND_SIX_ROOT, migrated: true, to: LAYOUT.rootDir })
    // Parents are created BEFORE the rename, and the rename is issued exactly once.
    expect(harness.calls).toEqual([
      `mkdir:${String.raw`C:\Users\lucas\AppData\Local\Lia\runtimes`}`,
      `rename:${ROUND_SIX_ROOT}->${LAYOUT.rootDir}`,
    ])
    const entry = harness.logs[0] as { detail?: string, event?: string }
    expect(entry.event).toBe('migrated')
    expect(entry.detail).toContain('Roaming\\proj-airi')
    expect(entry.detail).toContain(String.raw`Local\Lia`)
  })

  it('falls back to the oldest root when the round-6 one never existed', () => {
    const harness = createFsHarness([ORIGINAL_ROOT])
    const facts = migrateLegacyRuntimeRootsSync(LAYOUT, harness.deps)
    expect(facts).toEqual({ from: ORIGINAL_ROOT, migrated: true, to: LAYOUT.rootDir })
  })

  it('prefers the newest legacy root when several exist', () => {
    const harness = createFsHarness([ROUND_SIX_ROOT, ORIGINAL_ROOT])
    const facts = migrateLegacyRuntimeRootsSync(LAYOUT, harness.deps)
    expect(facts.from).toBe(ROUND_SIX_ROOT)
    expect(harness.calls.filter(call => call.startsWith('rename:'))).toHaveLength(1)
  })

  it('never overwrites an existing destination, even when a legacy tree also exists', () => {
    const harness = createFsHarness([LAYOUT.rootDir, ROUND_SIX_ROOT])
    const facts = migrateLegacyRuntimeRootsSync(LAYOUT, harness.deps)
    expect(facts).toEqual({ from: undefined, migrated: false, reason: 'root-present', to: LAYOUT.rootDir })
    expect(harness.calls).toEqual([])
    expect(harness.existing.has(ROUND_SIX_ROOT)).toBe(true)
  })

  it('is a no-op on a fresh install (nothing to move)', () => {
    const harness = createFsHarness([])
    const facts = migrateLegacyRuntimeRootsSync(LAYOUT, harness.deps)
    expect(facts).toEqual({ from: undefined, migrated: false, reason: 'legacy-absent', to: LAYOUT.rootDir })
    expect(harness.calls).toEqual([])
  })

  it('never renames when the root is its own only candidate (non-Windows layout)', () => {
    const layout = resolveRuntimeRootLayout({
      appDataDir: '/home/lia/.config',
      localAppDataDir: '',
      pathApi: posix,
      platform: 'linux',
      userDataDir: '/home/lia/.config/@proj-airi/stage-tamagotchi',
    })
    const harness = createFsHarness([layout.rootDir])
    const facts = migrateLegacyRuntimeRootsSync(layout, harness.deps)
    expect(facts).toEqual({ from: undefined, migrated: false, reason: 'same-path', to: layout.rootDir })
    expect(harness.calls).toEqual([])
  })

  it('propagates a failed rename instead of silently resurrecting the legacy path', () => {
    const harness = createFsHarness([ROUND_SIX_ROOT])
    harness.deps.renameSync = () => {
      throw new Error('EPERM: operation not permitted')
    }
    expect(() => migrateLegacyRuntimeRootsSync(LAYOUT, harness.deps)).toThrow('EPERM')
    expect(harness.logs).toEqual([])
  })
})
