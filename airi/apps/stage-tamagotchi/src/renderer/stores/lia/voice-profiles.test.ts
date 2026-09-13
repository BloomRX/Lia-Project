import type { LiaCustomVoiceProfile, LiaVoiceConfig } from '../../../shared/eventa'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The renderer side of the private voice library.
 *
 * The point of these tests is the two invariants that keep this feature from
 * becoming a second source of truth: a profile is referenced by id only, and
 * dropping a profile repairs `voice.tts` through the existing single writer
 * rather than leaving a dangling reference the chat would resolve to nothing.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async (_config: unknown) => {
    structuredClone(_config)
  }),
  list: vi.fn(async (): Promise<LiaCustomVoiceProfile[]> => []),
  engines: vi.fn(async () => [
    { extensions: ['.pth'], id: 'generic', label: 'Generic (local server)', roles: ['model'] },
  ]),
  pick: vi.fn(async (_options: unknown): Promise<string[] | null> => null),
  importProfile: vi.fn(async (_request: unknown): Promise<unknown> => ({ error: 'fileMissing', message: 'x', ok: false })),
  remove: vi.fn(async (_payload: unknown): Promise<unknown> => ({ ok: true, value: { id: 'x' } })),
}))

const card = vi.hoisted(() => ({
  speech: undefined as { provider?: string, model?: string, voice_id?: string } | undefined,
  persona: { language: { character: 'pt-BR' } },
  updateActiveCardSpeech: vi.fn(async () => true),
  persistActiveCardModuleSelections: vi.fn(async () => {}),
  get activeCard() {
    return { id: 'lia', extensions: { airi: { modules: { speech: card.speech }, persona: card.persona } } }
  },
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    const id = invoke?.receiveEvent?.id
    if (id === 'eventa:invoke:lia:voice:config:get-receive')
      return ipc.getVoiceConfig
    if (id === 'eventa:invoke:lia:voice:config:set-receive')
      return ipc.saveVoiceConfig
    if (id === 'eventa:invoke:lia:voice:profiles:list-receive')
      return ipc.list
    if (id === 'eventa:invoke:lia:voice:engines:list-receive')
      return ipc.engines
    if (id === 'eventa:invoke:lia:voice:profiles:pick-receive')
      return ipc.pick
    if (id === 'eventa:invoke:lia:voice:profiles:import-receive')
      return ipc.importProfile
    if (id === 'eventa:invoke:lia:voice:profiles:remove-receive')
      return ipc.remove
    throw new Error(`Unexpected eventa invoke: ${JSON.stringify(invoke)}`)
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'pt-BR' }, t: (key: string) => `T(${key})` }),
}))

vi.mock('@proj-airi/stage-ui/stores/modules/airi-card', () => ({
  useAiriCardStore: () => card,
}))

const PROFILE: LiaCustomVoiceProfile = {
  id: 'aaaa-bbbb',
  name: 'Minha voz',
  engine: 'generic',
  createdAt: '2026-01-01T00:00:00.000Z',
  files: [{ role: 'model', filename: 'model.pth', bytes: 1024 }],
}

const CUSTOM = 'custom-local-voice'

