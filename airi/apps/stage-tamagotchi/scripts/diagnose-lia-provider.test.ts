import type { LiaProductSummary, RuntimeDiagnosisInput, RuntimeStateSummary, VaultSummary } from './diagnose-lia-provider-core'

import { describe, expect, it } from 'vitest'

import {
  classify,
  providerNeedsKey,
  scanLocalStorageValue,
  summarizeLiaProductConfig,
  summarizeVaultFile,
} from './diagnose-lia-provider-core'

/**
 * Tests for the read-only provider diagnosis.
 *
 * The point of these is the classification order: the report must name the FIRST
 * broken link, not every symptom, and it must never need a secret value to do so.
 */

/** A deliberately fake value standing in for an encrypted vault entry. */
const FAKE_SECRET = 'ZmFrZS1lbmNyeXB0ZWQtY2lwaGVydGV4dC1ub3QtYS1yZWFsLWtleQ=='

function validProductRaw(): string {
  return JSON.stringify({
    schemaVersion: 1,
    provider: {
      chat: {
        strategy: 'manual',
        preferred: { providerId: 'openrouter-ai', modelId: 'openai/gpt-oss-120b' },
        fallback: [{ providerId: 'groq', modelId: 'llama-3.3-70b-versatile' }],
        fallbackEnabled: true,
        onboarded: true,
      },
    },
  })
}

function product(overrides: Partial<LiaProductSummary> = {}): LiaProductSummary {
  return {
    found: true,
    path: '/tmp/lia-product.json',
    parseError: null,
    onboarded: true,
    preferredProvider: 'openrouter-ai',
    preferredModel: 'openai/gpt-oss-120b',
    fallbackEnabled: true,
    fallbackProvider: 'groq',
    fallbackModel: 'llama-3.3-70b-versatile',
    documentMentionsApiKey: false,
    ...overrides,
  }
}

function vault(overrides: Partial<VaultSummary> = {}): VaultSummary {
  return {
    found: true,
    path: '/tmp/lia-secrets.json',
    parseError: null,
    entryCount: 2,
    scopes: ['groq', 'openrouter-ai'],
    primarySecretExists: true,
    fallbackSecretExists: true,
    ciphertextLengths: { 'openrouter-ai': 88, 'groq': 76 },
    ...overrides,
  }
}

function runtimeState(overrides: Partial<RuntimeStateSummary> = {}): RuntimeStateSummary {
  return {
    readable: true,
    activeProvider: 'openrouter-ai',
    activeModel: 'openai/gpt-oss-120b',
    configuredProviderIds: ['openrouter-ai'],
    ...overrides,
  }
}

function runtime(overrides: Partial<RuntimeDiagnosisInput> = {}): RuntimeDiagnosisInput {
  return {
    providerId: 'openrouter-ai',
    modelId: 'openai/gpt-oss-120b',
    providerExists: true,
    providerStatus: 'configured',
    providerConfigExists: true,
    resolverRegistered: true,
    resolverCalledForChat: true,
    resolverCalledForModelListing: true,
    resolvedCredentialAvailable: true,
    instanceCreated: true,
    instanceProvider: 'openrouter-ai',
    instanceModel: 'openai/gpt-oss-120b',
    factorySawCredential: true,
    listModelsCalled: true,
    credentialReachedListModels: true,
    getChatProviderInstanceCalled: true,
    credentialReachedChat: true,
    requests: [{
      method: 'GET',
      endpoint: 'https://openrouter.ai/api/v1/models',
      hasAuthorizationHeader: true,
      authorizationHeaderLength: 32,
    }],
    notes: [],
    ...overrides,
  }
}

