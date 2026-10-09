import { chmod, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  brainRequirementForChatTurn,
  createProductionBrainAutomaticPolicy,
  createProductionBrainCatalog,
  decideBrainRouteFromProductState,
  readLiaProductConfig,
} from '@lia/core'
import { describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

/**
 * Phase 8.0D-M2: the managed Brain routing default, tested as the REAL
 * product lifecycle it is - `conversar()` over the canonical document on disk,
 * through the real Lia Core writer and the real canonical router.
 *
 * Why this suite exists in this shape: the first Windows gate of the multimodal
 * route failed with the image-bearing turn still on the globally active chat
 * model, because the canonical document a normal Launcher install produces has
 * NO `brain.mode` at all - an absent mode answers `modeUnspecified`, which
 * selects no route. Every routing test written before that used a fixture that
 * already declared `brain.mode: 'automatic'`, so the gap was invisible. These
 * tests therefore never hand the router a mode: they run `conversar()` and read
 * the mode back off the disk.
 *
 * The Launcher is the product-configuration authority for this field, exactly
 * as it already is for the managed speech-to-text default. Nothing here is a
 * second routing authority: the routing decision stays owned by Lia Core's
 * canonical router, and the Stage still makes it.
 */

const SECRET = 'gsk-test-not-a-real-key'

/** The engine/model identities the production Brain declares, as literals. */
const GROQ_ENGINE_ID = 'groq'
const GROQ_TEXT_MODEL_ID = 'openai/gpt-oss-120b'
const GROQ_VISION_MODEL_ID = 'qwen/qwen3.8-27b'

/** A canonical document exactly as a normal Groq-onboarded install has it. */
function groqDoc(brain?: Record<string, unknown>) {
  return {
    persona: { activeCardId: 'lia-default' },
    preferences: { language: 'pt-BR' },
    provider: {
      chat: { onboarded: true, preferred: { modelId: GROQ_TEXT_MODEL_ID, providerId: 'groq' } },
    },
    schemaVersion: 1,
    // The managed speech-to-text target the Launcher already materializes on
    // this install, so the STT default is a no-op here and every "untouched
    // document" assertion below isolates the Brain bootstrap alone.
    voice: {
      stt: { preferred: { modelId: 'whisper-large-v3-turbo', providerId: 'lia-groq-transcription' } },
      tts: { preferred: { providerId: 'cloud-voice-provider', voiceId: 'nova' } },
    },
    ...(brain === undefined ? {} : { brain }),
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
        docAtStart = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
        return { logTail: [], phase: 'running' as const }
      },
      state: () => ({ logTail: [], phase: 'stopped' as const }),
      stop: async () => {},
    }) as never,
    workspaceRoot: '/missing',
  })
  return { docAtStart: () => docAtStart, host, startedWith }
}

async function readDoc(home: { userData: string }): Promise<Record<string, any>> {
  return JSON.parse(await readFile(join(home.userData, 'lia-product.json'), 'utf8')) as Record<string, any>
}

function detailOf(events: Array<{ detail?: string, event: string }>, event: string): string | undefined {
  return events.find(entry => entry.event === event)?.detail
}

