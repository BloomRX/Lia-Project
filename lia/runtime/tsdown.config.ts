import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    './src/index.ts',
    './src/bootstrap/runtime-root.ts',
    './src/bridge/lia-config.ts',
    './src/voice/config.ts',
    './src/voice/engines/kokoro/index.ts',
    './src/voice/engines/registry.ts',
    './src/voice/engines/types.ts',
    './src/voice/voice-service.ts',
    './src/paths/product-paths.ts',
    './src/paths/install-location.ts',
    './src/product/config.ts',
    './src/secrets/oidc-account.ts',
    './src/secrets/oidc-login.ts',
    './src/secrets/oidc-session.ts',
    './src/secrets/vault.ts',
    './src/secrets/windows-user-cipher.ts',
    './src/voice/shared.ts',
    './src/voices/profiles.ts',
    './src/voices/types.ts',
  ],
  dts: true,
  format: 'esm',
})
