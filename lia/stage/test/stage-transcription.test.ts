import type { TransportRecord, TransportSnapshot } from '../../core/src/transports/contracts.ts'

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bindCredential } from '../../core/src/credentials/destination.ts'
import { createStageTranscription } from '../src/main/stage-transcription.ts'

const providerId = 'custom-stt'
const baseUrl = 'https://speech.example.invalid/v1'
const syntheticKey = 'stage-synthetic-transcription-key'
const record: TransportRecord = {
  id: providerId,
  definitionId: 'openai-compatible-audio-transcription',
  providerId,
  type: 'http',
  protocol: 'audio-transcription',
  baseUrl,
  enabled: true,
  modelIds: ['model-a', 'model-b'],
  adapterOptions: {},
  metadata: {},
  credentialRef: { scope: providerId, key: 'apiKey' },
}

function fixture(transport = record) {
  const snapshot: TransportSnapshot = {
    schemaVersion: 1,
    revision: 1,
    records: [transport],
    tombstones: [],
    migration: { version: 1, imported: [] },
  }
  const state = { modelId: 'model-a', snapshot }
  const calls: string[] = []
  const transcribe = createStageTranscription({
    async readProduct() {
      return { status: 'ok', filePath: '', value: { voice: { stt: { preferred: { providerId, modelId: state.modelId } } } } }
    },
    async readTransports() { return state.snapshot },
    async readCredential(scope) {
      calls.push('credential')
      assert.equal(scope, providerId)
      return bindCredential(scope, new URL(baseUrl), syntheticKey, 'transcription')
    },
    fetchForProvider: () => async (url, init) => {
      calls.push('fetch')
      assert.equal(init?.redirect, 'error')
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${syntheticKey}`)
      assert.equal(String(url), `${baseUrl}/audio/transcriptions`)
      return Response.json({ text: 'Olá', ignored: syntheticKey })
    },
  })
  return { calls, state, transcribe }
}

const bytes = new Uint8Array([1, 2, 3])

test('remote STT requests approval before accessing a credential and returns only text', async () => {
  const { calls, transcribe } = fixture()
  const result = await transcribe(bytes, 'audio/wav', new AbortController().signal, async (id, destination) => {
    calls.push('approval')
    assert.equal(id, providerId)
    assert.equal(destination, `${baseUrl}/audio/transcriptions`)
    return true
  })
  assert.deepEqual(result, { ok: true, text: 'Olá' })
  assert.deepEqual(calls, ['approval', 'credential', 'fetch'])
})

test('remote STT denial and cancellation during approval do not access credentials or send audio', async () => {
  const { calls, transcribe } = fixture()
  const controller = new AbortController()
  assert.deepEqual(await transcribe(bytes, 'audio/wav', controller.signal, async () => false), { ok: false, code: 'cancelled' })
  assert.deepEqual(await transcribe(bytes, 'audio/wav', controller.signal, async () => {
    controller.abort()
    return true
  }), { ok: false, code: 'cancelled' })
  assert.deepEqual(calls, [])
})

test('a model or transport change during approval invalidates consent before credential access', async () => {
  for (const change of ['model', 'transport']) {
    const { calls, state, transcribe } = fixture()
    assert.deepEqual(await transcribe(bytes, 'audio/wav', new AbortController().signal, async () => {
      if (change === 'model')
        state.modelId = 'model-b'
      else
        state.snapshot = { ...state.snapshot, revision: 2 }
      return true
    }), { ok: false, code: 'configuration' })
    assert.deepEqual(calls, [])
  }
})

test('rejects an insecure remote destination and a foreign credential scope before approval', async () => {
  for (const transport of [
    { ...record, baseUrl: 'http://speech.example.invalid/v1' },
    { ...record, credentialRef: { ...record.credentialRef, scope: 'other' } },
  ]) {
    const { calls, transcribe } = fixture(transport)
    assert.deepEqual(await transcribe(bytes, 'audio/wav', new AbortController().signal, async () => {
      calls.push('approval')
      return true
    }), { ok: false, code: 'configuration' })
    assert.deepEqual(calls, [])
  }
})
