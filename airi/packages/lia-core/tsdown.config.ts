import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './src/index.ts',
    './src/alltalk/client.ts',
    './src/alltalk/custom-voice-engine-restart.ts',
    './src/alltalk/custom-voice-prepare.ts',
    './src/alltalk/engine-config.ts',
    './src/alltalk/port-diagnostics.ts',
    './src/alltalk/port-listeners.ts',
    './src/alltalk/runtime.ts',
    './src/alltalk/shutdown.ts',
    './src/bootstrap/archive-path.ts',
    './src/bootstrap/bootstrap.ts',
    './src/bootstrap/env.ts',
    './src/bootstrap/install-exec.ts',
    './src/bootstrap/runtime-root.ts',
    './src/bridge/lia-config.ts',
    './src/paths/product-paths.ts',
    './src/product/config.ts',
    './src/secrets/vault.ts',
    './src/voice/shared.ts',
    './src/voices/profiles.ts',
    './src/voices/types.ts',
  ],
  dts: true,
  format: 'esm',
})
