import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './src/index.ts',
    './src/bootstrap/runtime-root.ts',
    './src/bridge/lia-config.ts',
    './src/voice/config.ts',
    './src/voice/engines/types.ts',
    './src/voice/voice-service.ts',
    './src/paths/product-paths.ts',
    './src/paths/install-location.ts',
    './src/product/config.ts',
    './src/secrets/vault.ts',
    './src/voice/shared.ts',
    './src/voices/profiles.ts',
    './src/voices/types.ts',
  ],
  dts: true,
  format: 'esm',
})
