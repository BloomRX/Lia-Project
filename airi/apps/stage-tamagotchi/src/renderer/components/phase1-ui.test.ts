import locales from '@proj-airi/i18n/locales'

// @vitest-environment jsdom
import { PiniaColada } from '@pinia/colada'
import { useChatStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { DoubleCheckButton } from '@proj-airi/ui'
import { mount } from '@vue/test-utils'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { createMemoryHistory, createRouter } from 'vue-router'

import InteractiveArea from './InteractiveArea.vue'

const chatBoundary = vi.hoisted(() => ({ hasApiKey: vi.fn(async () => true) }))
vi.mock('../stores/lia/provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stores/lia/provider')>()
  return { ...actual, useLiaProviderStore: () => ({ hasApiKey: chatBoundary.hasApiKey }) }
})

// Internal report: docs/reports/LIA-UI-UX-AUDIT-2026-11-14.md (UI-S01/UI-S02/UI-A02).
// DOM-emulated regression only. Real Chromium/Windows evidence remains a separate gate.
const wrappers: Array<ReturnType<typeof mount>> = []
const pinias: Array<ReturnType<typeof createPinia>> = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0))
    wrapper.unmount()
  for (const pinia of pinias.splice(0))
    disposePinia(pinia)
  window.history.replaceState(null, '', '/')
})

function confirmation() {
  const wrapper = mount(DoubleCheckButton, {
    attachTo: document.body,
    props: {
      label: 'Clear this conversation',
      confirmLabel: 'Confirm clear',
      cancelLabel: 'Cancel',
      description: 'This removes the messages in this conversation. This cannot be undone.',
    },
    slots: { confirm: 'Confirm clear' },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('phase 1 destructive confirmation', () => {
  it('opens without confirmation, focuses cancel, and cancel performs no action', async () => {
    const wrapper = confirmation()
    const confirm = vi.fn()
    const cancel = vi.fn()
    await wrapper.setProps({ onConfirm: confirm, onCancel: cancel })
    const initial = wrapper.get('button[aria-label="Clear this conversation"]')
    await initial.trigger('click')
    expect(confirm).not.toHaveBeenCalled()
    const cancelButton = wrapper.get('button[aria-describedby]')
    expect(document.activeElement).toBe(cancelButton.element)
    const descriptionId = cancelButton.attributes('aria-describedby')
    expect(wrapper.get(`#${descriptionId}`).text()).toContain('cannot be undone')
    await cancelButton.trigger('click')
    await nextTick()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(initial.element)
  })

  it('requires a second explicit action and emits once', async () => {
    const wrapper = confirmation()
    const confirm = vi.fn()
    await wrapper.setProps({ onConfirm: confirm })
    await wrapper.get('button[aria-label="Clear this conversation"]').trigger('click')
    expect(confirm).not.toHaveBeenCalled()
    await wrapper.get('button[aria-label="Confirm clear"]').trigger('click')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(wrapper.find('button[aria-label="Confirm clear"]').exists()).toBe(false)
  })

  it('escape cancels and restores the initial action focus', async () => {
    const wrapper = confirmation()
    const confirm = vi.fn()
    const cancel = vi.fn()
    await wrapper.setProps({ onConfirm: confirm, onCancel: cancel })
    const initial = wrapper.get('button[aria-label="Clear this conversation"]')
    await initial.trigger('click')
    await wrapper.get('button[aria-describedby]').trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(initial.element)
  })

  it('a disabled action cannot open or confirm a destructive choice', async () => {
    const wrapper = confirmation()
    const confirm = vi.fn()
    await wrapper.setProps({ onConfirm: confirm })
    await wrapper.get('button[aria-label="Clear this conversation"]').trigger('click')
    await wrapper.setProps({ disabled: true })
    expect(wrapper.find('button[aria-label="Confirm clear"]').exists()).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('lia chat confirmation seam', () => {
  it('cancel preserves messages and confirmation reaches cleanup once for the active session', async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('synced-leader', 'false')
    url.searchParams.set('stage-runtime', 'minimal')
    url.searchParams.set('lia-managed', 'true')
    window.history.replaceState(null, '', url)
    const pinia = createPinia()
    pinias.push(pinia)
    pinia.state.value = {
      'chat-session-selection': { activeSessionId: 'active-session' },
      'chat-session': {
        sessionMetas: {
          'active-session': { sessionId: 'active-session', userId: 'local', characterId: 'default', createdAt: 1, updatedAt: 1 },
          'other-session': { sessionId: 'other-session', userId: 'local', characterId: 'default', createdAt: 1, updatedAt: 1 },
        },
        sessionMessages: {
          'active-session': [{ id: 'system', role: 'system', content: 'prompt' }, { id: 'message', role: 'user', content: 'Keep this until confirmation' }],
          'other-session': [{ id: 'other-message', role: 'user', content: 'Other conversation' }],
        },
      },
    }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    await router.push('/')
    await router.isReady()
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: locales })
    const wrapper = mount(InteractiveArea, { attachTo: document.body, global: { plugins: [pinia, PiniaColada, i18n, router] } })
    wrappers.push(wrapper)
    const { useBackgroundStore } = await import('@proj-airi/stage-ui/stores/background')
    vi.spyOn(useBackgroundStore(pinia), 'initializeStore').mockImplementation(async () => {})
    const sessions = useChatSessionStore(pinia)
    const chat = useChatStore(pinia)
    const cleanup = vi.spyOn(chat, 'cleanup').mockImplementation(async () => {
      // The orchestrator's cancellation/persistence contract is covered by its
      // own tests. Here only the UI gate is under test; do not start IDB writes.
    })
    const initial = wrapper.get('button[aria-label="Clear this conversation"]')
    await initial.trigger('click')
    expect(cleanup).not.toHaveBeenCalled()
    expect(sessions.getSessionMessages('active-session')).toHaveLength(2)
    await wrapper.get('button[aria-describedby]').trigger('click')
    expect(cleanup).not.toHaveBeenCalled()
    expect(sessions.getSessionMessages('active-session')).toHaveLength(2)
    await initial.trigger('click')
    await wrapper.get('button[aria-label="Confirm clear"]').trigger('click')
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1))
    expect(cleanup).toHaveBeenCalledWith('active-session')
    expect(sessions.getSessionMessages('active-session')).toHaveLength(2)
    expect(sessions.getSessionMessages('other-session')[0].content).toBe('Other conversation')
  })
})
