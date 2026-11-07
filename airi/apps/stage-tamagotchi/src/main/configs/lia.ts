import type { LiaProductConfig } from './lia-schema'

import { parse } from 'valibot'

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
  let transactions: Promise<void> = Promise.resolve()

  return {
    ...config,
    updateAndSave(mutator: (current: LiaProductConfig) => LiaProductConfig): Promise<void> {
      const run = async () => {
        await config.flush()
        // Only committed state is visible through get(). A rejected candidate
        // never becomes the input of a later sibling transaction.
        const current = structuredClone(config.get() ?? defaultLiaProductConfig)
        const candidate = parse(liaProductConfigSchema, mutator(current))
        await config.commit(candidate)
      }
      const next = transactions.then(run, run)
      transactions = next
      void next.catch(() => {})
      return next
    },
  }
}
