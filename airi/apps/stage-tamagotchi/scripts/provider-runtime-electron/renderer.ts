import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { generateText } from '@xsai/generate-text'
import { streamText } from '@xsai/stream-text'

import { createNativeProviderRuntime } from '../../src/renderer/services/lia/native-provider-runtime'
import {
  electronLiaProviderChatConfigGet,
  electronLiaProviderChatConfigSet,
  electronLiaSecretEncryptionAvailable,
  electronLiaSecretGet,
  electronLiaSecretSet,
} from '../../src/shared/eventa'

const invokeGet = useElectronEventaInvoke(electronLiaSecretGet)
const invokeSet = useElectronEventaInvoke(electronLiaSecretSet)
const invokeAvailable = useElectronEventaInvoke(electronLiaSecretEncryptionAvailable)
const getConfig = useElectronEventaInvoke(electronLiaProviderChatConfigGet)
const setConfig = useElectronEventaInvoke(electronLiaProviderChatConfigSet)
const status = document.querySelector<HTMLElement>('#status')!
const result = document.querySelector<HTMLElement>('#result')!
const providerInput = document.querySelector<HTMLSelectElement>('#provider')!
const endpointInput = document.querySelector<HTMLInputElement>('#endpoint')!
const modelInput = document.querySelector<HTMLInputElement>('#model')!
let controller: AbortController | undefined
let pending: Promise<void> | undefined
let last = { phase: 'idle', code: '' }
const native = createNativeProviderRuntime({
  readConfig: () => ({ baseUrl: endpointInput.value }),
  resolveCredential: providerId => invokeGet({ scope: providerId, key: 'apiKey' }),
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

async function execute(kind: 'json' | 'stream' | 'discover') {
  controller = new AbortController()
  const signal = controller.signal
  last = { phase: 'running', code: '' }
  status.textContent = 'Processando'
  result.textContent = ''
  try {
    const providerId = providerInput.value
    const model = modelInput.value
    await setConfig({ preferred: { providerId, modelId: model }, fallbackEnabled: false })
    if (kind === 'discover') {
      const key = await invokeGet({ scope: providerId, key: 'apiKey' })
      const discovered = await native.discover(providerId, { baseUrl: endpointInput.value, apiKey: key })
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
  seed: (scope: string, value: string) => invokeSet({ scope, key: 'apiKey', value }),
  encryptionAvailable: () => invokeAvailable(),
  config: () => getConfig(),
  wait: async () => {
    await pending
    return { ...last, text: result.textContent }
  },
}
declare global {
  interface Window { providerGate: typeof api }
}
window.providerGate = api
void getConfig().then((config) => {
  if (config.preferred?.providerId)
    providerInput.value = config.preferred.providerId
  if (config.preferred?.modelId)
    modelInput.value = config.preferred.modelId
  status.textContent = 'Pronto'
})
