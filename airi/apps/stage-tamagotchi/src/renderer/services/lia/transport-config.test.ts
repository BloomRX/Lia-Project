import type { TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLiaTransportClient, toTransportRecord } from './transport-config'

const ipc = vi.hoisted(() => ({ read: vi.fn(), mutate: vi.fn() }))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: { receiveEvent: { id: string } }) => event.receiveEvent.id.includes(':get-') ? ipc.read : ipc.mutate,
}))
function state(revision: number): TransportSnapshot {
  return {
    schemaVersion: 1,
    revision,
    records: [toTransportRecord('service', 'compatible', { baseUrl: `https://fixture.invalid/v${revision}/` })],
    tombstones: [],
    migration: { version: 1, imported: [] },
  }
}
beforeEach(() => vi.resetAllMocks())

describe('main transport configuration read cache', () => {
  it('does not replace a newer snapshot with a delayed older read', async () => {
    let finishOld!: (value: unknown) => void
    ipc.read.mockImplementationOnce(() => new Promise((resolve) => {
      finishOld = resolve
    }))
    ipc.read.mockResolvedValueOnce({ ok: true, snapshot: state(2) })
    const client = createLiaTransportClient()
    const old = client.refresh()
    await client.refresh()
    finishOld({ ok: true, snapshot: state(1) })
    expect((await old).revision).toBe(2)
    expect(client.get('service')?.baseUrl).toBe('https://fixture.invalid/v2/')
  })
  it('returns copies and never lets consumers edit the authoritative cache in memory', async () => {
    ipc.read.mockResolvedValue({ ok: true, snapshot: state(1) })
    const client = createLiaTransportClient()
    const view = await client.refresh()
    view.records[0].baseUrl = 'https://changed.invalid/'
    client.get('service')!.baseUrl = 'https://changed.invalid/'
    expect(client.get('service')!.baseUrl).toBe('https://fixture.invalid/v1/')
  })
})
