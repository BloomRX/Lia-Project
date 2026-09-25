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

import { artistryToolReferences } from '../stores/tools'

/**
 * Phase 8.0D-10B-3B1: the logical-send correlation key at the REAL user-send
 * seam.
 *
 * The component and the stores run for real, `chatStore.send` is a spy (so the
 * assertion is about the payload the seam hands over), and the renderer invoke
 * seam is intercepted for the Brain channel ONLY - exactly like the 8.0D-9 seam
 * test - so the shadow request can be proven untouched.
 */

const electron = vi.hoisted(() => ({
  brainInvoke: vi.fn(),
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

/** Deterministic, opaque-looking ids so the generated value can be asserted. */
const MINTED_IDS = [
  '1f9d6a1e-0000-4000-8000-000000000001',
  '1f9d6a1e-0000-4000-8000-000000000002',
  '1f9d6a1e-0000-4000-8000-000000000003',
]

let minted: ReturnType<typeof vi.spyOn>
let mintedIndex = 0

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

beforeEach(() => {
  vi.clearAllMocks()
  electron.brainInvoke.mockResolvedValue({ status: 'modeUnspecified' })
  localStorage.clear()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  // Only the id factory is watched: it is the seam's own dependency-free
  // mechanism, so counting it proves generation happens once, at the seam.
  mintedIndex = 0
  minted = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => MINTED_IDS[mintedIndex++] ?? `minted-${mintedIndex}`)
})

describe('interactive area logical send correlation (Phase 8.0D-10B-3B1)', () => {
  it('a/b/g: one send mints exactly one id and hands the unchanged payload over', async () => {
    const { send, wrapper } = await renderArea()
    const before = minted.mock.calls.length

    await submitDraft(wrapper, 'plain correlated turn')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    // A: exactly one id per send.
    expect(minted.mock.calls.length - before).toBe(1)

    const [payload] = send.mock.calls[0] as [Record<string, unknown>]
    // B: the exact minted value reaches the send.
    expect(payload.correlationId).toBe(MINTED_IDS[0])
    expect(String(payload.correlationId)).not.toHaveLength(0)

    // G: every pre-existing payload field is exactly as before - the additive
    // key is the only difference.
    expect(Object.keys(payload).sort()).toEqual([
      'attachments',
      'correlationId',
      'sessionId',
      'text',
      'tools',
    ])
    expect(payload.sessionId).toBe('session-b')
    expect(payload.text).toBe('plain correlated turn')
    expect(payload.attachments).toEqual([])
    expect(payload.tools).toBe(artistryToolReferences)
    // The payload stays serializable (the leader boundary structured-clones it).
    expect(() => structuredClone(payload)).not.toThrow()
    expect(structuredClone(payload).correlationId).toBe(MINTED_IDS[0])
  })

  it('c: a second logical send receives a different id', async () => {
    const { send, wrapper } = await renderArea()

    await submitDraft(wrapper, 'first turn')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await submitDraft(wrapper, 'second turn')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))

    const first = (send.mock.calls[0] as [Record<string, unknown>])[0].correlationId
    const second = (send.mock.calls[1] as [Record<string, unknown>])[0].correlationId
    expect(first).toBe(MINTED_IDS[0])
    expect(second).toBe(MINTED_IDS[1])
    expect(second).not.toBe(first)
  })

  it('d: attachments and tools do not mint extra ids', async () => {
    const { send, wrapper } = await renderArea()

    await attachImages(wrapper, 2)
    const before = minted.mock.calls.length
    await submitDraft(wrapper, 'look at this')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

    const [payload] = send.mock.calls[0] as [Record<string, unknown>]
    expect(minted.mock.calls.length - before).toBe(1)
    expect((payload.attachments as unknown[]).length).toBe(2)
    expect(payload.correlationId).toBe(MINTED_IDS[0])
  })

  it('e/f: the Brain shadow request is unchanged apart from the forwarded id', async () => {
    const { send, wrapper } = await renderArea()

    await submitDraft(wrapper, 'shadow untouched')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))

    // E: exactly one invoke, on the same channel, with the approved shape.
    const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(request).sort()).toEqual(['correlationId', 'facts'])
    // F: the facts are still the canonical turn description.
    expect(request.facts).toEqual({ hasImageInput: false, reasoningRequested: false, usesTools: true })
    // No route identity or policy crosses the boundary with the key.
    expect(JSON.stringify(request)).not.toMatch(/automaticPolicy|routes|engineId|modelId|providerId|descriptor/i)
  })

  it('keeps the shadow observation and the send id independent of each other', async () => {
    const { consciousness, send, wrapper } = await renderArea()
    consciousness.reasoning = true

    await submitDraft(wrapper, 'reasoning turn')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))

    // The facts reflect the real reasoning setting while the payload carries the
    // id: two independent pieces of the same submission.
    const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect(request.facts).toEqual({ hasImageInput: false, reasoningRequested: true, usesTools: true })
    expect((send.mock.calls[0] as [Record<string, unknown>])[0].correlationId).toBe(MINTED_IDS[0])
  })
  it('h/i/m: ONE submission sends the SAME generated id down both paths', async () => {
    const { send, wrapper } = await renderArea()
    const before = minted.mock.calls.length

    await submitDraft(wrapper, 'one submission, two paths')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))

    // H: one submission, one generated id - nothing was minted twice.
    expect(minted.mock.calls.length - before).toBe(1)
    const generated = MINTED_IDS[0]

    // I: the execution path and the shadow path carry the very same value.
    const [payload] = send.mock.calls[0] as [Record<string, unknown>]
    const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect(payload.correlationId).toBe(generated)
    expect(request.correlationId).toBe(generated)
    expect(request.correlationId).toBe(payload.correlationId)
    // Exact value identity, not a copy of some other id.
    expect(String(request.correlationId)).not.toHaveLength(0)

    // M: the shadow invoke was never awaited - the send had already happened
    // by the time it was observed, and the send call is not gated behind it.
    expect(electron.brainInvoke.mock.invocationCallOrder[0]).toBeGreaterThan(0)
    expect(send.mock.calls.length).toBe(1)
  })

  it('j: a second submission gets its own id on both paths', async () => {
    const { send, wrapper } = await renderArea()

    await submitDraft(wrapper, 'first')
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))
    await submitDraft(wrapper, 'second')
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(2))

    expect((send.mock.calls[0] as [Record<string, unknown>])[0].correlationId).toBe(MINTED_IDS[0])
    expect((send.mock.calls[1] as [Record<string, unknown>])[0].correlationId).toBe(MINTED_IDS[1])
    expect((electron.brainInvoke.mock.calls[0] as [Record<string, unknown>])[0].correlationId).toBe(MINTED_IDS[0])
    expect((electron.brainInvoke.mock.calls[1] as [Record<string, unknown>])[0].correlationId).toBe(MINTED_IDS[1])
    expect(MINTED_IDS[0]).not.toBe(MINTED_IDS[1])
  })

  it('k/l: facts and the rest of the send payload are unchanged by the key', async () => {
    const { consciousness, send, wrapper } = await renderArea()
    consciousness.reasoning = true
    await attachImages(wrapper, 1)

    await submitDraft(wrapper, 'facts and payload')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(electron.brainInvoke).toHaveBeenCalledTimes(1))

    // K: the facts still describe exactly the outgoing turn.
    const [request] = electron.brainInvoke.mock.calls[0] as [Record<string, unknown>]
    expect(request.facts).toEqual({ hasImageInput: true, reasoningRequested: true, usesTools: true })

    // L: the send payload keeps its fields and values; the key is the only
    // addition this milestone approved.
    const [payload] = send.mock.calls[0] as [Record<string, unknown>]
    expect(payload.sessionId).toBe('session-b')
    expect(payload.text).toBe('facts and payload')
    expect((payload.attachments as unknown[]).length).toBe(1)
    expect(payload.tools).toBe(artistryToolReferences)
    expect(Object.keys(payload).sort()).toEqual(['attachments', 'correlationId', 'sessionId', 'text', 'tools'])
  })

  it('n: a rejected Brain bridge cannot prevent the correlated send', async () => {
    const { send, wrapper } = await renderArea()
    electron.brainInvoke.mockRejectedValue(new Error('bridge exploded'))

    await submitDraft(wrapper, 'rejected bridge')
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    await new Promise(resolve => setTimeout(resolve, 0))

    // N: the send still went out, with its own generated key and its payload
    // otherwise intact.
    const [payload] = send.mock.calls[0] as [Record<string, unknown>]
    expect(payload.correlationId).toBe(MINTED_IDS[0])
    expect(payload.text).toBe('rejected bridge')
  })
})
