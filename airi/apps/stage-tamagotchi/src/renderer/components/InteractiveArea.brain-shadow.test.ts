import { groqBrainDescriptors } from '@lia/core'
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
import { createMemoryStorage } from '../../test-helpers'
import { artistryToolReferences } from '../stores/tools'

/**
 * Phase 8.0D-10B-4D4C4-D2B2-D2: InteractiveArea authoritative Lia route at the REAL normal send seam.
 *
 * Replaces the shadow-only observation: one logical send → freeze reasoning+tools,
 * build one facts snapshot, await resolveLiaAuthoritativeSendRoute, then send with
 * frozen reasoning and conditional routeOverride. All 15 D2 gates are proved here.
 */

const electron = vi.hoisted(() => ({
  brainInvoke: vi.fn(),
}))

const liaProviderMock = vi.hoisted(() => ({
  hasApiKey: vi.fn(),
}))

vi.mock('@proj-airi/electron-vueuse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/electron-vueuse')>()
  const { electronLiaBrainChatDecision } = await import('../../shared/eventa')
  return {
    ...actual,
    useElectronEventaInvoke: (channel?: unknown, ...rest: unknown[]) => {
      if (channel === electronLiaBrainChatDecision)
        return electron.brainInvoke
      return (actual.useElectronEventaInvoke as (...args: unknown[]) => unknown)(channel, ...rest)
    },
  }
})

vi.mock('../stores/lia/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/lia/provider')>()
  return {
    ...actual,
    useLiaProviderStore: () => ({
      hasApiKey: liaProviderMock.hasApiKey,
    }),
  }
})

function makeAutomaticSelected() {
  const { engines, models } = groqBrainDescriptors()
  return {
    status: 'automatic' as const,
    selection: {
      status: 'selected' as const,
      route: { engine: engines[0]!, model: models[0]! },
    },
  }
}

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
  return { chat, consciousness: useConsciousnessSettingsStore(pinia), send, wrapper, pinia }
}

/**
 * The send payload exactly as the chat store declares it - derived from the
 * store's OWN `send` signature, never widened to `Record<string, unknown>`. A
 * field that disappears from the payload contract then fails HERE, instead of
 * silently reading `undefined` through a cast.
 */
type ChatSendPayload = Parameters<ReturnType<typeof useChatStore>['send']>[0]

/** One recorded `send` call's payload, by index, through that same signature. */
function sentPayloadAt(calls: [ChatSendPayload][], index: number): ChatSendPayload {
  return calls[index][0]
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
  for (let index = 0; index < count; index++) {
    transfer.items.add(new File([`image-${index}`], `image-${index}.png`, { type: 'image/png' }))
  }

  Object.defineProperty(input.element, 'files', { configurable: true, value: transfer.files })
  await input.trigger('change')
  await vi.waitFor(() => expect(wrapper.findAll('img[src^="blob:"]').length).toBe(count))
}

function observedFacts(): Record<string, boolean> | undefined {
  const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>] | []
  return request?.facts as Record<string, boolean> | undefined
}

