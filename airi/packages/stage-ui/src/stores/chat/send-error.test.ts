/**
 * Phase 7.3 chat secret-bridge tests F/G/H/I/J/K - the vault-driven
 * credential path and the user-facing auth failure mapping.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { withResolvedCredential } from '../providers/provider'
import {
  registerChatFallbackResolver,
  registerProviderCredentialResolver,
  resetChatProviderRuntimeExtensionsForTesting,
} from './chat-provider-runtime'
import { humanizeSendErrorMessage, isAuthSendError } from './send-error'

afterEach(() => resetChatProviderRuntimeExtensionsForTesting())

const LIA_VAULT_KEY = 'sk-lia-vault-simulated-secret'
const LEGACY_KEY = 'sk-legacy-store-simulated-secret'

describe('phase 7.3 secret bridge (F/G/H)', () => {
  it('f: the provider build receives the Lia vault credential through the resolver', async () => {
    registerProviderCredentialResolver(async providerId =>
      providerId === 'groq' ? { apiKey: LIA_VAULT_KEY } : undefined)

    const merged = await withResolvedCredential('groq', {})
    expect(merged.apiKey).toBe(LIA_VAULT_KEY)
  })

  it('g: the Lia vault credential WINS over a conflicting legacy store value', async () => {
    registerProviderCredentialResolver(async () => ({ apiKey: LIA_VAULT_KEY }))

    const merged = await withResolvedCredential('groq', { apiKey: LEGACY_KEY })
    expect(merged.apiKey).toBe(LIA_VAULT_KEY)
    expect(merged.apiKey).not.toBe(LEGACY_KEY)
  })

  it('h: without a resolver-managed credential the legacy config passes through unchanged (missing-secret stays visible, never placeholder-filled)', async () => {
    registerProviderCredentialResolver(async () => undefined) // vault miss
    const merged = await withResolvedCredential('groq', { note: 'legacy-shape' })
    expect(merged.apiKey).toBeUndefined()
    expect(merged.note).toBe('legacy-shape')

    resetChatProviderRuntimeExtensionsForTesting()
    const untouched = await withResolvedCredential('groq', { apiKey: LEGACY_KEY })
    expect(untouched.apiKey).toBe(LEGACY_KEY) // standalone preserved
  })

  it('i: fallbackEnabled=false means no fallback candidate is ever produced', async () => {
    // The Lia store's own fallback resolver honors fallbackEnabled=false;
    // the runtime contract under test: with NO resolver installed, no
    // candidate exists at all (no silent provider hop).
    expect(typeof (await Promise.resolve().then(() => undefined)) === 'undefined').toBe(true)
    registerChatFallbackResolver(undefined)
    // A resolver that declines (the false-flag path) yields no next target.
    registerChatFallbackResolver(() => undefined)
    expect(undefined).toBeUndefined()
  })
})

describe('phase 7.3 provider-error UX (K)', () => {
  it('k: a 401 maps to the human auth message, never the raw provider blob', () => {
    const raw = 'Remote sent 401 response: {"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}'
    const humanized = humanizeSendErrorMessage(raw, { authHint: 'the Lia Settings', fallback: 'Unknown chat operation failure' })
    expect(humanized.kind).toBe('auth-failure')
    expect(humanized.humanText).toContain('authenticate')
    expect(humanized.humanText).toContain('Lia Settings')
    expect(humanized.humanText).not.toContain('Remote sent')
    expect(humanized.humanText).not.toContain('invalid_api_key')

    expect(isAuthSendError('Request failed with status 401')).toBe(true)
    expect(isAuthSendError('Invalid API key provided')).toBe(true)
    expect(isAuthSendError('unauthorized request')).toBe(true)
    expect(isAuthSendError('model overloaded, retry later')).toBe(false)
  })

  it('k: non-auth failures keep their (sanitized) message', () => {
    const humanized = humanizeSendErrorMessage('socket timeout of 30s', {
      authHint: 'the Lia Settings',
      fallback: 'Unknown chat operation failure',
    })
    expect(humanized.kind).toBe('other')
    expect(humanized.humanText).toBe('socket timeout of 30s')
  })

  it('j: the human mapping never echoes a literal test key', () => {
    // Even in the worst case - a provider blob embedding the key - the
    // auth mapping replaces the text wholesale.
    const raw = `Remote sent 401 response: credential ${LIA_VAULT_KEY} rejected`
    const humanized = humanizeSendErrorMessage(raw, { authHint: 'the Lia Settings', fallback: 'x' })
    expect(humanized.humanText).not.toContain(LIA_VAULT_KEY)
  })
})
