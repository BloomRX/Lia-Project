import { chmod, readFile } from 'node:fs/promises'
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

describe('i. Voice-install detection is honest and engine-neutral (Phase 7.8E)', () => {
  it('with no engine hosted, the default answer is installed = false - directory existence is never proof', async () => {
    const home = await makeLiaHome({ customVoice: true })
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const status = await host.homeStatus()
    expect(status.voice.installed).toBe(false)
    expect(status.voice.installDir).toBeUndefined()
  })

  it('the engine inspection seam - today injected, tomorrow the real adapter - is the only route to installed', async () => {
    const home = await makeLiaHome({ customVoice: true })
    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      inspectInstallImpl: async () => true,
      workspaceRoot: '/missing',
    })

    const status = await host.homeStatus()
    expect(status.voice.installed).toBe(true)
    // The seam proves the install AT the configured runtime home.
    expect(status.voice.installDir).toBe(home.installDir)
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

/**
 * Phase 7.1 supervisor contract, host level: closing Lia stops WHAT IT
 * OWNS (stage, voice runtime), leaves adopted/external processes alone,
 * single-flights double quits, and refuses new conversations while closing.
 */
describe('supervisor shutdown through the host: the stage is the only owned child (A/F, engine-neutral)', () => {
  /**
   * Transitional ownership (Phase 7.8C/E): the launcher hosts NO voice
   * worker anymore - the F5 manager and its whole ownership shape (owned
   * this session vs recovered pre-existing vs external) were deleted, not
   * parked. The coordinator therefore has exactly ONE registrant, the stage.
   * The axioms that survive unchanged: an owned child is stopped exactly
   * once, teardown is single-flight, and nothing unregistered is touched.
   */
  async function hostWithFakes(options: {
    ownedStage?: boolean
  } = {}) {
    const calls: string[] = []
    const home = await makeLiaHome()
    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      stageManagerFactory: () => {
        const manager = {
          holdsOwnedStage: () => options.ownedStage ?? false,
          isAvailable: () => true,
          start: async () => ({ logTail: [], phase: 'running' as const }),
          state: () => ({ logTail: [], phase: options.ownedStage ? 'running' as const : 'stopped' as const }),
          stop: async () => calls.push('stage-stop'),
        }
        return manager as never
      },
      workspaceRoot: '/missing',
    })
    return { calls, host }
  }

  it('a. quitting with a spawned stage stops the stage and reports it', async () => {
    const { calls, host } = await hostWithFakes({ ownedStage: true })
    const report = await host.quit()
    expect(calls).toEqual(['stage-stop'])
    expect(report.steps.find(s => s.name === 'stage')?.outcome).toBe('stopped')
  })

  it('the voice-runtime step is gone entirely - no worker exists to own, recover, or leak', async () => {
    // The round-7 ownership cases for a voice runtime (spawned, recovered,
    // external/unknown) are all answered by the same deletion: there is NO
    // voice-runtime registrant at all, so that entire leaked-process failure
    // class cannot reappear until a modular engine registers its own entry.
    const { calls, host } = await hostWithFakes({ ownedStage: false })
    const report = await host.quit()
    expect(calls).toEqual([])
    expect(report.steps.map(s => s.name)).toEqual(['stage'])
    expect(report.steps[0].outcome).toBe('no-owned-process')
  })

  it('f. two quits share one teardown (single-flight)', async () => {
    const { calls, host } = await hostWithFakes({ ownedStage: true })
    const [first, second] = await Promise.all([host.quit(), host.quit()])
    // The owned stage is stopped EXACTLY once - no doubled kill.
    expect(calls).toEqual(['stage-stop'])
    expect(first).toBe(second)
  })

  it('once closing, conversar() is refused - no new starts during shutdown', async () => {
    const { host } = await hostWithFakes()
    await host.vault.setSecret('openrouter', 'apiKey', 'sk-x')
    await host.quit()
    await expect(host.conversar()).rejects.toThrow(/closing/)
    expect(host.coordinator.isShuttingDown()).toBe(true)
  })
})

/**
 * Phase 7.1 items G-J/L, host level: the Config screen's save path -
 * every editable subtree persists through the core writer, secrets ride
 * the vault channel only, and the runtime cache follows the new document.
 */
