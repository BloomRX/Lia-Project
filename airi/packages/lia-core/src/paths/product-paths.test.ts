import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { liaProductPaths, liaUserDataCandidates } from './product-paths'

/**
 * The one-home rule, pinned as tests (Phase 7, architecture item 7):
 * existing user data stays canonical wherever it already is; a fresh
 * machine gets the product default; no alternative root is ever invented.
 */

describe('liaProductPaths', () => {
  it('the explicit env wins over everything', () => {
    const paths = liaProductPaths({
      env: { APPDATA: '/appdata', APP_USER_DATA_PATH: '/shared', LIA_USER_DATA: '/override' },
    })
    expect(paths.userDataDir).toBe('/override')
    expect(paths.source).toBe('lia-user-data-env')
    expect(paths.productConfigFile).toBe(join('/override', 'lia-product.json'))
    expect(paths.vaultFile).toBe(join('/override', 'lia-secrets.json'))
    expect(paths.voicesRoot).toBe(join('/override', 'lia-voices'))
  })

  it('the shared AIRI env is honoured next', () => {
    const paths = liaProductPaths({ env: { APPDATA: '/appdata', APP_USER_DATA_PATH: '/shared' } })
    expect(paths.userDataDir).toBe('/shared')
    expect(paths.source).toBe('app-user-data-env')
  })

  it('an existing candidate with product data is attached to, never forked', () => {
    const candidate = join('/appdata', '@proj-airi/stage-tamagotchi')
    const paths = liaProductPaths({
      env: { APPDATA: '/appdata' },
      exists: p => p === join(candidate, 'lia-product.json'),
    })
    expect(paths.userDataDir).toBe(candidate)
    expect(paths.source).toBe('existing-data-candidate')
  })

  it('a fresh machine resolves the product default', () => {
    const paths = liaProductPaths({ env: { APPDATA: '/appdata' }, exists: () => false })
    expect(paths.userDataDir).toBe(join('/appdata', 'Lia'))
    expect(paths.source).toBe('product-default')
  })

  it('without any resolvable home the error is honest', () => {
    expect(() => liaProductPaths({ env: {} })).toThrow(/LIA_USER_DATA/)
  })

  it('candidates are the documented legacy list, most specific first', () => {
    expect(liaUserDataCandidates({ env: { APPDATA: '/appdata' } })[0]).toBe(join('/appdata', 'Lia'))
    expect(liaUserDataCandidates({ env: {} })).toEqual([])
  })
})
