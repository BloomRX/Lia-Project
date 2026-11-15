export interface PresenceBounds { x: number, y: number, width: number, height: number }
export interface PresenceDisplay { id: number, workArea: PresenceBounds }
export interface PresenceConfig {
  mode: 'tamagotchi' | 'free'
  scale: number
  paused: boolean
  pinned: boolean
  allMonitors: boolean
  monitorId: number | null
  hideOnHover: boolean
  alwaysOnTop: boolean
  pauseOnFullscreen: boolean
  home: { x: number, y: number } | null
}
export const defaultPresence: PresenceConfig = {
  mode: 'tamagotchi', scale: 1, paused: false, pinned: false, allMonitors: false,
  monitorId: null, hideOnHover: false, alwaysOnTop: true, pauseOnFullscreen: true, home: null,
}
export function isPresenceConfig(value: unknown): value is PresenceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return false
  const v = value as Record<string, unknown>
  return Object.keys(v).length === Object.keys(defaultPresence).length
    && Object.keys(v).every(k => k in defaultPresence)
    && (v.mode === 'tamagotchi' || v.mode === 'free')
    && typeof v.scale === 'number' && Number.isFinite(v.scale) && v.scale >= 0.5 && v.scale <= 1.5
    && ['paused', 'pinned', 'allMonitors', 'hideOnHover', 'alwaysOnTop', 'pauseOnFullscreen'].every(k => typeof v[k] === 'boolean')
    && (v.monitorId === null || Number.isSafeInteger(v.monitorId))
    && (v.home === null || (typeof v.home === 'object' && !Array.isArray(v.home)
      && Object.keys(v.home).length === 2 && ['x', 'y'].every(k => Number.isSafeInteger((v.home as Record<string, unknown>)[k]))))
}
export function fitPresence(bounds: PresenceBounds, area: PresenceBounds): PresenceBounds {
  const ratio = Math.min(1, area.width / bounds.width, area.height / bounds.height)
  const width = Math.max(1, Math.floor(bounds.width * ratio))
  const height = Math.max(1, Math.floor(bounds.height * ratio))
  return {
    x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)), width, height,
  }
}
export function presenceDisplay(displays: PresenceDisplay[], config: PresenceConfig, bounds: PresenceBounds): PresenceDisplay | undefined {
  return displays.find(d => d.id === config.monitorId)
    ?? displays.find(d => bounds.x >= d.workArea.x && bounds.x < d.workArea.x + d.workArea.width
      && bounds.y >= d.workArea.y && bounds.y < d.workArea.y + d.workArea.height)
    ?? displays[0]
}
/** A target always belongs to one physical work area, never a virtual-screen gap. */
export function presenceTarget(displays: PresenceDisplay[], config: PresenceConfig, bounds: PresenceBounds, random = Math.random): PresenceBounds {
  const current = presenceDisplay(displays, config, bounds)
  if (!current)
    return bounds
  const unit = () => Math.max(0, Math.min(0.999999, random()))
  const display = config.allMonitors ? displays[Math.floor(unit() * displays.length)]! : current
  const fitted = fitPresence(bounds, display.workArea)
  return { ...fitted, x: display.workArea.x + Math.floor(unit() * (display.workArea.width - fitted.width + 1)),
    y: display.workArea.y + Math.floor(unit() * (display.workArea.height - fitted.height + 1)) }
}
