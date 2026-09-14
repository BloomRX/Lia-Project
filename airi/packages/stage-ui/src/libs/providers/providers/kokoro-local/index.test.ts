import { beforeEach, describe, expect, it, vi } from 'vitest'

import { providerKokoroLocal } from '.'
import { getDefaultKokoroModel, KOKORO_MODELS } from '../../../../workers/kokoro/constants'

/**
 * Kokoro voice discovery.
 *
 * Regression guard for the bug behind 4E-2 QA item B: the Voz tab asked for
 * Kokoro's voices and got an empty list, so the UI claimed the provider "does
 * not offer a voice list". Kokoro needs no credential, so it is normally never
 * saved in the provider settings - which means `listProviderVoices` hands
 * `listVoices` an empty config, `assertModelSupported(undefined)` threw, and the
 * catch turned discovery into `[]`.
 *
 * Only the inference adapter is mocked: the worker and `kokoro-js` cannot run
 * here. The provider definition, its default-model resolution and the voice
 * mapping under test are the real ones.
 */

const mocks = vi.hoisted(() => ({
  loadModel: vi.fn(async () => ({})),
  getVoices: vi.fn(() => ({
    af_heart: { language: 'en-US', name: 'Heart', gender: 'Female' },
    pf_dora: { language: 'en-GB', name: 'Dora', gender: 'Female' },
  })),
}))

vi.mock('../../../inference/adapters/kokoro', () => ({
  getKokoroAdapter: async () => ({
    // Not ready, so `listVoices` has to resolve and load a model first - the
    // path that used to throw on an unconfigured provider.
    state: 'loading',
    loadModel: mocks.loadModel,
    getVoices: mocks.getVoices,
  }),
}))

/** No WebGPU in Node, so the default must be the WASM build. */
const DEFAULT_MODEL = getDefaultKokoroModel(false, false)

async function listVoices(config: Record<string, unknown>) {
  const list = providerKokoroLocal.extraMethods?.listVoices
  if (!list)
    throw new Error('kokoro-local must expose listVoices')

  // The declared parameter type says `model` is required, but the real caller
  // (`listProviderVoices`) passes `getProviderConfig(id) ?? {}`, which for a
  // provider that was never saved really is `{}`. That gap between the declared
  // and the actual argument is precisely why the type system never caught the
  // bug this file guards.
  return await list(config as never, {} as never, undefined)
}

describe('kokoro local voice discovery', () => {
  beforeEach(() => {
    mocks.loadModel.mockClear()
    mocks.getVoices.mockClear()
  })

  it('resolves a default model that really exists in the catalogue', () => {
    // The fallback is only safe while it names a real, non-WebGPU model.
    expect(KOKORO_MODELS.map(model => model.id)).toContain(DEFAULT_MODEL)
    expect(KOKORO_MODELS.find(model => model.id === DEFAULT_MODEL)?.platform).toBe('wasm')
  })

  it('returns the real catalogue when the provider was never configured', async () => {
    // Exactly what `listProviderVoices` passes for a provider with no saved
    // config: `getProviderConfig(id) ?? {}`.
    const voices = await listVoices({})

    expect(voices).not.toEqual([])
    expect(voices.map(voice => voice.id)).toEqual(['af_heart', 'pf_dora'])
  })

  it('loads the schema default instead of failing on a missing model', async () => {
    await listVoices({})

    const expected = KOKORO_MODELS.find(model => model.id === DEFAULT_MODEL)
    expect(mocks.loadModel).toHaveBeenCalledWith(expected?.quantization, expected?.platform)
  })

  it('maps catalogue entries to friendly names, keeping the id technical', async () => {
    const voices = await listVoices({})

    expect(voices[0]).toMatchObject({
      id: 'af_heart',
      name: 'Heart (Female, English)',
      provider: 'kokoro-local',
      gender: 'female',
    })
    // The label a user reads must not be the technical voice key.
    expect(voices[0].name).not.toBe(voices[0].id)
  })

  it('still honours an explicitly configured model', async () => {
    await listVoices({ model: 'q8' })

    const expected = KOKORO_MODELS.find(model => model.id === 'q8')
    expect(mocks.loadModel).toHaveBeenCalledWith(expected?.quantization, expected?.platform)
  })
})
