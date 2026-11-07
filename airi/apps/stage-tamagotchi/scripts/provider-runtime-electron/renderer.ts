import type { TransportMutation, TransportRecord, TransportSnapshot } from '../../../../../lia/core/src/transports/contracts'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { generateText } from '@xsai/generate-text'
import { streamText } from '@xsai/stream-text'

import { createMainTransportExecution } from '../../src/renderer/services/lia/main-transport-execution'
import { createNativeProviderRuntime } from '../../src/renderer/services/lia/native-provider-runtime'
import { legacyTransportCandidates, toTransportRecord } from '../../src/renderer/services/lia/transport-config'
import {
  electronLiaProviderChatConfigGet,
  electronLiaProviderChatConfigSet,
  electronLiaSecretDelete,
  electronLiaSecretEncryptionAvailable,
  electronLiaSecretGet,
  electronLiaSecretSet,
} from '../../src/shared/eventa'
import { electronLiaTransportsGet, electronLiaTransportsMutate } from '../../src/shared/eventa/lia-transports'

const invokeSet = useElectronEventaInvoke(electronLiaSecretSet)
const invokeAvailable = useElectronEventaInvoke(electronLiaSecretEncryptionAvailable)
const getConfig = useElectronEventaInvoke(electronLiaProviderChatConfigGet)
const setConfig = useElectronEventaInvoke(electronLiaProviderChatConfigSet)
const getTransports = useElectronEventaInvoke(electronLiaTransportsGet)
const mutateTransports = useElectronEventaInvoke(electronLiaTransportsMutate)
const status = document.querySelector<HTMLElement>('#status')!
const result = document.querySelector<HTMLElement>('#result')!
const providerInput = document.querySelector<HTMLSelectElement>('#provider')!
const endpointInput = document.querySelector<HTMLInputElement>('#endpoint')!
const modelInput = document.querySelector<HTMLInputElement>('#model')!
let controller: AbortController | undefined
let pending: Promise<void> | undefined
let last = { phase: 'idle', code: '' }
let snapshot: TransportSnapshot | undefined
async function refreshTransports() {
  const reply = await getTransports()
  if (!reply.ok)
    throw Object.assign(new Error('Transport repository unavailable'), { code: 'configuration' })
  snapshot = reply.snapshot
}
const native = createNativeProviderRuntime({
  execution: createMainTransportExecution(),
  beforeRead: refreshTransports,
  readConfig: (providerId) => {
    const record = snapshot?.records.find(item => item.providerId === providerId)
    if (!record?.enabled)
      throw Object.assign(new Error('Transport unavailable'), { code: 'configuration' })
    return { baseUrl: record.baseUrl }
  },
})

function safeCode(error: unknown) {
  const allowed = new Set(['configuration', 'credentials', 'http', 'network', 'timeout', 'cancelled', 'protocol', 'empty', 'unsupported'])
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const entry = current as { code?: unknown, cause?: unknown }
    if (typeof entry.code === 'string' && allowed.has(entry.code))
      return entry.code
    current = entry.cause
  }
  return 'operation'
}

async function execute(kind: 'json' | 'stream' | 'discover', persist = true) {
  controller = new AbortController()
  const signal = controller.signal
  last = { phase: 'running', code: '' }
  status.textContent = 'Processando'
  result.textContent = ''
  try {
    const providerId = providerInput.value
    const model = modelInput.value
    await refreshTransports()
    if (persist) {
      const current = snapshot!.records.find(item => item.id === providerId)
      const record: TransportRecord = {
        id: providerId,
        providerId,
        definitionId: providerId,
        type: 'http',
        protocol: 'chat-completions',
        baseUrl: endpointInput.value,
        adapterOptions: current?.adapterOptions ?? {},
        modelIds: [model],
        enabled: true,
        metadata: current?.metadata ?? {},
        credentialRef: { scope: providerId, key: 'apiKey' },
      }
      const reply = await mutateTransports({ kind: 'put', expectedRevision: snapshot!.revision, record })
      if (!reply.ok)
        throw Object.assign(new Error('Transport update failed'), { code: 'configuration' })
      snapshot = reply.snapshot
    }
    await setConfig({ preferred: { providerId, modelId: model }, fallbackEnabled: false })
    if (kind === 'discover') {
      const record = snapshot!.records.find(item => item.providerId === providerId)
      const discovered = await native.discover(providerId, { baseUrl: record?.baseUrl })
      if (discovered.status !== 'ready')
        throw new Error('Discovery did not complete')
      result.textContent = discovered.models.map(item => item.id).join('\n')
    }
    else {
      const provider = await native.getChatProvider(providerId)
      if (!provider)
        throw new Error('Unmigrated target')
      const options = { ...provider.chat(model), messages: [{ role: 'user' as const, content: 'Synthetic integration fixture.' }], abortSignal: signal }
      if (kind === 'json') {
        const response = await generateText(options)
        if (!response.text?.trim()) {
          last = { phase: 'error', code: 'empty' }
          status.textContent = 'Falha: empty'
          return
        }
        result.textContent = response.text
      }
      else {
        const stream = streamText({ ...options, onEvent: (event) => {
          if (event.type === 'text.delta')
            result.textContent += event.delta
        } })
        // The full step lifecycle is authoritative; optional result rejections
        // are observed as in production, without logging private error bodies.
        void stream.messages.catch(() => {})
        void stream.usage.catch(() => {})
        void stream.totalUsage.catch(() => {})
        await stream.steps
      }
    }
    last = { phase: 'done', code: '' }
    status.textContent = 'Concluído'
  }
  catch (error) {
    last = { phase: 'error', code: safeCode(error) }
    status.textContent = `Falha: ${last.code}`
  }
}

