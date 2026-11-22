import { createApp } from 'vue'

import App from './App.vue'

import './styles.css'
// Phase 8.0A-1: the semantic design-token layer (foundation only - no
// existing rule is replaced, nothing re-skins current screens).
import './styles/lia-tokens.css'

createApp(App).mount('#app')