function observedCorrelationId(): string | undefined {
  const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>] | []
  return request?.correlationId as string | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', createMemoryStorage())
  electron.brainInvoke.mockResolvedValue(makeAutomaticSelected())
  liaProviderMock.hasApiKey.mockResolvedValue(true)
  localStorage.clear()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('interactive area authoritative Lia route (Phase 8.0D-10B-4D4C4-D2B2-D2)', () => {
  it('31: automatic selected Groq route with credential true → payload routeOverride {groq, openai/gpt-oss-120b} and one brain invoke', async () => {
    const { send, wrapper } = await renderArea()
    electron.brainInvoke.mockResolvedValue(makeAutomaticSelected())
    liaProviderMock.hasApiKey.mockResolvedValue(true)

    await submitDraft(wrapper, 'route me')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
    expect(liaProviderMock.hasApiKey).toHaveBeenCalledWith('groq')
    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(payload.routeOverride).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    expect(Object.keys(payload.routeOverride ?? {}).sort()).toEqual(['modelId', 'providerId'])
  })

  it('32: non-routable still sends — routeOverride absent, one brain request', async () => {
    const cases = [
      { status: 'disabled' },
      { status: 'modeUnspecified' },
      { status: 'automaticPolicyMissing' },
      { status: 'automatic', selection: { status: 'noCandidates' } },
      { status: 'automatic', selection: { status: 'noPolicyMatch' } },
      { status: 'automatic', selection: { status: 'ambiguous', ref: { engineId: 'groq', modelId: 'openai/gpt-oss-120b' } } },
    ] as const

    for (const outcome of cases) {
      vi.clearAllMocks()
      localStorage.clear()
      electron.brainInvoke.mockResolvedValue(outcome as never)
      liaProviderMock.hasApiKey.mockResolvedValue(true)

      const { send, wrapper } = await renderArea()
      await submitDraft(wrapper, 'still sends')
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

      const payload = sentPayloadAt(send.mock.calls, 0)
      expect(payload).not.toHaveProperty('routeOverride')
      expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
      // no credential lookup for non-routable
      expect(liaProviderMock.hasApiKey).not.toHaveBeenCalled()
    }
  })

  it('33: credential false still sends — resolver undefined, no routeOverride', async () => {
    const { send, wrapper } = await renderArea()
    electron.brainInvoke.mockResolvedValue(makeAutomaticSelected())
    liaProviderMock.hasApiKey.mockResolvedValue(false)

    await submitDraft(wrapper, 'no cred')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(payload).not.toHaveProperty('routeOverride')
    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
    expect(liaProviderMock.hasApiKey).toHaveBeenCalledTimes(1)
  })

  it('34: decision failure still sends — no routeOverride, no unhandled rejection', async () => {
    const { send, wrapper } = await renderArea()
    const unhandled: unknown[] = []
    const onUnhandled = (r: unknown) => unhandled.push(r)
    process.on('unhandledRejection', onUnhandled)
    electron.brainInvoke.mockRejectedValue(new Error('bridge exploded'))

    try {
      await submitDraft(wrapper, 'decision fail')
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    finally {
      process.off('unhandledRejection', onUnhandled)
    }

    expect(unhandled).toEqual([])
    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(payload).not.toHaveProperty('routeOverride')
    // payload still has reasoning
    expect(payload).toHaveProperty('reasoning')
  })

  it('35: authority is actually awaited — deferred brain blocks send until resolved', async () => {
    const { send, wrapper } = await renderArea()
    let resolveBrain!: (value: unknown) => void
    electron.brainInvoke.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveBrain = resolve
      })
    })

    await submitDraft(wrapper, 'deferred')
    // allow handleSend to reach the await
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(send).toHaveBeenCalledTimes(0)
    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)

    resolveBrain(makeAutomaticSelected())
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  })

  it('36: exactly one brain decision request per normal send', async () => {
    const { send, wrapper } = await renderArea()
    await submitDraft(wrapper, 'one request')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
    // second send → second request, not duplicate for first
    electron.brainInvoke.mockClear()
    liaProviderMock.hasApiKey.mockClear()
    electron.brainInvoke.mockResolvedValue(makeAutomaticSelected())
    liaProviderMock.hasApiKey.mockResolvedValue(true)
    await submitDraft(wrapper, 'second')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(electron.brainInvoke).toHaveBeenCalledTimes(1)
  })

  it('37: same correlationId on brain request and chat payload, opaque non-empty string', async () => {
    const { send, wrapper } = await renderArea()
    await submitDraft(wrapper, 'correlation')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const brainCid = observedCorrelationId()
    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(typeof brainCid).toBe('string')
    expect(brainCid!.length).toBeGreaterThan(0)
    expect(payload.correlationId).toBe(brainCid)
  })

  it('38: reasoning true snapshot — facts true and payload true', async () => {
    const { consciousness, send, wrapper } = await renderArea()
    await consciousness.setReasoning(true)

    await submitDraft(wrapper, 'reasoning true')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(observedFacts()?.reasoningRequested).toBe(true)
    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(payload.reasoning).toBe(true)
    expect(payload).toHaveProperty('reasoning')
  })

  it('39: reasoning false snapshot — facts false and payload false exists', async () => {
    const { consciousness, send, wrapper } = await renderArea()
    await consciousness.setReasoning(false)

    await submitDraft(wrapper, 'reasoning false')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(observedFacts()?.reasoningRequested).toBe(false)
    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(payload.reasoning).toBe(false)
    expect(payload).toHaveProperty('reasoning')
    expect(Object.hasOwn(payload, 'reasoning')).toBe(true)
  })

  it('40: reasoning does not drift during await — false frozen even if live becomes true', async () => {
    const { consciousness, send, wrapper } = await renderArea()
    await consciousness.setReasoning(false)

    let resolveBrain!: (v: unknown) => void
    electron.brainInvoke.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveBrain = resolve
      })
    })

    await submitDraft(wrapper, 'drift reasoning')
    await new Promise(resolve => setTimeout(resolve, 10))
    // mutate live after capture but before authority resolves
    await consciousness.setReasoning(true)

    resolveBrain(makeAutomaticSelected())
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(observedFacts()?.reasoningRequested).toBe(false)
    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(payload.reasoning).toBe(false)
  })

  it('41: tools snapshot — facts.usesTools from captured tools and payload.tools !== live but deep-equals', async () => {
    const { send, wrapper } = await renderArea()
    await submitDraft(wrapper, 'tools snapshot')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const payload = send.mock.calls[0][0] as { tools: unknown[] }
    expect(payload.tools).toEqual(artistryToolReferences)
    expect(payload.tools).not.toBe(artistryToolReferences)
    expect(observedFacts()?.usesTools).toBe(true)
    expect(observedFacts()?.usesTools).toBe((payload.tools?.length ?? 0) > 0)
  })

  it('42: tools do not drift during await — membership frozen', async () => {
    const { send, wrapper } = await renderArea()

    let resolveBrain!: (v: unknown) => void
    electron.brainInvoke.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveBrain = resolve
      })
    })

    // capture baseline length
    const baselineLen = artistryToolReferences.length
    await submitDraft(wrapper, 'tools drift')
    await new Promise(resolve => setTimeout(resolve, 10))

    // mutate live source after capture (push temporary)
    const extra = { name: 'drift_probe_tool' }
    ;(artistryToolReferences as unknown as unknown[]).push(extra)

    try {
      resolveBrain(makeAutomaticSelected())
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

      const payload = send.mock.calls[0][0] as { tools: unknown[] }
      // in-flight payload must NOT contain the drifted extra
      expect(payload.tools).not.toContainEqual(extra)
      expect(payload.tools).toHaveLength(baselineLen)
      expect(observedFacts()?.usesTools).toBe((payload.tools?.length ?? 0) > 0)
      expect(payload.tools).not.toBe(artistryToolReferences)
    }
    finally {
      // restore live source
      artistryToolReferences.pop()
    }
  })

  it('43: attachments snapshot — hasImageInput matches captured attachments', async () => {
    const { send, wrapper } = await renderArea()
    await attachImages(wrapper, 1)
    await submitDraft(wrapper, 'with image')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(observedFacts()?.hasImageInput).toBe(true)
    const payload = send.mock.calls[0][0] as { attachments: unknown[] }
    expect(payload.attachments).toHaveLength(1)
  })

  it('43b: no attachments → hasImageInput false', async () => {
    const { send, wrapper } = await renderArea()
    await submitDraft(wrapper, 'no image')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    expect(observedFacts()?.hasImageInput).toBe(false)
  })

  it('44: payload exactness for selected route — reasoning + routeOverride, no Brain leakage', async () => {
    const { consciousness, send, wrapper } = await renderArea()
    await consciousness.setReasoning(true)

    await submitDraft(wrapper, 'exactness')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(Object.keys(payload).sort()).toEqual(['attachments', 'correlationId', 'reasoning', 'routeOverride', 'sessionId', 'text', 'tools'])
    expect(payload.reasoning).toBe(true)
    expect(payload.routeOverride).toEqual({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    expect(JSON.stringify(payload)).not.toMatch(/brain|decision|selection|readiness|engineId/i)
    // ensure no extra route fields
    expect(Object.keys(payload.routeOverride ?? {}).sort()).toEqual(['modelId', 'providerId'])
  })

  it('44b: payload exactness for undefined route — reasoning present, routeOverride absent', async () => {
    const { send, wrapper } = await renderArea()
    electron.brainInvoke.mockResolvedValue({ status: 'disabled' } as never)

    await submitDraft(wrapper, 'undefined route')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const payload = sentPayloadAt(send.mock.calls, 0)
    expect(Object.keys(payload).sort()).toEqual(['attachments', 'correlationId', 'reasoning', 'sessionId', 'text', 'tools'])
    expect(payload).toHaveProperty('reasoning')
    expect(payload).not.toHaveProperty('routeOverride')
    expect(JSON.stringify(payload)).not.toMatch(/brain|decision|selection|readiness|engineId/i)
  })

  it('l: outgoing image attachments still set hasImageInput', async () => {
    const { send, wrapper } = await renderArea()
    await attachImages(wrapper, 2)
    await submitDraft(wrapper, 'look at this')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(observedFacts()).toEqual({ hasImageInput: true, reasoningRequested: false, usesTools: true })
  })

  it('observes the channel through the existing renderer invoke convention', async () => {
    const { send, wrapper } = await renderArea()
    await submitDraft(wrapper, 'channel check')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    expect(electronLiaBrainChatDecision.receiveEvent.id).toBe('eventa:invoke:lia:brain:chat-decision-receive')
    expect(Object.keys((electron.brainInvoke.mock.calls[0] as [Record<string, unknown>])[0]).sort()).toEqual(['correlationId', 'facts'])
  })

  it('intercepts only the Brain channel and preserves the real invoke for everything else', async () => {
    const { useElectronEventaInvoke } = await import('@proj-airi/electron-vueuse')
    expect(useElectronEventaInvoke(electronLiaBrainChatDecision)).toBe(electron.brainInvoke)
    const otherChannel = { receiveEvent: { id: 'eventa:invoke:unrelated:channel-receive' } }
    expect(() => useElectronEventaInvoke(otherChannel as never)).toThrow(/ipcRenderer is not available/)
  })
})
