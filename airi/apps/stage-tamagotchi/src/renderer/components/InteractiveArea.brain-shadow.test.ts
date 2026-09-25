// @vitest-environment happy-dom
import { PiniaColada } from '@pinia/colada'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useConsciousnessSettingsStore } from '@proj-airi/stage-ui/stores/modules/consciousness-settings'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import InteractiveArea from './InteractiveArea.vue'

import { electronLiaBrainChatDecision } from '../../shared/eventa'
import { artistryToolReferences } from '../stores/tools'

/**
 * Phases 8.0D-9 / 8.0D-10B-3B2: the shadow observation at the REAL user-send seam.
 *
 * The component, the stores and the shadow helper all run for real; only the
 * renderer invoke seam is a spy - and it is intercepted for the Brain channel
 * ONLY, so every other Electron invoke in the mounted tree keeps its real
 * implementation. That makes these tests describe the production path: send
 * the draft, then look at exactly what crossed the bridge and at what
 * `chatStore.send` received.
 */

const electron = vi.hoisted(() => ({
  brainInvoke: vi.fn(),
}))

vi.mock('@proj-airi/electron-vueuse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/electron-vueuse')>()
  // The canonical channel object itself - the same module instance the shadow
  // helper and this test both import. `defineInvokeEventa` has no top-level
  // `.id`; the receive event carries the channel tag (`<tag>-receive`), so
  // identity is the precise discriminator for the one intercepted channel.
  const { electronLiaBrainChatDecision } = await import('../../shared/eventa')
  return {
    ...actual,
    useElectronEventaInvoke: (channel?: unknown, ...rest: unknown[]) => {
      // Only the Brain decision channel is intercepted; everything else keeps
      // the real renderer invoke.
      if (channel === electronLiaBrainChatDecision)
        return electron.brainInvoke
      return (actual.useElectronEventaInvoke as (...args: unknown[]) => unknown)(channel, ...rest)
    },
  }
})

const NO_IMAGE_FACTS = { hasImageInput: false, reasoningRequested: false, usesTools: true }

