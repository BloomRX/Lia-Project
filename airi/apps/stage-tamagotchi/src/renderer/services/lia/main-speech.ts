import type { LiaVoiceTtsTarget } from '../../../shared/eventa'

import { ProviderError } from '../../../../../../../lia/core/src/providers/index'
import { supportsMainSpeech } from '../../../shared/lia/speech-transport'
import { createMainTransportExecution } from './main-transport-execution'
import { createLiaTransportClient, toTransportRecord } from './transport-config'

/** Shared by preview and the automatic Stage host. Unsupported adapters stay local. */
export function createNativeSpeechSynthesis(readLegacyEndpoint?: (providerId: string) => unknown) {
  const execution = createMainTransportExecution()
  const transports = createLiaTransportClient()
  async function run(target: LiaVoiceTtsTarget, text: string, signal: AbortSignal) {
    if (signal.aborted)
      throw new ProviderError('cancelled')
    if (!text.trim())
      return new ArrayBuffer(0)
    const { providerId, modelId, voiceId } = target
    if (!modelId || !voiceId)
      throw new ProviderError('configuration')
    await transports.refresh()
    if (signal.aborted)
      throw new ProviderError('cancelled')
    let record = transports.get(providerId)
    const legacyBaseUrl = readLegacyEndpoint?.(providerId)
    const savedLegacyEndpoint = typeof legacyBaseUrl === 'string' ? legacyBaseUrl.trim() : ''
    if (!record && !transports.hasRemoved(providerId)) {
      // Import only the saved endpoint. Existing keys must already be in
      // the vault for this exact provider. A tombstone cannot be revived.
      if (savedLegacyEndpoint) {
        await transports.migrate([{
          ...toTransportRecord(providerId, providerId, { baseUrl: savedLegacyEndpoint }),
          protocol: 'audio-speech',
        }])
        record = transports.get(providerId)
      }
    }
    if (signal.aborted)
      throw new ProviderError('cancelled')
    if (!record?.enabled || record.protocol !== 'audio-speech')
      throw new ProviderError('configuration')
    if (!record.adapterOptions.managedSpeechConfig && savedLegacyEndpoint && savedLegacyEndpoint.replace(/\/+$/, '') !== record.baseUrl.replace(/\/+$/, ''))
      throw new ProviderError('configuration')
    return execution.synthesize(providerId, record.baseUrl, { model: modelId, voice: voiceId, input: text }, signal)
  }
  return (target: LiaVoiceTtsTarget, text: string, signal: AbortSignal) =>
    supportsMainSpeech(target.providerId) ? run(target, text, signal) : undefined
}
