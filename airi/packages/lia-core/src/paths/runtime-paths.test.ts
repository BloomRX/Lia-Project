/**
 * Windows integration HOTFIX 3, core half: the canonical runtime paths.
 *
 * The whole story of the hotfix is here in miniature. The QA runtime sits,
 * perfectly valid, at `C:\Users\<you>\AppData\Local\Lia\runtimes\alltalk\app`
 * - put there by the AIRI installer - while the launcher was deriving an
 * install location from the product user-data home (the Roaming
 * stage-tamagotchi root, kept for config compatibility). A mutation that
 * derives the runtime root from userData must FAIL these tests (item C).
 *
 * NB: these assertions compare path SEGMENTS, not raw separator style -
 * `node:path.join` mixes separators when a Windows-style env value is fed
 * to the POSIX implementation this suite runs under, and the round-7
 * resolver (which these tests mirror) accepts exactly that same value.
 */
import { describe, expect, it } from 'vitest'

import { resolveAllTalkInstallCandidates, resolveAllTalkRuntimeDir, resolveLiaRuntimeRoot } from './runtime-paths'

/** Windows-style LOCALAPPDATA the way a real profile hands it over. */
const WIN_LOCAL = 'C:\\Users\\tester\\AppData\\Local'
/** The legacy config-compat home, deliberately nowhere near LocalAppData. */
const STAGE_USERDATA = 'C:\\Users\\tester\\AppData\\Roaming\\@proj-airi\\stage-tamagotchi'
const WIN_ENV = { LOCALAPPDATA: WIN_LOCAL }

/** segment-fold, so tests run on either node:path implementation. */
function asSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean)
}

describe('resolveLiaRuntimeRoot (hotfix 3)', () => {
  it('win32: resolves strictly under LOCALAPPDATA, Lia product segment, alltalk leaf', () => {
    expect(asSegments(resolveLiaRuntimeRoot({ env: WIN_ENV, platform: 'win32' })))
      .toEqual([...asSegments(WIN_LOCAL), 'Lia', 'runtimes', 'alltalk'])
  })

  it('win32 + legacy stage userData present: still LOCALAPPDATA - never derived from userData (test C)', () => {
    const root = resolveLiaRuntimeRoot({
      env: WIN_ENV,
      platform: 'win32',
      userDataDir: STAGE_USERDATA,
    })
    expect(asSegments(root)).toEqual([...asSegments(WIN_LOCAL), 'Lia', 'runtimes', 'alltalk'])
    expect(root).not.toContain('stage-tamagotchi')
    expect(root).not.toContain('Roaming')
  })

  it('posix: keeps the historical userData-based root', () => {
    expect(asSegments(resolveLiaRuntimeRoot({ platform: 'linux', userDataDir: '/home/me/.config/Lia' })))
      .toEqual(['home', 'me', '.config', 'Lia', 'runtimes', 'alltalk'])
  })

  it('win32 without LOCALAPPDATA: throws instead of guessing a root', () => {
    expect(() => resolveLiaRuntimeRoot({ env: {}, platform: 'win32' })).toThrow(/LOCALAPPDATA/)
    expect(() => resolveLiaRuntimeRoot({ env: { LOCALAPPDATA: 'relative' }, platform: 'win32' }))
      .toThrow(/absolute Windows path/)
  })
})

describe('resolveAllTalkRuntimeDir (hotfix 3)', () => {
  it('is <runtimeRoot>\\app - the tree the installer wrote and the markers check', () => {
    const appDir = resolveAllTalkRuntimeDir({ env: WIN_ENV, platform: 'win32' })
    expect(asSegments(appDir))
      .toEqual([...asSegments(WIN_LOCAL), 'Lia', 'runtimes', 'alltalk', 'app'])
  })
})

describe('resolveAllTalkInstallCandidates (hotfix 3)', () => {
  it('a configured document path comes first, the canonical app dir is always present (test A/C wiring)', () => {
    const candidates = resolveAllTalkInstallCandidates({
      configuredInstallDir: 'D:\\moved\\alltalk',
      env: WIN_ENV,
      platform: 'win32',
      userDataDir: STAGE_USERDATA,
    })
    expect(candidates.map(c => c.dir)).toEqual([
      'D:\\moved\\alltalk',
      resolveAllTalkRuntimeDir({ env: WIN_ENV, platform: 'win32' }),
    ])
    expect(candidates[0]?.source).toBe('configured-product-document')
    expect(candidates[1]?.source).toBe('canonical-runtime')
  })

  it('no configured path: the canonical app dir alone, never a userData-derived guess', () => {
    const candidates = resolveAllTalkInstallCandidates({
      env: WIN_ENV,
      platform: 'win32',
      userDataDir: STAGE_USERDATA,
    })
    expect(candidates).toHaveLength(1)
    expect(candidates.map(c => asSegments(c.dir)))
      .toEqual([[...asSegments(WIN_LOCAL), 'Lia', 'runtimes', 'alltalk', 'app']])
    expect(candidates[0]?.dir).not.toContain('stage-tamagotchi')
    expect(candidates[0]?.source).toBe('canonical-runtime')
  })

  it('a configured path identical to the canonical one is emitted exactly once', () => {
    const canonical = resolveAllTalkRuntimeDir({ env: WIN_ENV, platform: 'win32' })
    const candidates = resolveAllTalkInstallCandidates({
      configuredInstallDir: canonical,
      env: WIN_ENV,
      platform: 'win32',
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.source).toBe('configured-product-document')
  })

  it('blank configured paths are ignored rather than producing empty candidates', () => {
    const candidates = resolveAllTalkInstallCandidates({
      configuredInstallDir: '   ',
      env: WIN_ENV,
      platform: 'win32',
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.source).toBe('canonical-runtime')
  })
})
