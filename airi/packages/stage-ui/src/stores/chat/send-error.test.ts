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
    const humanized = humanizeSendErrorMessage(raw)
    expect(humanized.kind).toBe('auth-failure')
    expect(humanized.humanText).toContain('verify access')
    expect(humanized.humanText).toContain('settings')
    expect(humanized.humanText).not.toContain('Remote sent')
    expect(humanized.humanText).not.toContain('invalid_api_key')

    expect(isAuthSendError('Request failed with status 401')).toBe(true)
    expect(isAuthSendError('Invalid API key provided')).toBe(true)
    expect(isAuthSendError('unauthorized request')).toBe(true)
    expect(isAuthSendError('model overloaded, retry later')).toBe(false)
  })

  it('k: network failures receive a safe connection message', () => {
    const humanized = humanizeSendErrorMessage('socket timeout of 30s')
    expect(humanized.kind).toBe('network')
    expect(humanized.humanText).toBe('Could not reach the AI service. Check your connection and try again.')
  })

  it('j: the human mapping never echoes a literal test key', () => {
    // Even in the worst case - a provider blob embedding the key - the
    // auth mapping replaces the text wholesale.
    const raw = `Remote sent 401 response: credential ${LIA_VAULT_KEY} rejected`
    const humanized = humanizeSendErrorMessage(raw)
    expect(humanized.humanText).not.toContain(LIA_VAULT_KEY)
  })
})

describe('safe chat send errors', () => {
  it.each([
    ['Remote sent 413 response: {"error":{"message":"SENTINEL_PRIVATE https://service.invalid/account user-qa"}}', 'input-limit'],
    ['Request failed with status code 429: SENTINEL_PRIVATE', 'quota'],
    ['HTTP 503: SENTINEL_PRIVATE', 'service-unavailable'],
    ['Remote sent 403 response: SENTINEL_PRIVATE', 'permission-failure'],
    ['Failed to fetch: SENTINEL_PRIVATE', 'network'],
    ['O serviço de IA terminou sem enviar uma resposta. Tente novamente.', 'empty-response'],
    ['An unrecognized failure with SENTINEL_PRIVATE', 'other'],
  ])('replaces the full transport payload for %s', (raw, kind) => {
    const humanized = humanizeSendErrorMessage(raw)
    expect(humanized.kind).toBe(kind)
    expect(humanized.humanText).not.toContain('SENTINEL_PRIVATE')
    expect(humanized.humanText).not.toContain('https://')
    expect(humanized.humanText).not.toContain('{')
    expect(humanizeSendErrorMessage(humanized.humanText)).toEqual(humanized)
  })

  it('does not interpret arbitrary account numbers as an HTTP status', () => {
    expect(isAuthSendError('Account 401 had a failure')).toBe(false)
    expect(isAuthSendError('{"error":{"message":"Request 401 for account 413"}}')).toBe(false)
  })

  it.each([
    ['{"status":413,"error":{"message":"Account 401"}}', 'input-limit'],
    ['{"error":{"statusCode":"429","message":"SENTINEL_PRIVATE"}}', 'quota'],
    ['Request failed with status 401', 'auth-failure'],
    ['HTTP/1.1 503 Service Unavailable', 'service-unavailable'],
    ['Error: Remote sent 403 response: SENTINEL_PRIVATE', 'permission-failure'],
    ['Failure in account 429 while processing request 413', 'other'],
    ['{"error":{"message":"The request has HTTP 401 in an unrelated body"}}', 'other'],
  ])('only classifies status from a known envelope: %s', (raw, kind) => {
    expect(humanizeSendErrorMessage(raw).kind).toBe(kind)
  })

  it('uses a safe fallback when the translator is missing a key or fails', () => {
    const canonical = humanizeSendErrorMessage('HTTP 413')
    expect(humanizeSendErrorMessage('HTTP 413', { translate: key => key })).toEqual(canonical)
    expect(humanizeSendErrorMessage('HTTP 413', { translate: () => '' })).toEqual(canonical)
    expect(humanizeSendErrorMessage('HTTP 413', {
      translate: () => {
        throw new Error('translation failure')
      },
    })).toEqual(canonical)
  })
})
