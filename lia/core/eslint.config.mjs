// Temporary repository tooling only; the native provider runtime has no imports
// from airi/. Node's strip-types runner requires explicit .ts extensions.
import repositoryConfig from '../../airi/eslint.config.ts'

const inherited = await repositoryConfig
const owner = inherited.find(config => Array.isArray(config.rules?.['no-restricted-syntax'])
  && config.rules['no-restricted-syntax'].some(rule => rule?.message?.startsWith('Omit TypeScript and JavaScript source extensions')))
if (!owner)
  throw new Error('Repository import policy was not found; review the native Node lint profile.')

export default [
  ...inherited,
  {
    files: ['lia/core/src/providers/**/*.ts', 'lia/core/src/transports/**/*.ts', 'lia/core/test/providers*.test.ts', 'lia/core/test/transports.test.ts', 'lia/core/eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': owner.rules['no-restricted-syntax'].filter(rule => !rule?.message?.startsWith('Omit TypeScript and JavaScript source extensions')),
    },
  },
  { files: ['lia/core/test/providers*.test.ts', 'lia/core/test/transports.test.ts'], rules: { 'test/no-import-node-test': 'off' } },
]
