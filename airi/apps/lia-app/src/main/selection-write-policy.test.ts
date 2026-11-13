import { describe, expect, it } from 'vitest'

import {
  decideSelectionWrite,
  isLauncherManagedProvider,
} from '../../../stage-tamagotchi/src/shared/lia/selection-write-policy'

/**
 * Política de escrita da seleção (AF-1, 12/11/2026).
 *
 * O bug que esta política fecha: Launcher e Stage escreviam
 * `provider.chat.preferred` sem saber um do outro. A regra precisa preservar
 * provedores fora do catálogo, não converter nada e não criar beco sem saída.
 */

const groq = { providerId: 'groq', modelId: 'openai/gpt-oss-120b' }
const ollama = { providerId: 'ollama', modelId: 'llama3' }
const openai = { providerId: 'openai', modelId: 'gpt-4.1-mini' }

describe('selection write policy', () => {
  it('knows exactly which providers the Launcher manages today', () => {
    expect(isLauncherManagedProvider('groq')).toBe(true)
    // Listed but unavailable: the catalog does not manage it yet.
    expect(isLauncherManagedProvider('openai-compatible')).toBe(false)
    expect(isLauncherManagedProvider('ollama')).toBe(false)
    expect(isLauncherManagedProvider('')).toBe(false)
  })

  it('lets a first selection through (nothing to protect)', () => {
    expect(decideSelectionWrite({ incoming: groq })).toEqual({ ok: true })
    expect(decideSelectionWrite({ persisted: undefined, incoming: ollama })).toEqual({ ok: true })
  })

  it('lets a legacy provider change freely', () => {
    expect(decideSelectionWrite({ persisted: ollama, incoming: openai })).toEqual({ ok: true })
    // An unknown provider is NOT converted and NOT treated as managed.
    expect(decideSelectionWrite({ persisted: ollama, incoming: { providerId: 'acme-local', modelId: 'x' } })).toEqual({ ok: true })
  })

  it('refuses to change a Launcher-managed selection from the Stage', () => {
    expect(decideSelectionWrite({ persisted: groq, incoming: ollama })).toEqual({ ok: false, code: 'selection-owned-by-launcher' })
    expect(decideSelectionWrite({ persisted: ollama, incoming: groq })).toEqual({ ok: false, code: 'selection-owned-by-launcher' })
    // A different model on the same managed provider is also the Launcher's call.
    expect(decideSelectionWrite({ persisted: groq, incoming: { providerId: 'groq', modelId: 'qwen/qwen3.8-27b' } }))
      .toEqual({ ok: false, code: 'selection-owned-by-launcher' })
  })

  it('still allows the idempotent re-write of the same selection', () => {
    expect(decideSelectionWrite({ persisted: groq, incoming: { ...groq } })).toEqual({ ok: true })
    expect(decideSelectionWrite({ persisted: ollama, incoming: { ...ollama } })).toEqual({ ok: true })
  })

  it('allows clearing a managed selection - the escape hatch back to the Stage', () => {
    expect(decideSelectionWrite({ persisted: groq, incoming: undefined })).toEqual({ ok: true })
    // And once cleared, the Stage may choose anything again.
    expect(decideSelectionWrite({ persisted: undefined, incoming: ollama })).toEqual({ ok: true })
  })

  it('refuses a write built from a selection that has already changed', () => {
    expect(decideSelectionWrite({ persisted: openai, incoming: ollama, expected: ollama }))
      .toEqual({ ok: false, code: 'stale-selection' })
    expect(decideSelectionWrite({ persisted: openai, incoming: ollama, expected: null }))
      .toEqual({ ok: false, code: 'stale-selection' })
    // The caller read exactly what is persisted: it is an intended change.
    expect(decideSelectionWrite({ persisted: openai, incoming: ollama, expected: openai }))
      .toEqual({ ok: true })
  })

  it('skips the staleness check for callers that predate the field', () => {
    // `expected: undefined` is "no information", not "I read nothing".
    expect(decideSelectionWrite({ persisted: openai, incoming: ollama })).toEqual({ ok: true })
  })

  it('reports ownership before staleness - the more specific reason wins', () => {
    expect(decideSelectionWrite({ persisted: groq, incoming: ollama, expected: ollama }))
      .toEqual({ ok: false, code: 'selection-owned-by-launcher' })
  })

  it('accepts an injected managed set so the rule is testable without the catalog', () => {
    const managed = (id: string) => id === 'acme-managed'
    expect(decideSelectionWrite({ persisted: { providerId: 'acme-managed' }, incoming: ollama, managed }))
      .toEqual({ ok: false, code: 'selection-owned-by-launcher' })
    expect(decideSelectionWrite({ persisted: ollama, incoming: openai, managed })).toEqual({ ok: true })
  })
})
