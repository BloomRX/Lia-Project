<script setup lang="ts">
import AccountSettingsPage from '@proj-airi/stage-pages/pages/settings/account/account-settings-page.vue'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { signOut } from '@proj-airi/stage-ui/libs/auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { electronAuthLogout, electronAuthStartLogin } from '../../../../shared/eventa'

const router = useRouter()
const auth = useAuthStore()
const { t } = useI18n()
const startLogin = useElectronEventaInvoke(electronAuthStartLogin)
const logout = useElectronEventaInvoke(electronAuthLogout)

async function handleLogin() {
  if (auth.oidcEnabled)
    await startLogin()
}

async function handleLogout() {
  try {
    await logout()
  }
  finally {
    await signOut()
    await router.push('/settings')
  }
}
</script>

<template>
  <AccountSettingsPage v-if="auth.oidcEnabled" @login="handleLogin" @logout="handleLogout" />
  <p v-else role="status">
    {{ t('tamagotchi.stage.controls-island.account-unavailable') }}
  </p>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.account.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.account.description
  icon: i-solar:user-circle-bold-duotone
  settingsEntry: false
  order: 0
  stageTransition:
    name: slide
</route>
