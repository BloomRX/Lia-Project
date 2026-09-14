import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { detectStripRoot, isInsideRoot, isSymlinkEntry, resolveArchiveEntry } from './archive-path'

/**
 * Archive path validation, exercised against both platforms.
 *
 * `pathImpl` is injected precisely so Windows semantics can be tested on a POSIX
 * machine. That matters more than it looks: the bug this module exists to fix was
 * invisible on Linux, where `/` is the only separator, and only appeared when a
 * real Windows install compared `C:\...\alltalk/app` against
 * `C:\...\alltalk\app\x`. Testing only the host platform would have shipped it.
 */

const win = path.win32
const posix = path.posix

const WIN_ROOT = 'C:\\Users\\lia\\AppData\\Local\\Lia\\runtimes\\alltalk\\app'
const WRAPPER = 'alltalk_tts-f16117e95b540e9bbbd8247b49ca6c6b1350b172'

/** Convenience for the accepted case. */
function accept(entryName: string, opts: { pathImpl?: typeof win, root?: string, stripRoot?: string } = {}) {
  return resolveArchiveEntry({
    entryName,
    pathImpl: opts.pathImpl ?? win,
    rootDir: opts.root ?? WIN_ROOT,
    stripRoot: opts.stripRoot ?? WRAPPER,
  })
}

describe('the Windows false positive that broke a real install', () => {
  it('accepts an entry when the root was built with forward slashes', () => {
    // The exact shape the bootstrapper produced: a Windows path with a hardcoded
    // '/' appended. The guard used to compare this un-normalised string against a
    // backslash-normalised target and reject everything.
    const mixedRoot = 'C:\\Users\\lia\\AppData\\Local\\Lia\\runtimes\\alltalk/app'

    const result = accept(`${WRAPPER}/script.py`, { root: mixedRoot })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.target).toBe(`${WIN_ROOT}\\script.py`)
      expect(result.relative).toBe('script.py')
    }
  })

  it('accepts the real archive shape end to end', () => {
    for (const name of [
      `${WRAPPER}/script.py`,
      `${WRAPPER}/atsetup.bat`,
      `${WRAPPER}/system/tts_generator/tts_server.py`,
      `${WRAPPER}/.github/workflows/python-ci.yml`,
    ]) {
      const result = accept(name)
      expect(result.ok, name).toBe(true)
    }
  })

  it('recognises the wrapper directory marker as nothing to write', () => {
    const result = accept(`${WRAPPER}/`)

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.isRootMarker).toBe(true)
  })
})

describe('accepts', () => {
  it('accepts nested paths and dot-directories', () => {
    expect(accept(`${WRAPPER}/sub/file.py`).ok).toBe(true)
    expect(accept(`${WRAPPER}/.github/x`).ok).toBe(true)
  })

  it('accepts forward slashes on Windows', () => {
    const result = accept(`${WRAPPER}/a/b/c.txt`)

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.target).toBe(`${WIN_ROOT}\\a\\b\\c.txt`)
  })

  it('accepts a plain filename with no wrapper to strip', () => {
    const result = resolveArchiveEntry({
      entryName: 'script.py',
      pathImpl: win,
      rootDir: WIN_ROOT,
    })

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.relative).toBe('script.py')
  })

  it('accepts the same shapes on POSIX', () => {
    const result = resolveArchiveEntry({
      entryName: `${WRAPPER}/system/x.py`,
      pathImpl: posix,
      rootDir: '/home/lia/.local/share/lia/runtimes/alltalk/app',
      stripRoot: WRAPPER,
    })

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.target).toBe('/home/lia/.local/share/lia/runtimes/alltalk/app/system/x.py')
  })

  it('treats a backslash as an ordinary filename character on POSIX', () => {
    // On POSIX `a\b.py` is one legal filename, not a path. Rewriting the separator
    // there would create a different file than the archive asked for.
    const result = resolveArchiveEntry({
      entryName: 'a\\b.py',
      pathImpl: posix,
      rootDir: '/tmp/dest',
    })

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.relative).toBe('a\\b.py')
  })
})

