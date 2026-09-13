import { createConfig } from '../libs/electron/persistence'
import { defaultLiaProductConfig, liaProductConfigSchema } from './lia-schema'

export * from './lia-schema'

/**
 * Creates the Lia product config at `userData/lia-product.json`.
 *
 * Because the schema fixes `schemaVersion` to the supported literal, a file from
 * a newer/unknown schema fails validation and `createConfig` auto-heals it back
 * to the default (keeping a `.bak`). This satisfies "validate the version now"
 * without a migration engine; a migration framework only becomes necessary once
 * a second real schema version exists.
 */
export function createLiaProductConfig() {
  const config = createConfig('lia', 'product.json', liaProductConfigSchema, {
    default: defaultLiaProductConfig,
    autoHeal: true,
  })
  config.setup()

  return config
}
