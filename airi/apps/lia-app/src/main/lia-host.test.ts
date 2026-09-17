import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

/**
 * Tests G through L of the Phase 7 contract, against the launcher host
 * wired to the real Lia Core over fixture data on disk.
 */

describe('g. Existing Lia product config is read', () => {
  it('the snapshot surfaces persona, provider, voice, runtime and language', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const snapshot = await host.productSnapshot()

    expect(snapshot?.persona?.activeCardId).toBe('lia-default')
    expect(snapshot?.provider?.chat?.preferred?.providerId).toBe('openrouter')
    expect(snapshot?.voice?.tts?.preferred?.providerId).toBe('cloud-voice-provider')
    expect(snapshot?.preferences?.language).toBe('pt-BR')
    expect((await host.homeStatus()).config.status).toBe('ok')
  })

  it('reads the same document AIRI wrote - no second copy appears', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const status = await host.homeStatus()
    expect(status.config.filePath).toBe(join(home.userData, 'lia-product.json'))
    expect(status.paths.source).toBe('existing-data-candidate')
  })
})

describe('h. Existing voice profile list is read', () => {
  it('the canonical library registry lists its profiles verbatim', async () => {
    const home = await makeLiaHome({ voiceCount: 3 })
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const profiles = await host.listVoices()

    expect(profiles).toHaveLength(3)
    expect(profiles.map(p => p.id)).toEqual(['profile-1', 'profile-2', 'profile-3'])
    expect(profiles[1].files[0].filename).toBe('model.wav')
  })
})

describe('i. Existing AllTalk installation is detected', () => {
  it('the runtime fixture inside the configured installDir passes isInstalled()', async () => {
    const home = await makeLiaHome({ customVoice: true })
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const runtime = await host.runtime()
    expect(await runtime.isInstalled()).toBe(true)

    const status = await host.homeStatus()
    expect(status.alltalk.installed).toBe(true)
    expect(status.alltalk.installDir).toBe(home.installDir)
  })
})

describe('j. The launcher does not duplicate canonical data', () => {
  it('config, vault and voices all resolve INSIDE the one user-data root', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const { paths } = host
    expect(paths.userDataDir.startsWith(home.appData)).toBe(true)
    for (const file of [paths.productConfigFile, paths.vaultFile, paths.voicesRoot]) {
      expect(file.startsWith(`${paths.userDataDir}/`)).toBe(true)
    }
  })

  it('an explicit override wins and is shared with the stage child', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({
      cipher: identityCipher,
      env: { ...fixtureEnv(home), LIA_USER_DATA: home.userData },
      workspaceRoot: '/missing',
    })

    const env = await host.stageEnv()
    expect(host.paths.source).toBe('lia-user-data-env')
    expect(env.APP_USER_DATA_PATH).toBe(home.userData)
  })
})

describe('k. Secrets are not logged and never cross to surfaces', () => {
  it('a stored secret value appears in no host event and no bridge payload', async () => {
    const home = await makeLiaHome()
    const SECRET = 'sk-test-very-secret-value'
    const events: Array<{ detail?: string, event: string }> = []
    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      onEvent: (event, detail) => events.push({ detail, event }),
      workspaceRoot: '/missing',
    })

    await host.vault.setSecret('openrouter', 'apiKey', SECRET)

    await host.homeStatus()
    const bridge = await host.bridgeConfig()
    const env = await host.stageEnv()

    expect(host.vault.hasSecret('openrouter', 'apiKey')).toBe(true)
    expect(events.every(e => !`${e.event} ${e.detail ?? ''}`.includes(SECRET))).toBe(true)
    expect(JSON.stringify(bridge)).not.toContain(SECRET)
    expect(JSON.stringify(env)).not.toContain(SECRET)
    // The bridge exposes PRESENCE only.
    expect(Object.keys(bridge.secrets)).toEqual(['hasSecret', 'vaultFile'])
    expect(bridge.secrets.hasSecret('openrouter')).toBe(true)
  })
})

describe('l. The AIRI adapter receives the expected contract', () => {
  it('bridge shape + stage env carry the launch facts (never secret values)', async () => {
    const home = await makeLiaHome({ customVoice: true })
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })
    await host.vault.setSecret('openrouter', 'apiKey', 'sk-hidden')

    const bridge = await host.bridgeConfig()
    expect(bridge.bridgeVersion).toBe(1)
    expect(bridge.identity.productName).toBe('Lia')
    expect(bridge.identity.personaCardId).toBe('lia-default')
    expect(bridge.language).toBe('pt-BR')
    expect(bridge.llm.preferred).toEqual({ modelId: 'test-model', providerId: 'openrouter' })
    expect(bridge.voice.preferred).toMatchObject({ providerId: 'custom-local-voice', voiceId: 'profile-1' })
    expect(bridge.runtime.alltalkManaged).toBe(true)
    expect(bridge.productConfigFile).toBe(join(home.userData, 'lia-product.json'))

    const env = await host.stageEnv()
    expect(env.LIA_MANAGED).toBe('1')
    expect(env.LIA_PRODUCT_CONFIG_FILE).toBe(join(home.userData, 'lia-product.json'))
    expect(env.LIA_VAULT_FILE).toBe(join(home.userData, 'lia-secrets.json'))
    expect(env.APP_USER_DATA_PATH).toBe(home.userData)
  })
})

describe('conversar() - the pipeline the CTA gates on', () => {
  it('a ready configuration launches the stage with the bridge env; an unfinished one does not', async () => {
    const home = await makeLiaHome()
    const startedWith: Array<Record<string, string | undefined> | undefined> = []
    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      stageManagerFactory: () => {
        const manager = {
          isAvailable: () => true,
          start: async (options?: { env?: Record<string, string | undefined> }) => {
            startedWith.push(options?.env)
            return { logTail: [], phase: 'running' as const }
          },
          state: () => ({ logTail: [], phase: 'stopped' as const }),
          stop: async () => {},
        }
        return manager as never
      },
      workspaceRoot: '/missing',
    })

    // Not ready: no secret for the preferred provider -> a named error, no spawn.
    await expect(host.conversar()).rejects.toThrow(/not fully configured/)
    expect(startedWith).toHaveLength(0)

    await host.vault.setSecret('openrouter', 'apiKey', 'sk-hidden')

    // Ready now: ready-made voice means NO runtime start (item 12), one stage.
    const state = await host.conversar()
    expect(state.phase).toBe('running')
    expect(startedWith).toHaveLength(1)
    expect(startedWith[0]).toMatchObject({ LIA_MANAGED: '1', APP_USER_DATA_PATH: home.userData })
  })
})
