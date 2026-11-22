import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createStageVoice } from '../src/main/stage-voice.ts'

test('opt-out and an unavailable selection never reach the voice engine', async () => {
  let enabled = false
  let preferred = 'kokoro'
  let synthesized = 0
  let stopped = 0
  const voice = createStageVoice({
    id: 'kokoro',
    capabilities: () => ({ clonesVoice: false, requiresNetwork: false, runsLocally: true, streams: false }),
    async health() { return { ok: true } },
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
