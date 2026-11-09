import { PiniaColada } from '@pinia/colada'
import { resetChatProviderRuntimeExtensionsForTesting } from '@proj-airi/stage-ui/stores/chat/chat-provider-runtime'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { getProviderCredentialConfigPort } from '@proj-airi/stage-ui/stores/providers/credential-config-port'
import { useProviderStore } from '@proj-airi/stage-ui/stores/providers/provider'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { createNativeProviderRuntime } from '../../services/lia/native-provider-runtime'
import { createSecretAdoptHandler } from '../../services/lia/secret-adopt.fixture'
import { createLiaTransportClient } from '../../services/lia/transport-config'
import { setTransportTestVaultResolver, setTransportTestWriteFailure } from '../../services/lia/transport-config.fixture'

const ipc = vi.hoisted(() => ({
  chatConfig: vi.fn(async (): Promise<import('../../../shared/eventa').LiaProviderChatConfig> => ({})),
  encryptionAvailable: vi.fn(async () => true),
  saveChatConfig: vi.fn(async (_config: import('../../../shared/eventa').LiaProviderChatConfig) => {}),
  secretDelete: vi.fn(async () => true),
  vaultGet: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
  secretGet: vi.fn(async (_payload: { scope: string, key: string }): Promise<string | undefined> => undefined),
  secretHas: vi.fn(async () => false),
  secretSet: vi.fn(async (_payload: { scope: string, key: string, value: string }) => true),
}))

vi.mock('@proj-airi/electron-vueuse', async () => {
  const { transportTestInvoke } = await import('../../services/lia/transport-config.fixture')
  return ({
    useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
      const handlers: Record<string, unknown> = {
        'eventa:invoke:lia:provider:chat:config:get-receive': ipc.chatConfig,
        'eventa:invoke:lia:provider:chat:config:set-receive': ipc.saveChatConfig,
        'eventa:invoke:lia:secret:delete-receive': ipc.secretDelete,
        'eventa:invoke:lia:secret:encryption-available-receive': ipc.encryptionAvailable,
        'eventa:invoke:lia:secret:get-receive': ipc.secretGet,
        'eventa:invoke:lia:secret:has-receive': ipc.secretHas,
        'eventa:invoke:lia:secret:set-receive': ipc.secretSet,
        'eventa:invoke:lia:secret:adopt-receive': createSecretAdoptHandler({ secretHas: ipc.secretHas, secretGet: ipc.secretGet, secretSet: ipc.secretSet }),
      }
      const id = invoke?.receiveEvent?.id ?? ''
      const transport = transportTestInvoke(id)
      if (transport)
        return transport
      if (id in handlers)
        return handlers[id]
      throw new Error(`Unexpected eventa invoke: ${id}`)
    },
  })
})

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const { useLiaProviderStore } = await import('./provider')
const KEY = 'SYNTHETIC_SECRET_NEVER_OUTPUT'
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  const app = createApp({})
  const pinia = createPinia()
  app.use(pinia)
  app.use(PiniaColada)
  setActivePinia(pinia)
  setTransportTestVaultResolver(pinia, ipc.vaultGet)
  ipc.vaultGet.mockResolvedValue(undefined)
  fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/models')
    ? Response.json({ data: [{ id: 'custom/Local:Q4' }] })
    : Response.json({ choices: [{ message: { content: 'OK' } }] }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  expect(ipc.secretGet).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  resetChatProviderRuntimeExtensionsForTesting()
})

const localId = 'lm-studio'
const genericId = 'openai-compatible'
const address = 'https://local-service.invalid/v1/'
const model = 'custom/Local-model:Q4'
const wire = { model, messages: [{ role: 'user', content: 'synthetic migration test' }] }

function install(configs: Record<string, Record<string, unknown>>) {
  const lia = useLiaProviderStore()
  const source = useProviderStore()
  const config = useProviderConfigStore()
  for (const [id, value] of Object.entries(configs))
    config.ensureProvider(id, id, value)
  const legacy = vi.fn(source.getChatProviderInstance)
  source.getChatProviderInstance = legacy
  lia.registerRuntimeExtensions()
  return { lia, source, config, legacy }
}

