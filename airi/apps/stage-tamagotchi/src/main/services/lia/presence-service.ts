import type { PresenceBounds, PresenceConfig, PresenceDisplay } from '../../../../../../../lia/core/src/presence'
import type { PresenceResult } from '../../../shared/eventa/lia-presence'

import { defaultPresence, fitPresence, isPresenceConfig, presenceDisplay, presenceTarget } from '../../../../../../../lia/core/src/presence'

interface PresenceWindow {
  getBounds: () => PresenceBounds
  setBounds: (bounds: PresenceBounds, animate?: boolean) => void
  isDestroyed: () => boolean
  isFullScreen: () => boolean
  isAlwaysOnTop: () => boolean
  setAlwaysOnTop: (value: boolean) => void
  getOpacity: () => number
  setOpacity: (value: number) => void
  getMinimumSize: () => number[]
  setMinimumSize: (width: number, height: number) => void
}
interface PresenceScreen {
  getAllDisplays: () => PresenceDisplay[]
  getCursorScreenPoint: () => { x: number, y: number }
  on: (event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: () => void) => unknown
  removeListener: (event: 'display-added' | 'display-removed' | 'display-metrics-changed', listener: () => void) => unknown
}
/** Persistence is injected through the canonical product-config writer; this service never opens a file. */
export function createPresenceService(options: {
  window: PresenceWindow
  screen: PresenceScreen
  initial?: unknown
  save: (config: PresenceConfig) => Promise<void>
  random?: () => number
}) {
  const win = options.window
  let config = structuredClone(isPresenceConfig(options.initial) ? options.initial : defaultPresence)
  let active = false
  let disposed = false
  let original: { bounds: PresenceBounds, top: boolean, opacity: number, minimum: number[] } | undefined
  let destination: PresenceBounds | undefined
  let ticks = 0
  let queue = Promise.resolve()
  const displays = () => options.screen.getAllDisplays().filter(d => d.workArea.width > 0 && d.workArea.height > 0)
  function snapshot(): PresenceResult {
    if (disposed || win.isDestroyed())
      return { ok: false, code: 'unavailable' }
    return { ok: true, state: { config: structuredClone(config), displays: displays(), active, fullscreen: win.isFullScreen() } }
  }
  function recover() {
    if (!active || disposed || win.isDestroyed() || config.mode !== 'free')
      return
    const display = presenceDisplay(displays(), config, win.getBounds())
    if (display)
      win.setBounds(fitPresence(win.getBounds(), display.workArea))
    destination = undefined
  }
  function restore() {
    if (!original || win.isDestroyed())
      return
    const display = presenceDisplay(displays(), { ...config, monitorId: null }, original.bounds)
    const bounds = display ? fitPresence(original.bounds, display.workArea) : original.bounds
    win.setMinimumSize(Math.min(original.minimum[0]!, bounds.width), Math.min(original.minimum[1]!, bounds.height))
    win.setBounds(bounds)
    win.setAlwaysOnTop(original.top)
    win.setOpacity(original.opacity)
    original = undefined
    destination = undefined
  }
  function apply(reposition = true) {
    if (!active || config.mode !== 'free') {
      restore()
      return
    }
    original ??= { bounds: win.getBounds(), top: win.isAlwaysOnTop(), opacity: win.getOpacity(), minimum: win.getMinimumSize() }
    win.setMinimumSize(1, 1)
    const bounds = win.getBounds()
    const display = presenceDisplay(displays(), config, bounds)
    if (display && reposition) {
      win.setBounds(fitPresence({ x: config.home?.x ?? bounds.x, y: config.home?.y ?? bounds.y, width: Math.round(240 * config.scale), height: Math.round(360 * config.scale) }, display.workArea))
    }
    win.setAlwaysOnTop(config.alwaysOnTop)
    destination = undefined
  }
  function tick() {
    if (disposed || !active || win.isDestroyed() || config.mode !== 'free')
      return
    const bounds = win.getBounds()
    const cursor = options.screen.getCursorScreenPoint()
    const hover = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
    const fullscreen = config.pauseOnFullscreen && win.isFullScreen()
    win.setOpacity(fullscreen || (config.hideOnHover && hover) ? 0 : original?.opacity ?? 1)
    if (config.paused || config.pinned || fullscreen || hover)
      return
    if (!destination || ++ticks > 150) {
      destination = presenceTarget(displays(), config, bounds, options.random)
      ticks = 0
    }
    const dx = destination.x - bounds.x
    const dy = destination.y - bounds.y
    // Travel only within a monitor. Cross-monitor changes use an atomic placement,
    // preventing the window from walking through disconnected virtual-screen gaps.
    const current = presenceDisplay(displays(), { ...config, monitorId: null }, bounds)
    const targetDisplay = presenceDisplay(displays(), { ...config, monitorId: null }, destination)
    if (current?.id !== targetDisplay?.id) {
      win.setBounds(destination)
      return
    }
    const distance = Math.hypot(dx, dy)
    const step = Math.min(1, 3 / Math.max(1, distance))
    win.setBounds({ ...bounds, x: Math.round(bounds.x + dx * step), y: Math.round(bounds.y + dy * step) })
  }
  const events = ['display-added', 'display-removed', 'display-metrics-changed'] as const
  events.forEach(event => options.screen.on(event, recover))
  const timer = setInterval(tick, 100)
  function serial(operation: () => Promise<PresenceResult>): Promise<PresenceResult> {
    const result = queue.then(operation)
    queue = result.then(() => {}, () => {})
    return result
  }
  return {
    get: snapshot,
    setActive(value: boolean) {
      if (disposed || win.isDestroyed())
        return
      active = value
      apply()
    },
    set(input: unknown): Promise<PresenceResult> {
      return serial(async () => {
        if (!isPresenceConfig(input))
          return { ok: false, code: 'invalid' }
        if (disposed || win.isDestroyed())
          return { ok: false, code: 'unavailable' }
        const next = structuredClone(input)
        if (next.mode === 'free' && next.home === null) {
          const { x, y } = win.getBounds()
          next.home = { x, y }
        }
        try {
          await options.save(next)
        }
        catch (error) {
          console.info(`[lia-presence] save=${error instanceof Error && ['Error', 'TypeError', 'ValiError', 'DataCloneError'].includes(error.name) ? error.name : 'unavailable'}`)
          if (error instanceof Error) {
            const code = (error as NodeJS.ErrnoException).code
            if (code && ['EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'EXDEV', 'EEXIST', 'ENOSPC'].includes(code))
              console.info(`[lia-presence] storage=${code}`)
          }
          return { ok: false, code: 'storage' }
        }
        if (disposed || win.isDestroyed())
          return { ok: false, code: 'unavailable' }
        const reposition = config.mode !== next.mode || config.scale !== next.scale
          || config.monitorId !== next.monitorId || config.home?.x !== next.home?.x || config.home?.y !== next.home?.y
        config = next
        apply(reposition)
        return snapshot()
      })
    },
    action(input: unknown): Promise<PresenceResult> {
      return serial(async () => {
        if (!input || typeof input !== 'object' || Object.keys(input).length !== 1 || !('action' in input)
          || (input.action !== 'home' && input.action !== 'set-home')) {
          return { ok: false, code: 'invalid' }
        }
        if (!active || config.mode !== 'free' || disposed || win.isDestroyed())
          return { ok: false, code: 'unavailable' }
        if (input.action === 'set-home') {
          const { x, y } = win.getBounds()
          const next = { ...config, home: { x, y } }
          try {
            await options.save(next)
          }
          catch { return { ok: false, code: 'storage' } }
          if (disposed || win.isDestroyed())
            return { ok: false, code: 'unavailable' }
          config = next
        }
        else { apply() }
        return snapshot()
      })
    },
    dispose() {
      if (disposed)
        return
      clearInterval(timer)
      events.forEach(event => options.screen.removeListener(event, recover))
      restore()
      disposed = true
    },
  }
}
