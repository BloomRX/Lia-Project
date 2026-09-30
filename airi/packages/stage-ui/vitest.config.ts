import { cwd } from 'node:process'
import { resolve } from 'node:path'

import Vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'
import Yaml from 'unplugin-yaml/vite'

import { playwright } from '@vitest/browser-playwright'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    Info(),
    Vue(),
    Yaml(),
  ],
  resolve: {
    alias: {
      '@lia/core': resolve(import.meta.dirname, '../lia-core/src'),
      '@proj-airi/i18n': resolve(import.meta.dirname, '../i18n/src'),
      '@proj-airi/server-sdk-shared': resolve(import.meta.dirname, '../../server/packages/server-sdk-shared/src'),
      '@proj-airi/server-shared': resolve(import.meta.dirname, '../server-shared/src'),
      '@proj-airi/electron-eventa': resolve(import.meta.dirname, '../electron-eventa/src'),
    },
  },
  test: {
    env: loadEnv('test', cwd(), ''),
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          fileParallelism: false,
          hookTimeout: 20_000,
          maxWorkers: 1,
          testTimeout: 20_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          exclude: ['**/node_modules/**'],
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