describe('lia voice profiles store', async () => {
  const { useLiaVoiceProfilesStore, targetForProfile, isCustomVoiceTarget, CUSTOM_VOICE_PROVIDER_ID }
    = await import('./voice-profiles')
  const { useLiaVoiceStore } = await import('./voice')

  /** What the store last sent over the `voice.tts` Set channel. */
  function lastSaved(): LiaVoiceConfig {
    const call = ipc.saveVoiceConfig.mock.calls.at(-1)
    if (!call)
      throw new Error('saveVoiceConfig was never called')
    return call[0] as LiaVoiceConfig
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.list.mockResolvedValue([])
    ipc.pick.mockResolvedValue(null)
    ipc.remove.mockResolvedValue({ ok: true, value: { id: PROFILE.id } })
    ipc.saveVoiceConfig.mockClear()
  })

  it('references a profile by id only - never by path, never by content', () => {
    const target = targetForProfile(PROFILE)

    expect(target).toEqual({ providerId: CUSTOM_VOICE_PROVIDER_ID, voiceId: PROFILE.id })
    expect(isCustomVoiceTarget(target)).toBe(true)
    expect(isCustomVoiceTarget({ providerId: 'kokoro-local', voiceId: 'af_heart' })).toBe(false)

    const serialized = JSON.stringify(target)
    expect(serialized).not.toContain('model.pth')
    expect(serialized).not.toContain('/')
    expect(serialized.length).toBeLessThan(120)
  })

  it('loads the library and the engine list', async () => {
    ipc.list.mockResolvedValue([PROFILE])
    const store = useLiaVoiceProfilesStore()

    await store.refresh()

    expect(store.profiles).toHaveLength(1)
    expect(store.byId.get(PROFILE.id)?.name).toBe('Minha voz')
    expect(store.engineFor('generic')?.extensions).toEqual(['.pth'])
    expect(store.engineFor('nope')).toBeUndefined()
  })

  it('a cancelled picker changes nothing', async () => {
    ipc.pick.mockResolvedValue(null)
    const store = useLiaVoiceProfilesStore()
    await store.refresh()

    const picked = await store.pickFiles('generic', ['model'])

    expect(picked).toBeNull()
    expect(store.profiles).toHaveLength(0)
    expect(store.isBusy).toBe(false)
    expect(ipc.importProfile).not.toHaveBeenCalled()
  })

  it('passes the engine extensions to the picker', async () => {
    ipc.pick.mockResolvedValue(['/picked/model.pth'])
    const store = useLiaVoiceProfilesStore()
    await store.refresh()

    const picked = await store.pickFiles('generic', ['model'])

    expect(picked).toEqual(['/picked/model.pth'])
    expect(ipc.pick).toHaveBeenCalledWith(expect.objectContaining({ extensions: ['.pth'] }))
  })

  it('records a failed import as a friendly code instead of throwing', async () => {
    ipc.importProfile.mockResolvedValue({ error: 'tooLarge', message: 'Too big.', ok: false })
    const store = useLiaVoiceProfilesStore()

    const result = await store.importProfile({ name: 'X', engine: 'generic', sources: [{ path: '/a.pth', role: 'model' }] })

    expect(result.ok).toBe(false)
    expect(store.lastError).toEqual({ code: 'tooLarge', message: 'Too big.' })
    expect(store.profiles).toHaveLength(0)
  })

  it('removing a profile that is not in use does not touch voice.tts', async () => {
    ipc.list.mockResolvedValue([PROFILE])
    const store = useLiaVoiceProfilesStore()
    await store.refresh()

    const result = await store.removeProfile(PROFILE.id)

    expect(result.ok).toBe(true)
    expect(store.profiles).toHaveLength(0)
    expect(ipc.saveVoiceConfig).not.toHaveBeenCalled()
  })

  it('removing the active profile repairs voice.tts through the single writer', async () => {
    // `voice.tts` points at the profile being deleted.
    ipc.getVoiceConfig.mockResolvedValue({
      tts: {
        preferred: { providerId: CUSTOM, voiceId: PROFILE.id },
        fallback: [{ providerId: 'kokoro-local', voiceId: 'af_heart' }],
      },
    })
    ipc.list.mockResolvedValue([PROFILE])
    const store = useLiaVoiceProfilesStore()
    const voiceStore = useLiaVoiceStore()
    await voiceStore.refreshConfig()
    await store.refresh()

    await store.removeProfile(PROFILE.id)

    // Exactly one write, and it promotes the reserve rather than muting Lia.
    expect(ipc.saveVoiceConfig).toHaveBeenCalledTimes(1)
    expect(lastSaved().tts).toEqual({
      preferred: { providerId: 'kokoro-local', voiceId: 'af_heart' },
      fallback: [{ providerId: 'kokoro-local', voiceId: 'af_heart' }],
    })
    expect(voiceStore.preferred?.providerId).toBe('kokoro-local')
  })

  it('removing the active profile with no reserve clears it instead of dangling', async () => {
    ipc.getVoiceConfig.mockResolvedValue({
      tts: { preferred: { providerId: CUSTOM, voiceId: PROFILE.id }, fallback: [] },
    })
    ipc.list.mockResolvedValue([PROFILE])
    const store = useLiaVoiceProfilesStore()
    const voiceStore = useLiaVoiceStore()
    await voiceStore.refreshConfig()
    await store.refresh()

    await store.removeProfile(PROFILE.id)

    const saved = lastSaved().tts
    expect(saved?.preferred).toBeUndefined()
    expect(saved?.fallback).toEqual([])
    // No target still points at the deleted profile.
    expect(JSON.stringify(saved)).not.toContain(PROFILE.id)
  })

  it('keeps voice.tts as the source of truth for what is selected', async () => {
    ipc.getVoiceConfig.mockResolvedValue({
      tts: { preferred: { providerId: CUSTOM, voiceId: PROFILE.id }, fallback: [] },
    })
    ipc.list.mockResolvedValue([PROFILE])
    const store = useLiaVoiceProfilesStore()
    const voiceStore = useLiaVoiceStore()
    await voiceStore.refreshConfig()
    await store.refresh()

    const preferred = voiceStore.preferred
    expect(isCustomVoiceTarget(preferred)).toBe(true)
    // The selection resolves to a real profile through the library.
    expect(store.byId.get(preferred?.voiceId ?? '')?.name).toBe('Minha voz')
  })
})
