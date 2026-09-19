import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  LiaAllTalkRuntimeConfig,
  LiaAllTalkStatus,
  LiaAllTalkSyncResult,
  LiaAllTalkSynthesisRequest,
} from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia-schema'
import type { AllTalkRuntimeConfig } from './alltalk-client'
import type { LiaVoiceProfileStore } from './voice-profiles'

import { defineInvokeHandler } from '@moeru/eventa'
import { BrowserWindow, dialog } from 'electron'

import {
  electronLiaAllTalkConfigGet,
  electronLiaAllTalkConfigSet,
  electronLiaAllTalkStatus,
  electronLiaAllTalkSync,
  electronLiaAllTalkSynthesize,
  electronLiaAllTalkVoicesDirPick,
} from '../../../shared/eventa'
import { defaultLiaProductConfig } from '../../configs/lia-schema'
import {
  createAllTalkClient,
} from './alltalk-client'
import { logAllTalkDeviceReport, probeAllTalkDevice } from './alltalk-device-probe'
import {
  mergeAllTalkRuntime,
  normalizeAllTalkRuntimePayload,
  resolveAllTalkRuntime,
} from './alltalk-runtime-config'
import { resolveSynthesisLanguage, synthesizeProfileWithAllTalk } from './alltalk-synthesis'
import { createAllTalkSyncService } from './alltalk-voices-sync'

type MainContext = ReturnType<typeof createContext>['context']

/**
 * Reduces a renderer payload to the fields the renderer is allowed to set.
 *
 * Extracted as a pure function because the security property lives here, not in
 * the IPC plumbing: **`voicesDir` is never read from the payload.** A directory
 * path can only enter the config through the main process's own
 * `showOpenDialog`, so a compromised renderer cannot aim the sync at an
 * arbitrary folder - not even by sending a plausible-looking one.
 *
 * `baseUrl` must parse as an `http:`/`https:` URL, which is what keeps a value
 * like `file:///C:/Windows` or a bare path out of the client.
 */
/**
 * IPC surface for the local AllTalk runtime.
 *
 * Three rules shape this file:
 *
 * 1. **The renderer cannot set a filesystem path.** `voicesDir` is only ever
 *    written from inside the `showOpenDialog` handler below; `configSet`
 *    deliberately ignores it. There is no channel that accepts a directory from
 *    the renderer, so a compromised renderer cannot aim the sync at, say,
 *    `C:\Windows`.
 * 2. **The renderer cannot name a voice file.** Synthesis takes a `profileId`.
 *    The filename sent to AllTalk as `character_voice_gen` is derived here from
 *    the profile, never accepted from the caller.
 * 3. **Only `voice.runtime.alltalk` is written.** `tts`, `stt`, `persona`,
 *    `provider` and `preferences` are carried over verbatim, so this bridge can
 *    never clobber the voice selection - and it is not a second writer of
 *    `voice.tts`.
 */
export function registerLiaAllTalkBridge(params: {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined, update: (value: LiaProductConfig) => void }
  store: LiaVoiceProfileStore
}): void {
  const { context, liaProductConfig } = params

  function readRuntime(): AllTalkRuntimeConfig {
    return resolveAllTalkRuntime(liaProductConfig.get())
  }

  function writeRuntime(next: Partial<LiaAllTalkRuntimeConfig>): void {
    const current = liaProductConfig.get() ?? defaultLiaProductConfig
    liaProductConfig.update(mergeAllTalkRuntime(current, next))
  }

  function syncService(voicesDir?: string) {
    return createAllTalkSyncService({ store: params.store, voicesDir })
  }

  defineInvokeHandler(context, electronLiaAllTalkConfigGet, (): LiaAllTalkRuntimeConfig => readRuntime())

  defineInvokeHandler(
    context,
    electronLiaAllTalkConfigSet,
    (payload: Partial<LiaAllTalkRuntimeConfig>): LiaAllTalkRuntimeConfig => {
      const next = normalizeAllTalkRuntimePayload(payload)
      if (Object.keys(next).length > 0)
        writeRuntime(next)
      return readRuntime()
    },
  )

  defineInvokeHandler(
    context,
    electronLiaAllTalkVoicesDirPick,
    async (options: { clear?: boolean }): Promise<string | null> => {
      if (options?.clear) {
        writeRuntime({ voicesDir: '' })
        return null
      }

      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const dialogOptions = {
        title: 'Select the AllTalk voices folder',
        properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      // Cancel is a normal outcome: the previous folder stays configured.
      if (result.canceled || result.filePaths.length === 0)
        return null

      const chosen = result.filePaths[0]
      writeRuntime({ voicesDir: chosen })
      return chosen
    },
  )

  defineInvokeHandler(context, electronLiaAllTalkStatus, async (): Promise<LiaAllTalkStatus> => {
    const runtime = readRuntime()
    const client = createAllTalkClient(runtime)
    const probe = await client.status()

    if (probe.ok)
      return { state: 'connected', voices: probe.voices }

    // Offline *and* no folder chosen means there is nothing to point at yet;
    // that is a different instruction to the user than "start your server".
    if (probe.state === 'offline' && !runtime.voicesDir)
      return { state: 'notConfigured' }

    return probe.state === 'offline' ? { state: 'offline' } : { state: 'error', error: probe.error }
  })

  defineInvokeHandler(
    context,
    electronLiaAllTalkSync,
    async (payload: { profileId: string }): Promise<LiaAllTalkSyncResult> => {
      const runtime = readRuntime()
      return syncService(runtime.voicesDir).ensureProfileAvailableToAllTalk(String(payload?.profileId ?? ''))
    },
  )

  defineInvokeHandler(
    context,
    electronLiaAllTalkSynthesize,
    async (request: LiaAllTalkSynthesisRequest): Promise<ArrayBuffer> => {
      const runtime = readRuntime()
      const profileId = String(request?.profileId ?? '')

      // Publish first, so `character_voice_gen` always names a file that exists
      // in AllTalk's folder by the time the request is made.
      return synthesizeProfileWithAllTalk({
        profileId,
        text: String(request?.text ?? ''),
        language: resolveSynthesisLanguage({
          configured: liaProductConfig.get()?.preferences?.language,
          requested: request?.language,
        }),
        runtime,
        store: params.store,
      })
    },
  )

  // Phase 7.7, Part 2: audit the ACTUAL execution device of the running
  // stack - once per process, never blocking IPC, never crashing it. The
  // report distinguishes a CPU-build from a CUDA build from the torch wheel
  // shipped in the install (RX 580 -> likely +cpu, but MEASURED, not guessed).
  void probeAllTalkDevice(readRuntime(), {
    getGpuInfoImpl: async () => {
      try {
        const { app } = await import('electron')
        const info = await app.getGPUInfo('basic') as { gpuDevice?: Array<{ deviceName?: string, deviceVendor?: string }> }
        return Array.isArray(info?.gpuDevice) ? info.gpuDevice : []
      }
      catch {
        return []
      }
    },
  })
    .then(report => logAllTalkDeviceReport(report))
    .catch(() => undefined)
}
