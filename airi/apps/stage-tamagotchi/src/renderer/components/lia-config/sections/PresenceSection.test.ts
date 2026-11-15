import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { createI18n } from 'vue-i18n'
import { renderToString } from 'vue/server-renderer'

import PresenceSection from './PresenceSection.vue'

import { defaultPresence } from '../../../../../../../../lia/core/src/presence'
import { useLiaPresenceStore } from '../../../stores/lia/presence'

vi.mock('@proj-airi/electron-vueuse', () => ({ useElectronEventaInvoke: () => vi.fn() }))
beforeEach(() => setActivePinia(createPinia()))
async function render(locale = 'pt-BR') {
  return renderToString(createSSRApp(PresenceSection).use(createI18n({ legacy: false, locale })))
}
describe('presence screen', () => {
  it('offers two real modes and only shows movement controls in Free', async () => {
    const store = useLiaPresenceStore()
    store.state = { config: { ...defaultPresence }, displays: [], active: true, fullscreen: false }
    const stationary = await render()
    expect(stationary).toContain('Modo Estático')
    expect(stationary).toContain('Modo Livre')
    expect(stationary).not.toContain('Pausar movimento')
    store.state.config.mode = 'free'
    const free = await render()
    expect(free).toContain('Pausar movimento')
    expect(free).toContain('outros aplicativos e jogos ainda não é detectada')
    expect(free).toContain('Definir posição atual como Home')
  })
  it('renders English and useful connection errors', async () => {
    const store = useLiaPresenceStore()
    store.error = true
    const html = await render('en')
    expect(html).toContain('Could not update presence')
    expect(html).toContain('Try again')
  })
})
