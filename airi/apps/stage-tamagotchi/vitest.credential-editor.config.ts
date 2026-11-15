import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/** Reuses installed Stage test tools to exercise the shared editor in Chromium. */
export default defineConfig({
  root: resolve(import.meta.dirname, '../../packages/stage-pages'),
  plugins: [Info(), Vue(), Yaml()],
  test: {
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
