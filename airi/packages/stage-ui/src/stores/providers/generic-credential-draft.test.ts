import { describe, expect, it } from 'vitest'

import { genericProviderConfigForSave, genericProviderDraft } from './generic-credential-draft'

describe('generic provider credential draft', () => {
  it('never presents a historical host key or mutates the saved snapshot', () => {
    const saved = { apiKey: 'synthetic-historical', baseUrl: 'https://example.invalid', token: 'own-token' }
    expect(genericProviderDraft(saved, true)).toEqual({ baseUrl: saved.baseUrl, token: saved.token })
    expect(saved.apiKey).toBe('synthetic-historical')
  })

  it('never persists a draft host key and preserves other configuration', () => {
    expect(genericProviderConfigForSave({ apiKey: 'synthetic-draft', baseUrl: 'https://example.invalid', model: 'selected', token: 'own-token' }, {}, true))
      .toEqual({ baseUrl: 'https://example.invalid', model: 'selected', token: 'own-token' })
  })

  it('keeps historical data until host migration confirms its removal', () => {
    expect(genericProviderConfigForSave({ apiKey: 'synthetic-draft', model: 'new' }, { apiKey: 'synthetic-current' }, true))
      .toEqual({ model: 'new', apiKey: 'synthetic-current' })
  })

  it('does not resurrect a stale historical key after migration', () => {
    const draft = { apiKey: 'synthetic-historical', model: 'new' }
    expect(genericProviderConfigForSave(draft, { model: 'old' }, true)).toEqual({ model: 'new' })
    expect(genericProviderConfigForSave(draft, { apiKey: 'synthetic-replacement' }, true))
      .toEqual({ model: 'new', apiKey: 'synthetic-replacement' })
  })

  it('preserves web and unmapped provider keys unchanged', () => {
    const draft = { apiKey: 'synthetic-web', token: 'own-token', model: 'new' }
    expect(genericProviderDraft(draft, false)).toEqual(draft)
    expect(genericProviderConfigForSave(draft, { apiKey: 'old' }, false)).toEqual(draft)
  })
})