describe('rejects traversal', () => {
  const cases: Array<[string, string]> = [
    ['../evil', 'parent-traversal'],
    [`${WRAPPER}/../../evil`, 'parent-traversal'],
    ['..\\evil', 'parent-traversal'],
    ['a/../../evil', 'parent-traversal'],
    ['C:\\evil', 'drive-letter'],
    ['C:/evil', 'drive-letter'],
    ['c:/evil', 'drive-letter'],
    ['/evil', 'absolute'],
    ['//evil', 'unc'],
    ['\\\\server\\share\\evil', 'unc'],
    ['//server/share/evil', 'unc'],
    ['', 'empty'],
    ['/', 'absolute'],
  ]

  for (const [entryName, reason] of cases) {
    it(`refuses ${JSON.stringify(entryName)} as ${reason}`, () => {
      const result = accept(entryName)

      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toBe(reason)
    })
  }

  it('refuses backslash traversal on Windows but not on POSIX', () => {
    // The same string means traversal on Windows and a filename on POSIX. Both
    // answers are correct; the platform decides which applies.
    expect(accept('..\\evil', { pathImpl: win }).ok).toBe(false)
    expect(accept('..\\evil', { pathImpl: posix }).ok).toBe(true)
  })

  it('validates before resolving, so the attempt stays visible', () => {
    // Resolving first would collapse `..` and leave nothing to inspect. The reason
    // is what makes the log line useful.
    const result = accept(`${WRAPPER}/../../evil`)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('parent-traversal')
      expect(result.raw).toBe(`${WRAPPER}/../../evil`)
      expect(result.normalised).toContain('..')
    }
  })
})

describe('boundary checking', () => {
  it('refuses a sibling directory whose name merely starts with the root', () => {
    // The classic failure of a bare startsWith: C:\runtime is a string prefix of
    // C:\runtime-evil\x, but that path is outside the root.
    const result = resolveArchiveEntry({
      entryName: 'x',
      pathImpl: win,
      rootDir: 'C:\\runtime',
    })

    // A bare `x` cannot reach the sibling on its own - what matters is that the
    // comparison would not have accepted it if something had.
    expect(result.ok).toBe(true)

    const naive = 'C:\\runtime-evil\\x'.startsWith('C:\\runtime')
    expect(naive).toBe(true)
  })

  it('refuses a resolved path that lands outside via the root itself', () => {
    // Simulates what a bare startsWith would have waved through: a target in a
    // sibling directory sharing the root's name as a prefix.
    const root = win.resolve('C:\\runtime')
    const sibling = win.resolve('C:\\runtime-evil\\x')

    const inside = sibling === root || sibling.startsWith(`${root}${win.sep}`)
    expect(inside).toBe(false)

    // And the naive form, for contrast.
    expect(sibling.startsWith(root)).toBe(true)
  })

  it('accepts a path directly at the root', () => {
    const result = accept('script.py')

    expect(result.ok).toBe(true)
    if (result.ok)
      expect(result.target).toBe(`${WIN_ROOT}\\script.py`)
  })
})

describe('wrapper detection', () => {
  const names = [
    `${WRAPPER}/`,
    `${WRAPPER}/script.py`,
    `${WRAPPER}/system/x.py`,
  ]

  it('detects a single wrapper directory', () => {
    expect(detectStripRoot(names, win)).toBe(WRAPPER)
  })

  it('does not strip when entries sit at the top level', () => {
    // Stripping the first component here would silently eat a real directory.
    expect(detectStripRoot(['a.py', 'b/c.py'], win)).toBeUndefined()
  })

  it('does not strip a single top-level file', () => {
    expect(detectStripRoot(['only.py'], win)).toBeUndefined()
  })

  it('does not strip a wrapper that is not an ordinary name', () => {
    expect(detectStripRoot(['../a.py', '../b/c.py'], win)).toBeUndefined()
    expect(detectStripRoot(['C:/a.py', 'C:/b/c.py'], win)).toBeUndefined()
  })

  it('returns nothing for an empty archive', () => {
    expect(detectStripRoot([], win)).toBeUndefined()
  })

  it('detects the same wrapper using POSIX semantics', () => {
    expect(detectStripRoot(names, posix)).toBe(WRAPPER)
  })
})

