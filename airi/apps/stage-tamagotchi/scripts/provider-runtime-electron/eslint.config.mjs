/**
 * Local per-folder ESLint profile for the Electron gate harness.
 *
 * The repository-wide config is inherited unchanged; the overrides below exist
 * for reasons specific to a standalone `node --test` harness, and each one is
 * narrower than it looks.
 */

import repositoryConfig from '../../../../eslint.config.ts'

const inherited = await repositoryConfig

/**
 * The repository's "omit source extensions" rule. Kept as a value so it can be
 * removed *only* for the `.mjs` files below, where Node's ESM resolver rejects a
 * relative import that omits `.mjs`. The rule is right for the bundler-facing
 * code and wrong here; the folder's own config already took the same exemption
 * for itself.
 */
const extensionRuleOwner = inherited.find(config => Array.isArray(config.rules?.['no-restricted-syntax'])
  && config.rules['no-restricted-syntax'].some(rule => rule?.message?.startsWith('Omit TypeScript and JavaScript source extensions')))

if (!extensionRuleOwner)
  throw new Error('Repository import policy was not found; review the Electron gate lint profile.')

const withoutExtensionRule = extensionRuleOwner.rules['no-restricted-syntax']
  .filter(rule => !rule?.message?.startsWith('Omit TypeScript and JavaScript source extensions'))

export default [
  ...inherited,
  {
    files: ['apps/stage-tamagotchi/scripts/provider-runtime-electron/eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': withoutExtensionRule,
    },
  },
  {
    /**
     * A `node --test` harness cannot import from `vitest`: it has to run under
     * plain `node`, and it must skip itself outside Windows rather than fail to
     * resolve. The rule exists to keep product tests on the project runner; this
     * folder is tooling, and the exemption is the whole point of the folder.
     */
    files: ['apps/stage-tamagotchi/scripts/provider-runtime-electron/**/*.test.mjs'],
    rules: {
      'test/no-import-node-test': 'off',
    },
  },
  {
    /**
     * Node ESM requires an explicit extension on a relative specifier. Applies
     * to every module in this folder, not only the tests, because the gate and
     * its `lib/` helpers are plain `.mjs` executed by `node`.
     */
    files: ['apps/stage-tamagotchi/scripts/provider-runtime-electron/**/*.mjs'],
    rules: {
      'no-restricted-syntax': withoutExtensionRule,
    },
  },
]