for (const kind of ['json', 'stream', 'discover'] as const) {
  document.querySelector(`#${kind}`)!.addEventListener('click', () => {
    if (last.phase !== 'running')
      pending = execute(kind)
  })
}
document.querySelector('#cancel')!.addEventListener('click', () => controller?.abort())
window.addEventListener('beforeunload', () => native.dispose())

const api = {
  synthesizeFixtureSpeech: async (providerId: string, baseUrl: string) => {
    const port = createMainTransportExecution()
    try {
      const bytes = await port.synthesize(providerId, baseUrl, { model: 'fixture-speech', voice: 'fixture-voice', input: 'Olá' }, new AbortController().signal)
      return Array.from(new Uint8Array(bytes))
    }
    finally {
      port.dispose()
    }
  },
  // Adversarial probe only: production execution does not use this getter.
  readProtectedSecret: (scope: string) => useElectronEventaInvoke(electronLiaSecretGet)({ scope, key: 'apiKey' }),
  seed: (scope: string, value: string) => invokeSet({ scope, key: 'apiKey', value }),
  clearFixtureKey: (scope: string) => useElectronEventaInvoke(electronLiaSecretDelete)({ scope, key: 'apiKey' }),
  encryptionAvailable: () => invokeAvailable(),
  config: () => getConfig(),
  transports: () => getTransports(),
  migrateLegacy: async (configured: unknown, credentials: unknown, modelIds: string[]) => {
    await refreshTransports()
    return mutateTransports({ kind: 'migrate', expectedRevision: snapshot!.revision, records: legacyTransportCandidates(configured, credentials).map(candidate => toTransportRecord(candidate.id, candidate.definitionId, candidate.config, modelIds)) })
  },
  mutate: async (mutation: TransportMutation) => {
    const reply = await mutateTransports(mutation)
    await refreshTransports()
    return reply
  },
  executeStored: async () => {
    await execute('json', false)
    return { ...last, text: result.textContent }
  },
  /**
   * Runs one stored record for `providerId` without touching the form.
   *
   * Used by the curated-provider matrix: the record is written first (the
   * configuration the gate is testing), then executed through the same
   * production bridge the Launcher uses.
   */
  executeProvider: async (providerId: string, model: string, mode: 'json' | 'stream' = 'json') => {
    providerInput.value = providerId
    modelInput.value = model
    await execute(mode, false)
    return { ...last, text: result.textContent }
  },
  /**
   * Sends several providers at once. Each call owns its own provider instance,
   * so one failure must not surface on another provider's channel.
   */
  concurrent: async (entries: Array<{ providerId: string, model: string }>) => {
    await refreshTransports()
    return Promise.all(entries.map(async ({ providerId, model }) => {
      try {
        const provider = await native.getChatProvider(providerId)
        if (!provider)
          return { providerId, code: 'unmigrated', text: '' }
        const response = await generateText({ ...provider.chat(model), messages: [{ role: 'user' as const, content: 'Synthetic concurrency fixture.' }] })
        return { providerId, code: '', text: response.text }
      }
      catch (error) {
        return { providerId, code: safeCode(error), text: '' }
      }
    }))
  },
  /** Seeds one record per provider, all pointing at the local fixture server. */
  seedRecords: async (entries: Array<{ providerId: string, baseUrl: string, model: string }>) => {
    await refreshTransports()
    let revision = snapshot!.revision
    for (const entry of entries) {
      const current = snapshot!.records.find(item => item.id === entry.providerId)
      const record: TransportRecord = {
        id: entry.providerId,
        providerId: entry.providerId,
        definitionId: entry.providerId,
        type: 'http',
        protocol: 'chat-completions',
        baseUrl: entry.baseUrl,
        adapterOptions: current?.adapterOptions ?? {},
        modelIds: [entry.model],
        enabled: true,
        metadata: current?.metadata ?? {},
        credentialRef: { scope: entry.providerId, key: 'apiKey' },
      }
      const reply = await mutateTransports({ kind: 'put', expectedRevision: revision, record })
      if (!reply.ok)
        throw Object.assign(new Error('Transport update failed'), { code: 'configuration' })
      snapshot = reply.snapshot
      revision = reply.snapshot.revision
    }
    return snapshot!.records.map(item => item.id)
  },
  wait: async () => {
    await pending
    return { ...last, text: result.textContent }
  },
  /**
   * Tears the transport bridge down and proves the next send is refused instead
   * of reaching the network — the same `dispose()` the Stage calls on unmount.
   * Returns the sanitized class, never the body.
   */
  disposeAndExecute: async (providerId: string, model: string) => {
    native.dispose(providerId)
    providerInput.value = providerId
    modelInput.value = model
    await execute('json', false)
    return { ...last }
  },
}
declare global {
  interface Window { providerGate: typeof api }
}
window.providerGate = api
void getConfig().then(async (config) => {
  await refreshTransports()
  if (config.preferred?.providerId)
    providerInput.value = config.preferred.providerId
  if (config.preferred?.modelId)
    modelInput.value = config.preferred.modelId
  const record = snapshot?.records.find(item => item.providerId === providerInput.value)
  if (record)
    endpointInput.value = record.baseUrl
  status.textContent = 'Pronto'
})