describe('conversar() - managed Brain routing default (Phase 8.0D-M2)', () => {
  it('1: an absent brain.mode on an eligible managed Groq install is defaulted to automatic BEFORE the stage starts', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { docAtStart, host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    // The document this install really has: no routing mode at all.
    expect((await readDoc(home)).brain).toBeUndefined()

    const state = await host.conversar()

    expect(state.phase).toBe('running')
    expect(startedWith).toHaveLength(1)
    // Written BEFORE the child launches, so the managed Stage reads a resolved mode.
    expect(JSON.parse(docAtStart()!).brain).toEqual({ mode: 'automatic' })
    expect(await readDoc(home)).toMatchObject({ brain: { mode: 'automatic' } })
    expect(detailOf(events, 'lia-app.conversar-brain-defaulted')).toBe('mode=automatic')
    // The canonical intent this launch runs with is reported by its owner.
    expect(detailOf(events, 'lia-app.conversar-brain-mode')).toBe('mode=absent')

    // Metadata only: no credential, no derived URL, and the rest of the
    // document is untouched.
    const raw = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain('apiKey')
    expect(raw).not.toContain('api.groq.com')
    expect((await readDoc(home)).voice.tts.preferred).toEqual({
      providerId: 'cloud-voice-provider',
      voiceId: 'nova',
    })
    expect((await readDoc(home)).provider.chat.preferred).toEqual({
      modelId: GROQ_TEXT_MODEL_ID,
      providerId: 'groq',
    })
  })

  it('2: an explicit disabled mode is absolute - never overridden, never re-written', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc({ mode: 'disabled' }) })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    const before = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    await host.conversar()

    expect(startedWith).toHaveLength(1)
    // Byte-identical: the user's opt-out is not touched in any way.
    expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(before)
    expect((await readDoc(home)).brain).toEqual({ mode: 'disabled' })
    expect(detailOf(events, 'lia-app.conversar-brain-mode')).toBe('mode=disabled')
    expect(events.some(e => e.event === 'lia-app.conversar-brain-defaulted')).toBe(false)
    expect(events.some(e => e.event === 'lia-app.conversar-brain-not-ready')).toBe(false)
  })

  it('3: an explicit manual mode is absolute - never overridden, never re-written', async () => {
    const home = await makeLiaHome({
      productConfig: groqDoc({ engine: { preferred: 'groq' }, mode: 'manual', model: { preferred: GROQ_TEXT_MODEL_ID } }),
    })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    const before = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    await host.conversar()

    expect(startedWith).toHaveLength(1)
    expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(before)
    expect((await readDoc(home)).brain).toEqual({
      engine: { preferred: 'groq' },
      mode: 'manual',
      model: { preferred: GROQ_TEXT_MODEL_ID },
    })
    expect(detailOf(events, 'lia-app.conversar-brain-mode')).toBe('mode=manual')
    expect(events.some(e => e.event === 'lia-app.conversar-brain-defaulted')).toBe(false)
  })

  it('4: an existing automatic mode is preserved idempotently, with no second write', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc({ mode: 'automatic' }) })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    const before = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    await host.conversar()

    expect(startedWith).toHaveLength(1)
    expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(before)
    expect(detailOf(events, 'lia-app.conversar-brain-mode')).toBe('mode=automatic')
    // Nothing to default, so nothing is claimed as defaulted.
    expect(events.some(e => e.event === 'lia-app.conversar-brain-defaulted')).toBe(false)
  })

  it('4b: the default is idempotent across launches and never duplicates a credential', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    await host.conversar()
    const afterFirst = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    await host.conversar()

    // The second launch finds automatic already declared and preserves it.
    expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(afterFirst)
    expect(startedWith).toHaveLength(2)
    expect(detailOf(events, 'lia-app.conversar-brain-mode')).toBe('mode=absent')
    expect(events.filter(e => e.event === 'lia-app.conversar-brain-defaulted')).toHaveLength(1)
    // One secret, one scope: the existing Groq key is reused, never copied,
    // and the Brain default creates no credential of its own.
    expect(host.vault.hasSecret('groq', 'apiKey')).toBe(true)
    expect((await readFile(join(home.userData, 'lia-product.json'), 'utf8')).includes(SECRET)).toBe(false)
  })

  it('5: a chat provider the production Brain does not serve never fabricates automatic readiness', async () => {
    const home = await makeLiaHome({
      productConfig: {
        ...groqDoc(),
        provider: { chat: { onboarded: true, preferred: { modelId: 'some-other-model', providerId: 'openrouter' } } },
      },
    })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('openrouter', 'apiKey', SECRET)

    const before = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    const state = await host.conversar()

    // Conversation still proceeds - a Brain default is never a gate.
    expect(state.phase).toBe('running')
    expect(startedWith).toHaveLength(1)
    // The Groq Brain is NOT selected for a user whose chat configuration does
    // not justify it, and the document is untouched.
    expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(before)
    expect((await readDoc(home)).brain).toBeUndefined()
    expect(detailOf(events, 'lia-app.conversar-brain-not-ready')).toContain('reason=chat-provider-not-eligible')
    expect(events.some(e => e.event === 'lia-app.conversar-brain-defaulted')).toBe(false)
    // And no credential is ever written for the Brain.
    expect(host.vault.hasSecret('groq', 'apiKey')).toBe(false)
  })

  it('6: a failed canonical write degrades honestly - no mutation, no blocked conversation', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    const before = await readFile(join(home.userData, 'lia-product.json'), 'utf8')
    await chmod(home.userData, 0o500)
    try {
      const state = await host.conversar()

      // Degraded, never corrupting and never blocking: text conversation is
      // exactly as usable as it was before this phase existed.
      expect(state.phase).toBe('running')
      expect(startedWith).toHaveLength(1)
      expect(await readFile(join(home.userData, 'lia-product.json'), 'utf8')).toBe(before)
      expect(JSON.parse(before).brain).toBeUndefined()

      const notReady = detailOf(events, 'lia-app.conversar-brain-not-ready')
      expect(notReady, 'a degraded default is reported').toBeDefined()
      expect(notReady!).toContain('reason=config-write-failed')
      expect(events.some(e => e.event === 'lia-app.conversar-brain-defaulted')).toBe(false)
      // The secret never reaches an event.
      expect(events.every(e => !`${e.event} ${e.detail ?? ''}`.includes(SECRET))).toBe(true)
    }
    finally {
      await chmod(home.userData, 0o700)
    }
  })

  it('7/8: after the managed bootstrap the SAME canonical snapshot routes an image turn to the vision model and a text turn to the text brain', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { host } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    await host.conversar()

    // The Stage's OWN input: the canonical document as it now exists on disk,
    // read through the canonical reader - never a hand-written fixture.
    const read = await readLiaProductConfig(join(home.userData, 'lia-product.json'))
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return
    const snapshot = read.value

    const catalog = createProductionBrainCatalog()
    const policy = createProductionBrainAutomaticPolicy()
    const decide = (facts: Parameters<typeof brainRequirementForChatTurn>[0]) =>
      decideBrainRouteFromProductState({
        automaticPolicy: policy,
        engines: catalog.engines,
        models: catalog.models,
        requirement: brainRequirementForChatTurn(facts),
        snapshot,
      })

    // 7: the real image requirement - the one the send path derives from a
    // turn carrying an attachment - selects the engine's vision route.
    const imageRequirement = brainRequirementForChatTurn({ hasImageInput: true })
    expect(imageRequirement.required).toContain('imageInput')
    const image = decide({ hasImageInput: true })
    expect(image.status).toBe('automatic')
    if (image.status !== 'automatic')
      return
    expect(image.selection.status).toBe('selected')
    if (image.selection.status !== 'selected')
      return
    expect(image.selection.route.engine.id).toBe(GROQ_ENGINE_ID)
    expect(image.selection.route.model.id).toBe(GROQ_VISION_MODEL_ID)

    // 8: a text-only turn stays on the text chat brain - the default is not a
    // switch of the whole conversation to the vision model.
    const text = decide({})
    expect(text.status).toBe('automatic')
    if (text.status !== 'automatic')
      return
    expect(text.selection.status).toBe('selected')
    if (text.selection.status !== 'selected')
      return
    expect(text.selection.route.engine.id).toBe(GROQ_ENGINE_ID)
    expect(text.selection.route.model.id).toBe(GROQ_TEXT_MODEL_ID)
  })

  it('integration: normal Conversar bootstrap -> canonical snapshot -> Brain decision -> image routeOverride', async () => {
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const events: Array<{ detail?: string, event: string }> = []
    const { host, startedWith } = hostFor(home, events)
    await host.vault.setSecret('groq', 'apiKey', SECRET)

    // 1. The normal product flow, end to end, with nothing pre-declared.
    expect((await readDoc(home)).brain).toBeUndefined()
    await host.conversar()
    expect(startedWith).toHaveLength(1)

    // 2. The canonical snapshot the managed Stage child is handed.
    const read = await readLiaProductConfig(join(home.userData, 'lia-product.json'))
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return

    // 3. The Stage Brain decision over that snapshot, for an image-bearing turn.
    const catalog = createProductionBrainCatalog()
    const decision = decideBrainRouteFromProductState({
      automaticPolicy: createProductionBrainAutomaticPolicy(),
      engines: catalog.engines,
      models: catalog.models,
      requirement: brainRequirementForChatTurn({ hasImageInput: true }),
      snapshot: read.value,
    })

    // 4. The authoritative routeOverride the renderer adapter derives from it:
    // automatic + selected is routable, engine id is the provider id, model id
    // verbatim. (The adapter itself is pinned by its own literal oracle in the
    // Stage suite; this asserts the composition across the real boundary.)
    expect(decision.status).toBe('automatic')
    if (decision.status !== 'automatic')
      return
    expect(decision.selection.status).toBe('selected')
    if (decision.selection.status !== 'selected')
      return
    expect({
      modelId: decision.selection.route.model.id,
      providerId: decision.selection.route.engine.id,
    }).toEqual({ modelId: GROQ_VISION_MODEL_ID, providerId: GROQ_ENGINE_ID })
  })

  it('the same flow WITHOUT the bootstrap reproduces the Windows failure: no route, so the turn stays on the active model', async () => {
    // Regression anchor: this is the state the first Windows gate ran in. An
    // absent mode yields modeUnspecified, which the renderer adapter maps to
    // `undefined` - i.e. no routeOverride, so the send keeps the globally
    // active provider/model and the image reaches a text-only model.
    const home = await makeLiaHome({ productConfig: groqDoc() })
    const read = await readLiaProductConfig(join(home.userData, 'lia-product.json'))
    expect(read.status).toBe('ok')
    if (read.status !== 'ok')
      return

    const catalog = createProductionBrainCatalog()
    const decision = decideBrainRouteFromProductState({
      automaticPolicy: createProductionBrainAutomaticPolicy(),
      engines: catalog.engines,
      models: catalog.models,
      requirement: brainRequirementForChatTurn({ hasImageInput: true }),
      snapshot: read.value,
    })
    expect(decision).toEqual({ status: 'modeUnspecified' })
    // The adapter's rule, verbatim: only automatic + selected is routable.
    const routable = decision.status === 'automatic' && decision.selection.status === 'selected'
    expect(routable).toBe(false)
  })

  it('10: the Brain bootstrap touches no voice, speech or hearing concern', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(
      fileURLToPath(new URL('./lia-host.ts', import.meta.url)),
      'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // The new primitive's own body, isolated from the rest of the host.
    const start = source.indexOf('async function ensureBrainReadyForConversar(')
    expect(start).toBeGreaterThan(0)
    const end = source.indexOf('async function ensureVoiceReadyForConversar(', start)
    expect(end).toBeGreaterThan(start)
    const body = source.slice(start, end)

    expect(body).not.toMatch(/voice|tts|stt|speech|hearing|transcription|kokoro|microphone|alltalk/i)
    // No second routing authority and no provider/model identity of its own:
    // the router is asked, and the engine id is compared with the configured
    // chat provider - never matched against a hardcoded model list.
    expect(body).not.toMatch(/gpt-oss|qwen|whisper/i)
    expect(body).not.toMatch(/activeProvider|activeModel|chatStore/)
    // It persists through the canonical writer and reads presence only.
    expect(body).toContain('updateLiaProductConfig(paths.productConfigFile, brainRoutingModeUpdate(\'automatic\'))')
    expect(body).toContain('vault.hasSecret(preferredAi.providerId, \'apiKey\')')
    expect(body).not.toMatch(/getSecret|readSecret|resolveApiKey|decrypt/)

    // Wired exactly once into the Conversar pipeline, beside the STT default.
    expect(source.match(/await ensureBrainReadyForConversar\(snapshot\)/g)).toHaveLength(1)
    expect(source.match(/await ensureSttReadyForConversar\(snapshot\)/g)).toHaveLength(1)
    expect(source.match(/await ensureVoiceReadyForConversar\(snapshot\)/g)).toHaveLength(1)
  })
})
