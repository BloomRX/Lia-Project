import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createNativeSpeechSynthesis } from './main-speech'

const ipc = vi.hoisted(() => ({ refresh: vi.fn(), get: vi.fn(), synthesize: vi.fn() }))
vi.mock('./transport-config', () => ({
  createLiaTransportClient: () => ({ refresh: ipc.refresh, get: ipc.get, hasRemoved: () => true }),
  toTransportRecord: vi.fn(),
}))
vi.mock('./main-transport-execution', () => ({
  createMainTransportExecution: () => ({ synthesize: ipc.synthesize }),
}))

const target = { providerId: 'openai-compatible-audio-speech', modelId: 'model', voiceId: 'voice' }
const baseUrl = 'https://fixture.invalid/v1/'

beforeEach(() => {
  vi.resetAllMocks()
  ipc.get.mockReturnValue({ enabled: true, protocol: 'audio-speech', baseUrl, adapterOptions: {} })
})

describe('automatic speech adapter', () => {
  it('uses the saved endpoint with the Stage target and preserves the turn abort signal', async () => {
    const signal = new AbortController().signal
    const audio = new ArrayBuffer(4)
    ipc.synthesize.mockResolvedValue(audio)
    await expect(createNativeSpeechSynthesis()(target, 'segmento', signal)).resolves.toBe(audio)
    expect(ipc.synthesize).toHaveBeenCalledExactlyOnceWith(target.providerId, baseUrl, { model: 'model', voice: 'voice', input: 'segmento' }, signal)
  })

  it('leaves local synthesis with the existing Stage pipeline', () => {
    expect(createNativeSpeechSynthesis()({ providerId: 'kokoro-local' }, 'segmento', new AbortController().signal)).toBeUndefined()
    expect(ipc.refresh).not.toHaveBeenCalled()
  })

  it('consumes an empty native segment without falling through to the legacy client', async () => {
    await expect(createNativeSpeechSynthesis()(target, '', new AbortController().signal)).resolves.toEqual(new ArrayBuffer(0))
    expect(ipc.refresh).not.toHaveBeenCalled()
  })

  it('does not dispatch a superseded turn while waiting for the saved configuration', async () => {
    const controller = new AbortController()
    ipc.refresh.mockImplementationOnce(async () => controller.abort())
    await expect(createNativeSpeechSynthesis()(target, 'segmento', controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(ipc.synthesize).not.toHaveBeenCalled()
  })

  it('does not fall back to a renderer client when native configuration is missing', async () => {
    ipc.get.mockReturnValueOnce(undefined)
    await expect(createNativeSpeechSynthesis()(target, 'segmento', new AbortController().signal)).rejects.toMatchObject({ code: 'configuration' })
    expect(ipc.synthesize).not.toHaveBeenCalled()
  })
})
