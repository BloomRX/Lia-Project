import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { resolveSynthesisLanguage, synthesizeProfileWithAllTalk } from './alltalk-synthesis'
import { createLiaVoiceProfileStore } from './voice-profiles'

/**
 * The whole chain, driven against a real local HTTP server:
 *
 * profile id -> publish the reference WAV -> managed filename -> POST
 * /api/tts-generate -> JSON with output_file_url -> GET the bytes.
 *
 * Nothing here needs a real AllTalk: the server records what it was asked for,
 * which is how the test can assert that AllTalk received the *managed* filename
 * and the *normalized* language rather than trusting the client to have sent
 * them.
 */

let server: Server
let baseUrl: string
let listening = false

interface Recorded {
  body: string
  url: string
}
const recorded: Recorded[] = []

/** Set per test: where the second hop points, and whether the server is up. */
let audioUrl = '/audio/out.wav'
let generateStatus: 'generate-success' | 'generate-failure' = 'generate-success'

let root: string
let profilesDir: string
let voicesDir: string
let downloadsDir: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      recorded.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') })

      if (req.url === '/api/voices') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ voices: [] }))
        return
      }
      if (req.url === '/api/tts-generate') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: generateStatus, output_file_url: audioUrl }))
        return
      }
      if (req.url?.startsWith('/audio/')) {
        res.writeHead(200, { 'Content-Type': 'audio/wav' })
        // A minimal but non-empty WAV header + samples, so "did we get audio" is
        // a real question.
        res.end(Buffer.concat([Buffer.from('RIFF....WAVEfmt ', 'latin1'), Buffer.alloc(64, 9)]))
        return
      }
      res.writeHead(404)
      res.end('{}')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  listening = true
})

