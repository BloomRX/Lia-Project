import type { LeadershipMode } from 'pinia-plugin-synced'

import { createPinia, disposePinia } from 'pinia'
import { createSyncedPiniaPlugin } from 'pinia-plugin-synced'
import { expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { triggerSignIn } from '../libs/auth'
import { refreshAccessToken } from '../libs/auth-oidc'
import { useAuthStore } from './auth'

vi.mock('../libs/auth', () => ({ getAuthToken: () => null, triggerSignIn: vi.fn(async () => {}) }))
vi.mock('../libs/auth-client', () => ({ authClient: {}, requestAuthSession: vi.fn(async () => null) }))
vi.mock('../libs/auth-oidc', () => ({ refreshAccessToken: vi.fn() }))

it('processes a follower recovery in the leader and ignores a stale follower generation', async () => {
  const namespace = `auth-recovery:${crypto.randomUUID()}`
  function connect(leadership: LeadershipMode) {
    const runtime = createSyncedPiniaPlugin({ namespace, leadership })
    const pinia = createPinia().use(runtime.plugin)
    createApp({}).use(pinia)
    const store = useAuthStore(pinia)
    return { pinia, runtime, store }
  }
  const leader = connect('leader-only')
  const follower = connect('follower-only')
  try {
    await vi.waitFor(() => expect(follower.runtime.getLeaderId()).toBe(leader.runtime.participantId))
    leader.store.token = 'synthetic-access'
    leader.store.refreshToken = 'synthetic-refresh'
    leader.store.oidcClientId = 'synthetic-client'
    await vi.waitFor(() => expect(follower.store.token).toBe('synthetic-access'))
    const generation = follower.store.getAuthGeneration()
    const revision = follower.store.bearerRevision
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error('synthetic failure'))

    expect(await follower.store.refreshAfterUnauthorized(generation, revision)).toBeNull()
    expect(refreshAccessToken).toHaveBeenCalledOnce()
    expect(triggerSignIn).toHaveBeenCalledOnce()
    expect(leader.store.token).toBeNull()

    leader.store.token = 'replacement'
    await follower.store.requestReLoginAfterAuthFailure(generation, revision)
    expect(leader.store.token).toBe('replacement')
    expect(triggerSignIn).toHaveBeenCalledOnce()
  }
  finally {
    for (const { runtime, pinia } of [follower, leader]) {
      runtime.dispose()
      disposePinia(pinia)
    }
  }
})
