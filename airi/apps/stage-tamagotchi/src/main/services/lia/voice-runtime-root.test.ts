import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  adoptRuntimeRootSync,
  ATSETUP_FORBIDDEN_PATH_CHARS,
  migrateLegacyRuntimeRootsSync,
  resolveLocalAppDataDir,
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
      expect(char.replace(ATSETUP_FORBIDDEN_PATH_CHARS, '~')).toBe('~')
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

describe('adoptRuntimeRootSync - the never-break-the-panel decision', () => {
  const epermDeps = (harness: ReturnType<typeof createFsHarness>) => {
    harness.deps.renameSync = () => {
      throw new Error('EPERM: operation not permitted, rename')
    }
    return harness.deps
  }

  it('adopts the new root and reports the migration when it succeeds', () => {
    const harness = createFsHarness([ROUND_SIX_ROOT])
    const decision = adoptRuntimeRootSync(LAYOUT, harness.deps)
    expect(decision).toEqual({ adopted: 'migrated', rootDir: LAYOUT.rootDir })
  })

  it('passes a no-op through unchanged (root already present)', () => {
    const harness = createFsHarness([LAYOUT.rootDir, ROUND_SIX_ROOT])
    const decision = adoptRuntimeRootSync(LAYOUT, harness.deps)
    expect(decision).toEqual({ adopted: 'root-present', rootDir: LAYOUT.rootDir })
  })

  it('on a failed rename, adopts the newest char-safe legacy root instead of throwing', () => {
    // The round-6 QA machine shape: a leftover voice server (or an AV handle)
    // holds files in the old tree, rename fails with EPERM, and without this
    // adoption the runtime-state IPC kept rejecting - so the Install card
    // never mounted. With it, the session works from the round-6 root and the
    // rename is retried on the next process start.
    const harness = createFsHarness([ROUND_SIX_ROOT])
    const decision = adoptRuntimeRootSync(LAYOUT, epermDeps(harness))
    expect(decision.adopted).toBe('fallback-legacy')
    expect(decision.rootDir).toBe(ROUND_SIX_ROOT)
    expect(decision.error).toContain('EPERM')
    const entry = harness.logs[0] as { detail?: string, event?: string }
    expect(entry.event).toBe('migration-failed-fallback-legacy')
    expect(entry.detail).toContain(ROUND_SIX_ROOT)
    expect(entry.detail).toContain('EPERM')
  })

  it('prefers a fresh new root over the char-poisoned @proj-airi tree, even when it is the only legacy', () => {
    // Never resurrect the path the installer cannot survive. Nothing is
    // copied, nothing is deleted: the Install card comes back and the guided
    // flow builds the new root.
    const harness = createFsHarness([ORIGINAL_ROOT])
    const decision = adoptRuntimeRootSync(LAYOUT, epermDeps(harness))
    expect(decision.adopted).toBe('fallback-fresh-root')
    expect(decision.rootDir).toBe(LAYOUT.rootDir)
    expect(decision.rootDir).not.toContain('@')
    expect(harness.existing.has(ORIGINAL_ROOT)).toBe(true) // untouched
    const entry = harness.logs[0] as { detail?: string, event?: string }
    expect(entry.event).toBe('migration-failed-fallback-fresh-root')
  })

  it('on an empty disk the new root wins through the ordinary no-op path - nothing to copy or delete', () => {
    // Nothing to migrate means the rename never runs: adoption is the plain
    // legacy-absent no-op, not a fallback.
    const harness = createFsHarness([])
    const decision = adoptRuntimeRootSync(LAYOUT, epermDeps(harness))
    expect(decision.adopted).toBe('legacy-absent')
    expect(decision.rootDir).toBe(LAYOUT.rootDir)
    expect(harness.existing.size).toBe(0)
    expect(harness.calls).toEqual([])
  })

  it('a failed mkdir of the new root parent also falls back, not through', () => {
    // mkdirSync is part of the migration step too; whatever stage throws, the
    // decision must end in a usable root for this session.
    const harness = createFsHarness([ROUND_SIX_ROOT])
    harness.deps.mkdirSync = () => {
      throw new Error('EPERM: mkdir')
    }
    const decision = adoptRuntimeRootSync(LAYOUT, harness.deps)
    expect(decision.adopted).toBe('fallback-legacy')
    expect(decision.rootDir).toBe(ROUND_SIX_ROOT)
  })
})

/**
 * Round-7 hotfix 4, items A/B/F: `%LOCALAPPDATA%` from the one supported
 * source. `app.getPath` has no 'localAppData' name on any Electron release -
 * passing one threw at bridge-registration and took the whole handler with
 * it, which is what made the Install click die between "install-invoke" and a
 * main that never heard it. The environment is the documented source, and it
 * is validated here before the layout consumes it.
 */