beforeEach(async () => {
  recorded.length = 0
  audioUrl = '/audio/out.wav'
  generateStatus = 'generate-success'

  root = await mkdtemp(join(tmpdir(), 'lia-e2e-'))
  profilesDir = join(root, 'lia-voices')
  voicesDir = join(root, 'alltalk', 'voices')
  downloadsDir = join(root, 'downloads')
  await mkdir(downloadsDir, { recursive: true })
  await mkdir(voicesDir, { recursive: true })
  await writeFile(join(downloadsDir, 'referencia.wav'), Buffer.alloc(2048, 5))
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

function store() {
  return createLiaVoiceProfileStore({ rootDir: profilesDir })
}

async function importedProfile(name = 'Lia pessoal') {
  const source = join(downloadsDir, 'referencia.wav')
  const result = await store().importProfile(
    { name, engine: 'alltalk', sources: [{ role: 'referenceAudio', path: source }] },
    new Set([source]),
  )
  if (!result.ok)
    throw new Error(result.message)
  return result.value
}

function runtime(overrides: Record<string, unknown> = {}) {
  return { baseUrl, voicesDir, timeoutMs: 5000, ...overrides }
}

function lastGenerate(): URLSearchParams {
  const entry = recorded.find(item => item.url === '/api/tts-generate')
  if (!entry)
    throw new Error('no generation request reached the server')
  return new URLSearchParams(entry.body)
}

describe('resolveSynthesisLanguage', () => {
  it('prefers an explicit request language over the product preference', () => {
    expect(resolveSynthesisLanguage({ configured: 'pt-BR', requested: 'en' })).toBe('en')
  })

  it('falls back to the product preference instead of AllTalk auto-detection', () => {
    expect(resolveSynthesisLanguage({ configured: 'pt-BR', requested: undefined })).toBe('pt-BR')
  })

  it('keeps auto-detection when neither side declares a language', () => {
    expect(resolveSynthesisLanguage({ configured: '', requested: undefined })).toBeUndefined()
    expect(resolveSynthesisLanguage({})).toBeUndefined()
  })

  it('trims stray whitespace and treats blanks as undeclared', () => {
    expect(resolveSynthesisLanguage({ configured: '  ', requested: '   ' })).toBeUndefined()
    expect(resolveSynthesisLanguage({ configured: ' pt ', requested: '  ' })).toBe('pt')
  })
})

describe('synthesizeProfileWithAllTalk', () => {
  it('resolves a profile id into audio, with no filename from the caller', async () => {
    const profile = await importedProfile()

    const audio = await synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá! Eu sou a Lia.',
      language: 'pt-BR',
      runtime: runtime(),
      store: store(),
    })

    expect(audio.byteLength).toBeGreaterThan(0)
    expect(Buffer.from(audio).subarray(0, 4).toString('latin1')).toBe('RIFF')
  })

  it('sends AllTalk the managed filename, not the user\'s original name', async () => {
    const profile = await importedProfile()

    await synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      language: 'pt-BR',
      runtime: runtime(),
      store: store(),
    })

    const fields = lastGenerate()
    // `referencia.wav` is what the user called the file; AllTalk must never see it.
    expect(fields.get('character_voice_gen')).toBe(`lia-${profile.id}.wav`)
    expect(fields.get('character_voice_gen')).not.toBe('referencia.wav')
    expect(fields.get('text_input')).toBe('Olá!')
  })

  it('normalizes pt-BR to the pt code AllTalk documents', async () => {
    const profile = await importedProfile()

    await synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      language: 'pt-BR',
      runtime: runtime(),
      store: store(),
    })

    expect(lastGenerate().get('language')).toBe('pt')
  })

  it('publishes the reference file before the first request', async () => {
    const profile = await importedProfile()

    await synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      runtime: runtime(),
      store: store(),
    })

    // The copy exists in AllTalk's folder by the time generation runs, which is
    // the only way `character_voice_gen` can resolve.
    const published = await readFile(join(voicesDir, `lia-${profile.id}.wav`))
    expect(published.byteLength).toBe(2048)
  })

  it('returns the bytes from the second hop, not the JSON envelope', async () => {
    const profile = await importedProfile()

    const audio = await synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      runtime: runtime(),
      store: store(),
    })

    // The first response was a JSON document; the bytes came from output_file_url.
    expect(recorded.some(item => item.url === audioUrl)).toBe(true)
    expect(Buffer.from(audio).subarray(0, 4).toString('latin1')).not.toBe('{')
  })

  it('throws a recoverable error when AllTalk is offline', async () => {
    const profile = await importedProfile()

    // Port 1 has nothing listening: the ordinary "server not running" case.
    await expect(synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      runtime: runtime({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 }),
      store: store(),
    })).rejects.toThrow()

    // Throwing is what the 4D fallback policy needs: it must see a failure to
    // advance to the next target. A swallowed error would mute the turn instead.
    expect(recorded.filter(item => item.url === '/api/tts-generate')).toHaveLength(0)
  })

  it('throws a recoverable error when the backend reports failure', async () => {
    generateStatus = 'generate-failure'
    const profile = await importedProfile()

    await expect(synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      runtime: runtime(),
      store: store(),
    })).rejects.toThrow(/Não foi possível gerar a fala da Lia\. \[category=generation-failed\]/)
  })

  it('throws when no voicesDir is configured, without calling the server', async () => {
    const profile = await importedProfile()

    await expect(synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      runtime: runtime({ voicesDir: undefined }),
      store: store(),
    })).rejects.toThrow(/AllTalk voices folder/)

    expect(recorded).toHaveLength(0)
  })

  it('throws when the profile does not exist', async () => {
    await expect(synthesizeProfileWithAllTalk({
      profileId: 'no-such-profile',
      text: 'Olá!',
      runtime: runtime(),
      store: store(),
    })).rejects.toThrow(/not in the library/)

    expect(recorded).toHaveLength(0)
  })

  it('accepts no filename or path in any argument', async () => {
    // A caller trying to steer the request at an arbitrary file has nothing to
    // steer with: the only inputs are an id, some text and a language tag.
    const profile = await importedProfile()

    await synthesizeProfileWithAllTalk({
      profileId: profile.id,
      text: 'Olá!',
      runtime: runtime(),
      store: store(),
    })

    const fields = lastGenerate()
    for (const key of ['character_voice_gen', 'output_file_name', 'text_input']) {
      const value = fields.get(key) ?? ''
      expect(value).not.toContain('/')
      expect(value).not.toContain('..')
    }
  })
})

describe('server fixture', () => {
  it('is actually listening', () => {
    expect(listening).toBe(true)
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
  })
})
