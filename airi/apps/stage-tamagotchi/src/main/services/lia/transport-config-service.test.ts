import type { TransportRecord, TransportSnapshot } from '../../../../../../../lia/core/src/transports/contracts'

import { describe, expect, it, vi } from 'vitest'

import { CURATED_CHAT_PROVIDER_IDS } from '../../../shared/lia/provider-catalog'
import { NATIVE_RECORDING_TRANSCRIPTION_IDS } from '../../../shared/lia/transcription-transport'
import { canRendererReadLegacySecret } from './transport-config-service'

/**
 * The one rule that makes "the credential never reaches the renderer" true at
 * runtime rather than by convention: `secrets:get` refuses a scope here, in the
 * main process, regardless of what any renderer code asks for.
 *
 * `electron` is mocked because this module imports `app` for the application
 * repository path; every assertion injects its own snapshot instead, so no file
 * is ever touched.
 */
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/unused-user-data') } }))

function snapshot(overrides: Partial<TransportSnapshot> = {}): TransportSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    records: [],
    tombstones: [],
    migration: { version: 1, imported: [] },
    ...overrides,
  }
}

function repository(value: TransportSnapshot = snapshot()) {
  return { read: async () => value }
}

function record(scope: string): TransportRecord {
  return {
    id: scope,
    providerId: scope,
    definitionId: 'openai-compatible',
    type: 'http' as const,
    protocol: 'chat-completions' as const,
    baseUrl: 'https://fixture.invalid/v1/',
    enabled: true,
    adapterOptions: {},
    modelIds: [],
    metadata: {},
    credentialRef: { scope, key: 'apiKey' },
  }
}

describe('renderer read access to stored credentials', () => {
  it.each(NATIVE_RECORDING_TRANSCRIPTION_IDS)('denies native recording scope %s before migration', async (id) => {
    expect(await canRendererReadLegacySecret(id, repository())).toBe(false)
  })
  it.each(CURATED_CHAT_PROVIDER_IDS)(
    'denies %s: a curated provider executes in main, so the renderer has no use for its key',
    async (id) => {
      // Denied even with an empty snapshot — i.e. before any transport record
      // exists. A first-run window must not be able to read the key it just sent.
      expect(await canRendererReadLegacySecret(id, repository())).toBe(false)
    },
  )

  it('denies a curated provider that also has an active transport record', async () => {
    expect(await canRendererReadLegacySecret('anthropic', repository(snapshot({ records: [record('anthropic')] })))).toBe(false)
  })

  it('has no exception left: the transcription consumer that justified one now runs in main', async () => {
    // `groq` used to be readable because the hearing pipeline built its
    // transcription client in this renderer. Speech-to-text moved to
    // `transcription-service.ts`, so the exception is gone. If this assertion
    // ever needs loosening, the reason has to be a consumer that genuinely
    // cannot run in main — argued in review, not appended here.
    expect(await canRendererReadLegacySecret('groq', repository())).toBe(false)
    expect(await canRendererReadLegacySecret('groq', repository(snapshot({ records: [record('groq')] })))).toBe(false)
  })

  it('denies any scope that a transport record covers, curated or not', async () => {
    expect(await canRendererReadLegacySecret('personal-service', repository(snapshot({ records: [record('personal-service')] })))).toBe(false)
  })

  it('denies a scope whose credential was deliberately migrated away', async () => {
    const protectedScopes = snapshot({ protectedCredentialScopes: ['legacy-remote'] })
    expect(await canRendererReadLegacySecret('legacy-remote', repository(protectedScopes))).toBe(false)
    expect(await canRendererReadLegacySecret('legacy-remote', repository(snapshot({ tombstones: ['legacy-remote'] })))).toBe(false)
  })

  it('denies everything when the snapshot admits its migration was incomplete', async () => {
    expect(await canRendererReadLegacySecret('legacy-remote', repository(snapshot({ credentialProtectionIncomplete: true })))).toBe(false)
  })

  it('fails closed when the snapshot cannot be read', async () => {
    const failing = { read: async (): Promise<TransportSnapshot> => {
      throw new Error('disk unavailable')
    } }
    expect(await canRendererReadLegacySecret('legacy-remote', failing)).toBe(false)
  })

  it('leaves providers outside the chat catalog and outside any record alone', async () => {
    expect(await canRendererReadLegacySecret('some-uncatalogued-scope', repository())).toBe(true)
  })
})
