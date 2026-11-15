import { createPinia, defineStore } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, defineComponent, nextTick, ref } from 'vue'

import { registerProviderCredentialConfigPort } from '../stores/providers/credential-config-port'
import { useProviderValidation } from './use-provider-validation'

const boundary = vi.hoisted(() => ({
  validateProviderConfig: vi.fn(),
  getProviderDefinition: vi.fn(() => ({ id: 'native-service' })),
  getDefaultProviderConfig: vi.fn(() => ({})),
  hasManualProviderValidators: vi.fn(async () => false),
  initializeProvider: vi.fn(async () => {}),
}))

const useFixtureStore = defineStore('credential-validation-fixture', () => {
  const configs = ref<Record<string, { baseUrl: string, status?: string }>>({})
  const added = ref<string[]>([])
  return {
    configs,
    added,
    getProvider: (id: string) => configs.value[id],
    setProviderStatus: (id: string, status: string) => { configs.value[id].status = status },
    markProviderAdded: (id: string) => { added.value.push(id) },
  }
})

vi.mock('../stores/providers/config', () => ({ useProviderConfigStore: () => useFixtureStore() }))
vi.mock('../stores/providers/provider', () => ({ useProviderStore: () => boundary }))
vi.mock('../libs/providers/metadata', () => ({ selectProviderMetadata: async () => ({ id: 'native-service' }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({}) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: { value: 'pt-BR' } }) }))
vi.mock('./use-analytics', () => ({ useAnalytics: () => ({
  trackProviderConnectionTestCompleted: vi.fn(),
  trackProviderConnectionTestStarted: vi.fn(),
}) }))

interface HostNode { text: string }
const renderer = createRenderer<HostNode, HostNode>({
  createElement: () => ({ text: '' }),
  createText: text => ({ text }),
  createComment: text => ({ text }),
  insert: () => {},
  remove: () => {},
  patchProp: () => {},
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.text = text },
  parentNode: () => null,
  nextSibling: () => null,
})

describe('native credential configuration validation', () => {
  let dispose: (() => void) | undefined
  let unmount: (() => void) | undefined
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => {
    unmount?.()
    dispose?.()
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each([
    { endpoint: 'https://service.example/v1/', requiresCredential: false, configured: true },
    { endpoint: 'http://127.0.0.1:32145/v1/', requiresCredential: false, configured: true },
    { endpoint: 'https://service.example/v1/', requiresCredential: true, configured: false },
    { endpoint: 'https://service.example/v1/', requiresCredential: undefined, configured: false },
  ])('validates $endpoint with requiresCredential=$requiresCredential', async ({ endpoint, requiresCredential, configured }) => {
    const has = vi.fn(async () => false)
    dispose = registerProviderCredentialConfigPort({
      owns: id => id === 'native-service',
      has,
      save: async () => true,
      ...(requiresCredential === undefined ? {} : { requiresCredential: () => requiresCredential }),
    })
    const pinia = createPinia()
    const store = useFixtureStore(pinia)
    store.configs['native-service'] = { baseUrl: endpoint }
    let validation: ReturnType<typeof useProviderValidation> | undefined
    const app = renderer.createApp(defineComponent({
      setup() {
        validation = useProviderValidation('native-service')
        return () => null
      },
    }))
    app.use(pinia)
    app.mount({ text: '' })
    unmount = () => app.unmount()
    // Flush async metadata and lifecycle work, then the composable's feedback delay.
    for (let i = 0; i < 8; i++)
      await nextTick()
    await vi.advanceTimersByTimeAsync(1000)

    expect(validation?.isValid.value).toBe(configured)
    expect(store.getProvider('native-service')?.status).toBe(configured ? 'configured' : 'unconfigured')
    expect(store.added.includes('native-service')).toBe(configured)
    expect(store.configs['native-service']).not.toHaveProperty('apiKey')
    expect(boundary.validateProviderConfig).not.toHaveBeenCalled()
    if (requiresCredential === false)
      expect(has).not.toHaveBeenCalled()
    else
      expect(has).toHaveBeenCalledWith('native-service')
  })
})
