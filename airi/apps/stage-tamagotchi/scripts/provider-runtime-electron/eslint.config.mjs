import repositoryConfig from '../../../../eslint.config.ts'

const inherited = await repositoryConfig
const owner = inherited.find(config => Array.isArray(config.rules?.['no-restricted-syntax'])
  && config.rules['no-restricted-syntax'].some(rule => rule?.message?.startsWith('Omit TypeScript and JavaScript source extensions')))
if (!owner)
  throw new Error('Repository import policy was not found; review the Electron gate lint profile.')

export default [
  ...inherited,
  {
    files: ['apps/stage-tamagotchi/scripts/provider-runtime-electron/eslint.config.mjs'],
    rules: {
      'no-restricted-syntax': owner.rules['no-restricted-syntax'].filter(rule => !rule?.message?.startsWith('Omit TypeScript and JavaScript source extensions')),
    },
  },
  {
    files: ['apps/stage-tamagotchi/scripts/provider-runtime-electron/gate.test.mjs'],
    rules: { 'test/no-import-node-test': 'off' },
  },
]
