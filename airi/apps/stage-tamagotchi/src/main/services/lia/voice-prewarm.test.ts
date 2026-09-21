import type { LiaVoiceEngine } from '@lia/core/voice/engines/types'

import { describe, expect, it, vi } from 'vitest'

import { prewarmManagedVoice } from './voice-prewarm'

/**
 * Phase 7.9E, item 1 contract: the managed prewarm hides the cold start
 * without EVER blocking the Stage, starting anything twice, or letting an
 * engine failure reach the product surface.
 */

function fakeEngine(id: string, startImpl: () => Promise<void>, calls: string[]): LiaVoiceEngine {
  return {
    id,
    capabilities: () => ({ clonesVoice: false, requiresNetwork: false, runsLocally: true, streams: false }),
    health: async () => ({ device: 'cpu', ok: true, state: 'ready' }),
    start: async () => {
      calls.push(`start:${id}`)
      await startImpl()
    },
    stop: async () => {
      calls.push(`stop:${id}`)
    },
    synthesize: async () => {
      throw new Error('not exercised by prewarm')
    },
  }
}

describe('lia voice prewarm (Phase 7.9E)', () => {
  it('a managed launch starts every registered engine exactly once, sequentially', async () => {
    const calls: string[] = []
    let releaseFirst: () => void = () => undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const engines = [
      fakeEngine('kokoro', () => firstGate, calls),
      fakeEngine('future-engine', () => Promise.resolve(), calls),
    ]

    const handle = prewarmManagedVoice({ engines, managedLaunch: true })

    // Sequential proof: with the first start still in flight, the second
    // engine has NOT been touched (parallel warm would already have called it).
    expect(calls).toEqual(['start:kokoro'])
    releaseFirst()
    await handle.settled
    expect(calls).toEqual(['start:kokoro', 'start:future-engine'])
    expect(handle.readyEngines()).toEqual(['kokoro', 'future-engine'])
  })

  it('constructing the handle NEVER waits for the engine - Stage startup is not blocked', async () => {
    const calls: string[] = []
    let engineFinished = false
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const engines = [fakeEngine('kokoro', async () => {
      await gate
      engineFinished = true
    }, calls)]

    // If this constructor awaited the engine, the test would hang here.
    const handle = prewarmManagedVoice({ engines, managedLaunch: true })
    expect(calls).toEqual(['start:kokoro'])
    expect(handle.readyEngines()).toEqual([]) // not settled yet, honestly
    expect(engineFinished).toBe(false)

    const settledSpy = vi.fn()
    void handle.settled.then(settledSpy)
    await Promise.resolve()
    expect(settledSpy).not.toHaveBeenCalled() // pending, non-blocking

    release()
    await handle.settled
    expect(settledSpy).toHaveBeenCalledTimes(1)
    expect(engineFinished).toBe(true)
    expect(handle.readyEngines()).toEqual(['kokoro'])
  })

  it('a standalone launch touches NO engine and stays lazy by contract', async () => {
    const calls: string[] = []
    const engine = fakeEngine('kokoro', () => Promise.resolve(), calls)
    const handle = prewarmManagedVoice({ engines: [engine], managedLaunch: false })
    await handle.settled
    expect(calls).toEqual([])
    expect(handle.readyEngines()).toEqual([])
  })

  it('an engine failure degrades silently: diagnostics recorded, remaining engines still warmed, settled never rejects', async () => {
    const calls: string[] = []
    const logs: Array<Record<string, unknown>> = []
    const engines = [
      fakeEngine('kokoro', () => Promise.reject(new Error('the Kokoro runtime is not installed')), calls),
      fakeEngine('future-engine', () => Promise.resolve(), calls),
    ]

    const handle = prewarmManagedVoice({
      engines,
      log: entry => logs.push(entry as unknown as Record<string, unknown>),
      managedLaunch: true,
      now: (() => {
        let t = 0
        return () => (t += 250)
      })(),
    })
    await expect(handle.settled).resolves.toBeUndefined()

    expect(calls).toEqual(['start:kokoro', 'start:future-engine'])
    expect(handle.readyEngines()).toEqual(['future-engine'])
    const failure = logs.find(entry => entry.ok === false)
    expect(failure).toMatchObject({ engine: 'kokoro', event: 'lia.voice.prewarm', managed: true, ms: 250 })
    expect(String(failure?.note)).toContain('not installed')
    const success = logs.find(entry => entry.engine === 'future-engine' && entry.ok === true)
    expect(success).toBeDefined()
  })

  it('onSettled runs after the attempt (capability refresh seam) and only then', async () => {
    const calls: string[] = []
    const order: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const engines = [fakeEngine('kokoro', () => gate, calls)]

    const handle = prewarmManagedVoice({
      engines,
      managedLaunch: true,
      onSettled: () => order.push('settled-hook'),
    })
    await Promise.resolve()
    expect(order).toEqual([])
    release()
    await handle.settled
    await Promise.resolve()
    expect(order).toEqual(['settled-hook'])
  })

  it('measured warm time comes from the clock, per engine', async () => {
    const logs: Array<Record<string, unknown>> = []
    const calls: string[] = []
    const engines = [fakeEngine('kokoro', () => Promise.resolve(), calls)]
    const handle = prewarmManagedVoice({
      engines,
      log: entry => logs.push(entry as unknown as Record<string, unknown>),
      managedLaunch: true,
      now: (() => {
        let t = 1_000
        return () => (t += 1_250)
      })(), // two 1.25s ticks: the QA Ryzen 5 5500 cold-start shape
    })
    await handle.settled
    expect(logs.find(entry => entry.ok === true)).toMatchObject({ engine: 'kokoro', ms: 1_250 })
  })
})
