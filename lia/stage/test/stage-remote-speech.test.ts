import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bindCredential } from '../../core/src/credentials/destination.ts'
import { createStageRemoteSpeech } from '../src/main/stage-remote-speech.ts'

test('speech consent gates credential access and revalidates the destination', async () => {
  const providerId = 'openai-compatible-audio-speech'
  const target = { providerId, modelId: 'test-model', voiceId: 'test-voice' }
  const address = new URL('https://example.invalid/v1')
  const key = 'synthetic-speech-key'
  let approved = false
  let changed = false
  let calls = 0
  let reads = 0
  const speak = createStageRemoteSpeech({
    async readProduct() {
      return { status: 'ok', filePath: '', value: { voice: { tts: { preferred: target } } } }
    },
    async readTransports() {
      return { schemaVersion: 1, revision: 1, tombstones: [], migration: { version: 1, imported: [] }, records: [{
        id: providerId, providerId, definitionId: providerId, type: 'http', protocol: 'audio-speech',
        baseUrl: changed ? 'https://other.invalid/v1' : address.href, enabled: true, modelIds: [],
        adapterOptions: {}, metadata: {}, credentialRef: { scope: providerId, key: 'apiKey' },
      }] }
    },
    readCredential() {
      reads++
      return bindCredential(providerId, address, key, 'speech')
    },
    async approve(origin) {
      if (approved && calls)
        changed = true
      assert.equal(origin, address.origin)
      return approved
    },
    async fetch(url, options) {
      calls++
      assert.equal(String(url), 'https://example.invalid/v1/audio/speech')
      assert.equal(new Headers(options?.headers).get('authorization'), `Bearer ${key}`)
      assert.equal(options?.redirect, 'error')
      assert.equal(JSON.parse(String(options?.body)).response_format, 'wav')
      const wave = Buffer.from('524946462600000057415645666d74201000000001000100803e0000007d00000200100064617461020000000000', 'hex')
      return new Response(wave, { headers: { 'content-type': 'audio/wav' } })
    },
  })
  const submit = () => speak(target, 'Texto sintético', new AbortController().signal)
  assert.deepEqual(await submit(), { ok: false, code: 'cancelled' })
  assert.equal(reads, 0)
  approved = true
  assert.equal((await submit()).ok, true)
  assert.deepEqual(await submit(), { ok: false, code: 'unavailable' })
  assert.equal(reads, 1)
  assert.equal(calls, 1)
})
