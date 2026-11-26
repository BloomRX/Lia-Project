import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { createLocalAllTalk, listLocalAllTalkVoices } from '../../core/src/providers/local-alltalk.ts'

const wave = Buffer.alloc(46)
wave.write('RIFF')
wave.writeUInt32LE(wave.length - 8, 4)
wave.write('WAVE', 8)
const signal = () => new AbortController().signal

test('uses AllTalk V2 form encoding and reads the generated WAV from the same local service', async () => {
  const requests: Array<{ path?: string, form: URLSearchParams }> = []
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req)
      chunks.push(chunk)
    requests.push({ path: req.url, form: new URLSearchParams(Buffer.concat(chunks).toString()) })
    if (req.url === '/api/tts-generate')
      res.end(JSON.stringify({ status: 'generate-success', output_file_url: '/audio/fixture.wav' }))
    else
      res.end(wave)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const speak = createLocalAllTalk(new URL(`http://127.0.0.1:${address.port}`))
    assert.deepEqual(await speak({ text: 'Olá, Lia', voice: 'Voz de teste.wav', language: 'pt-BR' }, signal()), {
      ok: true, audio: new Uint8Array(wave).buffer,
    })
    assert.deepEqual(requests.map(({ path }) => path), ['/api/tts-generate', '/audio/fixture.wav'])
    assert.equal(requests[0].form.get('character_voice_gen'), 'Voz de teste.wav')
    assert.equal(requests[0].form.get('language'), 'pt')
    assert.equal(requests[0].form.get('autoplay'), 'false')
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test('rejects remote services, unexpected audio URLs and cancelled synthesis', async () => {
  assert.throws(() => createLocalAllTalk(new URL('https://service.example.test')))
  const base = new URL('http://127.0.0.1:7851')
  const input = { text: 'Teste', voice: 'fixture.wav' }
  for (const path of ['https://elsewhere.test/audio/private.wav', '//elsewhere.test/audio/private.wav', '/audio/%2e%2e%2fprivate.wav', '/v1/private.wav']) {
    let calls = 0
    const speak = createLocalAllTalk(base, async () => {
      calls++
      return Response.json({ status: 'generate-success', output_file_url: path })
    })
    assert.deepEqual(await speak(input, signal()), { ok: false, code: 'unavailable' })
    assert.equal(calls, 1)
  }
  const abort = new AbortController()
  const speak = createLocalAllTalk(base, async () => {
    abort.abort()
    return Response.json({ status: 'generate-success', output_file_url: '/audio/fixture.wav' })
  })
  assert.deepEqual(await speak(input, abort.signal), { ok: false, code: 'cancelled' })
})


test('the local voice catalog returns only unique usable WAV names', async () => {
  const catalog = await listLocalAllTalkVoices(async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:7851/api/voices')
    assert.equal(options?.redirect, 'error')
    return Response.json({ voices: ['Dora.wav', '../private.wav', 'Dora.wav', 'demo.mp3', 'João.wav'], private: 'fixture' })
  })
  assert.deepEqual(catalog, { ok: true, voices: ['Dora.wav', 'João.wav'] })
  assert.deepEqual(await listLocalAllTalkVoices(async () => Response.json({ unexpected: true })), { ok: false })
})