describe('additional compatible transport migration', () => {
  it('keeps explicit keyless local providers configurable without a saved credential', () => {
    install({ [localId]: { baseUrl: address } })
    const port = getProviderCredentialConfigPort(localId)
    expect(port).toBeDefined()
    expect(port!.requiresCredential?.(localId)).toBe(false)
  })

  it('keeps a newly created local alias keyless before its first transport record', () => {
    const { config } = install({})
    config.ensureProvider('local-alias', localId, { baseUrl: address })
    const port = getProviderCredentialConfigPort('local-alias')
    expect(port).toBeDefined()
    expect(port!.requiresCredential?.('local-alias')).toBe(false)
    expect(ipc.secretSet).not.toHaveBeenCalled()
  })
  it('saves a native chat editor key through Main without provider configuration or SDK reads', async () => {
    const { config } = install({ [genericId]: { baseUrl: address } })
    const port = getProviderCredentialConfigPort(genericId)
    expect(port).toBeDefined()
    expect(await port!.save(genericId, KEY)).toBe(true)
    expect(ipc.secretSet).toHaveBeenCalledWith({ scope: genericId, key: 'apiKey', value: KEY })
    expect(config.getProviderConfig(genericId)).not.toHaveProperty('apiKey')
    const repository = await createLiaTransportClient().refresh()
    expect(repository.records.find(record => record.providerId === genericId)?.protocol).toBe('chat-completions')
    expect(JSON.stringify(repository)).not.toContain(KEY)
  })

  it('keeps an alias of a native chat definition in the same Main execution contract', async () => {
    const { lia, config } = install({})
    const alias = 'native-custom-instance'
    config.ensureProvider(alias, genericId, { baseUrl: address })
    const port = getProviderCredentialConfigPort(alias)
    expect(port).toBeDefined()
    expect(await port!.save(alias, KEY)).toBe(true)
    const repository = await createLiaTransportClient().refresh()
    expect(repository.records.find(record => record.providerId === alias)).toMatchObject({ definitionId: genericId, protocol: 'chat-completions' })
    expect(config.getProviderConfig(alias)).not.toHaveProperty('apiKey')
    await expect(lia.resolveApiKey(alias)).resolves.toBeUndefined()
  })

  it('owns the persisted local-compatible ID only with an explicit endpoint', async () => {
    const native = createNativeProviderRuntime({ readConfig: () => undefined, resolveCredential: async () => undefined })
    expect(native.owns(localId)).toBe(false)
    expect(native.owns(localId, { baseUrl: address })).toBe(true)
    expect(native.owns(localId, { baseUrl: '' })).toBe(false)
    expect(native.owns(localId, { baseUrl: '  ' })).toBe(false)
    expect(await native.getChatProvider(localId)).toBeUndefined()
    // The original migrated generic target never silently delegates an invalid draft.
    expect(native.owns(genericId)).toBe(true)
    await expect(native.getChatProvider(genericId)).rejects.toMatchObject({ code: 'configuration' })
    native.dispose()
  })

  it('executes a custom model through the native factory with no legacy instance', async () => {
    const { source, legacy, config } = install({ [localId]: { baseUrl: address } })
    const provider = await source.getChatProviderInstance(localId, { reasoning: 'disabled' })
    expect(provider).toBeDefined()
    expect(provider!.chat(model)).not.toHaveProperty('apiKey')
    const response = await provider!.chat(model).fetch!(new URL('https://ignored.invalid'), { method: 'POST', body: JSON.stringify(wire) })
    expect(await response.json()).toEqual({ choices: [{ message: { content: 'OK' } }] })
    expect(legacy).not.toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${address}chat/completions`)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(wire)
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('authorization')).toBe(false)
    expect(JSON.stringify(config.$state)).not.toContain(KEY)
  })

  /**
   * Corte B changed this from "delegates to the legacy executor" to "fails
   * closed", and the change is the point of the cut.
   *
   * The delegation was safe only because `lm-studio` is keyless. For any
   * curated provider that does need a key, returning `undefined` from the
   * factory hands the send to `providerStore.getChatProviderInstance`, which
   * resolves the vault credential *inside this renderer* and builds an SDK
   * client around it. Keeping the old assertion would have kept an audit trail
   * that said that fallback is acceptable. It is not: an endpoint-less record is
   * a configuration error, and it must be visible as one.
   */
  it('fails a curated provider closed instead of delegating to the legacy executor', async () => {
    const { source, legacy } = install({ [localId]: {} })
    const prior = await legacy(localId, { reasoning: 'disabled' })
    legacy.mockClear()
    ipc.secretGet.mockClear()

    await expect(source.getChatProviderInstance(localId, { reasoning: 'disabled' }))
      .rejects
      .toMatchObject({ code: 'configuration' })

    // Nothing read the vault, and nothing reached the legacy executor.
    expect(ipc.secretGet).not.toHaveBeenCalled()
    expect(legacy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prior).toBeDefined()
  })

  /**
   * Corte B: a provider with no persisted endpoint is configured BEFORE it is
   * exercised — key into the vault, record onto disk — instead of travelling to
   * the request as a draft credential. The wire result is the same; the path the
   * secret takes is not.
   */
  it('configures an unsaved provider first, then discovers and probes it without a payload credential', async () => {
    const { lia, source } = install({})
    const find = vi.spyOn(source, 'findProviderDefinition')
    // The fake main reads its OWN vault, so the credential channel has to feed
    // it — the same way the real `secrets:set` handler writes the value that
    // `getSecret` later returns.
    ipc.secretSet.mockImplementationOnce(async ({ scope, value }: { scope: string, value: string }): Promise<boolean> => {
      ipc.vaultGet.mockResolvedValue(value)
      return scope === localId
    })
    const args = { providerId: localId, baseUrl: address, modelId: model, apiKey: KEY }
    expect(await lia.discoverModels(args)).toEqual({ status: 'ready', models: [{ id: 'custom/Local:Q4', label: 'custom/Local:Q4' }] })
    expect(await lia.testConnection(args)).toEqual({ ok: true, scope: 'text', message: '' })
    expect(find).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The key reached main through the credential channel, not the execution one.
    expect(ipc.secretSet).toHaveBeenCalledWith({ scope: localId, key: 'apiKey', value: KEY })
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe(model)
    expect(ipc.saveChatConfig).not.toHaveBeenCalled()
    // And the persisted record carries the endpoint, never the secret.
    const records = (await createLiaTransportClient().refresh()).records
    expect(records.find(entry => entry.providerId === localId)?.baseUrl).toBe(address)
    expect(JSON.stringify(records)).not.toContain(KEY)
  })

  it('stops before any request when the credential cannot be stored', async () => {
    const { lia } = install({})
    ipc.secretSet.mockResolvedValueOnce(false)
    const result = await lia.testConnection({ providerId: localId, baseUrl: address, modelId: model, apiKey: KEY })
    expect(result).toMatchObject({ ok: false, failure: 'configuration' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops before any request when the provider record cannot be persisted', async () => {
    const { lia } = install({})
    // Main refuses every write: the endpoint can never be recorded, so execution
    // must not proceed against an address main cannot see.
    setTransportTestWriteFailure(getActivePinia()!, 'storage')
    try {
      const result = await lia.testConnection({ providerId: localId, baseUrl: address, modelId: model, apiKey: KEY })
      expect(result).toMatchObject({ ok: false, failure: 'configuration' })
      expect(fetchMock).not.toHaveBeenCalled()
    }
    finally {
      setTransportTestWriteFailure(getActivePinia()!, undefined)
    }
  })

  it('does not reuse another provider credential when switching to a keyless compatible target', async () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { source, legacy, config } = install({ [genericId]: { baseUrl: 'https://primary-service.invalid/v1/' }, [localId]: { baseUrl: address } })
    ipc.vaultGet.mockImplementation(async ({ scope }) => scope === genericId ? KEY : undefined)
    for (const id of [genericId, localId]) {
      const provider = await source.getChatProviderInstance(id, { reasoning: 'disabled' })
      const response = await provider!.chat(model).fetch!(new URL('https://ignored.invalid'), { method: 'POST', body: JSON.stringify(wire) })
      await response.text()
    }
    expect(legacy).not.toHaveBeenCalled()
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has('authorization')).toBe(false)
    expect(ipc.vaultGet.mock.calls.map(([payload]) => payload.scope)).toEqual([genericId, localId])
    expect(JSON.stringify(config.$state)).not.toContain(KEY)
    expect(JSON.stringify(logs.mock.calls)).not.toContain(KEY)
  })

  it('rejects an explicitly invalid endpoint without falling back to the legacy factory', async () => {
    const { source, legacy } = install({ [localId]: { baseUrl: 'invalid-address' } })
    await expect(source.getChatProviderInstance(localId, { reasoning: 'disabled' })).rejects.toMatchObject({ code: 'configuration' })
    expect(legacy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(ipc.vaultGet).not.toHaveBeenCalled()
  })
})
