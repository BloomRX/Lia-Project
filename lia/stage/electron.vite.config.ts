import { fileURLToPath } from 'node:url'

import { defineConfig } from 'electron-vite'

const electronExternals = ['electron', /^electron\/.+/]

export default defineConfig({
  main: {
    build: { rolldownOptions: { external: electronExternals } },
  },
  preload: {
    build: { rolldownOptions: { external: electronExternals, output: { format: 'cjs' } } },
  },
  renderer: {
    build: {
      rolldownOptions: {
        input: {
          index: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
          presence: fileURLToPath(new URL('./src/renderer/presence.html', import.meta.url)),
        },
      },
    },
  },
})
