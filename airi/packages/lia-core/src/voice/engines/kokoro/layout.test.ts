import { describe, expect, it } from 'vitest'

import { inspectKokoroInstall, resolveKokoroLayout } from './layout'
import { KOKORO_VOICES } from './manifest'

describe('kokoro layout (engine-owned runtime tree)', () => {
  it('composes one engine subdirectory under the engine-neutral home', () => {
    const layout = resolveKokoroLayout({ home: '/home/user/runtimes', platform: 'linux' })
    expect(layout.rootDir).toBe('/home/user/runtimes/kokoro')
    expect(layout.venvPython).toBe('/home/user/runtimes/kokoro/venv/bin/python')
    expect(layout.modelFile).toBe('/home/user/runtimes/kokoro/models/model_quantized.onnx')
    expect(layout.voicesNpz).toBe('/home/user/runtimes/kokoro/models/voices-pt.npz')
    expect(layout.workerFile).toBe('/home/user/runtimes/kokoro/worker/kokoro_worker.py')
    expect(layout.stateFile).toBe('/home/user/runtimes/kokoro/install-state.json')
  })

  it('uses Scripts/python.exe on win32', () => {
    const layout = resolveKokoroLayout({ home: 'C:/Users/you/AppData/Local/Lia/runtimes', platform: 'win32' })
    expect(layout.venvPython).toMatch(/venv[\\/]Scripts[\\/]python\.exe$/)
  })

  it('reports every missing marker on an empty tree (not-installed is honest)', () => {
    const layout = resolveKokoroLayout({ home: '/home/nowhere', platform: 'linux' })
    const check = inspectKokoroInstall(layout, { existsSync: () => false })
    expect(check.installed).toBe(false)
    expect(check.missing).toEqual([
      'venv-python',
      'model',
      ...KOKORO_VOICES.map(voice => `voice-${voice.name}`),
      'voices-npz',
      'worker',
      'install-state',
    ])
  })

  it('a partial tree is NOT installed (half-bootstraps never pretend ready)', () => {
    const layout = resolveKokoroLayout({ home: '/home/partial', platform: 'linux' })
    const check = inspectKokoroInstall(layout, {
      existsSync: path => path === layout.venvPython || path === layout.modelFile,
    })
    expect(check.installed).toBe(false)
    expect(check.missing).toContain('worker')
    expect(check.missing).toContain('install-state')
  })

  it('a complete tree is installed', () => {
    const layout = resolveKokoroLayout({ home: '/home/complete', platform: 'linux' })
    const check = inspectKokoroInstall(layout, { existsSync: () => true })
    expect(check).toEqual({ installed: true, missing: [] })
  })
})
