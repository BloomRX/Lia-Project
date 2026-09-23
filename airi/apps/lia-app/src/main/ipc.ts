import type { LiaConfigUpdatePayload, LiaHost } from './lia-host'
import type { LiaBootTimer } from './timing'

import { ipcMain } from 'electron'

/**
 * The launcher's IPC surface (Phase 7 + 7.1). Plain `ipcMain.handle`
 * channels, `lia:`-prefixed: no AIRI eventa, no shared framework - the
 * smallest stable contract (architecture item 6) between the launcher
 * window and the launcher process. The renderer never receives secret
 * VALUES: a boolean presence map only (item 17), and config writes ride a
 * separate `secrets` array straight to the vault (Phase 7.1, item 5).
 */

export interface LiaIpcExtras {
  /**
   * Opens the OS file picker for voice audio and returns absolute paths.
   * Injected by the Electron entry (needs a window); the picked paths are
   * remembered as the ONLY importable sources until the next pick.
   */
  pickVoiceFiles?: () => Promise<string[]>
  /**
   * Opens the OS DIRECTORY picker for the heavy runtime location (Phase
   * 7.4 Part J). The directory path may ONLY arrive here - never as a
   * renderer payload - so a compromised window cannot aim installs at
   * `C:\Windows`.
   */
  pickDirectory?: () => Promise<string | null>
  /** The renderer's "close Lia" button routes here (Phase 7.1, item 3). */
  requestQuit?: () => void
  /**
   * Phase 7.9G: the product Voice Engine surface (install state, ONE
   * install action). Owner: `voice-engine-service`; absent in unit tests
   * that do not exercise the Voice screen.
   */
  voiceEngine?: {
    install: () => Promise<unknown>
    state: () => Promise<unknown>
  }
}

/** The voice-file allowlist, refreshed by every successful pick. */
let lastPickedVoicePaths: string[] = []

export function registerLiaIpc(host: LiaHost, timer: LiaBootTimer, extras: LiaIpcExtras = {}): void {
  ipcMain.handle('lia:home-status', async () => await host.homeStatus())
  ipcMain.handle('lia:product-config', async () => {
    const snapshot = await host.productSnapshot()
    return {
      filePath: host.paths.productConfigFile,
      snapshot,
      status: (await host.homeStatus()).config.status,
    }
  })
  ipcMain.handle('lia:voices:list', async () => await host.listVoices())
  ipcMain.handle('lia:runtime:state', async () => {
    // Engine-neutral answer from the home status (Phase 7.8C): the launcher
    // hosts no worker yet, so the strip reads the install phase honestly.
    const voice = (await host.homeStatus()).voice
    return {
      installed: voice.installed === true,
      state: { note: voice.error, phase: voice.phase, running: voice.running },
    }
  })
  ipcMain.handle('lia:bridge', async () => {
    // The stage adapter contract, rendered read-only for the diagnostics
    // tab. `hasSecret` is a function and cannot serialize; the renderer
    // receives the boolean map only.
    const bridge = await host.bridgeConfig()
    const safe: unknown = {
      ...bridge,
      secrets: { vaultFile: bridge.secrets.vaultFile },
    }
    return safe
  })
  ipcMain.handle('lia:secrets:presence', async (_event, providerId: string) => {
    if (typeof providerId !== 'string' || providerId.length === 0 || providerId.length > 64)
      return false
    return host.vault.hasSecret(providerId, 'apiKey')
  })
  ipcMain.handle('lia:stage:state', () => host.stage.state())
  ipcMain.handle('lia:stage:start', async () => await host.conversar())
  ipcMain.handle('lia:stage:stop', async () => {
    await host.stage.stop()
    return host.stage.state()
  })
  ipcMain.handle('lia:timings', () => timer.marks())

  // ---- Phase 7.1 channels -------------------------------------------------

  ipcMain.handle('lia:config:update', async (_event, payload: unknown) => {
    return await host.updateConfig(sanitizeConfigUpdate(payload))
  })

  ipcMain.handle('lia:voices:pick', async () => {
    if (!extras.pickVoiceFiles)
      return []
    lastPickedVoicePaths = await extras.pickVoiceFiles()
    return lastPickedVoicePaths
  })

  ipcMain.handle('lia:voices:import', async (_event, request: unknown) => {
    // The allowlist makes EVERY imported source provably dialog-picked: the
    // renderer cannot turn this channel into an arbitrary-file reader.
    const validated = sanitizeVoiceImport(request)
    return await host.importVoice(validated, new Set(lastPickedVoicePaths))
  })

  ipcMain.handle('lia:app:quit', () => {
    extras.requestQuit?.()
  })

  // ---- Phase 7.4 runtime location channels (Part G/J) --------------------
  // The renderer can ASK for a folder pick, but the path itself only ever
  // enters through the main-process dialog and only persists after the
  // core's validation - mirroring the voicesDir rule above.

  ipcMain.handle('lia:runtime-location:status', async () => await host.runtimeLocationStatus())

  ipcMain.handle('lia:runtime-location:pick', async () => {
    const chosen = extras.pickDirectory ? await extras.pickDirectory() : null
    return await host.applyRuntimeLocation(chosen)
  })

  ipcMain.handle('lia:runtime-location:clear', async () => await host.clearRuntimeLocation())

  // ---- Phase 7.9G voice-engine channels ----------------------------------
  // READ surface + ONE install action. Selection intentionally rides the
  // EXISTING `lia:config:update` writer (canonical seam) - no new write
  // channel exists for engines.

  ipcMain.handle('lia:voice-engine:state', async () => {
    if (!extras.voiceEngine)
      return { engines: [], phase: 'idle' }
    return await extras.voiceEngine.state()
  })

  ipcMain.handle('lia:voice-engine:install', async () => {
    if (!extras.voiceEngine)
      return { status: 'failed' }
    return await extras.voiceEngine.install()
  })
}

