import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { electronLiaVoiceConfigSet, i18nGetLocale, i18nSetLocale } from '../../../shared/eventa'
import { createLiaProductConfig } from '../../configs/lia'
import { createI18nService } from '../../services/airi/i18n'
import { registerLiaVoiceConfigBridge } from '../../services/lia/voice-config-service'

const mocks = vi.hoisted(() => ({
  handlers: new Map<unknown, (value?: unknown) => unknown>(),
  product: undefined as ReturnType<typeof createLiaProductConfig> | undefined,
  path: '',
  get: vi.fn(() => ({ language: 'en' })),
  update: vi.fn(),
}))
vi.mock('@moeru/eventa', async original => ({
  ...await original<typeof import('@moeru/eventa')>(),
  defineInvokeHandler: (_context: unknown, event: unknown, handler: (value?: unknown) => unknown) => mocks.handlers.set(event, handler),
}))
vi.mock('electron', () => ({ app: { getPath: () => mocks.path } }))
vi.mock('injeca', () => ({ injeca: { resolve: async () => ({ config: { get: mocks.get, update: mocks.update }, liaProductConfig: mocks.product }) } }))

let dir: string
const locale = vi.fn()
async function start() {
  await createI18nService({
    context: {} as Parameters<typeof createI18nService>[0]['context'],
    window: {} as Parameters<typeof createI18nService>[0]['window'],
    i18n: { t: vi.fn(), locale },
  })
}
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  dir = await mkdtemp(join(tmpdir(), 'lia-language-ipc-'))
  mocks.path = dir
  mocks.product = createLiaProductConfig()
  vi.stubEnv('LIA_MANAGED', '1')
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

describe('language IPC ownership', () => {
  it('managed Stage uses canonical default despite legacy English and persists changes for restart', async () => {
    await start()
    expect(locale).toHaveBeenLastCalledWith('pt-BR')
    expect(await mocks.handlers.get(i18nGetLocale)!()).toBe('pt-BR')
    await mocks.handlers.get(i18nSetLocale)!('ja')
    expect(JSON.parse(await readFile(join(dir, 'lia-product.json'), 'utf8'))).toMatchObject({ preferences: { language: 'ja' } })
    expect(mocks.update).not.toHaveBeenCalled()
    await start()
    expect(locale).toHaveBeenLastCalledWith('ja')
  })

  it('does not publish successful language change after a failed canonical write', async () => {
    await start()
    vi.spyOn(mocks.product!, 'updateAndSave').mockRejectedValueOnce(new Error('write failed'))
    await expect(mocks.handlers.get(i18nSetLocale)!('en')).rejects.toThrow('write failed')
    expect(locale).toHaveBeenCalledTimes(1)
    expect(locale).toHaveBeenLastCalledWith('pt-BR')
  })

  it('canonical language stays in the shared Main getter and survives a real sibling voice write', async () => {
    await start()
    await mocks.handlers.get(i18nSetLocale)!('ja')
    expect(mocks.product!.get()?.preferences.language).toBe('ja')
    registerLiaVoiceConfigBridge({
      context: {} as Parameters<typeof registerLiaVoiceConfigBridge>[0]['context'],
      liaProductConfig: mocks.product!,
    })
    await mocks.handlers.get(electronLiaVoiceConfigSet)!({ tts: { preferred: { providerId: 'voice-fixture' } } })
    await mocks.product!.flush()
    expect(JSON.parse(await readFile(join(dir, 'lia-product.json'), 'utf8'))).toMatchObject({
      preferences: { language: 'ja' },
      voice: { tts: { preferred: { providerId: 'voice-fixture' } } },
    })
    mocks.product = createLiaProductConfig()
    expect(mocks.product.get()?.preferences.language).toBe('ja')
  })

  it('standalone keeps legacy English and saves only global config', async () => {
    vi.stubEnv('LIA_MANAGED', '')
    await writeFile(join(dir, 'lia-product.json'), JSON.stringify({ preferences: { language: 'pt-BR' } }))
    await start()
    expect(locale).toHaveBeenLastCalledWith('en')
    expect(mocks.handlers.get(i18nGetLocale)!()).toBe('en')
    await mocks.handlers.get(i18nSetLocale)!('fr')
    expect(mocks.update).toHaveBeenCalledWith({ language: 'fr' })
    expect(JSON.parse(await readFile(join(dir, 'lia-product.json'), 'utf8'))).toMatchObject({ preferences: { language: 'pt-BR' } })
  })
})