describe('updateConfig - the editable product document', () => {
  it('g-J. provider, persona, voice and language edits persist to the SAME file', async () => {
    const home = await makeLiaHome({
      productConfig: {
        customField: 'keep-me',
        persona: { activeCardId: 'lia-default' },
        preferences: { language: 'pt-BR' },
        provider: { chat: { preferred: { modelId: 'm1', providerId: 'openrouter' } } },
        schemaVersion: 1,
        voice: { tts: { preferred: { providerId: 'cloud-voice-provider', voiceId: 'nova' } } },
      },
    })
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const saved = await host.updateConfig({
      update: {
        persona: { activeCardId: 'lia-energetica' },
        preferences: { language: 'en-US' },
        // NOTE: the schema's provider target is providerId+modelId only -
        // a custom endpoint has no field to live in (documented, item 5).
        provider: { chat: { preferred: { modelId: 'm2', providerId: 'openrouter' } } },
        voice: { tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'profile-1' } } },
      },
    })
    expect(saved.status).toBe('ok')

    const reread = await host.productSnapshot()
    expect(reread?.persona?.activeCardId).toBe('lia-energetica')
    expect(reread?.preferences?.language).toBe('en-US')
    expect(reread?.provider?.chat?.preferred?.modelId).toBe('m2')
    expect(reread?.voice?.tts?.preferred?.providerId).toBe('custom-local-voice')
    // Unknown keys survive a save on DISK - forward compatibility with
    // AIRI (item 5). The typed snapshot hides them by design, so check raw.
    const raw = JSON.parse(await hostConfigText(home)) as Record<string, unknown>
    expect(raw.customField).toBe('keep-me')
    expect((await host.homeStatus()).config.filePath).toBe(join(home.userData, 'lia-product.json'))
  })

  it('a secret in the document update is refused by the core writer (L)', async () => {
    const home = await makeLiaHome()
    const before = await hostConfigText(home)
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const result = await host.updateConfig({
      update: { provider: { chat: { preferred: { apiKey: 'sk-should-never-persist', providerId: 'openrouter' } as never } } },
    })
    expect(result.status).toBe('secret-forbidden')
    expect(await hostConfigText(home)).toBe(before) // The file was not touched.
  })

  it('secrets ride the vault channel: stored encrypted, never in the JSON (L)', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const result = await host.updateConfig({
      secrets: [{ key: 'apiKey', scope: 'openrouter', value: 'sk-top-secret-123' }],
      update: { provider: { chat: { preferred: { modelId: 'm1', providerId: 'openrouter' } } } },
    })
    expect(result.status).toBe('ok')
    expect(host.vault.hasSecret('openrouter', 'apiKey')).toBe(true)
    expect(await hostConfigText(home)).not.toContain('sk-top-secret-123')
  })
})

async function hostConfigText(home: { userData: string }): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return await readFile(join(home.userData, 'lia-product.json'), 'utf8')
}

/**
 * K of Phase 7.1: after a config edit, the NEXT launch carries the new
 * facts - the bridge contract re-reads the document on every build, and
 * the stage env reflects the saved provider/voice immediately.
 */
describe('k. an edited config reaches the next stage launch', () => {
  it('bridge + stage env are rebuilt from the UPDATED document', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })

    const bridgeBefore = await host.bridgeConfig()
    expect(bridgeBefore.llm.preferred?.providerId).toBe('openrouter')

    await host.updateConfig({
      secrets: [{ key: 'apiKey', scope: 'openai', value: 'sk-new-provider' }],
      update: {
        preferences: { language: 'en-US' },
        provider: { chat: { preferred: { modelId: 'gpt-5', providerId: 'openai' } } },
      },
    })

    // The stage env points at the SAME canonical document - the next start
    // reads the new provider from it (nothing is copied into the env).
    const after = await host.stageEnv()
    expect(after.LIA_PRODUCT_CONFIG_FILE).toBe(join(home.userData, 'lia-product.json'))
    expect(after.LIA_MANAGED).toBe('1')

    // The bridge contract rebuilt from the UPDATED document.
    const bridge = await host.bridgeConfig()
    expect(bridge.llm.preferred?.providerId).toBe('openai')
    expect(bridge.llm.preferred?.modelId).toBe('gpt-5')
    expect(bridge.language).toBe('en-US')
    expect(bridge.secrets.hasSecret('openai')).toBe(true)
    // And values stay out of every surface: keys are presence booleans only.
    expect(JSON.stringify(bridge.identity)).not.toContain('sk-new-provider')
    expect(JSON.stringify(after)).not.toContain('sk-new-provider')
  })
})

/**
 * The voice rail of Phase 7.1, item 6: importing a picked file lands in the
 * canonical library, visible to both the launcher and AIRI - one storage.
 */
