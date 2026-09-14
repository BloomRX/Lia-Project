import { cwd } from 'node:process'

import vue from '@vitejs/plugin-vue'
import Info from 'unplugin-info/vite'

import { loadEnv } from 'vite'
import { defineProject } from 'vitest/config'

/**
 * Diagnostic-only project, used by `DiagnoseLiaProvider.ps1`.
 *
 * Kept separate from `vitest.node.config.ts` on purpose: the probe file is not a
 * `.test.ts`, so the regular suites never collect it, and this config collects
 * nothing else. The `Info()` plugin is required because stage-ui imports the
 * virtual `~build` module.
 */
export default defineProject({
  root: import.meta.dirname,
  plugins: [Info(), vue()],
  test: {
    name: 'stage-tamagotchi:diagnose',
    env: loadEnv('test', cwd(), ''),
    include: ['scripts/diagnose-lia-provider.probe.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
})
