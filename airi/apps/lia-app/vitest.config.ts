import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * O mesmo alias do `electron.vite.config.ts`, para que os testes exercitem a
 * superfície pública (`@lia/contracts/...`) e não um caminho que só existe
 * dentro do bundler.
 */
const liaContracts = resolve(import.meta.dirname, '..', '..', '..', 'lia', 'core', 'src')

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@lia\/contracts$/, replacement: resolve(liaContracts, 'index.ts') },
      { find: '@lia/contracts', replacement: liaContracts },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
})