describe('resolveLocalAppDataDir - the supported %LOCALAPPDATA% source', () => {
  it('returns the local profile directory on Windows (F)', () => {
    const local = resolveLocalAppDataDir('win32', name => (
      name === 'LOCALAPPDATA' ? String.raw`C:\Users\Test\AppData\Local` : undefined
    ))
    expect(local).toBe(String.raw`C:\Users\Test\AppData\Local`)

    // End to end through the layout: the exact target of the product
    // decision, checked with the same conviction the report demands.
    const layout = resolveRuntimeRootLayout({
      appDataDir: String.raw`C:\Users\Test\AppData\Roaming`,
      localAppDataDir: local,
      pathApi: win,
      platform: 'win32',
      userDataDir: String.raw`C:\Users\Test\AppData\Roaming\@proj-airi\stage-tamagotchi`,
    })
    expect(layout.rootDir).toBe(String.raw`C:\Users\Test\AppData\Local\Lia\runtimes\alltalk`)
    expect(win.isAbsolute(layout.rootDir)).toBe(true)
    expect(layout.rootDir.includes('Roaming')).toBe(false)
    expect(layout.rootDir.includes('@')).toBe(false)
    for (const char of ATSETUP_BLACKLIST_CHARS) {
      expect(layout.rootDir.includes(char)).toBe(false)
    }
  })

  it('fails with an operational error when no LocalAppData source resolves (F - hotfix item 4)', () => {
    // The old copy ordered users to reinstall their Windows profile - the
    // core cannot conclude that from a missing env key (hotfix, item 4).
    expect(() => resolveLocalAppDataDir('win32', () => undefined))
      .toThrow(/Could not resolve Windows LocalAppData/)
    expect(() => resolveLocalAppDataDir('win32', () => undefined))
      .toThrow(/LOCALAPPDATA is not present/)
    expect(() => resolveLocalAppDataDir('win32', () => undefined))
      .toThrow(/USERPROFILE is not present/)
    expect(() => resolveLocalAppDataDir('win32', () => undefined))
      .not
      .toThrow(/reinstall/)
    expect(() => resolveLocalAppDataDir('win32', () => ''))
      .toThrow(/Could not resolve Windows LocalAppData/)
  })

  it('validates USERPROFILE\\AppData\\Local as the defensive fallback (hotfix item 3)', () => {
    const env = (values: Record<string, string | undefined>) =>
      (name: string) => values[name]
    expect(resolveLocalAppDataDir('win32', env({ LOCALAPPDATA: undefined, USERPROFILE: 'C:\\Users\\lucas' })))
      .toBe(String.raw`C:\Users\lucas\AppData\Local`)
    // A faulty primary must never hide a valid profile-root fallback.
    expect(resolveLocalAppDataDir('win32', env({ LOCALAPPDATA: 'relative', USERPROFILE: 'C:\\Users\\lucas' })))
      .toBe(String.raw`C:\Users\lucas\AppData\Local`)
    // Trailing separators in the profile root stay single.
    expect(resolveLocalAppDataDir('win32', env({ LOCALAPPDATA: '', USERPROFILE: 'C:\\Users\\lucas\\' })))
      .toBe(String.raw`C:\Users\lucas\AppData\Local`)
    // Roaming is never a LocalAppData substitute (hotfix item 3).
    expect(() => resolveLocalAppDataDir('win32', env({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' })))
      .toThrow(/Could not resolve Windows LocalAppData/)
  })

  it('rejects a LOCALAPPDATA that is not an absolute Windows path (F)', () => {
    expect(() => resolveLocalAppDataDir('win32', () => 'AppData\\Local')).toThrow(/not an absolute Windows path/)
    expect(() => resolveLocalAppDataDir('win32', () => '/usr/local')).toThrow(/not an absolute Windows path/)
    // UNC roots remain valid, as real (if rare) Windows setups show.
    expect(resolveLocalAppDataDir('win32', () => '\\\\server\\share')).toBe('\\\\server\\share')
  })

  it('rejects blacklist characters rather than sheltering a broken install (F)', () => {
    expect(() => resolveLocalAppDataDir('win32', () => String.raw`C:\Users\T@st\AppData\Local`)).toThrow(/characters the voice installer cannot handle/)
  })

  it('reads nothing off Windows, so non-Windows profiles cannot fail here (B)', () => {
    expect(resolveLocalAppDataDir('darwin', () => {
      throw new Error('must not read')
    })).toBe('')
    expect(resolveLocalAppDataDir('linux', () => undefined)).toBe('')
  })
})
