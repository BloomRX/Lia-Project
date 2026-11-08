import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultPresence } from '../../../../../../../lia/core/src/presence'
import { createPresenceService } from './presence-service'

function fixture() {
  vi.useFakeTimers()
  let bounds = { x: 10, y: 20, width: 700, height: 800 }
  let opacity = 0.9
  let top = false
  let fullscreen = false
  let cursor = { x: 1900, y: 1000 }
  let displays = [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }]
  const listeners = new Set<() => void>()
  const save = vi.fn(async () => {})
  const service = createPresenceService({
    window: {
      getBounds: () => bounds,
      setBounds: (value) => {
        bounds = value
      },
      isDestroyed: () => false,
      isFullScreen: () => fullscreen,
      getOpacity: () => opacity,
      setOpacity: (value) => {
        opacity = value
      },
      getMinimumSize: () => [300, 400],
      setMinimumSize: () => {},
      isAlwaysOnTop: () => top,
      setAlwaysOnTop: (value) => {
        top = value
      },
    },
    screen: { getAllDisplays: () => displays, getCursorScreenPoint: () => cursor, on: (_, listener) => listeners.add(listener), removeListener: (_, listener) => listeners.delete(listener) },
    save,
    random: () => 0.8,
  })
  return {
    service,
    save,
    listeners,
    bounds: () => bounds,
    opacity: () => opacity,
    top: () => top,
    fullscreen: (v: boolean) => {
      fullscreen = v
    },
    cursor: (x: number, y: number) => {
      cursor = { x, y }
    },
    displays: (v: typeof displays) => {
      displays = v
      listeners.forEach(fn => fn())
    },
  }
}
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
describe('presence Main adapter', () => {
  it('preserves original Tamagotchi dimensions, opacity and top state', async () => {
    const f = fixture()
    f.service.setActive(true)
    await f.service.set({ ...defaultPresence, mode: 'free' })
    expect(f.bounds()).toEqual({ x: 10, y: 20, width: 240, height: 360 })
    vi.advanceTimersByTime(2000)
    expect(f.bounds().x).toBeGreaterThan(10)
    await f.service.set({ ...defaultPresence, mode: 'tamagotchi' })
    expect(f.bounds()).toEqual({ x: 10, y: 20, width: 700, height: 800 })
    expect(f.opacity()).toBe(0.9)
    expect(f.top()).toBe(false)
    f.service.dispose()
    expect(f.listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('pauses, pins, returns Home and hides only while hovered', async () => {
    const f = fixture()
    f.service.setActive(true)
    await f.service.set({ ...defaultPresence, mode: 'free', home: { x: 100, y: 100 }, pinned: true, hideOnHover: true })
    vi.advanceTimersByTime(1000)
    expect(f.bounds().x).toBe(100)
    f.cursor(110, 110)
    vi.advanceTimersByTime(100)
    expect(f.opacity()).toBe(0)
    f.cursor(1900, 1000)
    vi.advanceTimersByTime(100)
    expect(f.opacity()).toBe(0.9)
    await f.service.set({ ...defaultPresence, mode: 'free', home: { x: 100, y: 100 } })
    vi.advanceTimersByTime(2000)
    await f.service.action({ action: 'home' })
    expect(f.bounds().x).toBe(100)
    f.fullscreen(true)
    const before = f.bounds()
    vi.advanceTimersByTime(1000)
    expect(f.bounds()).toEqual(before)
    expect(f.opacity()).toBe(0)
    f.service.dispose()
  })
  it('recovers removed monitors and rejects malformed IPC or failed storage', async () => {
    const f = fixture()
    f.service.setActive(true)
    expect(await f.service.set({ mode: 'free' })).toEqual({ ok: false, code: 'invalid' })
    f.save.mockRejectedValueOnce(new Error('disk'))
    expect(await f.service.set({ ...defaultPresence, mode: 'free' })).toEqual({ ok: false, code: 'storage' })
    expect(f.bounds().width).toBe(700)
    await f.service.set({ ...defaultPresence, mode: 'free', home: { x: 1500, y: 400 } })
    f.displays([{ id: 2, workArea: { x: -800, y: 0, width: 800, height: 600 } }])
    expect(f.bounds().x + f.bounds().width).toBeLessThanOrEqual(0)
    expect(await f.service.action({ action: 'execute' })).toEqual({ ok: false, code: 'invalid' })
    f.service.setActive(false)
    expect(f.bounds()).toEqual({ x: -525, y: 0, width: 525, height: 600 })
    expect(f.bounds().x).toBeGreaterThanOrEqual(-800)
    expect(f.bounds().x + f.bounds().width).toBeLessThanOrEqual(0)
    expect(f.bounds().y + f.bounds().height).toBeLessThanOrEqual(600)
    f.service.dispose()
  })
  it('pins and pauses at the current position rather than jumping Home', async () => {
    const f = fixture()
    f.service.setActive(true)
    await f.service.set({ ...defaultPresence, mode: 'free', home: { x: 100, y: 100 } })
    vi.advanceTimersByTime(1000)
    const moved = f.bounds()
    expect(moved.x).toBeGreaterThan(100)
    await f.service.set({ ...defaultPresence, mode: 'free', home: { x: 100, y: 100 }, pinned: true })
    vi.advanceTimersByTime(1000)
    expect(f.bounds()).toEqual(moved)
    await f.service.set({ ...defaultPresence, mode: 'free', home: { x: 100, y: 100 }, paused: true })
    vi.advanceTimersByTime(1000)
    expect(f.bounds()).toEqual(moved)
    f.service.dispose()
  })
})