describe('voice import through the host', () => {
  it('a dialog-picked file DEFERS cleanly - no engine is hosted to receive it (Phase 7.8D/E)', async () => {
    const home = await makeLiaHome()
    const host = createLiaHost({ cipher: identityCipher, env: fixtureEnv(home), workspaceRoot: '/missing' })
    const { writeFile } = await import('node:fs/promises')
    const sourceFile = join(home.userData, 'picked-voice.wav')
    await writeFile(sourceFile, 'fake-audio')

    const before = await host.listVoices()
    // Any engine id - real legacy or invented - names no runnable engine.
    const imported = await host.importVoice(
      { engine: 'f5-tts', name: 'Voz da Ana', sources: [{ path: sourceFile, role: 'referenceAudio' }] },
      new Set([sourceFile]),
    )
    expect(imported.ok).toBe(false)
    if (!imported.ok) {
      expect(imported.error).toBe('engineUnknown')
    }

    // Nothing is created: the library is untouched by a deferred import.
    const after = await host.listVoices()
    expect(after.length).toBe(before.length)
    expect(after.some(p => p.name === 'Voz da Ana')).toBe(false)

    // The dialog-allowlist guard against arbitrary reads is absorbed by the
    // deferral: the engine gate fires BEFORE any source path is looked at
    // (core importProfile order), so an unallowlisted path can never even be
    // opened. The dedicated failure-order coverage lives in the core profile
    // tests; here we assert the refusal needs no successful path through it.
    const refused = await host.importVoice(
      { name: 'x', sources: [{ path: '/etc/passwd', role: 'model' }] },
      new Set([sourceFile]),
    )
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.error).toBe('engineUnknown')
    }
  })
})

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: the Launcher is the product-configuration
 * authority for speech-to-text, so the canonical default is materialized HERE,
 * before the Stage child launches - never by the Stage guessing at runtime.
 *
 * The eligibility gate is deliberately narrow (§14): voice not opted out, no
 * existing selection, the Groq chat path selected, and the EXISTING Groq vault
 * key present. Otherwise the Launcher refuses to guess - and specifically never
 * falls back to Web Speech, which the Windows runtime evidence showed reporting
 * `network` and restarting forever without a transcript.
 */
