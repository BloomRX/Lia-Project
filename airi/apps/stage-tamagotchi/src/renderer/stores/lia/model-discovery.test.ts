import type { LiaModelDiscoveryResult } from './provider-runtime'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useLiaModelDiscovery } from './model-discovery'

const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  scopes.forEach(scope => scope.stop())
  scopes.length = 0
  vi.useRealTimers()
})

function setup(discover: (args: { providerId: string, baseUrl?: string, apiKey?: string }) => Promise<LiaModelDiscoveryResult>) {
  const draft = ref({ providerId: 'a', baseUrl: 'https://service.invalid/v1/', apiKey: 'synthetic' })
  const scope = effectScope()
  scopes.push(scope)
  const result = scope.run(() => useLiaModelDiscovery(draft, discover))!
  return { draft, scope, ...result }
}

describe('draft discovery lifecycle', () => {
  it('debounces credentials and address edits into one effective request', async () => {
    const discover = vi.fn(async () => ({ status: 'ready' as const, models: [] }))
    const ui = setup(discover)
    ui.draft.value.apiKey = 'new-synthetic'
    await nextTick()
    ui.draft.value.baseUrl = 'https://changed.invalid/v1/'
    await nextTick()
    expect(discover).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(discover).toHaveBeenCalledExactlyOnceWith(ui.draft.value)
    expect(ui.state.value).toBe('ready')
  })

  it('ignores an old response after changing the selected provider', async () => {
    let resolve!: (value: LiaModelDiscoveryResult) => void
    const discover = vi.fn().mockImplementationOnce(() => new Promise<LiaModelDiscoveryResult>((done) => {
      resolve = done
    })).mockResolvedValueOnce({ status: 'ready', models: [{ id: 'b/model', label: 'B' }] })
    const ui = setup(discover)
    await vi.advanceTimersByTimeAsync(300)
    ui.draft.value.providerId = 'b'
    await nextTick()
    expect(ui.models.value).toEqual([])
    await vi.advanceTimersByTimeAsync(300)
    resolve({ status: 'ready', models: [{ id: 'a/model', label: 'A' }] })
    await Promise.resolve()
    expect(ui.models.value.map(model => model.id)).toEqual(['b/model'])
  })

  it('cancels scheduled work on unmount and ignores a pending failure after clearing selection', async () => {
    const discover = vi.fn(async () => {
      throw new Error('synthetic-private-error')
    })
    const ui = setup(discover)
    ui.scope.stop()
    await vi.advanceTimersByTimeAsync(300)
    expect(discover).not.toHaveBeenCalled()
    const other = setup(discover)
    other.draft.value.providerId = ''
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(other.state.value).toBe('idle')
    expect(discover).not.toHaveBeenCalled()
  })
})