describe('lia provider diagnosis core', () => {
  it('summarizes the product config without echoing anything secret-shaped', () => {
    const summary = summarizeLiaProductConfig(validProductRaw(), '/tmp/lia-product.json')

    expect(summary.onboarded).toBe(true)
    expect(summary.preferredProvider).toBe('openrouter-ai')
    expect(summary.preferredModel).toBe('openai/gpt-oss-120b')
    expect(summary.fallbackProvider).toBe('groq')
    expect(summary.fallbackEnabled).toBe(true)
    expect(summary.documentMentionsApiKey).toBe(false)
  })

  it('flags a missing and a malformed product config differently', () => {
    expect(summarizeLiaProductConfig(null, '/tmp/lia-product.json').found).toBe(false)
    expect(summarizeLiaProductConfig('{not json', '/tmp/lia-product.json').parseError).toBeTruthy()
  })

  it('detects a credential that leaked into the product config', () => {
    const leaked = validProductRaw().replace('"strategy":"manual"', '"strategy":"manual","apiKey":"sk-should-never-be-here"')
    expect(summarizeLiaProductConfig(leaked, '/tmp/lia-product.json').documentMentionsApiKey).toBe(true)
  })

  it('reads only scopes and ciphertext lengths from the vault', () => {
    const raw = JSON.stringify({
      'openrouter-ai\u0000apiKey': FAKE_SECRET,
      'groq\u0000apiKey': 'b3RoZXJjaXBoZXI=',
    })
    const summary = summarizeVaultFile(raw, '/tmp/lia-secrets.json', 'openrouter-ai', 'groq')

    expect(summary.entryCount).toBe(2)
    expect(summary.scopes).toEqual(['groq', 'openrouter-ai'])
    expect(summary.primarySecretExists).toBe(true)
    expect(summary.fallbackSecretExists).toBe(true)
    expect(summary.ciphertextLengths['openrouter-ai']).toBe(FAKE_SECRET.length)
    expect(JSON.stringify(summary)).not.toContain(FAKE_SECRET)
  })

  it('reports a missing vault secret for the primary scope', () => {
    const summary = summarizeVaultFile(JSON.stringify({ 'groq\u0000apiKey': 'e' }), '/tmp/lia-secrets.json', 'openrouter-ai', 'groq')
    expect(summary.primarySecretExists).toBe(false)
    expect(summary.fallbackSecretExists).toBe(true)
  })

  it('distinguishes keyless providers', () => {
    expect(providerNeedsKey('ollama')).toBe(false)
    expect(providerNeedsKey('lm-studio')).toBe(false)
    expect(providerNeedsKey('openrouter-ai')).toBe(true)
  })

  it('scans a value out of a raw localStorage blob', () => {
    const blob = `prefix\u0000\u0001settings/consciousness/active-provider\u0001openrouter-ai\u0000trailing`
    expect(scanLocalStorageValue([blob], 'settings/consciousness/active-provider')).toBe('openrouter-ai')
    expect(scanLocalStorageValue([blob], 'settings/consciousness/active-model')).toBeNull()
  })

  it('passes when every link holds', () => {
    const verdict = classify({ product: product(), vault: vault(), runtimeState: runtimeState(), runtime: runtime() })
    expect(verdict.status).toBe('PASS')
    expect(verdict.firstFailure).toBeNull()
  })

  it('reports hypothesis A when the vault has no secret for a keyed provider', () => {
    const verdict = classify({
      product: product(),
      vault: vault({ primarySecretExists: false, scopes: ['groq'] }),
      runtimeState: runtimeState(),
      runtime: runtime(),
    })
    expect(verdict.status).toBe('FAIL')
    expect(verdict.firstFailure).toBe('vault secret missing')
    expect(verdict.hypothesis).toBe('A')
  })

  it('does not demand a secret from a keyless provider', () => {
    const verdict = classify({
      product: product({ preferredProvider: 'ollama', preferredModel: 'llama3.2' }),
      vault: vault({ primarySecretExists: false, scopes: [] }),
      runtimeState: runtimeState({ activeProvider: 'ollama', activeModel: 'llama3.2' }),
      runtime: runtime({ providerId: 'ollama', modelId: 'llama3.2' }),
    })
    expect(verdict.status).toBe('PASS')
  })

  it('reports hypothesis B when the resolver was never registered', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState(),
      runtime: runtime({ resolverRegistered: false }),
    })
    expect(verdict.firstFailure).toBe('credential resolver not registered')
    expect(verdict.hypothesis).toBe('B')
  })

  it('reports hypothesis C when the resolver is registered but never called for chat', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState(),
      runtime: runtime({ credentialReachedChat: false, resolverCalledForChat: false }),
    })
    expect(verdict.firstFailure).toBe('resolver not called for chat')
    expect(verdict.hypothesis).toBe('C')
  })

  it('reports hypothesis D when the resolver returns nothing usable', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState(),
      runtime: runtime({ resolvedCredentialAvailable: false }),
    })
    expect(verdict.firstFailure).toBe('resolver returned no credential')
    expect(verdict.hypothesis).toBe('D')
  })

  it('reports hypothesis E when createProvider never sees the credential', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState(),
      runtime: runtime({ factorySawCredential: false }),
    })
    expect(verdict.firstFailure).toBe('createProvider did not receive the credential')
    expect(verdict.hypothesis).toBe('E')
  })

  it('reports hypothesis F when model listing bypasses the resolver', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState(),
      runtime: runtime({ credentialReachedListModels: false }),
    })
    expect(verdict.firstFailure).toBe('model-listing credential missing')
    expect(verdict.hypothesis).toBe('F')
  })

  it('reports hypothesis G when a request carries no Authorization header', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState(),
      runtime: runtime({
        requests: [{
          method: 'POST',
          endpoint: 'https://openrouter.ai/api/v1/chat/completions',
          hasAuthorizationHeader: false,
          authorizationHeaderLength: 0,
        }],
      }),
    })
    expect(verdict.firstFailure).toBe('request authorization missing')
    expect(verdict.hypothesis).toBe('G')
  })

  it('reports hypothesis I when the runtime is on the AIRI native provider', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState({ activeProvider: 'official-provider' }),
      runtime: runtime(),
    })
    expect(verdict.firstFailure).toBe('runtime is using the AIRI native provider')
    expect(verdict.hypothesis).toBe('I')
  })

  it('reports hypothesis I when the preferred provider itself is the native one', () => {
    const verdict = classify({
      product: product({ preferredProvider: 'official-provider' }),
      vault: vault(),
      runtimeState: runtimeState({ activeProvider: 'official-provider' }),
      runtime: runtime(),
    })
    expect(verdict.firstFailure).toBe('preferred provider is the AIRI native provider')
    expect(verdict.hypothesis).toBe('I')
  })

  it('reports the FIRST broken link, not a later one', () => {
    const verdict = classify({
      product: product(),
      // Both a missing secret (A) and a missing Authorization header (G) hold;
      // A comes first in the chain, so it is the one reported.
      vault: vault({ primarySecretExists: false }),
      runtimeState: runtimeState(),
      runtime: runtime({ requests: [{ method: 'POST', endpoint: 'https://x.test/v1', hasAuthorizationHeader: false, authorizationHeaderLength: 0 }] }),
    })
    expect(verdict.firstFailure).toBe('vault secret missing')
    expect(verdict.hypothesis).toBe('A')
  })

  it('treats an unreadable localStorage as unknown rather than as a failure', () => {
    const verdict = classify({
      product: product(),
      vault: vault(),
      runtimeState: runtimeState({ readable: false, activeProvider: null, activeModel: null }),
      runtime: runtime(),
    })
    expect(verdict.status).toBe('PASS')
  })

  it('is inconclusive, not passing, when the runtime probe did not run', () => {
    const verdict = classify({ product: product(), vault: vault(), runtimeState: runtimeState(), runtime: null })
    expect(verdict.status).toBe('INCONCLUSIVE')
  })
})