/**
 * The renderer's save payload, whittled to its contract: strings, plain
 * objects, and the secrets array on its own rail. Oversized or mistyped
 * fields are DROPPED - the core writer below stays the final validator.
 */
function sanitizeConfigUpdate(payload: unknown): LiaConfigUpdatePayload {
  const source = (payload !== null && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const secrets: LiaConfigUpdatePayload['secrets'] = []
  if (Array.isArray(source.secrets)) {
    for (const entry of source.secrets) {
      if (entry === null || typeof entry !== 'object')
        continue
      const { key, scope, value } = entry as Record<string, unknown>
      if (typeof scope !== 'string' || typeof key !== 'string' || typeof value !== 'string')
        continue
      if (scope.length === 0 || scope.length > 64 || key.length === 0 || key.length > 64 || value.length > 4096)
        continue
      secrets.push({ key, scope, value })
    }
  }
  const update = (source.update !== null && typeof source.update === 'object' ? source.update : {}) as LiaConfigUpdatePayload['update']
  return { secrets, update }
}

/** The voice import request, whittled to name + engine + picked sources. */
function sanitizeVoiceImport(request: unknown): {
  engine?: string
  name: string
  sources: { path: string, role: string }[]
} {
  const source = (request !== null && typeof request === 'object' ? request : {}) as Record<string, unknown>
  const sources: { path: string, role: string }[] = []
  if (Array.isArray(source.sources)) {
    for (const entry of source.sources) {
      if (entry === null || typeof entry !== 'object')
        continue
      const { path, role } = entry as Record<string, unknown>
      if (typeof path !== 'string' || path.length === 0 || path.length > 1024)
        continue
      const safeRole = typeof role === 'string' && role.length > 0 && role.length <= 32 ? role : 'referenceAudio'
      sources.push({ path, role: safeRole })
    }
  }
  const name = typeof source.name === 'string' && source.name.trim().length > 0 ? source.name.trim().slice(0, 200) : 'Voz importada'
  // No default engine id: with no runnable engine registered (Phase 7.8D) an
  // import without one defers cleanly in the core instead of writing a fake id.
  const engine = typeof source.engine === 'string' && source.engine.trim().length > 0 ? source.engine.trim().slice(0, 64) : undefined
  return { ...(engine ? { engine } : {}), name, sources }
}