describe('conversar() - managed STT default (Phase 8.0D SHELL-B1)', () => {
  const SECRET = 'gsk-test-not-a-real-key'
  const STT_TARGET = { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' }

  function groqDoc(voice: Record<string, unknown> = {}) {
    return {
      persona: { activeCardId: 'lia-default' },
      preferences: { language: 'pt-BR' },
      provider: {
        chat: { onboarded: true, preferred: { modelId: 'llama-3.3-70b-versatile', providerId: 'groq' } },
      },
      schemaVersion: 1,
      voice: { tts: { preferred: { providerId: 'cloud-voice-provider', voiceId: 'nova' } }, ...voice },
    }
  }

  /** A host whose stage manager records the launch env and the doc at launch. */
  function hostFor(home: { userData: string }, events: Array<{ detail?: string, event: string }>) {
    const startedWith: Array<Record<string, string | undefined> | undefined> = []
    let docAtStart: string | undefined
    const host = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home as never),
      onEvent: (event, detail) => events.push({ detail, event }),
      stageManagerFactory: () => ({
        isAvailable: () => true,
        start: async (options?: { env?: Record<string, string | undefined> }) => {
          startedWith.push(options?.env)
          // Snapshot the canonical document at the exact moment of launch, so
          // "written before the Stage launches" is proven, not assumed.
          docAtStart = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
          return { logTail: [], phase: 'running' as const }
        },
        state: () => ({ logTail: [], phase: 'stopped' as const }),
        stop: async () => {},
      }) as never,
      workspaceRoot: '/missing',
    })
    return {
      docAtStart: () => docAtStart,
      host,
      startedWith,
    }
  }

  const readDoc = async (home: { userData: string }) =>
    JSON.parse(await readFile(join(home.userData, 'lia-product.json'), 'utf8')) as Record<string, any>

  it('case 1: an eligible launch writes the canonical default BEFORE the stage starts', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { docAtStart, host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    const state = await host.conversar()

    // The Stage still launches normally, with the SAME shared userData.
    expect(state.phase).toBe('running')
    expect(startedWith).toHaveLength(1)
    expect(startedWith[0]).toMatchObject({ LIA_MANAGED: '1', APP_USER_DATA_PATH: home.userData })

    // ...and the target was already in the document at launch time.
    expect(JSON.parse(docAtStart()!).voice.stt.preferred).toEqual(STT_TARGET)
    expect(await readDoc(home)).toMatchObject({ voice: { stt: { preferred: STT_TARGET } } })
    expect(events.some(e => e.event === 'lia-app.conversar-stt-defaulted')).toBe(true)

    // The default is metadata only: no credential, no derived base URL.
    const raw = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('apiKey')
    expect(raw).not.toContain('api.groq.com')
    // The pre-existing TTS selection survived.
    expect((await readDoc(home)).voice.tts.preferred).toEqual({
      providerId: 'cloud-voice-provider',
      voiceId: 'nova',
    })
  })

  it('case 2: an explicit STT selection is preserved exactly and never overridden', async () => {
    const chosen = { providerId: 'browser-web-speech-api' }
    const home = await makeLiaHome({ productConfig: groqDoc({ stt: { preferred: chosen } }) })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    await host.conversar()

    expect(startedWith).toHaveLength(1)
    // Untouched: the operator's choice wins over the product default.
    expect((await readDoc(home)).voice.stt.preferred).toEqual(chosen)
    expect(events.some(e => e.event === 'lia-app.conversar-stt-defaulted')).toBe(false)
  })

  it('case 3: voice.enabled=false writes no STT default at all', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc({ enabled: false }) })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    await host.conversar()

    // Text conversation still works; the microphone preference is not invented.
    expect(startedWith).toHaveLength(1)
    const doc = await readDoc(home)
    expect(doc.voice.enabled).toBe(false)
    expect(doc.voice.stt).toBeUndefined()
    expect(events.some(e => e.event === 'lia-app.conversar-stt-defaulted')).toBe(false)
  })

  it('case 4: a non-Groq chat provider gets no guessed STT target', async () => {
    const home = await makeLiaHome() // fixture default: preferred = openrouter
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('openrouter', 'apiKey', SECRET)

    await host.conversar()

    expect(startedWith).toHaveLength(1)
    // No provider is invented, and Web Speech is never selected for the user.
    expect((await readDoc(home)).voice.stt).toBeUndefined()
    expect(events.some(e => e.event === 'lia-app.conversar-stt-defaulted')).toBe(false)
  })

  it('case 5: a missing Groq key yields no false-ready STT target', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    // Deliberately NO vault secret for groq.

    // The conversation itself is gated earlier by the existing readiness check.
    await expect(host.conversar()).rejects.toThrow(/not fully configured/)
    expect(startedWith).toHaveLength(0)

    // Advertising a target with no credential behind it would be a lie.
    expect((await readDoc(home)).voice.stt).toBeUndefined()
    expect(events.some(e => e.event === 'lia-app.conversar-stt-defaulted')).toBe(false)
  })

  it('case 6: a failed canonical write degrades STT without corrupting config or blocking chat', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    const before = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    // Make the canonical document's directory unwritable so the atomic
    // temp-file write cannot land.
    await chmod(home.userData, 0o500)
    try {
      const state = await host.conversar()

      // CHOSEN BEHAVIOR (documented, not silent): the write fails, so STT is
      // reported degraded and text conversation still proceeds. Rationale -
      // the document is left byte-identical, no secret is touched, and the
      // existing voice-readiness precedent already downgrades a missing voice
      // runtime to an event rather than a hard stop. Nothing in the source
      // architecture requires aborting the conversation here.
      expect(state.phase).toBe('running')
      expect(startedWith).toHaveLength(1)

      // The document is neither corrupted nor partially written.
      expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(before)
      expect(JSON.parse(before).voice.stt).toBeUndefined()

      // STT is honestly reported as not ready, with a machine-readable reason.
      const notReady = events.find(e => e.event === 'lia-app.conversar-stt-not-ready')
      expect(notReady, 'degraded STT is reported').toBeDefined()
      expect(notReady!.detail).toContain('reason=config-write-failed')
      expect(events.some(e => e.event === 'lia-app.conversar-stt-defaulted')).toBe(false)

      // And the secret never reaches an event.
      expect(events.every(e => !`${e.event} ${e.detail ?? ''}`.includes(SECRET))).toBe(true)
    }
    finally {
      await chmod(home.userData, 0o700)
    }
  })

  it('the STT default is idempotent across launches and never duplicates a credential', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    await host.conversar()
    const afterFirst = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    await host.conversar()

    // The second launch finds the selection already present and preserves it.
    expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(afterFirst)
    expect(startedWith).toHaveLength(2)
    // One secret, one scope: nothing was written to the vault.
    expect(host.vault.hasSecret('groq', 'apiKey')).toBe(true)
    expect(host.vault.hasSecret('lia-groq-transcription', 'apiKey')).toBe(false)
  })
})
