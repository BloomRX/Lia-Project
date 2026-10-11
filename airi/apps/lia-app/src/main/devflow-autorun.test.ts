import { describe, expect, it, vi } from 'vitest'

import {
  createLiaDevflowAutorun,
  LIA_DEVFLOW_AUTORUN_CONVERSAR,
  LIA_DEVFLOW_AUTORUN_ENV,
} from './devflow-autorun'

/**
 * DEVFLOW-AUTO contract E: the human "click Conversar com Lia" step is replaced
 * by an autorun that reaches the SAME canonical pipeline, only under an explicit
 * flag, exactly once.
 */

/** Source-scan helper: comments may legitimately name the method. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function harness(env: Record<string, string | undefined>) {
  const logs: string[] = []
  const conversar = vi.fn(async () => ({ phase: 'running' }))
  const autorun = createLiaDevflowAutorun({ conversar, env, log: line => logs.push(line) })
  return { autorun, conversar, logs }
}

describe('devflow autorun is opt-in', () => {
  it('a default launcher does NOT auto-open Conversar', async () => {
    const { autorun, conversar, logs } = harness({})
    expect(autorun.applies()).toBe(false)
    expect(await autorun.run()).toBe('skipped')
    expect(conversar).not.toHaveBeenCalled()
    expect(logs.join('\n')).toContain('autorun=skipped reason=flag-absent')
  })

  it('an unrelated flag value does NOT auto-open Conversar', async () => {
    for (const value of ['', '1', 'true', 'CONVERSAR', 'stage', 'conversar ']) {
      const { autorun, conversar } = harness({ [LIA_DEVFLOW_AUTORUN_ENV]: value })
      expect(autorun.applies(), `value=${JSON.stringify(value)}`).toBe(false)
      expect(await autorun.run()).toBe('skipped')
      expect(conversar).not.toHaveBeenCalled()
    }
  })

  it('the DevFlow flag DOES auto-open Conversar', async () => {
    const { autorun, conversar, logs } = harness({
      [LIA_DEVFLOW_AUTORUN_ENV]: LIA_DEVFLOW_AUTORUN_CONVERSAR,
    })
    expect(autorun.applies()).toBe(true)
    expect(await autorun.run()).toBe('invoked')
    expect(conversar).toHaveBeenCalledTimes(1)
    expect(logs.join('\n')).toContain('autorun=invoked action=conversar')
    expect(logs.join('\n')).toContain('autorun=completed')
  })
})

describe('devflow autorun is exactly-once', () => {
  it('a repeated run does not reach the canonical pipeline twice', async () => {
    const { autorun, conversar, logs } = harness({
      [LIA_DEVFLOW_AUTORUN_ENV]: LIA_DEVFLOW_AUTORUN_CONVERSAR,
    })
    expect(await autorun.run()).toBe('invoked')
    expect(await autorun.run()).toBe('duplicate')
    expect(await autorun.run()).toBe('duplicate')
    expect(conversar).toHaveBeenCalledTimes(1)
    expect(logs.filter(line => line.includes('autorun=duplicate'))).toHaveLength(2)
  })

  it('concurrent runs collapse into one invocation (single-flight preserved)', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const logs: string[] = []
    const conversar = vi.fn(async () => {
      await gate
      return { phase: 'running' }
    })
    const autorun = createLiaDevflowAutorun({
      conversar,
      env: { [LIA_DEVFLOW_AUTORUN_ENV]: LIA_DEVFLOW_AUTORUN_CONVERSAR },
      log: line => logs.push(line),
    })
    // Calling run() three times synchronously is the real race: `started` is
    // set before the first await, so only the first may reach the pipeline.
    const pending = [autorun.run(), autorun.run(), autorun.run()]
    release()
    const results = await Promise.all(pending)
    expect(results.filter(value => value === 'invoked')).toHaveLength(1)
    expect(results.filter(value => value === 'duplicate')).toHaveLength(2)
    expect(conversar).toHaveBeenCalledTimes(1)
  })
})

describe('the autorun uses the canonical path, wired once', () => {
  it('index.ts calls the same host.conversar the IPC handler calls', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf-8')
    // The IPC handler that the renderer's button reaches.
    const ipcSource = readFileSync(new URL('./ipc.ts', import.meta.url), 'utf-8')
    expect(ipcSource).toContain(`ipcMain.handle('lia:stage:start', async () => await host.conversar())`)
    // The autorun must delegate to that very same host method, not a parallel
    // stage path, and must be gated on applies().
    expect(source).toContain('conversar: () => host.conversar()')
    expect(source).toContain('if (devflowAutorun.applies())')
    // Counted on code only: the explanatory comment also names the method.
    expect(stripComments(source).match(/host\.conversar\(\)/g)).toHaveLength(1)
  })

  it('the autorun is never awaited on the boot path', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf-8')
    expect(source).toContain('void devflowAutorun.run()')
    expect(source).not.toContain('await devflowAutorun.run()')
  })
})
