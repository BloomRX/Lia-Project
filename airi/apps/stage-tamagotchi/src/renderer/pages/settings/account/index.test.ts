// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import Account from './index.vue'

const fixture = vi.hoisted(() => ({
  enabled: true,
  cancelLogin: vi.fn(),
  signOut: vi.fn(),
  push: vi.fn(),
}))

vi.mock('../../../../shared/eventa', () => ({
  electronAuthLogout: 'logout',
  electronAuthStartLogin: 'start',
}))
vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (event: string) => event === 'logout' ? fixture.cancelLogin : vi.fn(),
}))
vi.mock('@proj-airi/stage-ui/libs/auth', () => ({ signOut: fixture.signOut }))
vi.mock('@proj-airi/stage-ui/stores/auth', () => ({ useAuthStore: () => ({ oidcEnabled: fixture.enabled }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: fixture.push }) }))
vi.mock('@proj-airi/stage-pages/pages/settings/account/account-settings-page.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      emits: ['logout'],
      setup: (_, { emit }) => () => h('button', { onClick: () => emit('logout') }),
    }),
  }
})

it('shows unavailable account status without mounting login or logout when OIDC is off', () => {
  fixture.enabled = false
  const host = document.createElement('div')
  const app = createApp(Account)
  app.mount(host)
  try {
    expect(host.querySelector('button')).toBeNull()
    expect(host.querySelector('[role="status"]')?.textContent).toContain('account-unavailable')
  }
  finally {
    app.unmount()
    fixture.enabled = true
  }
})

it('cancels the pending Main login before starting legacy server logout', async () => {
  const cancellation = Promise.withResolvers<void>()
  const navigated = Promise.withResolvers<void>()
  fixture.cancelLogin.mockReturnValue(cancellation.promise)
  fixture.push.mockImplementation(() => navigated.resolve())
  const host = document.createElement('div')
  const app = createApp(Account)
  app.mount(host)

  try {
    host.querySelector('button')!.click()
    expect(fixture.cancelLogin).toHaveBeenCalledOnce()
    expect(fixture.signOut).not.toHaveBeenCalled()
    cancellation.resolve()
    await navigated.promise
    expect(fixture.signOut).toHaveBeenCalledOnce()
    expect(fixture.push).toHaveBeenCalledExactlyOnceWith('/settings')
  }
  finally {
    app.unmount()
  }
})
