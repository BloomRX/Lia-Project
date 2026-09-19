import type { CustomVoiceTransport } from '@proj-airi/stage-ui/libs/providers/providers/custom-local-voice'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { setCustomVoiceTransport } from '@proj-airi/stage-ui/libs/providers/providers/custom-local-voice'

import {
  electronLiaVoiceProfilesList,
  electronLiaVoiceSynthesize,
} from '../../../shared/eventa'

/**
 * Hands the `custom-local-voice` provider a way to reach the main process.
 *
 * The provider itself lives in `stage-ui` and knows nothing about Electron: it
 * receives a profile id and expects audio back. Everything that makes that real
 * - the private voice library, the engine routing (selected engine, the
 * enabled fallback), the canonical reference, the language resolution -
 * happens behind this transport, in the main process. That is what keeps
 * the shared package free of desktop assumptions and the desktop code free
 * of engine internals.
 *
 * Call once, during renderer startup.
 */
export function installCustomVoiceTransport(): CustomVoiceTransport {
  const synthesizeVoice = useElectronEventaInvoke(electronLiaVoiceSynthesize)
  const listProfiles = useElectronEventaInvoke(electronLiaVoiceProfilesList)

  const transport: CustomVoiceTransport = {
    synthesize: async (request) => {
      const result = await synthesizeVoice(request)
      // The engine fact stays available on the result for diagnostics, but
      // this transport intentionally never introspects it - engine identity
      // is devtools metadata, never a persona topic and never a UI branch.
      return result.audio
    },
    async listProfiles() {
      const profiles = await listProfiles()
      return profiles.map(profile => ({
        id: profile.id,
        name: profile.name,
        ...(profile.metadata?.language ? { language: profile.metadata.language } : {}),
      }))
    },
  }

  setCustomVoiceTransport(transport)
  return transport
}
