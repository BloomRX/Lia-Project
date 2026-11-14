import type { LiaCapabilitySnapshot } from '@proj-airi/stage-ui/libs/capabilities/lia-capability-port'

import { getElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { setLiaCapabilityRefreshHook, setLiaCapabilitySnapshot } from '@proj-airi/stage-ui/libs/capabilities/lia-capability-port'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import {
  electronLiaCapabilitiesGet,
  electronLiaCapabilitiesUpdated,
} from '../../../shared/eventa'

/**
 * Phase 7.7, Parts 7-11 (renderer half): carries the MAIN-process capability
 * truth into the shared chat package.
 *
 * The renderer never computes `voice.configured` / `voice.available` itself
 * (Part 10) - those come from the main process over IPC, and the push event
 * keeps this store current when the product truth changes (a voice gets
 * deselected, the runtime drops, ...).
 *
 * Refresh happens at turn boundaries (Part 11): `refresh()` is called from
 * the message-composed hook as well as here once at boot, so the snapshot a
 * turn reads is never more than one turn old - and it is NEVER rewritten
 * mid-generation, the refresh only lands before the next turn starts.
 */

let installed = false

export const useLiaCapabilitiesStore = defineStore('lia-capabilities', () => {
  const getCapabilities = useElectronEventaInvoke(electronLiaCapabilitiesGet)

  const stageModel = useSettingsStageModel()
  const currentSnapshot = shallowRef<LiaCapabilitySnapshot>()
  // A computed exposes facts without exposing a writable ref through Pinia.
  const snapshot = computed(() => currentSnapshot.value)

  function publish(next: LiaCapabilitySnapshot | undefined) {
    setLiaCapabilitySnapshot(next)
    currentSnapshot.value = next
  }

  function avatarAvailable(): boolean {
    // Presence signal only: a display model with a renderer that is not
    // 'disabled'. Unlike voice, this fact never gates behavior; it only
    // stops the persona from saying she cannot be seen.
    return Boolean(stageModel.stageModelSelectedDisplayModel)
  }

  async function refresh(): Promise<void> {
    try {
      const next = await getCapabilities({ avatarAvailable: avatarAvailable() })
      publish(next ?? undefined)
    }
    catch {
      // A dropped IPC resolves to "no capability claims at all" - the safest
      // lie is silence; the next turn's refresh can still succeed.
      publish(undefined)
    }
  }

  function initialize(): void {
    if (installed)
      return
    installed = true

    // Push channel: main publishes whenever the derived truth changes
    // (config edit, runtime up/down), so turns stay fresh without polling.
    getElectronEventaContext().on(electronLiaCapabilitiesUpdated, (event) => {
      // The runtime-state bridge emits its snapshot as `event.body`; follow it,
      // but stay tolerant of the plain-snapshot shape used by unit fakes.
      const snapshot = (event as { body?: unknown })?.body ?? event
      publish(snapshot as LiaCapabilitySnapshot | undefined)
    })

    // The Stage scene refreshes at every message-composed turn boundary via
    // this hook (Part 11) - the chat core never re-reads mid-generation.
    setLiaCapabilityRefreshHook(() => refresh())

    void refresh()
  }

  return {
    initialize,
    refresh,
    snapshot,
  }
})
