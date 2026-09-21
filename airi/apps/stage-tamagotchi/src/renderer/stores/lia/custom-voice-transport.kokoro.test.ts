/*
 * Phase 7.9C transport contract: the renderer's only bridge into the voice
 * engine forwards the language resolution faithfully.
 *
 * The engine-side language pass-through was added in 7.9C because the
 * custom-voice provider cannot carry it through its browser `fetch` shape:
 * the provider call site resolves the locale and speaks it exclusively
 * through the Lia speech pipeline, which feeds the transport a
 * request-language. What this test pins is that the transport never drops
 * or rewrites it (pt-BR profiles stay honest engines-side).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const synthesizeMock = vi.fn(async (_request: unknown) => ({ audio: new Uint8Array([7, 8]).buffer, engine: 'kokoro' }))

const ipc = {
  listProfiles: vi.fn(async () => []),
  synthesize: synthesizeMock,
}

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    if (invoke.receiveEvent?.id === 'eventa:invoke:lia:voice:synthesize-receive')
      return (request: unknown) => ipc.synthesize(request)
    if (invoke.receiveEvent?.id === 'eventa:invoke:lia:voice:profiles:list-receive')
      return () => ipc.listProfiles()
    throw new Error(`Unexpected eventa invoke: ${JSON.stringify(invoke)}`)
  },
}))

import { installCustomVoiceTransport } from '../../stores/lia/custom-voice-transport'

describe('custom voice transport (Phase 7.9C)', () => {
  beforeEach(() => {
    ipc.synthesize.mockClear()
  })

  it('forwards the engine-usable language tag verbatim (pass-through, never invented)', async () => {
    const transport = installCustomVoiceTransport()
    await transport.synthesize({ profileId: 'engine:kokoro', text: 'Oi', language: 'pt-BR' })
    expect(ipc.synthesize).toHaveBeenCalledTimes(1)
    expect(ipc.synthesize.mock.calls[0]![0]).toEqual({
      profileId: 'engine:kokoro',
      text: 'Oi',
      language: 'pt-BR',
    })
  })

  it('absent language becomes undefined explicitly (engine default applies, no guessing)', async () => {
    const transport = installCustomVoiceTransport()
    await transport.synthesize({ profileId: 'engine:kokoro', text: 'Oi' })
    expect(ipc.synthesize).toHaveBeenCalledTimes(1)
    expect(ipc.synthesize.mock.calls[0]![0]).toEqual({
      profileId: 'engine:kokoro',
      text: 'Oi',
      language: undefined,
    })
  })

  it('returns the engine-produced audio bytes untouched (engine fact stays metadata)', async () => {
    const transport = installCustomVoiceTransport()
    const audio = await transport.synthesize({ profileId: 'engine:kokoro', text: 'Oi', language: 'pt-BR' })
    expect(new Uint8Array(audio)).toEqual(new Uint8Array([7, 8]))
  })
})
