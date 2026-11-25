import type { LiaVoiceEngine } from '@lia/core/voice/engines/types'

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createStageVoice } from '../src/main/stage-voice.ts'

const config = { status: 'ok', filePath: '', value: {} } as const
const audio = new ArrayBuffer(4)

function engineFixture(synthesize: LiaVoiceEngine['synthesize'], stop: LiaVoiceEngine['stop']): LiaVoiceEngine {
  return {
    id: 'kokoro',
    capabilities: () => ({ clonesVoice: false, runsLocally: true, requiresNetwork: false, streams: false }),
    health: async () => ({ ok: true, state: 'ready' }),
    async start() {},
    synthesize,
    stop,
  }
}

test('cancels before synthesis if the product read is pending', async () => {
  const product = Promise.withResolvers<typeof config>()
  const engine = engineFixture(async () => assert.fail('synthesis should not start'), async () => assert.fail('engine was not started'))
  const voice = createStageVoice(engine, () => product.promise)
  const result = voice.speak('Olá')
  await voice.cancel()
  product.resolve(config)
  assert.deepEqual(await result, { ok: false, code: 'cancelled' })
})

test('stops once during synthesis, discards late audio and accepts a later retry', async () => {
  const started = Promise.withResolvers<void>()
  const late = Promise.withResolvers<{ audio: ArrayBuffer, engine: string }>()
  const stopped = Promise.withResolvers<void>()
  let stoppingCalls = 0
  let synthesisCalls = 0
  const engine = engineFixture(async () => {
    if (++synthesisCalls === 1) {
      started.resolve()
      return late.promise
    }
    return { audio, engine: 'kokoro' }
  }, () => {
    stoppingCalls++
    return stopped.promise
  })
  const voice = createStageVoice(engine, async () => config)
  const result = voice.speak('Olá')
  await started.promise
  const cancellation = Promise.all([voice.cancel(), voice.cancel()])
  late.resolve({ audio, engine: 'kokoro' })
  assert.equal(stoppingCalls, 1)
  assert.deepEqual(await voice.speak('Ainda ocupado'), { ok: false, code: 'unavailable' })
  stopped.resolve()
  await cancellation
  assert.deepEqual(await result, { ok: false, code: 'cancelled' })
  assert.deepEqual(await voice.speak('De novo'), { ok: true, audio })
})

test('opt-out and an unavailable selection never reach the voice engine', async () => {
  let enabled = false
  let preferred = 'kokoro'
  let synthesized = 0
  let stopped = 0
  const voice = createStageVoice({
    id: 'kokoro',
    capabilities: () => ({ clonesVoice: false, requiresNetwork: false, runsLocally: true, streams: false }),
    async health() { return { ok: true, state: 'ready' } },
    async start() {},
    async stop() { stopped++ },
    async synthesize() {
      synthesized++
      return { audio: new ArrayBuffer(2), engine: 'kokoro' }
    },
  }, async () => ({ filePath: '', status: 'ok', value: { voice: { enabled, engine: { preferred } } } }))

  assert.deepEqual(await voice.speak('Olá'), { ok: false, code: 'disabled' })
  enabled = true
  preferred = 'unregistered'
  assert.deepEqual(await voice.speak('Olá'), { ok: false, code: 'unavailable' })
  assert.equal(synthesized, 0)
  preferred = 'kokoro'
  assert.equal((await voice.speak('Olá')).ok, true)
  assert.equal(synthesized, 1)
  await voice.stop()
  assert.equal(stopped, 1)
  assert.deepEqual(await voice.speak('Olá'), { ok: false, code: 'unavailable' })
})

test('an explicitly selected legacy or unsupported provider never plays the local default', async () => {
  let providerId = 'custom-local-voice'
  let calls = 0
  const engine = engineFixture(async () => {
    calls++
    return { audio, engine: 'kokoro' }
  }, async () => {})
  const voice = createStageVoice(engine, async () => ({
    status: 'ok', filePath: '', value: { voice: { tts: { preferred: { providerId } } } },
  }))
  assert.deepEqual(await voice.speak('Olá'), { ok: false, code: 'unavailable' })
  providerId = 'unknown-speech'
  assert.deepEqual(await voice.speak('Olá'), { ok: false, code: 'unavailable' })
  assert.equal(calls, 0)
  providerId = 'kokoro'
  assert.deepEqual(await voice.speak('Olá'), { ok: true, audio })
  assert.equal(calls, 1)
})

test('passes the stock voice from the canonical TTS selection to the engine', async () => {
  const engine = engineFixture(async (input) => {
    assert.equal(input.voiceId, 'pm_alex')
    return { audio, engine: 'kokoro' }
  }, async () => {})
  const voice = createStageVoice(engine, async () => ({
    status: 'ok', filePath: '', value: { voice: { tts: { preferred: { providerId: 'kokoro', voiceId: 'pm_alex' } } } },
  }))
  assert.deepEqual(await voice.speak('Olá'), { ok: true, audio })
})

test('discards remote audio that arrives after cancellation or shutdown', async () => {
  for (const action of ['cancel', 'stop'] as const) {
    const started = Promise.withResolvers<AbortSignal>()
    const late = Promise.withResolvers<{ ok: true, audio: ArrayBuffer }>()
    const engine = engineFixture(async () => assert.fail('local synthesis should not run'), async () => {})
    const voice = createStageVoice(engine, async () => ({
      status: 'ok', filePath: '', value: { voice: { tts: { preferred: { providerId: 'openai-audio-speech' } } } },
    }), async (_target, _text, signal) => {
      started.resolve(signal)
      return late.promise
    })
    const result = voice.speak('Olá')
    const signal = await started.promise
    await voice[action]()
    assert.equal(signal.aborted, true)
    late.resolve({ ok: true, audio })
    assert.deepEqual(await result, { ok: false, code: 'cancelled' })
  }
})
