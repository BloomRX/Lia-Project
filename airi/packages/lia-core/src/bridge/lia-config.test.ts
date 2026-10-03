import { describe, expect, it } from 'vitest'

import { buildLiaBridgeConfig, LIA_STAGE_ENV, stageEnvFor } from './lia-config'

/**
 * The Lia -> AIRI adapter contract, pinned (Phase 7, architecture item 5):
 * AIRI receives already-resolved Lia settings and NEVER anything else.
 */

describe('buildLiaBridgeConfig', () => {
  const base = {
    hasSecret: (providerId: string) => providerId === 'openrouter',
    productConfigFile: '/home/lia-product.json',
    vaultFile: '/home/lia-secrets.json',
  }

  it('a full snapshot resolves into the v1 contract', () => {
    const bridge = buildLiaBridgeConfig({
      ...base,
      snapshot: {
        persona: { activeCardId: 'lia-default' },
        preferences: { language: 'pt-BR' },
        provider: { chat: { fallbackEnabled: true, preferred: { modelId: 'm', providerId: 'openrouter' } } },
        voice: {
          runtime: { alltalk: { baseUrl: 'http://127.0.0.1:7851', installDir: '/rt' } },
          tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'p1' } },
        },
      },
    })

    expect(bridge.bridgeVersion).toBe(1)
    expect(bridge.identity).toEqual({ personaCardId: 'lia-default', productName: 'Lia' })
    expect(bridge.language).toBe('pt-BR')
    expect(bridge.llm.preferred).toEqual({ modelId: 'm', providerId: 'openrouter' })
    expect(bridge.llm.fallbackEnabled).toBe(true)
    expect(bridge.runtime).toEqual({ alltalkBaseUrl: 'http://127.0.0.1:7851', alltalkManaged: true })
    expect(bridge.voice.preferred).toEqual({ modelId: undefined, providerId: 'custom-local-voice', voiceId: 'p1' })
    // Presence, never values.
    expect(bridge.secrets.hasSecret('openrouter')).toBe(true)
    expect(bridge.secrets.hasSecret('other')).toBe(false)
  })

  it('an empty snapshot still yields a safe contract', () => {
    const bridge = buildLiaBridgeConfig({ ...base, snapshot: {} })
    expect(bridge.identity.productName).toBe('Lia')
    expect(bridge.llm.preferred).toBeUndefined()
    expect(bridge.runtime.alltalkManaged).toBe(false)
    expect(bridge.voice.preferred).toBeUndefined()
  })

  it('an empty-string language means inherit (undefined), never ""', () => {
    const bridge = buildLiaBridgeConfig({ ...base, snapshot: { preferences: { language: '' } } })
    expect(bridge.language).toBeUndefined()
  })
})

describe('stageEnvFor', () => {
  it('carries exactly the three launch facts', () => {
    const bridge = buildLiaBridgeConfig({ hasSecret: () => false, productConfigFile: '/p', snapshot: {}, vaultFile: '/v' })
    const env = stageEnvFor(bridge)
    expect(env).toEqual({
      [LIA_STAGE_ENV.managed]: '1',
      [LIA_STAGE_ENV.productConfigFile]: '/p',
      [LIA_STAGE_ENV.vaultFile]: '/v',
    })
  })
})
