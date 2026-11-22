import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'

import { defineConfig } from 'electron-vite'

/**
 * `@lia/contracts` é o pacote de contratos que vive FORA do workspace pnpm
 * (`lia/core`). A resolução é por alias para o código-fonte — o mesmo arquivo que
 * o pacote publica em `exports`. O efeito prático é o que importa: nenhum
 * consumidor escreve caminho relativo, e o bundler inlina o contrato.
 */
const liaContracts = resolve(import.meta.dirname, '..', '..', '..', 'lia', 'core', 'src')

/**
 * The Electron MODULE boundary (Windows boot hotfix 2, Phase 7.1).
 *
 * `import { app, ... } from 'electron'` must resolve to the Electron
 * RUNTIME built-in - the app the Electron binary hands us - and never to
 * the npm `electron` package on disk. Bundling the npm package drags its
 * binary-install loader (getElectronPath, install.js, path.txt, "Electron
 * failed to install correctly") into the shipped main, where it promptly
 * downloads nothing and kills the launcher's first boot.
 *
 * Two concrete choices, both evidence-driven:
 *
 * - `rolldownOptions`, not the deprecated `rollupOptions`: under
 *   rolldown-vite (Vite 8) the legacy key was silently ignored here -
 *   externals declared through it (including electron-vite's own default)
 *   never took effect, which is how the loader got bundled at all;
 * - no legacy externalize-deps helper plugin: it is deprecated upstream
 *   AND its mere presence suppresses electron-vite's built-in
 *   `build.externalizeDeps` hook, removing the one net that
 *   re-externalizes dependencies. Our
 *   product deps (@lia/core, vue) bundle into the main on purpose - the
 *   dev/packaged boundary stays a single, inspectable file.
 */

const ELECTRON_EXTERNALS = ['electron', /^electron\/.+/, 'original-fs']

export default defineConfig({
  main: {
    resolve: {
      alias: [
        { find: /^@lia\/contracts$/, replacement: resolve(liaContracts, 'index.ts') },
        { find: '@lia/contracts', replacement: liaContracts },
      ],
    },
    build: {
      rolldownOptions: {
        external: ELECTRON_EXTERNALS,
        output: { format: 'es' },
      },
    },
  },
  preload: {
    resolve: {
      alias: [
        { find: /^@lia\/contracts$/, replacement: resolve(liaContracts, 'index.ts') },
        { find: '@lia/contracts', replacement: liaContracts },
      ],
    },
    build: {
      rolldownOptions: {
        external: ELECTRON_EXTERNALS,
        output: { format: 'cjs' },
      },
    },
  },
  renderer: {
    plugins: [vue()],
    resolve: {
      alias: [
        { find: /^@lia\/contracts$/, replacement: resolve(liaContracts, 'index.ts') },
        { find: '@lia/contracts', replacement: liaContracts },
      ],
    },
  },
})