async function renderArea() {
  const pinia = createPinia()
  pinia.state.value = {
    'chat-session-selection': { activeSessionId: 'session-b' },
    'chat-session': {
      sessionMetas: {
        'session-b': { sessionId: 'session-b', userId: 'local', characterId: 'default', createdAt: 1, updatedAt: 1 },
      },
      sessionMessages: { 'session-b': [{ id: 'system', role: 'system', content: 'system prompt' }] },
    },
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  await router.isReady()
  const i18n = createI18n({ legacy: false, locale: 'en', missingWarn: false, fallbackWarn: false, messages: { en: {} } })

  const wrapper = mount(InteractiveArea, { global: { plugins: [pinia, PiniaColada, i18n, router] } })
  const chat = useChatStore(pinia)
  const send = vi.spyOn(chat, 'send').mockResolvedValue({ messages: [], sessionId: 'session-b' })
  return { chat, consciousness: useConsciousnessSettingsStore(pinia), send, wrapper }
}

async function submitDraft(wrapper: Awaited<ReturnType<typeof renderArea>>['wrapper'], draft: string) {
  const textarea = wrapper.find('textarea')
  await textarea.setValue(draft)
  await textarea.trigger('keydown', { key: 'Enter' })
  return textarea
}

async function attachImages(wrapper: Awaited<ReturnType<typeof renderArea>>['wrapper'], count: number) {
  const input = wrapper.find('input[type="file"]')
  const transfer = new DataTransfer()
  for (let index = 0; index < count; index++)
    transfer.items.add(new File([`image-${index}`], `image-${index}.png`, { type: 'image/png' }))

  Object.defineProperty(input.element, 'files', { configurable: true, value: transfer.files })
  await input.trigger('change')
  await vi.waitFor(() => expect(wrapper.findAll('img[src^="blob:"]').length).toBe(count))
}

/** The facts the shadow observer sent to main for the FIRST observation. */
function observedFacts(): Record<string, boolean> | undefined {
  const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>] | []
  return request?.facts as Record<string, boolean> | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  electron.brainInvoke.mockResolvedValue({ status: 'modeUnspecified' })
  localStorage.clear()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('interactive area shadow brain observation (Phase 8.0D-9)', () => {
  it('k/m: a plain text send observes exactly one turn, with the honest baseline facts', async () => {
    const { send, wrapper } = await renderArea()

    await submitDraft(wrapper, 'plain shadow turn')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    // K: exactly one observation per send, carrying the facts and - since
    // 8.0D-10B-3B2 - the one opaque logical-send key this submission generated.
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(request).sort()).toEqual(['correlationId', 'facts'])
    expect(typeof request.correlationId).toBe('string')
    expect(String(request.correlationId)).not.toHaveLength(0)
    // M: no attachments -> hasImageInput false (the canonical facts shape).
    expect(observedFacts()).toEqual(NO_IMAGE_FACTS)
  })

  it('l: the outgoing image attachments set hasImageInput', async () => {
    const { send, wrapper } = await renderArea()

    await attachImages(wrapper, 2)
    await submitDraft(wrapper, 'look at this')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    expect(observedFacts()).toEqual({ ...NO_IMAGE_FACTS, hasImageInput: true })
  })

  it('n/o: usesTools mirrors the tool references the send actually carries', async () => {
    const { send, wrapper } = await renderArea()

    await submitDraft(wrapper, 'tools please')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const payload = send.mock.calls[0][0] as { tools: unknown[] }
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    // N: the outgoing references made it true...
    expect(payload.tools).toEqual(artistryToolReferences)
    expect(observedFacts()?.usesTools).toBe(true)
    // O: and the fact is exactly "the outgoing turn carries tool references".
    expect(observedFacts()?.usesTools).toBe((payload.tools?.length ?? 0) > 0)
  })

  it('p/q: reasoningRequested mirrors the existing consciousness reasoning flag', async () => {
    // P: the existing session flag, turned on through its own store action.
    const enabled = await renderArea()
    await enabled.consciousness.setReasoning(true)
    await submitDraft(enabled.wrapper, 'think first')
    await vi.waitFor(() => expect(enabled.send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    expect(observedFacts()).toEqual({ ...NO_IMAGE_FACTS, reasoningRequested: true })

    // Q: the default (off) reports false - and it is the SAME signal the chat
    // preparation reads, not a UI-only mirror.
    vi.clearAllMocks()
    electron.brainInvoke.mockResolvedValue({ status: 'modeUnspecified' })
    localStorage.clear()

    const disabled = await renderArea()
    await submitDraft(disabled.wrapper, 'no thinking')
    await vi.waitFor(() => expect(disabled.send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    expect(observedFacts()).toEqual(NO_IMAGE_FACTS)
  })

  it('r: combined image + tools + reasoning describe one turn together', async () => {
    const { consciousness, send, wrapper } = await renderArea()
    await consciousness.setReasoning(true)

    await attachImages(wrapper, 1)
    await submitDraft(wrapper, 'everything at once')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    expect(observedFacts()).toEqual({ hasImageInput: true, reasoningRequested: true, usesTools: true })
  })

  it('s/t: the existing chatStore.send payload is unchanged and never consumes a decision', async () => {
    const { send, wrapper } = await renderArea()
    // A decision that WOULD select a route, if anything consumed decisions.
    electron.brainInvoke.mockResolvedValue({ selection: { status: 'selected' }, status: 'automatic' })

    await submitDraft(wrapper, 'payload check')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    // S: the same payload shape the send has always had - sessionId, text, the
    // copied attachments and the tool references - plus ONLY the additive
    // logical-send correlation key added by 8.0D-10B-3B1.
    const [payload] = send.mock.calls[0] as [Record<string, unknown>]
    expect(payload).toMatchObject({
      attachments: [],
      sessionId: 'session-b',
      text: 'payload check',
      tools: artistryToolReferences,
    })
    expect(Object.keys(payload).sort()).toEqual(['attachments', 'correlationId', 'sessionId', 'text', 'tools'])
    // The additive key is one opaque non-empty string - not a decision value.
    expect(typeof payload.correlationId).toBe('string')
    expect(String(payload.correlationId)).not.toHaveLength(0)
    // T: nothing brain-shaped is part of what the store received.
    expect(JSON.stringify(payload)).not.toMatch(/brain|decision|selection|readiness|engineId|modelId/i)
  })

  it('u: a bridge that never answers does not sit on the send path', async () => {
    const { send, wrapper } = await renderArea()
    electron.brainInvoke.mockImplementation(() => new Promise(() => {}))

    await submitDraft(wrapper, 'never answered')
    // The send completed anyway - it is not awaited behind the bridge.
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0][0]).toMatchObject({ text: 'never answered' })
  })

  it('v: a rejected bridge never becomes a chat failure, and leaves no unhandled rejection', async () => {
    const { send, wrapper } = await renderArea()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    electron.brainInvoke.mockRejectedValue(new Error('bridge exploded'))

    try {
      await submitDraft(wrapper, 'rejected bridge')
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(unhandled).toEqual([])
    expect(send.mock.calls[0][0]).toMatchObject({ text: 'rejected bridge' })
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[LIA-BRAIN] shadow unavailable'))
  })

  it('w/x: noCandidates, disabled and modeUnspecified outcomes never prevent the send', async () => {
    const outcomes = [
      { selection: { status: 'noCandidates' }, status: 'automatic' },
      { status: 'disabled' },
      { status: 'modeUnspecified' },
      { readiness: { status: 'notResolved' }, resolution: { status: 'noPreference' }, status: 'manual' },
    ]

    for (const outcome of outcomes) {
      vi.clearAllMocks()
      localStorage.clear()
      electron.brainInvoke.mockResolvedValue(outcome)

      const { send, wrapper } = await renderArea()
      await submitDraft(wrapper, 'still sends')
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

      const status = (outcome as { status: string }).status
      expect(send.mock.calls[0][0], status).toMatchObject({ sessionId: 'session-b', text: 'still sends' })
      // The outcome was observed and logged, not acted upon.
      await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
      expect(console.info, status).toHaveBeenCalled()
    }
  })

  it('observes the channel through the existing renderer invoke convention', async () => {
    const { send, wrapper } = await renderArea()

    await submitDraft(wrapper, 'channel check')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))

    // The shared contract is the canonical Eventa invoke shape: the receive
    // event id is the channel tag with the `-receive` suffix.
    expect(electronLiaBrainChatDecision.receiveEvent.id).toBe('eventa:invoke:lia:brain:chat-decision-receive')
    // The invoke the helper used is the channel's own invoke - and the request
    // carries nothing but the facts and the one opaque join key.
    expect(Object.keys((electron.brainInvoke.mock.calls[0] as [Record<string, unknown>])[0]).sort())
      .toEqual(['correlationId', 'facts'])
  })

  it('intercepts only the Brain channel and preserves the real invoke for everything else', async () => {
    const { useElectronEventaInvoke } = await import('@proj-airi/electron-vueuse')

    // Intercepted: the Brain channel returns the observation spy, never the
    // real renderer invoke.
    expect(useElectronEventaInvoke(electronLiaBrainChatDecision)).toBe(electron.brainInvoke)

    // Not intercepted: any other channel still goes through the real
    // implementation, which here has no Electron ipcRenderer available - the
    // proof that the mock did not replace unrelated Eventa behavior globally.
    const otherChannel = { receiveEvent: { id: 'eventa:invoke:unrelated:channel-receive' } }
    expect(() => useElectronEventaInvoke(otherChannel as never)).toThrow(/ipcRenderer is not available/)
  })
})
