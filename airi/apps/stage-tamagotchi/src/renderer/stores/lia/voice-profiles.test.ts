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
  engines: vi.fn(async () => []),
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
  // Legacy-era id: existing documents carry it and stay readable.
  engine: 'alltalk',
  createdAt: '2026-01-01T00:00:00.000Z',
  files: [{ role: 'referenceAudio', filename: 'reference.wav', bytes: 1024 }],
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
    expect(serialized).not.toContain('reference.wav')
    expect(serialized).not.toContain('/')
    expect(serialized.length).toBeLessThan(120)
  })

  it('loads the library - and offers NO engines while none is runnable (7.8D/E)', async () => {
    ipc.list.mockResolvedValue([PROFILE])
    const store = useLiaVoiceProfilesStore()

    await store.refresh()

    expect(store.profiles).toHaveLength(1)
    expect(store.byId.get(PROFILE.id)?.name).toBe('Minha voz')
    // Transitional product truth: the picker has nothing to offer.
    expect(store.engines).toEqual([])
    expect(store.engineFor('alltalk')).toBeUndefined()
    expect(store.engineFor('nope')).toBeUndefined()
  })

  it('a cancelled picker changes nothing', async () => {
    ipc.pick.mockResolvedValue(null)
    const store = useLiaVoiceProfilesStore()
    await store.refresh()

    const picked = await store.pickFiles('alltalk', ['referenceAudio'])

    expect(picked).toBeNull()
    expect(store.profiles).toHaveLength(0)
    expect(store.isBusy).toBe(false)
    expect(ipc.importProfile).not.toHaveBeenCalled()
  })

  it('the picker opens unrestricted while no engine offers extensions', async () => {
    ipc.pick.mockResolvedValue(['/picked/reference.wav'])
    const store = useLiaVoiceProfilesStore()
    await store.refresh()

    const picked = await store.pickFiles('alltalk', ['referenceAudio'])

    expect(picked).toEqual(['/picked/reference.wav'])
    // No engine registered → no extension filter; and the import itself still
    // defers in the core until one exists.
    expect(ipc.pick).toHaveBeenCalledWith(expect.objectContaining({ extensions: [] }))
  })

  it('records a failed import as a friendly code instead of throwing', async () => {
    ipc.importProfile.mockResolvedValue({ error: 'engineUnknown', message: 'Imports are temporarily disabled.', ok: false })
    const store = useLiaVoiceProfilesStore()

    const result = await store.importProfile({ name: 'X', sources: [{ path: '/a.wav', role: 'referenceAudio' }] })

    expect(result.ok).toBe(false)
    expect(store.lastError).toEqual({ code: 'engineUnknown', message: 'Imports are temporarily disabled.' })
    expect(store.profiles).toHaveLength(0)
  })

  it('exposes no publish/sync primitive - there is no engine to sync to', () => {
    const store = useLiaVoiceProfilesStore()

    expect('syncProfile' in store).toBe(false)
    expect('syncErrors' in store).toBe(false)
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
