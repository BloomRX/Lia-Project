import type { LiaProductConfig } from './lia-schema'

import { env } from 'node:process'

import { withProductConfigWriteLock } from '@lia/core/product/config'
import { parse } from 'valibot'

import { createConfig } from '../libs/electron/persistence'
import { defaultLiaProductConfig, liaProductConfigSchema } from './lia-schema'

export * from './lia-schema'

/**
 * Uses the Launcher-owned product path in managed mode and userData in standalone mode.
 *
 * Because the schema fixes `schemaVersion` to the supported literal, a file from
 * a newer/unknown schema fails validation and `createConfig` auto-heals it back
 * to the default (keeping a `.bak`). This satisfies "validate the version now"
 * without a migration engine; a migration framework only becomes necessary once
 * a second real schema version exists.
 */
export function createLiaProductConfig() {
  const filePath = env.LIA_PRODUCT_CONFIG_FILE?.trim() || undefined
  const config = createConfig('lia', 'product.json', liaProductConfigSchema, {
    default: defaultLiaProductConfig,
    autoHeal: filePath === undefined,
    filePath,
  })
  config.setup()
  let transactions: Promise<void> = Promise.resolve()

  return {
    ...config,
    updateAndSave(mutator: (current: LiaProductConfig) => LiaProductConfig): Promise<void> {
      const run = async () => {
        await config.flush()
        if (filePath) {
          const { status } = config.setup()
          if (status !== 'ok' && status !== 'missing')
            throw new Error('Managed product configuration is unavailable')
        }
        // Only committed state is visible through get(). A rejected candidate
        // never becomes the input of a later sibling transaction.
        const current = structuredClone(config.get() ?? defaultLiaProductConfig)
        const candidate = parse(liaProductConfigSchema, mutator(current))
        await config.commit(candidate)
      }
      const transact = filePath ? () => withProductConfigWriteLock(run) : run
      const next = transactions.then(transact, transact)
      transactions = next
      void next.catch(() => {})
      return next
    },
  }
}
