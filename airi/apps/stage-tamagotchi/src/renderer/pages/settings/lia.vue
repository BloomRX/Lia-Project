<script setup lang="ts">
import { useRouter } from 'vue-router'

import LiaConfigPanel from '../../components/lia-config/LiaConfigPanel.vue'

const router = useRouter()
</script>

<template>
  <div class="pb-6">
    <LiaConfigPanel @back="router.push('/settings')" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.home.config.title
  subtitleKey: settings.title
  icon: i-solar:heart-angle-bold-duotone
  settingsEntry: true
  order: -1
</route>
