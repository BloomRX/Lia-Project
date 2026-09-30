import { cwd } from 'node:process'
import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import UnoCss from 'unocss/vite'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { playwright } from '@vitest/browser-playwright'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    Info(),
    vue(),
    UnoCss(),
    Yaml(),
  ],
  resolve: {
    alias: {
      '@lia/core': resolve(import.meta.dirname, '../../packages/lia-core/src'),
      '@proj-airi/i18n': resolve(import.meta.dirname, '../../packages/i18n/src'),
      '@proj-airi/server-sdk-shared': resolve(import.meta.dirname, '../../server/packages/server-sdk-shared/src'),
      '@proj-airi/server-shared': resolve(import.meta.dirname, '../../packages/server-shared/src'),
      '@proj-airi/electron-eventa': resolve(import.meta.dirname, '../../packages/electron-eventa/src'),
      '@proj-airi/stage-ui': resolve(import.meta.dirname, '../../packages/stage-ui/src'),
    },
  },
  test: {
    env: loadEnv('test', cwd(), ''),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts', '**/node_modules/**', '**/.git/**'],
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          exclude: ['**/node_modules/**', '**/.git/**'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              { browser: 'chromium' },
            ],
          },
        },
      },
    ],
  },
})
