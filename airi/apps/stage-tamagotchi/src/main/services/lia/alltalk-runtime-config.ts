import type { LiaAllTalkRuntimeConfig } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia-schema'
import type { AllTalkRuntimeConfig } from './alltalk-client'

import { defaultLiaProductConfig } from '../../configs/lia-schema'
import { DEFAULT_ALLTALK_BASE_URL, DEFAULT_ALLTALK_TIMEOUT_MS } from './alltalk-client'

/**
 * Reading and writing the AllTalk runtime settings.
 *
 * Split out from the IPC bridge on purpose: this file imports no Electron, so
 * the two security-relevant properties below can be tested directly.
 *
 * - What the renderer may set (`normalizeAllTalkRuntimePayload`).
 * - What a runtime write may disturb (`mergeAllTalkRuntime`).
 */

/**
 * Resolves the effective runtime settings, filling in documented defaults.
 *
 * An unset `voicesDir` stays absent rather than becoming `''`, so "not
 * configured" remains distinguishable from "configured as empty" - the UI owes
 * the user a different instruction in each case.
 */
/**
 * Returns the *client's* shape, with `baseUrl` and `timeoutMs` filled in. That is
 * the whole job of this function: downstream code should never have to ask
 * whether a default was applied.
 */
export function resolveAllTalkRuntime(config: LiaProductConfig | undefined): AllTalkRuntimeConfig {
  const stored = config?.voice?.runtime?.alltalk
  return {
    baseUrl: stored?.baseUrl?.trim() || DEFAULT_ALLTALK_BASE_URL,
    timeoutMs: stored?.timeoutMs && stored.timeoutMs > 0 ? stored.timeoutMs : DEFAULT_ALLTALK_TIMEOUT_MS,
    ...(stored?.voicesDir?.trim() ? { voicesDir: stored.voicesDir.trim() } : {}),
    ...(stored?.installDir?.trim() ? { installDir: stored.installDir.trim() } : {}),
  }
}

/**
 * Writes `voice.runtime.alltalk` into a config document, carrying every other
 * domain through verbatim.
 *
 * Pure so the invariant can be tested directly: `voice.tts` and `voice.stt` come
 * out byte-identical, which is what keeps this bridge from becoming a second
 * writer of the voice selection.
 */
export function mergeAllTalkRuntime(
  current: LiaProductConfig,
  next: Partial<LiaAllTalkRuntimeConfig>,
): LiaProductConfig {
  const voice = current.voice ?? {}
  return {
    schemaVersion: current.schemaVersion ?? defaultLiaProductConfig.schemaVersion,
    persona: current.persona ?? {},
    provider: current.provider ?? {},
    voice: {
      ...voice,
      runtime: { ...voice.runtime, alltalk: { ...voice.runtime?.alltalk, ...next } },
    },
    preferences: current.preferences ?? {},
  }
}

export function normalizeAllTalkRuntimePayload(
  payload: Partial<LiaAllTalkRuntimeConfig> | undefined,
): Partial<LiaAllTalkRuntimeConfig> {
  const next: Partial<LiaAllTalkRuntimeConfig> = {}

  const baseUrl = String(payload?.baseUrl ?? '').trim()
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:')
        next.baseUrl = baseUrl.replace(/\/+$/, '')
    }
    catch {
      // Ignored: an unusable URL leaves the previous one in place.
    }
  }

  const timeoutMs = Number(payload?.timeoutMs)
  if (Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600_000)
    next.timeoutMs = Math.round(timeoutMs)

  // `payload.voicesDir` and `payload.installDir` are intentionally never read.
  // Both are filesystem paths, and both can only enter the config through the
  // main process's own `showOpenDialog` handler.

  return next
}
