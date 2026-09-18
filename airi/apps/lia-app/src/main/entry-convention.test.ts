import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The Windows boot hotfix contract (Phase 7.1): the Electron entry declared
 * in package.json and the file the electron-vite main build actually EMITS
 * must be the same path, byte for byte - including the extension.
 *
 * The breakage this locks out: package.json said `out/main/index.mjs` while
 * the monorepo convention (type: module + main format 'es') emits
 * `out/main/index.js` - the launcher built fine and then could not start
 * at all. One convention, one file, no copy-rename workarounds.
 */

const appRoot = join(import.meta.dirname, '..', '..')
const packageJson = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8')) as {
  main?: string
  type?: string
}
const electronViteConfig = readFileSync(join(appRoot, 'electron.vite.config.ts'), 'utf8')

/**
 * The npm-electron bootstrap markers. They name the loader machinery
 * (`getElectronPath`, its refusal banner, its install hook) - strings no
 * honest launcher source ever legitimately writes, so a hit can only mean
 * the npm package got bundled.
 */
const NPM_ELECTRON_LOADER_MARKERS = [
  'getElectronPath',
  'Electron failed to install correctly',
]

describe('the Electron entry convention (Windows boot hotfix)', () => {
  it('package.json declares the monorepo convention: type module + index.js entry', () => {
    expect(packageJson.type).toBe('module')
    expect(packageJson.main).toBe('./out/main/index.js')
  })

  it('the main build emits ESM (which a type:module package serves as .js - never an .mjs entry)', () => {
    expect(electronViteConfig).toContain('format: \'es\'')
    // Guard against the regression itself: no .mjs entry may creep back
    // into the app manifest or its build config.
    expect(packageJson.main).not.toContain('.mjs')
    expect(electronViteConfig).not.toContain('index.mjs')
    expect(electronViteConfig).not.toContain('entryFileNames: \'[name].mjs\'')
    expect(electronViteConfig).not.toContain('entryFileNames: "[name].mjs"')
  })

  it('when a build exists on disk, the declared entry is EXACTLY the emitted file', (context) => {
    // Runs against a built app (QA/CI/local dev). A fresh checkout without
    // out/ has nothing to compare - the static conventions above carry the
    // guard in that environment.
    const builtMainDir = join(appRoot, 'out', 'main')
    if (!existsSync(builtMainDir)) {
      context.skip('no built main output on disk - static convention tests carry this guard')
      return
    }
    const expectedBuildArtifact = join(builtMainDir, 'index.js')
    expect(existsSync(expectedBuildArtifact)).toBe(true)

    const declaredEntry = join(appRoot, packageJson.main ?? '')
    expect(declaredEntry).toBe(expectedBuildArtifact)
    expect(existsSync(declaredEntry)).toBe(true)
    // And the phantom the QA hit stays absent: the build must not grow a
    // second entry copy next to the real one.
    expect(existsSync(join(builtMainDir, 'index.mjs'))).toBe(false)
  })
})

describe('electron must stay the runtime built-in, never bundled (Windows boot hotfix 2)', () => {
  it('the build config externalizes electron in BOTH main and preload, through rolldownOptions', () => {
    // Two `external:` lists covering the electron specifier, and written on
    // the key rolldown-vite actually honors. The deprecated plugin must not
    // return: it suppresses electron-vite's own externalize-deps hook.
    expect(electronViteConfig).toContain('rolldownOptions')
    expect(electronViteConfig.match(/\/\^electron\\\/\.\+\//g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    const externalsBlocks = electronViteConfig.match(/external:/g)?.length ?? 0
    expect(externalsBlocks).toBeGreaterThanOrEqual(2)
    expect(electronViteConfig).not.toContain('externalizeDepsPlugin')
  })

  it('when a build exists on disk, the npm electron bootstrap is NOT inside out/main/index.js', (context) => {
    const builtMain = join(appRoot, 'out', 'main', 'index.js')
    if (!existsSync(builtMain)) {
      context.skip('no built main output on disk - config-level guard above carries this contract')
      return
    }
    const emitted = readFileSync(builtMain, 'utf8')
    for (const marker of NPM_ELECTRON_LOADER_MARKERS) {
      expect(emitted).not.toContain(marker)
    }
    // Positive evidence too: the ESM main TALKS to electron as an external
    // runtime builtin - that import must survive to the consumer.
    expect(emitted).toContain('from "electron"')

    const builtPreload = join(appRoot, 'out', 'preload', 'index.cjs')
    expect(existsSync(builtPreload)).toBe(true)
    const preload = readFileSync(builtPreload, 'utf8')
    for (const marker of NPM_ELECTRON_LOADER_MARKERS) {
      expect(preload).not.toContain(marker)
    }
    expect(preload).toContain('require("electron")')
  })
})
