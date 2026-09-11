import type { Plugin } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

import Tres from '@tresjs/core'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { PiniaColada } from '@pinia/colada'
import { trackButtonPlugin } from '@proj-airi/stage-ui/directives/track-button'
import { configureAnalyticsAdapter } from '@proj-airi/stage-ui/libs/analytics'
import { browserAuthorizationHandler, registerAuthorizationHandler } from '@proj-airi/stage-ui/libs/auth'
import { piniaPluginTracing, setupSynced } from '@proj-airi/stage-ui/libs/pinia'
import { MotionPlugin } from '@vueuse/motion'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'

import App from './App.vue'

import { installRealChatObserver } from './diagnostics/real-chat-observer'
import { i18n } from './modules/i18n'
import { resolveRendererWindowContext } from './window-context'

import '@unocss/reset/tailwind.css'
import 'splitpanes/dist/splitpanes.css'
import 'vue-sonner/style.css'
import './styles/main.css'
import 'uno.css'
// Fonts
import '@proj-airi/font-cjkfonts-allseto/index.css'
import '@proj-airi/font-xiaolai/index.css'
import '@fontsource-variable/dm-sans/index.css'
import '@fontsource-variable/jura/index.css'
import '@fontsource-variable/quicksand/index.css'
import '@fontsource-variable/urbanist/index.css'
import '@fontsource-variable/comfortaa/index.css'
import '@fontsource/dm-mono/index.css'
import '@fontsource/dm-serif-display/index.css'
import '@fontsource/gugi/index.css'
import '@fontsource/kiwi-maru/index.css'
import '@fontsource/m-plus-rounded-1c/index.css'
import '@fontsource-variable/nunito/index.css'

configureAnalyticsAdapter(async (options) => {
  const { createPosthogAdapter } = await import('@proj-airi/stage-ui/libs/analytics/posthog')
  return createPosthogAdapter(options)
})
registerAuthorizationHandler(browserAuthorizationHandler)

// TEMPORARY read-only 401 diagnostic. Passive: it wraps fetch to record request
// metadata and forwards every call untouched. Active in dev, or in a packaged
// build after `localStorage.setItem('lia:diag:real-chat', '1')` + reload.
// Remove together with ./diagnostics/real-chat-observer once the 401 is traced.
try {
  if (import.meta.env.DEV || globalThis.localStorage?.getItem('lia:diag:real-chat') === '1')
    installRealChatObserver(globalThis as unknown as Window)
}
catch (error) {
  console.warn('[LIA-DIAG] observer not installed:', error)
}

const pinia = createPinia()
const synced = setupSynced({
  leadership: resolveRendererWindowContext().leadership,
})
pinia.use(synced.pinia)
if (import.meta.env.DEV)
  pinia.use(piniaPluginTracing)

const router = createRouter({
  history: createWebHashHistory(),
  // TODO: vite-plugin-vue-layouts is long deprecated, replace with another layout solution
  routes: setupLayouts(routes as RouteRecordRaw[]),
})

if (import.meta.hot) {
  handleHotUpdate(router, (updatedRoutes) => {
    router.clearRoutes()
    for (const route of setupLayouts(updatedRoutes))
      router.addRoute(route)
  })
}

createApp(App)
  .use(synced.vue)
  .use(MotionPlugin)
  // TODO: Fix autoAnimatePlugin type error
  .use(autoAnimatePlugin as unknown as Plugin)
  .use(router)
  .use(pinia)
  .use(PiniaColada)
  .use(i18n)
  .use(Tres)
  .use(trackButtonPlugin)
  .mount('#app')
