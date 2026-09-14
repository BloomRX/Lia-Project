import type { LiaProductConfig } from '../../configs/lia-schema'

import { parse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { liaProductConfigSchema } from '../../configs/lia-schema'
import { DEFAULT_ALLTALK_BASE_URL, DEFAULT_ALLTALK_TIMEOUT_MS } from './alltalk-client'
import { mergeAllTalkRuntime, normalizeAllTalkRuntimePayload, resolveAllTalkRuntime } from './alltalk-runtime-config'

/**
 * Runtime configuration is a *reference*: an address and a folder, never a
 * credential and never audio. These tests pin both halves - what the renderer is
 * allowed to set, and what a write to `voice.runtime.alltalk` may disturb.
 */

const configWithVoice: LiaProductConfig = {
  schemaVersion: 1,
  persona: { activeCardId: 'lia' },
  provider: {},
  voice: {
    tts: {
      preferred: { providerId: 'custom-local-voice', voiceId: 'profile-1' },
      fallback: [{ providerId: 'kokoro-local', modelId: 'kokoro-v1.1-zh', voiceId: 'af_heart' }],
    },
    stt: { preferred: { providerId: 'groq' } },
  },
  preferences: { language: 'pt-BR' },
}

describe('normalizeAllTalkRuntimePayload', () => {
  it('never reads voicesDir from the renderer', () => {
    // This is the whole point: a directory can only enter the config through the
    // main process's own showOpenDialog.
    const normalized = normalizeAllTalkRuntimePayload({
      baseUrl: 'http://127.0.0.1:7851',
      voicesDir: 'C:\\Windows\\System32',
    })

    expect(normalized).not.toHaveProperty('voicesDir')
    expect(normalized).toEqual({ baseUrl: 'http://127.0.0.1:7851' })
  })

  it('drops voicesDir even when it is the only field sent', () => {
    expect(normalizeAllTalkRuntimePayload({ voicesDir: '/etc' })).toEqual({})
    expect(normalizeAllTalkRuntimePayload({ voicesDir: '../../..' })).toEqual({})
  })

  it('accepts only http(s) base URLs', () => {
    expect(normalizeAllTalkRuntimePayload({ baseUrl: 'http://127.0.0.1:7851' }).baseUrl)
      .toBe('http://127.0.0.1:7851')
    expect(normalizeAllTalkRuntimePayload({ baseUrl: 'https://tts.example.com/' }).baseUrl)
      .toBe('https://tts.example.com')
  })

  it('rejects a base URL that is really a path or another scheme', () => {
    expect(normalizeAllTalkRuntimePayload({ baseUrl: 'file:///C:/Windows' })).toEqual({})
    expect(normalizeAllTalkRuntimePayload({ baseUrl: 'C:\\alltalk' })).toEqual({})
    expect(normalizeAllTalkRuntimePayload({ baseUrl: 'not a url' })).toEqual({})
    expect(normalizeAllTalkRuntimePayload({ baseUrl: '' })).toEqual({})
  })

  it('keeps timeout within sane bounds', () => {
    expect(normalizeAllTalkRuntimePayload({ timeoutMs: 5000 }).timeoutMs).toBe(5000)
    expect(normalizeAllTalkRuntimePayload({ timeoutMs: 10 }).timeoutMs).toBeUndefined()
    expect(normalizeAllTalkRuntimePayload({ timeoutMs: 10_000_000 }).timeoutMs).toBeUndefined()
    expect(normalizeAllTalkRuntimePayload({ timeoutMs: Number.NaN }).timeoutMs).toBeUndefined()
  })

  it('is a no-op for a missing or empty payload', () => {
    expect(normalizeAllTalkRuntimePayload(undefined)).toEqual({})
    expect(normalizeAllTalkRuntimePayload({})).toEqual({})
  })
})

describe('mergeAllTalkRuntime', () => {
  it('leaves voice.tts and voice.stt untouched', () => {
    const merged = mergeAllTalkRuntime(configWithVoice, { baseUrl: 'http://127.0.0.1:9999' })

    // The voice selection is not this bridge's to write.
    expect(merged.voice?.tts).toEqual(configWithVoice.voice?.tts)
    expect(merged.voice?.stt).toEqual(configWithVoice.voice?.stt)
    expect(merged.persona).toEqual(configWithVoice.persona)
    expect(merged.preferences).toEqual(configWithVoice.preferences)
  })

  it('writes only the alltalk runtime slice', () => {
    const merged = mergeAllTalkRuntime(configWithVoice, { voicesDir: '/opt/alltalk/voices' })

    expect(merged.voice?.runtime?.alltalk).toEqual({ voicesDir: '/opt/alltalk/voices' })
  })

  it('merges into an existing runtime instead of replacing it', () => {
    const first = mergeAllTalkRuntime(configWithVoice, { baseUrl: 'http://127.0.0.1:7851', voicesDir: '/v' })
    const second = mergeAllTalkRuntime(first, { timeoutMs: 8000 })

    expect(second.voice?.runtime?.alltalk).toEqual({
      baseUrl: 'http://127.0.0.1:7851',
      voicesDir: '/v',
      timeoutMs: 8000,
    })
  })

  it('can clear the folder without losing the address', () => {
    const first = mergeAllTalkRuntime(configWithVoice, { baseUrl: 'http://127.0.0.1:7851', voicesDir: '/v' })
    const cleared = mergeAllTalkRuntime(first, { voicesDir: '' })

    expect(cleared.voice?.runtime?.alltalk?.baseUrl).toBe('http://127.0.0.1:7851')
    expect(cleared.voice?.runtime?.alltalk?.voicesDir).toBe('')
  })
})

describe('persisted schema', () => {
  it('round-trips voice.runtime.alltalk through lia-product.json', () => {
    const withRuntime = mergeAllTalkRuntime(configWithVoice, {
      baseUrl: DEFAULT_ALLTALK_BASE_URL,
      voicesDir: '/opt/alltalk/voices',
      timeoutMs: DEFAULT_ALLTALK_TIMEOUT_MS,
    })

    const parsed = parse(liaProductConfigSchema, JSON.parse(JSON.stringify(withRuntime)))

    expect(parsed.voice?.runtime?.alltalk).toEqual({
      baseUrl: DEFAULT_ALLTALK_BASE_URL,
      voicesDir: '/opt/alltalk/voices',
      timeoutMs: DEFAULT_ALLTALK_TIMEOUT_MS,
    })
    expect(parsed.voice?.tts).toEqual(configWithVoice.voice?.tts)
  })

  it('accepts a document written before the runtime slice existed', () => {
    // A document as an older build wrote it: no `runtime`, and no `fallback`
    // either, since that default only materializes on parse.
    const legacy = { schemaVersion: 1, voice: { tts: {} } }
    const parsed = parse(liaProductConfigSchema, JSON.parse(JSON.stringify(legacy)))

    // Additive and optional: no migration, nothing lost. The `fallback: []` is
    // the schema's own default materializing, exactly as `voice.tts` behaves
    // everywhere else.
    expect(parsed.voice?.runtime).toBeUndefined()
    expect(parsed.voice?.tts).toEqual({ fallback: [] })
  })

  it('stores no secret and no audio', () => {
    const serialized = JSON.stringify(
      mergeAllTalkRuntime(configWithVoice, { baseUrl: 'http://127.0.0.1:7851', voicesDir: '/v' }),
    )

    expect(serialized).not.toMatch(/apiKey|token|secret|authorization/i)
    // A runtime config is a few dozen bytes; anything larger means a blob leaked.
    expect(serialized.length).toBeLessThan(600)
  })
})

describe('resolveAllTalkRuntime', () => {
  it('falls back to the documented defaults', () => {
    expect(resolveAllTalkRuntime(undefined)).toEqual({
      baseUrl: DEFAULT_ALLTALK_BASE_URL,
      timeoutMs: DEFAULT_ALLTALK_TIMEOUT_MS,
    })
  })

  it('keeps an unset voicesDir absent rather than empty', () => {
    // The UI distinguishes "not configured" from "configured as empty", so the
    // difference has to survive the read.
    expect(resolveAllTalkRuntime({ schemaVersion: 1 } as LiaProductConfig)).not.toHaveProperty('voicesDir')
    const cleared = resolveAllTalkRuntime(mergeAllTalkRuntime(configWithVoice, { voicesDir: '' }))
    expect(cleared).not.toHaveProperty('voicesDir')
  })

  it('trims a configured folder', () => {
    const merged = mergeAllTalkRuntime(configWithVoice, { voicesDir: '  /opt/alltalk/voices  ' })
    expect(resolveAllTalkRuntime(merged).voicesDir).toBe('/opt/alltalk/voices')
  })
})
