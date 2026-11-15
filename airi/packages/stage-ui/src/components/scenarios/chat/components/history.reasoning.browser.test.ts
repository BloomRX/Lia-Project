import type { StreamingAssistantMessage } from '../../../../types/chat'

import en from '@proj-airi/i18n/locales/en'

import { createPinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { createI18n } from 'vue-i18n'

import ChatHistory from './history.vue'

import { resetLiaCapabilitySnapshotForTesting, setLiaCapabilitySnapshot } from '../../../../libs/capabilities/lia-capability-port'
import { useSettingsDeveloper } from '../../../../stores/settings/developer'

function assistant(id: string): StreamingAssistantMessage {
  return {
    id,
    role: 'assistant',
    content: `Final answer ${id}`,
    slices: [{ type: 'text', text: `Final answer ${id}` }],
    tool_results: [],
    categorization: { speech: `Final answer ${id}`, reasoning: `QA_INTERNAL_REASONING_${id}` },
  }
}

function plugins() {
  const pinia = createPinia()
  const developer = useSettingsDeveloper(pinia)
  developer.showChatReasoning = false
  return {
    developer,
    plugins: [pinia, createI18n({ legacy: false, locale: 'en', messages: { en } })],
  }
}

afterEach(() => resetLiaCapabilitySnapshotForTesting())

describe('chat reasoning visibility', () => {
  it('hides stored and streaming reasoning through the explicit host policy, without changing either message', async () => {
    resetLiaCapabilitySnapshotForTesting()
    const stored = assistant('stored')
    const streaming = assistant('stream')
    const original = JSON.stringify([stored, streaming])
    const context = plugins()
    const screen = await render(ChatHistory, {
      props: {
        messages: [stored],
        sending: true,
        streamingMessage: streaming,
        reasoningVisibility: 'hidden',
        style: 'height: 480px; width: 480px;',
      },
      global: { plugins: context.plugins },
    })

    await vi.waitFor(() => expect(screen.container.textContent).toContain('Final answer stream'))
    expect(screen.container.textContent).toContain('Final answer stored')
    expect(screen.container.textContent).not.toContain('QA_INTERNAL_REASONING_')

    await screen.rerender({ reasoningVisibility: 'visible' })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('QA_INTERNAL_REASONING_stored'))
    expect(screen.container.textContent).toContain('QA_INTERNAL_REASONING_stream')
    await screen.rerender({ reasoningVisibility: 'hidden' })
    await vi.waitFor(() => expect(screen.container.textContent).not.toContain('QA_INTERNAL_REASONING_'))
    expect(JSON.stringify([stored, streaming])).toBe(original)
  })

  it.each([undefined, 'auto'] as const)('preserves standalone reasoning when visibility is %s', async (reasoningVisibility) => {
    resetLiaCapabilitySnapshotForTesting()
    const context = plugins()
    const screen = await render(ChatHistory, {
      props: { messages: [assistant('standalone')], reasoningVisibility, style: 'height: 240px; width: 480px;' },
      global: { plugins: context.plugins },
    })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('QA_INTERNAL_REASONING_standalone'))
    expect(context.developer.showChatReasoning).toBe(false)
  })

  it('keeps the managed auto policy and reacts to the existing developer flag', async () => {
    setLiaCapabilitySnapshot({ voice: { configured: false, available: false }, avatar: { available: false } })
    const context = plugins()
    const screen = await render(ChatHistory, {
      props: { messages: [assistant('managed')], reasoningVisibility: 'auto', style: 'height: 240px; width: 480px;' },
      global: { plugins: context.plugins },
    })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('Final answer managed'))
    expect(screen.container.textContent).not.toContain('QA_INTERNAL_REASONING_managed')
    context.developer.showChatReasoning = true
    await vi.waitFor(() => expect(screen.container.textContent).toContain('QA_INTERNAL_REASONING_managed'))
    context.developer.showChatReasoning = false
    await vi.waitFor(() => expect(screen.container.textContent).not.toContain('QA_INTERNAL_REASONING_managed'))
  })

  it('honors an explicit visible policy when the automatic managed policy would hide reasoning', async () => {
    setLiaCapabilitySnapshot({ voice: { configured: false, available: false }, avatar: { available: false } })
    const context = plugins()
    const screen = await render(ChatHistory, {
      props: { messages: [assistant('explicit')], reasoningVisibility: 'visible', style: 'height: 240px; width: 480px;' },
      global: { plugins: context.plugins },
    })
    await vi.waitFor(() => expect(screen.container.textContent).toContain('QA_INTERNAL_REASONING_explicit'))
    expect(context.developer.showChatReasoning).toBe(false)
  })
})
