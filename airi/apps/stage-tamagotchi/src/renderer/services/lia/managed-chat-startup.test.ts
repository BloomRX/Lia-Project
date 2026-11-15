import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { initializeManagedChat, managedChatStartupError } from './managed-chat-startup'

describe('managed chat startup wiring', () => {
  it('projects canonical chat after character hydration and before optional channel initialization', () => {
    const app = readFileSync(new URL('../../App.vue', import.meta.url), 'utf8')
    expect(app).toContain('from \'./services/lia/managed-chat-startup\'')
    const initialization = app.indexOf('await cardStore.initialize()')
    const activation = app.indexOf('await initializeManagedChat(', initialization)
    expect(activation).toBeGreaterThan(initialization)
    expect(activation).toBeLessThan(app.indexOf('await serverChannelStore.initialize('))
    expect(app.slice(activation)).toContain('windowContext, liaProviderStore, useConsciousnessStore()')
  })

  it.each([
    { liaManaged: false, leadership: 'leader-only' as const, stageRuntime: 'full' as const },
    { liaManaged: true, leadership: 'follower-only' as const, stageRuntime: 'minimal' as const },
  ])('leaves other window roles untouched: %j', async (context) => {
    const selection = { activeProvider: 'existing', activeModel: 'existing-model' }
    const provider = {
      loadedConfig: null,
      activateConfiguredProvider: async () => {
        throw new Error('must not run')
      },
    }
    expect(await initializeManagedChat(context, provider, selection)).toBe('skipped')
    expect(selection).toEqual({ activeProvider: 'existing', activeModel: 'existing-model' })
  })

  it.each(['rejected', 'throws', 'stale'] as const)('clears stale runtime selection when activation %s', async (failure) => {
    const selection = { activeProvider: 'old-target', activeModel: 'old-model' }
    const provider = {
      loadedConfig: { preferred: { providerId: 'saved-target', modelId: 'saved-model' } },
      activateConfiguredProvider: async () => {
        if (failure === 'throws')
          throw new Error('private credential and endpoint must stay private')
        return failure === 'stale'
      },
    }
    expect(await initializeManagedChat({ liaManaged: true, leadership: 'leader-only', stageRuntime: 'full' }, provider, selection)).toBe('unavailable')
    expect(selection).toEqual({ activeProvider: '', activeModel: '' })
  })

  it('provides fixed Portuguese and English failure feedback', () => {
    expect(managedChatStartupError('pt-BR')).toContain('serviço de IA')
    expect(managedChatStartupError('en-US')).toContain('AI service')
  })
})