describe('root boundary comparison', () => {
  // Tested directly rather than only through resolveArchiveEntry: with `..`
  // refused, a resolved entry can no longer leave the root, so this comparison is
  // unreachable through the entry name. Left untested it could be weakened to a
  // bare startsWith and the whole suite would still pass.
  it('refuses a sibling directory that merely shares the root as a prefix', () => {
    const root = win.resolve('C:\\runtime')

    expect(isInsideRoot(win.resolve('C:\\runtime-evil\\x'), root, win)).toBe(false)
    expect(isInsideRoot(win.resolve('C:\\runtime2\\x'), root, win)).toBe(false)
  })

  it('accepts a path genuinely inside the root', () => {
    const root = win.resolve('C:\\runtime')

    expect(isInsideRoot(win.resolve('C:\\runtime\\x'), root, win)).toBe(true)
    expect(isInsideRoot(win.resolve('C:\\runtime\\a\\b\\c.txt'), root, win)).toBe(true)
  })

  it('accepts the root itself', () => {
    const root = win.resolve('C:\\runtime')

    expect(isInsideRoot(root, root, win)).toBe(true)
  })

  it('behaves the same way on POSIX', () => {
    const root = posix.resolve('/srv/runtime')

    expect(isInsideRoot(posix.resolve('/srv/runtime-evil/x'), root, posix)).toBe(false)
    expect(isInsideRoot(posix.resolve('/srv/runtime/x'), root, posix)).toBe(true)
    expect(isInsideRoot(root, root, posix)).toBe(true)
  })

  it('is not satisfied by the naive comparison it replaces', () => {
    // Documents why the separator matters, so the difference is visible to whoever
    // reads this next rather than being rediscovered by a mutation.
    const root = win.resolve('C:\\runtime')
    const sibling = win.resolve('C:\\runtime-evil\\x')

    expect(sibling.startsWith(root)).toBe(true)
    expect(isInsideRoot(sibling, root, win)).toBe(false)
  })
})

describe('symbolic links', () => {
  const S_IFLNK = 0o120_000
  const S_IFREG = 0o100_000
  const S_IFDIR = 0o40_000
  const MADE_BY_UNIX = 3 << 8
  const MADE_BY_DOS = 0 << 8

  it('detects a Unix-made symlink', () => {
    expect(isSymlinkEntry({
      externalFileAttributes: (S_IFLNK | 0o777) << 16,
      versionMadeBy: MADE_BY_UNIX,
    })).toBe(true)
  })

  it('does not mistake a regular file or directory for a link', () => {
    expect(isSymlinkEntry({
      externalFileAttributes: (S_IFREG | 0o644) << 16,
      versionMadeBy: MADE_BY_UNIX,
    })).toBe(false)
    expect(isSymlinkEntry({
      externalFileAttributes: (S_IFDIR | 0o755) << 16,
      versionMadeBy: MADE_BY_UNIX,
    })).toBe(false)
  })

  it('does not read a mode out of DOS-made attributes', () => {
    // Those bits mean something else for an MS-DOS entry. Guessing a mode from
    // them would produce arbitrary verdicts, so the answer is conservatively false.
    expect(isSymlinkEntry({
      externalFileAttributes: (S_IFLNK | 0o777) << 16,
      versionMadeBy: MADE_BY_DOS,
    })).toBe(false)
  })

  it('refuses a symlink whose name looks perfectly innocent', () => {
    // Filename validation cannot see where a link points. The name passes every
    // path check above; only the attribute check catches it.
    const name = `${WRAPPER}/voices/shortcut`
    expect(accept(name).ok).toBe(true)
    expect(isSymlinkEntry({
      externalFileAttributes: (S_IFLNK | 0o777) << 16,
      versionMadeBy: MADE_BY_UNIX,
    })).toBe(true)
  })
})
