<script setup lang="ts">
/**
 * AI section: reuses the existing Lia provider configuration verbatim.
 *
 * No second provider store, no free-text model id, no vault changes - the
 * dropdown/model catalog, fallback and connection test already built and
 * validated stay exactly as they are. `embedded` only hides this component's
 * own back button, because the panel owns navigation.
 */
import LiaProviderConfig from '../../LiaProviderConfig.vue'

import { resolveRendererWindowContext } from '../../../window-context'

const managed = resolveRendererWindowContext().liaManaged
</script>

<template>
  <LiaProviderConfig mode="manage" :embedded="true" :managed="managed" data-testid="lia-config-ai-provider" />
</template>
