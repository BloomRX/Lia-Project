<script setup lang="ts">
import type { LiaApi } from '../../../preload'

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { pickVoiceEngineLocale } from '../voice-engine-strings'
import LiaButton from './lia/LiaButton.vue'
import LiaPanel from './lia/LiaPanel.vue'

const props = defineProps<{
  api?: Pick<LiaApi, 'oidcStatus' | 'oidcLogin' | 'oidcCancel' | 'oidcProfile' | 'oidcLogout'>
  language?: string
}>()
const copy = computed(() => pickVoiceEngineLocale(props.language) === 'en-US'
  ? {
      title: 'Account', signIn: 'Sign in', cancel: 'Cancel sign-in', signOut: 'Sign out', retry: 'Try again',
      loading: 'Checking the session…', browser: 'Complete sign-in in your browser.', signedOut: 'You are signed out.',
      failed: 'Could not complete the account operation. Try again.',
      revocation: 'Signed out on this device. The server did not confirm revocation.',
    }
  : {
      title: 'Conta', signIn: 'Entrar', cancel: 'Cancelar entrada', signOut: 'Sair da conta', retry: 'Tentar novamente',
      loading: 'Verificando a sessão…', browser: 'Conclua a entrada no navegador.', signedOut: 'Você está desconectado.',
      failed: 'Não foi possível concluir a operação da conta. Tente novamente.',
      revocation: 'Sessão encerrada neste dispositivo. O servidor não confirmou a revogação.',
    })

const available = ref(false)
const profile = ref<{ name: string, email: string }>()
const pending = ref<'profile' | 'login' | 'logout' | ''>('')
const feedback = ref<'failed' | 'revocation' | ''>('')
let mounted = true

async function refreshProfile() {
  const result = await props.api?.oidcProfile()
  if (!mounted)
    return
  if (result?.ok && result.profile)
    profile.value = { name: result.profile.name, email: result.profile.email }
  else if (result?.code === 'unauthenticated')
    profile.value = undefined
  else
    feedback.value = 'failed'
}

async function run(action: Exclude<typeof pending.value, ''>) {
  if (pending.value || !props.api)
    return
  pending.value = action
  feedback.value = ''
  try {
    if (action === 'login') {
      const result = await props.api.oidcLogin()
      if (result?.ok)
        await refreshProfile()
      else if (result?.code !== 'cancelled')
        feedback.value = 'failed'
    }
    else if (action === 'logout') {
      const result = await props.api.oidcLogout()
      if (result?.ok) {
        profile.value = undefined
        if (result.revocation === 'failed')
          feedback.value = 'revocation'
      }
      else {
        await refreshProfile()
        feedback.value = 'failed'
      }
    }
    else {
      await refreshProfile()
    }
  }
  catch {
    feedback.value = 'failed'
  }
  finally {
    pending.value = ''
  }
}

function cancelLogin() {
  void props.api?.oidcCancel().catch(() => { feedback.value = 'failed' })
}

onMounted(async () => {
  try {
    const status = await props.api?.oidcStatus?.()
    if (mounted && status?.ok && status.available) {
      available.value = true
      await run('profile')
    }
  }
  catch { /* The account panel is omitted when the optional service is absent. */ }
})
onBeforeUnmount(() => {
  mounted = false
  if (pending.value === 'login')
    cancelLogin()
})
</script>

<template>
  <LiaPanel v-if="available" aria-labelledby="lia-account-title">
    <h3 id="lia-account-title">
      {{ copy.title }}
    </h3>
    <div role="status">
      <p v-if="pending === 'login'">
        {{ copy.browser }}
      </p>
      <p v-else-if="pending">
        {{ copy.loading }}
      </p>
      <p v-else-if="feedback">
        {{ copy[feedback] }}
      </p>
      <p v-else-if="!profile">
        {{ copy.signedOut }}
      </p>
    </div>
    <p v-if="profile">
      {{ profile.name }} · {{ profile.email }}
    </p>
    <div class="account-actions">
      <LiaButton v-if="pending === 'login'" type="button" @click="cancelLogin">
        {{ copy.cancel }}
      </LiaButton>
      <LiaButton v-else-if="profile" type="button" :disabled="Boolean(pending)" @click="run('logout')">
        {{ copy.signOut }}
      </LiaButton>
      <LiaButton v-else type="button" variant="primary" :disabled="Boolean(pending)" @click="run('login')">
        {{ copy.signIn }}
      </LiaButton>
      <LiaButton v-if="feedback === 'failed'" type="button" :disabled="Boolean(pending)" @click="run('profile')">
        {{ copy.retry }}
      </LiaButton>
    </div>
  </LiaPanel>
</template>

<style scoped>
h3 { margin: 0; }
.account-actions { display: flex; flex-wrap: wrap; gap: var(--lia-space-2); }
</style>
