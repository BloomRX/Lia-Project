import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetLiaDevflowMarksForTest,
  LIA_DEVFLOW_APP_MOUNTED_CHANNEL,
  LIA_DEVFLOW_DIAGNOSTICS_ENV,
  LIA_DEVFLOW_SCENE_MOUNTED_CHANNEL,
  liaDevflowDiagnosticsEnabled,
  liaDevflowMark,
  registerLiaDevflowSceneBridge,
} from './devflow-diagnostics'

// vi.mock is hoisted above the imports by vitest, so the module under test
// never touches a real ipcMain.
const on = vi.fn()
vi.mock('electron', () => ({ ipcMain: { on: (...args: unknown[]) => on(...args) } }))

const HERE = dirname(fileURLToPath(import.meta.url))

function readHere(...parts: string[]): string {
  return readFileSync(join(HERE, ...parts), 'utf-8')
}

/**
 * DEVFLOW-AUTO contract F: the human S/N visual assertion is replaced by three
 * machine-verifiable facts. None of them may be logged in a normal launch, and
 * none of them may be claimed from a dev-server "ready in ..." line.
 */

/** Source-scan helper: the docblock legitimately names the markers. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function captureLogs(body: () => void): string[] {
  const lines: string[] = []
  const original = console.info
  console.info = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  try {
    body()
  }
  finally {
    console.info = original
  }
  return lines
}

beforeEach(() => {
  __resetLiaDevflowMarksForTest()
  on.mockClear()
})

// From src/main to airi/packages/stage-ui: four levels up, then into the package.
const STAGE_SCENE_COMPONENT_RELATIVE = join(
  '..',
  '..',
  '..',
  '..',
  'packages',
  'stage-ui',
  'src',
  'components',
  'scenes',
  'Stage.vue',
)

describe('diagnostics are inert without the DevFlow flag', () => {
  it('is disabled by default', () => {
    expect(liaDevflowDiagnosticsEnabled({})).toBe(false)
    expect(liaDevflowDiagnosticsEnabled({ [LIA_DEVFLOW_DIAGNOSTICS_ENV]: '0' })).toBe(false)
    expect(liaDevflowDiagnosticsEnabled({ [LIA_DEVFLOW_DIAGNOSTICS_ENV]: 'true' })).toBe(false)
    expect(liaDevflowDiagnosticsEnabled({ [LIA_DEVFLOW_DIAGNOSTICS_ENV]: '1' })).toBe(true)
  })

  it('emits nothing at all when the flag is absent', () => {
    const lines = captureLogs(() => {
      expect(liaDevflowMark('window=visible', {})).toBe(false)
      expect(liaDevflowMark('renderer=ready', {})).toBe(false)
      expect(liaDevflowMark('avatar-scene=mounted', {})).toBe(false)
    })
    expect(lines).toEqual([])
  })

  it('registers no IPC listener when the flag is absent', () => {
    expect(registerLiaDevflowSceneBridge({})).toBe(false)
    expect(on).not.toHaveBeenCalled()
  })
})

describe('diagnostics emit the three runtime facts under the flag', () => {
  const env = { [LIA_DEVFLOW_DIAGNOSTICS_ENV]: '1' }

  it('emits each marker once, with the lia-stage prefix', () => {
    const lines = captureLogs(() => {
      expect(liaDevflowMark('window=visible', env)).toBe(true)
      expect(liaDevflowMark('renderer=ready', env)).toBe(true)
      expect(liaDevflowMark('avatar-scene=mounted', env)).toBe(true)
    })
    expect(lines).toEqual([
      'lia-stage window=visible',
      'lia-stage renderer=ready',
      'lia-stage avatar-scene=mounted',
    ])
  })

  it('is idempotent: a re-show or reload is not new evidence', () => {
    const lines = captureLogs(() => {
      liaDevflowMark('window=visible', env)
      liaDevflowMark('window=visible', env)
      liaDevflowMark('window=visible', env)
    })
    expect(lines).toEqual(['lia-stage window=visible'])
  })

  it('the renderer bridge reports the mounted scene exactly once', () => {
    expect(registerLiaDevflowSceneBridge(env)).toBe(true)
    const channels = on.mock.calls.map(call => call[0])
    expect(channels).toContain(LIA_DEVFLOW_SCENE_MOUNTED_CHANNEL)
    const handler = on.mock.calls.find(
      call => call[0] === LIA_DEVFLOW_SCENE_MOUNTED_CHANNEL,
    )![1] as () => void
    const lines = captureLogs(() => {
      handler()
      handler()
    })
    expect(lines).toEqual(['lia-stage avatar-scene=mounted'])
  })

  it('the root app mount is a SEPARATE claim from the avatar scene', () => {
    // Renaming matters: `createApp(App).mount('#app')` proves the root app
    // mounted, not that an avatar loaded. Two channels, two marker names, and
    // neither can satisfy the other.
    expect(registerLiaDevflowSceneBridge(env)).toBe(true)
    const channels = on.mock.calls.map(call => call[0])
    expect(channels).toContain(LIA_DEVFLOW_APP_MOUNTED_CHANNEL)
    const appHandler = on.mock.calls.find(
      call => call[0] === LIA_DEVFLOW_APP_MOUNTED_CHANNEL,
    )![1] as () => void
    expect(captureLogs(() => appHandler())).toEqual(['lia-stage renderer-app=mounted'])
  })

  it('carries metadata only - no prompt, image, key or vault content', () => {
    const lines = captureLogs(() => {
      liaDevflowMark('window=visible', env)
      liaDevflowMark('renderer=ready', env)
      liaDevflowMark('avatar-scene=mounted', env)
    })
    const joined = lines.join('\n')
    expect(joined).toMatch(/^(lia-stage (?:window=visible|renderer=ready|avatar-scene=mounted)\n?)+$/)
    for (const forbidden of ['prompt', 'message', 'image', 'key', 'token', 'vault'])
      expect(joined.toLowerCase()).not.toContain(forbidden)
  })
})

describe('the markers are wired to the facts they claim', () => {
  it('window=visible comes from the shown state, renderer=ready from did-finish-load', () => {
    const source = readHere('windows', 'main', 'index.ts')
    const shownAt = source.indexOf('window!.show()')
    const visibleAt = source.indexOf('liaDevflowMark(\'window=visible\')')
    expect(shownAt).toBeGreaterThan(-1)
    expect(visibleAt, 'window=visible must follow show()').toBeGreaterThan(shownAt)
    expect(source).toContain('window.webContents.on(\'did-finish-load\', () => {\n    liaDevflowMark(\'renderer=ready\')')
  })

  it('avatar-scene=mounted is only reachable from the renderer bridge', () => {
    const source = stripComments(readHere('devflow-diagnostics.ts'))
    expect(source.match(/avatar-scene=mounted/g)).toHaveLength(1)
    expect(readHere('index.ts')).toContain('registerLiaDevflowSceneBridge()')
    // The ROOT app mount reports from main.ts, after mounting, under its own name.
    const rendererSource = stripComments(readHere('..', 'renderer', 'main.ts'))
    const mountAt = rendererSource.indexOf('.mount(\'#app\')')
    const sendAt = rendererSource.indexOf('lia-devflow:app-mounted')
    expect(mountAt).toBeGreaterThan(-1)
    expect(sendAt, 'the renderer must report AFTER mounting').toBeGreaterThan(mountAt)
    expect(rendererSource).not.toContain('lia-devflow:scene-mounted')
  })

  it('the avatar claim comes from the scene component, not the root mount', () => {
    // `pages/index.vue` watches the state the Stage scene component itself
    // writes, which is the only honest source for an avatar-scene claim.
    const pageSource = stripComments(readHere('..', 'renderer', 'pages', 'index.vue'))
    const watchAt = pageSource.indexOf('watch(stageMounted')
    const sendAt = pageSource.indexOf('lia-devflow:scene-mounted')
    expect(watchAt, 'index.vue must watch the scene state').toBeGreaterThan(-1)
    expect(sendAt, 'the scene claim must be sent from the scene watcher')
      .toBeGreaterThan(watchAt)
    // The claim is only honest if the scene component really writes that state.
    const stageVue = join(HERE, STAGE_SCENE_COMPONENT_RELATIVE)
    expect(readFileSync(stageVue, { encoding: 'utf-8' }))
      .toContain('componentState.value = \'mounted\'')
  })

  it('window=visible is verified, not assumed from the show() call', () => {
    // show() is a request. The marker must be gated on isVisible(), otherwise
    // the gate would trust a call instead of the fact.
    const windowSource = readHere('windows', 'main', 'index.ts')
    const showAt = windowSource.indexOf('window!.show()')
    const markAt = windowSource.indexOf('liaDevflowMark(\'window=visible\')')
    expect(showAt).toBeGreaterThan(-1)
    expect(markAt).toBeGreaterThan(showAt)
    const between = windowSource.slice(showAt, markAt)
    expect(between, 'the marker must be gated on isVisible()').toContain('isVisible()')
  })

  it('a dev-server ready line is never treated as stage evidence', () => {
    const source = stripComments(readHere('devflow-diagnostics.ts'))
    expect(source).not.toContain('ready in')
    expect(source).not.toContain('ready_in')
  })
})
