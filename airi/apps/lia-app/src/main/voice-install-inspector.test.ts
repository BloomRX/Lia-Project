/**
 * Phase 7.9E.2: the production install proof AND its production wiring.
 *
 * Before this seam the launcher bootstrap called createLiaHost without
 * `inspectInstallImpl`; the gate defaulted to `async () => false` and every
 * real machine answered `lia-app.conversar-blocked
 * reason=voice-runtime-not-installed` - even with the production-smoke-
 * validated Kokoro tree at `%LOCALAPPDATA%\Lia\runtimes\kokoro`.
 *
 * These tests build the REAL Kokoro runtime markers on a REAL scratch disk
 * (the required set the lia-core inspector itself says it owes) and prove:
 * - a complete validated tree answers installed=true;
 * - any single missing required marker answers installed=false;
 * - the Windows layout (`venv\Scripts\python.exe`) is the one being proven;
 * - the proof is read-only: it never creates/downloads ANYTHING;
 * - the production bootstrap (main/index.ts) actually wires this inspector
 *   into createLiaHost - no more silent default-false.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { inspectKokoroInstall, resolveKokoroLayout } from '@lia/core/voice/engines/kokoro'
import { describe, expect, it } from 'vitest'

import { createLiaVoiceInstallInspector } from './voice-install-inspector'

type KokoroLayout = ReturnType<typeof resolveKokoroLayout>

/**
 * The required marker set STRAIGHT FROM THE ENGINE: run the real inspector
 * with a recording probe and it names every path it owes. The engine stays
 * the single authority, even for the fixture.
 */
function requiredKokoroFiles(layout: KokoroLayout): string[] {
  const queried: string[] = []
  inspectKokoroInstall(layout, {
    existsSync: (path) => {
      queried.push(path)
      return false
    },
  })
  return queried
}

/** The markers ONLY - what a finished installer leaves; nothing else. */
async function materializeKokoroInstall(layout: KokoroLayout, options: { without?: string[] } = {}) {
  for (const target of requiredKokoroFiles(layout)) {
    if (options.without?.includes(target))
      continue
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, 'ok')
  }
}

async function scratchHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'lia-inspect-'))
}

describe('7.9E.2 - production Kokoro install proof (engine-owned authority)', () => {
  it('a complete validated tree answers installed=true (the QA machine case)', async () => {
    const home = await scratchHome()
    try {
      const layout = resolveKokoroLayout({ home })
      await materializeKokoroInstall(layout)
      const inspect = createLiaVoiceInstallInspector()
      expect(await inspect(home)).toBe(true)
      // Sanity: the SAME composition the seam runs, through the engine's
      // own authority, agrees.
      expect(inspectKokoroInstall(layout, { existsSync })).toEqual({ installed: true, missing: [] })
    }
    finally {
      await rm(home, { force: true, recursive: true })
    }
  })

  it('the Windows runtime tree is proven through the WIN32 layout (`venv\\Scripts\\python.exe`)', async () => {
    const home = await scratchHome()
    try {
      const layout = resolveKokoroLayout({ home, platform: 'win32' })
      expect(layout.venvPython).toBe(join(home, 'kokoro', 'venv', 'Scripts', 'python.exe'))
      await materializeKokoroInstall(layout)
      const inspect = createLiaVoiceInstallInspector()
      expect(await inspect(home, 'win32')).toBe(true)
    }
    finally {
      await rm(home, { force: true, recursive: true })
    }
  })

  it('any single missing required marker answers installed=false (never a bypass)', async () => {
    const home = await scratchHome()
    try {
      const layout = resolveKokoroLayout({ home })
      await materializeKokoroInstall(layout, { without: [layout.stateFile] })
      const inspect = createLiaVoiceInstallInspector()
      expect(await inspect(home)).toBe(false)
      expect(inspectKokoroInstall(layout, { existsSync })).toEqual({ installed: false, missing: ['install-state'] })
    }
    finally {
      await rm(home, { force: true, recursive: true })
    }
  })

  it('the proof is READ-ONLY: a missing home stays missing after inspection (no download, no install, no mkdir)', async () => {
    const outer = await scratchHome()
    try {
      const home = join(outer, 'never-created')
      const inspect = createLiaVoiceInstallInspector()
      expect(await inspect(home)).toBe(false)
      expect(existsSync(home)).toBe(false)
      expect(existsSync(join(home, 'kokoro'))).toBe(false)
    }
    finally {
      await rm(outer, { force: true, recursive: true })
    }
  })
})

describe('7.9E.2 - production bootstrap wiring (createLiaHost no longer defaults to false)', () => {
  it('main/index.ts passes the real inspector into createLiaHost', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
    expect(source).toContain('import { createLiaVoiceInstallInspector } from \'./voice-install-inspector\'')
    expect(source).toContain('inspectInstallImpl: createLiaVoiceInstallInspector(),')
  })
})
