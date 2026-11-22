import { defineConfig } from 'electron-vite'

const electronExternals = ['electron', /^electron\/.+/]

export default defineConfig({
  main: {
    build: { rolldownOptions: { external: electronExternals } },
  },
  preload: {
    build: { rolldownOptions: { external: electronExternals, output: { format: 'cjs' } } },
  },
  renderer: {},
})
