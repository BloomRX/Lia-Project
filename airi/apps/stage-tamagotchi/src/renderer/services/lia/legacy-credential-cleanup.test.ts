import { describe, expect, it } from 'vitest'

import {
  LEGACY_CREDENTIAL_KEYS,
  removeLegacyApiKey,
  stripCredentialField,
  withoutLegacyApiKey,
} from './legacy-credential-cleanup'

const SECRET = 'SYNTHETIC_LEGACY_KEY'
const OTHER = 'SYNTHETIC_OTHER_KEY'

function storage(seed: Record<string, string>) {
  const values = new Map(Object.entries(seed))
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

describe('legacy plaintext credential cleanup', () => {
  it('removes the key from the credentials map and keeps every other field', () => {
    const raw = JSON.stringify({ provider: { apiKey: SECRET, baseUrl: 'https://p.invalid/v1/', seed: 7 } })
    const next = JSON.parse(withoutLegacyApiKey(raw, 'provider', 'credentials')!) as Record<string, any>
    expect(next.provider).toEqual({ baseUrl: 'https://p.invalid/v1/', seed: 7 })
    expect(JSON.stringify(next)).not.toContain(SECRET)
  })

  it('removes the key from the configured-provider shape, which nests it under config', () => {
    const raw = JSON.stringify({ provider: { id: 'provider', config: { apiKey: SECRET, temperature: 0.4 } } })
    const next = JSON.parse(withoutLegacyApiKey(raw, 'provider', 'configured')!) as Record<string, any>
    expect(next.provider).toEqual({ id: 'provider', config: { temperature: 0.4 } })
    expect(JSON.stringify(next)).not.toContain(SECRET)
  })

  it('touches only the requested provider', () => {
    const raw = JSON.stringify({ mine: { apiKey: SECRET }, theirs: { apiKey: OTHER } })
    const next = JSON.parse(withoutLegacyApiKey(raw, 'mine', 'credentials')!) as Record<string, any>
    expect(next.mine).toEqual({})
    expect(next.theirs).toEqual({ apiKey: OTHER })
  })

  it('is idempotent: a second pass finds nothing to remove and reports no change', () => {
    const s = storage({ [LEGACY_CREDENTIAL_KEYS.credentials]: JSON.stringify({ provider: { apiKey: SECRET } }) })
    expect(removeLegacyApiKey(s, 'provider')).toEqual({ credentials: true, configured: false })
    const after = s.values.get(LEGACY_CREDENTIAL_KEYS.credentials)!
    expect(removeLegacyApiKey(s, 'provider')).toEqual({ credentials: false, configured: false })
    expect(s.values.get(LEGACY_CREDENTIAL_KEYS.credentials)).toBe(after)
  })

  it('writes nothing when the provider is absent, the blob is empty or the JSON is corrupt', () => {
    expect(withoutLegacyApiKey(null, 'provider', 'credentials')).toBeUndefined()
    expect(withoutLegacyApiKey('{"other":{}}', 'provider', 'configured')).toBeUndefined()
    expect(withoutLegacyApiKey('{not json', 'provider', 'credentials')).toBeUndefined()
    // A non-string apiKey is not a secret this module understands; leave it be.
    expect(withoutLegacyApiKey(JSON.stringify({ provider: { apiKey: 42 } }), 'provider', 'credentials')).toBeUndefined()
  })

  it('survives a storage that refuses to write, without throwing into the caller', () => {
    const s = storage({ [LEGACY_CREDENTIAL_KEYS.credentials]: JSON.stringify({ provider: { apiKey: SECRET } }) })
    const failing = {
      getItem: s.getItem,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }
    expect(() => removeLegacyApiKey(failing, 'provider')).not.toThrow()
    expect(removeLegacyApiKey(failing, 'provider').credentials).toBe(false)
  })

  it('drops the key from the reactive provider payload too, and nothing else', () => {
    expect(stripCredentialField({ apiKey: SECRET, temperature: 0.4 })).toEqual({ temperature: 0.4 })
    expect(stripCredentialField({ temperature: 0.4 })).toEqual({ temperature: 0.4 })
    // An absent payload stays absent: returning `{}` here would let a caller
    // overwrite a provider's configuration with an empty object.
    expect(stripCredentialField(undefined)).toBeUndefined()
  })
})
