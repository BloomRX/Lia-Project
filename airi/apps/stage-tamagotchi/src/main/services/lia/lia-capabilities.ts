import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { LiaCapabilitySnapshot } from '../../../shared/eventa'
import type { LiaProductConfig } from '../../configs/lia-schema'
import type { AllTalkRuntimeConfig } from './alltalk-client'
import type { LiaVoiceProfileStore } from './voice-profiles'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronLiaCapabilitiesGet,
  electronLiaCapabilitiesUpdated,
} from '../../../shared/eventa'
import { createAllTalkClient } from './alltalk-client'
import { createAllTalkSyncService, isVoiceVisibleToAllTalk } from './alltalk-voices-sync'

/**
 * Phase 7.7, Parts 7 + 10 + 11: the product's capability truth.
 *
 * The persona must be able to say "I have a voice" when she does, and must
 * never be tricked into "I am text-only" while speaking. What feeds that
 * answer MUST be authoritative runtime state, computed by the main process:
 *
 * - `voice.configured` derives from the PRODUCT selection
 *   (`voice.tts.preferred` on the custom voice provider + a profile id that
 *   still exists in the registry) - facts of configuration, cheap to read.
 *
 * - `voice.available` derives from a LIGHT probe of what can actually play
 *   right now: the server answers its health check AND sees the selected
 *   profile. A live HTTP probe per LLM turn would be wasteful, so the result
 *   is cached for `PROBE_TTL_MS`; configuration facts are always fresh. This
 *   is the "availability is real runtime state, not inferred from config"
 *   rule, implemented with a bounded cost.
 *
 * - `avatar.available` is a renderer-supplied presence signal (the stage
 *   knows whether a model is rendering; the main process cannot see it).
 *   It is a display fact only - unlike voice, it never gates behavior.
 *
 * The persona receives NOTHING else: no AllTalk, no XTTS, no ports, no
 * paths, no process ids (Part 7). Backend vocabulary stays in Diagnostics.
 */

/** The provider id that means "the user imported a voice of their own". */
const CUSTOM_LOCAL_VOICE_PROVIDER_ID = 'custom-local-voice'

const PROBE_TTL_MS = 8_000

interface VoiceSelection {
  configured: boolean
  profileId?: string
}

const DEFAULT_SNAPSHOT: LiaCapabilitySnapshot = {
  avatar: { available: false },
  voice: { available: false, configured: false },
}

/** Pure resolver for the configured half - exported for tests. */
export function resolveVoiceSelection(
  config: LiaProductConfig | undefined,
  profileIds: ReadonlySet<string>,
): VoiceSelection {
  const preferred = config?.voice?.tts?.preferred
  if (!preferred || preferred.providerId !== CUSTOM_LOCAL_VOICE_PROVIDER_ID)
    return { configured: false }

  const profileId = preferred.voiceId?.trim()
  if (!profileId || !profileIds.has(profileId))
    return { configured: false }

  return { configured: true, profileId }
}

type MainContext = ReturnType<typeof createContext>['context']

export function registerLiaCapabilitiesBridge(params: {
  context: MainContext
  liaProductConfig: { get: () => LiaProductConfig | undefined }
  /** Live resolver of the runtime connection the synthesis path can use. */
  readRuntime: () => AllTalkRuntimeConfig
  store: LiaVoiceProfileStore
}): { invalidate: () => void } {
  const { context, liaProductConfig, readRuntime, store } = params

  interface AvailabilityCache {
    available: boolean
    expiresAt: number
    /** Profile the availability result referred to - live checks only matter for it. */
    profileId: string
  }
  let availabilityCache: AvailabilityCache | undefined

  async function probeVoiceAvailable(profileId: string): Promise<boolean> {
    if (availabilityCache
      && availabilityCache.profileId === profileId
      && availabilityCache.expiresAt > Date.now()) {
      return availabilityCache.available
    }

    const runtime = readRuntime()
    if (!runtime)
      return false

    let available = false
    try {
      const status = await createAllTalkClient(runtime).status()
      if (status.ok && status.state === 'connected') {
        // Visibility via the REAL contract (Phase 7.5.1): the server reports
        // managed filenames exactly as `/api/voices` returns them.
        const managedFilename = await createAllTalkSyncService({
          store,
          voicesDir: runtime.voicesDir,
        }).filenameFor(profileId)
        available
          = !managedFilename // no derived name -> profile's audio missing
            ? false
            : isVoiceVisibleToAllTalk(status.voices, managedFilename)
      }
    }
    catch {
      available = false
    }

    availabilityCache = {
      available,
      expiresAt: Date.now() + PROBE_TTL_MS,
      profileId,
    }
    return available
  }

  async function computeSnapshot(avatarAvailable: boolean): Promise<LiaCapabilitySnapshot> {
    const selection = resolveVoiceSelection(liaProductConfig.get(), await storeIds())
    const available = selection.configured && selection.profileId
      ? await probeVoiceAvailable(selection.profileId)
      : false

    const snapshot: LiaCapabilitySnapshot = {
      avatar: { available: avatarAvailable },
      voice: { available, configured: selection.configured },
    }
    return snapshot
  }

  async function storeIds(): Promise<ReadonlySet<string>> {
    try {
      const profiles = await store.list()
      return new Set(profiles.map(profile => profile.id))
    }
    catch {
      return new Set()
    }
  }

  let lastPublished: LiaCapabilitySnapshot | undefined

  function publishIfChanged(snapshot: LiaCapabilitySnapshot): void {
    if (lastPublished
      && lastPublished.voice.configured === snapshot.voice.configured
      && lastPublished.voice.available === snapshot.voice.available
      && lastPublished.avatar.available === snapshot.avatar.available) {
      return
    }
    lastPublished = snapshot
    context.emit(electronLiaCapabilitiesUpdated, snapshot)
  }

  defineInvokeHandler(
    context,
    electronLiaCapabilitiesGet,
    async (payload?: { avatarAvailable?: boolean }) => {
      const snapshot = await computeSnapshot(Boolean(payload?.avatarAvailable))
      publishIfChanged(snapshot)
      return snapshot
    },
  )
  /**
   * Configuration changes invalidate the TTL immediately (Part 11): the next
   * LLM turn always re-probes, never reuses a stale availability verdict.
   */
  function invalidate(): void {
    availabilityCache = undefined
  }

  return { invalidate }
}

export { DEFAULT_SNAPSHOT as DEFAULT_LIA_CAPABILITY_SNAPSHOT }
