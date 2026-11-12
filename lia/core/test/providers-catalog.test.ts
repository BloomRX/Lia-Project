import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  findLiaAiProviderByEngineId,
  findLiaAiProviderByStageProviderId,
  findLiaAiProviderDefinition,
  LIA_AI_PROVIDER_CATALOG,
} from '../src/providers/catalog.ts'

describe('AI provider catalog', () => {
  it('keeps definition, Stage provider and Brain engine ids unique', () => {
    const definitionIds = LIA_AI_PROVIDER_CATALOG.map(provider => provider.definitionId)
    const stageIds = LIA_AI_PROVIDER_CATALOG.flatMap(provider => provider.stageProviderId ? [provider.stageProviderId] : [])
    const engineIds = LIA_AI_PROVIDER_CATALOG.flatMap(provider => provider.engineId ? [provider.engineId] : [])
    assert.equal(new Set(definitionIds).size, definitionIds.length)
    assert.equal(new Set(stageIds).size, stageIds.length)
    assert.equal(new Set(engineIds).size, engineIds.length)
  })

  it('makes every ready provider resolvable end to end', () => {
    for (const provider of LIA_AI_PROVIDER_CATALOG.filter(entry => entry.availability === 'ready')) {
      assert.ok(provider.stageProviderId, provider.definitionId)
      assert.ok(provider.engineId, provider.definitionId)
      assert.equal(new URL(provider.baseUrl).protocol, 'https:', provider.definitionId)
      assert.ok(provider.models.length > 0, provider.definitionId)
      assert.equal(findLiaAiProviderDefinition(provider.definitionId)?.definitionId, provider.definitionId)
      assert.equal(findLiaAiProviderByStageProviderId(provider.stageProviderId!)?.definitionId, provider.definitionId)
      assert.equal(findLiaAiProviderByEngineId(provider.engineId!)?.definitionId, provider.definitionId)
    }
  })

  it('describes Groq exactly as the Brain adapter and the Stage provider do', () => {
    const groq = findLiaAiProviderDefinition('groq')
    assert.ok(groq)
    assert.equal(groq.availability, 'ready')
    assert.equal(groq.stageProviderId, 'groq')
    assert.equal(groq.engineId, 'groq')
    assert.equal(groq.baseUrl, 'https://api.groq.com/openai/v1')
    assert.equal(groq.requiresApiKey, true)
    assert.deepEqual(groq.models.map(model => model.id), ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'])
    assert.equal(groq.models.find(model => model.recommended)?.id, 'openai/gpt-oss-120b')
    // The Brain adapter declares the same ids; this is the liaison the product
    // relies on, pinned here so a catalog edit cannot drift silently.
    assert.ok(groq.models.some(model => model.id === 'openai/gpt-oss-120b'))
    assert.ok(groq.models.some(model => model.id === 'qwen/qwen3.8-27b'))
  })

  it('never makes the generic OpenAI-compatible provider selectable', () => {
    const generic = findLiaAiProviderDefinition('openai-compatible')
    assert.ok(generic)
    assert.equal(generic.availability, 'unavailable')
    assert.equal(generic.stageProviderId, undefined)
    assert.equal(generic.engineId, undefined)
    assert.ok(generic.unavailableReason)
    // Not resolvable by either runtime id: the UI cannot enable it by accident.
    assert.equal(findLiaAiProviderByStageProviderId('openai-compatible'), undefined)
    assert.equal(findLiaAiProviderByEngineId('openai-compatible'), undefined)
  })

  it('returns undefined instead of throwing for unknown ids', () => {
    assert.equal(findLiaAiProviderDefinition('missing'), undefined)
    assert.equal(findLiaAiProviderByStageProviderId('missing'), undefined)
    assert.equal(findLiaAiProviderByEngineId('missing'), undefined)
  })
})
