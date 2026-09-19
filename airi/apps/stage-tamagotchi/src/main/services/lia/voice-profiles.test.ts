import type { LiaVoiceProfileImportRequest } from '../../../shared/eventa'

import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  createLiaVoiceProfileStore,
  findMissingFiles,
  isInside,
  LEGACY_VOICE_ENGINES,
  MAX_FILE_BYTES,
  safeFilename,
  VOICE_ENGINES,
} from './voice-profiles'

/**
 * The private voice library: import, persist, reload, remove - and the ways it
 * has to refuse.
 *
 * Everything here runs against a real temporary directory, so the bytes, the
 * registry file and the folder layout are all genuinely exercised rather than
 * mocked.
 */

/** Writes a stand-in model file. Content is irrelevant; only size and name matter. */
async function makeSource(dir: string, filename: string, bytes = 64): Promise<string> {
  const path = join(dir, filename)
  await writeFile(path, Buffer.alloc(bytes, 7))
  return path
}

/**
 * A TEST-ONLY engine declaration registered via the store's injection seam.
 * It is deliberately not a product id: the production registry is empty
 * (Phase 7.8D), and success-path import tests exercise the seam the same
 * way a real modular engine (Kokoro first) will.
 */
const TEST_ENGINE = {
  extensions: ['.pth'],
  id: 'test-engine',
  label: 'Test Engine',
  roles: ['model'],
} as const

function importRequest(overrides: Partial<LiaVoiceProfileImportRequest> = {}, sources: Array<{ path: string, role: string }>): LiaVoiceProfileImportRequest {
  return {
    name: 'Minha voz',
    engine: TEST_ENGINE.id,
    sources: sources.map(source => ({ role: source.role, path: source.path })),
    ...overrides,
  }
}

describe('safeFilename', () => {
  it('keeps an ordinary name', () => {
    expect(safeFilename('model.pth')).toBe('model.pth')
  })

  it('rejects a name that is only traversal, hidden, empty or reserved', () => {
    for (const evil of ['..', '.', '.hidden', '', '  ', 'a\0b.pth', 'con:aux', '../', '..\\'])
      expect(safeFilename(evil), JSON.stringify(evil)).toBeNull()
  })

  it('neutralizes traversal by keeping only the last segment', () => {
    // This is the safety property: a path that tries to climb out is reduced to
    // a bare name, so it can only ever land inside the profile's own folder.
    expect(safeFilename('../escape.pth')).toBe('escape.pth')
    expect(safeFilename('../../etc/passwd')).toBe('passwd')
    expect(safeFilename('/home/someone/Downloads/model.pth')).toBe('model.pth')
    expect(safeFilename('C:\\Users\\me\\model.pth')).toBe('model.pth')
    expect(safeFilename('C:\\Windows\\\\x.pth')).toBe('x.pth')
  })
})

describe('isInside', () => {
  it('accepts the root and its children, rejects everything else', () => {
    expect(isInside('/tmp/lib', '/tmp/lib')).toBe(true)
    expect(isInside('/tmp/lib', '/tmp/lib/a/b.pth')).toBe(true)
    expect(isInside('/tmp/lib', '/tmp/library/x')).toBe(false)
    expect(isInside('/tmp/lib', '/tmp/lib/../outside')).toBe(false)
  })
})

describe('lia voice profile store', () => {
  let rootDir = ''
  let sourceDir = ''

  /** A store with the test engine registered - the success path. */
  const makeStore = (dir: string) => createLiaVoiceProfileStore({ rootDir: dir, engines: [TEST_ENGINE] })

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'lia-voices-'))
    sourceDir = await mkdtemp(join(tmpdir(), 'lia-src-'))
  })

  it('imports a valid profile and copies the files into its own folder', async () => {
    const store = makeStore(rootDir)
    const model = await makeSource(sourceDir, 'model.pth', 1024)

    const result = await store.importProfile(
      importRequest({}, [{ path: model, role: 'model' }]),
      new Set([model]),
    )

    expect(result.ok).toBe(true)
    if (!result.ok)
      return

    const profile = result.value
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(profile.name).toBe('Minha voz')
    expect(profile.engine).toBe(TEST_ENGINE.id)
    expect(profile.files).toEqual([{ role: 'model', filename: 'model.pth', bytes: 1024 }])

    // The bytes really moved into userData/<id>/, and only the name was kept.
    const stored = await readFile(join(rootDir, profile.id, 'model.pth'))
    expect(stored.byteLength).toBe(1024)
    expect(stored[0]).toBe(7)
  })

  it('persists metadata only - never a path and never the bytes', async () => {
    const store = makeStore(rootDir)
    const model = await makeSource(sourceDir, 'model.pth', 512)
    const result = await store.importProfile(
      importRequest({}, [{ path: model, role: 'model' }]),
      new Set([model]),
    )
    expect(result.ok).toBe(true)

    const registry = JSON.parse(await readFile(join(rootDir, 'index.json'), 'utf8')) as { profiles: unknown[] }
    const serialized = JSON.stringify(registry)

    // Nothing absolute, nothing binary, nothing base64-shaped.
    expect(serialized).not.toContain(sourceDir)
    expect(serialized).not.toContain(rootDir)
    expect(serialized).not.toContain('AAAAAAAA')
    expect(registry.profiles).toHaveLength(1)
  })

  it('survives a restart: a fresh store over the same directory reloads the library', async () => {
    const first = makeStore(rootDir)
    const model = await makeSource(sourceDir, 'model.pth')
    const imported = await first.importProfile(importRequest({}, [{ path: model, role: 'model' }]), new Set([model]))
    expect(imported.ok).toBe(true)

    const second = makeStore(rootDir)
    const profiles = await second.list()

    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.name).toBe('Minha voz')
    // And the file is still where the reloaded profile says it is.
    expect(second.resolveFile(profiles[0]!.id, 'model.pth')).toBeTruthy()
  })

  it('removes a profile and its files', async () => {
    const store = makeStore(rootDir)
    const model = await makeSource(sourceDir, 'model.pth')
    const imported = await store.importProfile(importRequest({}, [{ path: model, role: 'model' }]), new Set([model]))
    expect(imported.ok).toBe(true)
    const id = (imported as { value: { id: string } }).value.id

    const removed = await store.remove(id)
    expect(removed.ok).toBe(true)
    expect(await store.list()).toHaveLength(0)
    // `resolveFile` only computes a contained path, so the meaningful assertion
    // is that the directory itself is gone.
    const { stat } = await import('node:fs/promises')
    await expect(stat(join(rootDir, id))).rejects.toThrow()
    await expect(store.remove(id)).resolves.toMatchObject({ ok: false, error: 'notFound' })
  })

  it('refuses a path that the file dialog never returned', async () => {
    const store = makeStore(rootDir)
    const model = await makeSource(sourceDir, 'model.pth')
    const secret = await makeSource(sourceDir, 'not-selected.pth')

    const result = await store.importProfile(
      importRequest({}, [{ path: secret, role: 'model' }]),
      new Set([model]), // the dialog returned `model`, not `secret`
    )

    expect(result.ok).toBe(false)
    if (result.ok)
      return
    expect(result.error).toBe('pathTraversal')
    expect(await store.list()).toHaveLength(0)
  })

  it('refuses a wrong extension, an empty name and a duplicate name', async () => {
    const store = makeStore(rootDir)
    const wrong = await makeSource(sourceDir, 'notes.txt')
    const model = await makeSource(sourceDir, 'model.pth')
    const allowed = new Set([wrong, model])

    const badExtension = await store.importProfile(importRequest({}, [{ path: wrong, role: 'model' }]), allowed)
    expect(badExtension.ok).toBe(false)
    if (!badExtension.ok)
      expect(badExtension.error).toBe('invalidExtension')

    const noName = await store.importProfile(importRequest({ name: '   ' }, [{ path: model, role: 'model' }]), allowed)
    expect(noName.ok).toBe(false)
    if (!noName.ok)
      expect(noName.error).toBe('emptyName')

    const first = await store.importProfile(importRequest({}, [{ path: model, role: 'model' }]), allowed)
    expect(first.ok).toBe(true)
    const duplicate = await store.importProfile(importRequest({}, [{ path: model, role: 'model' }]), allowed)
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok)
      expect(duplicate.error).toBe('duplicateName')

    // None of the refusals left a profile behind.
    expect(await store.list()).toHaveLength(1)
  })

  it('defers every NEW import while no runnable engine is registered (7.8D)', async () => {
    // The production registry is empty, so the store's default registry
    // contains no engine: imports refuse cleanly instead of writing a fake
    // engine id - including ids that never were engines, the legacy one and
    // an absent engine field.
    const store = createLiaVoiceProfileStore({ rootDir })
    const model = await makeSource(sourceDir, 'model.pth')
    const allowed = new Set([model])

    for (const engine of ['rvc-webui-v9', 'alltalk', 'lia-cloning', undefined]) {
      const result = await store.importProfile(
        importRequest(engine === undefined ? { engine: undefined } : { engine }, [{ path: model, role: 'model' }]),
        allowed,
      )
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.error).toBe('engineUnknown')
    }
    // Nothing was written by any of the refusals.
    expect(await store.list()).toHaveLength(0)

    // With a registered engine the role check still applies: the right id
    // and a wrong role refuse too.
    const badRole = await makeStore(rootDir).importProfile(
      importRequest({}, [{ path: model, role: 'weights' }]),
      allowed,
    )
    expect(badRole.ok).toBe(false)
    if (!badRole.ok)
      expect(badRole.error).toBe('engineUnknown')
  })

  it('keeps old alltalk-era profiles readable - read-compatibility only, never a new import', async () => {
    // Data written by older builds must survive untouched: the registry
    // lists the profile with its original engine id and resolves its files.
    const profileId = 'legacy-profile-1'
    await writeFile(join(rootDir, 'index.json'), `${JSON.stringify({
      profiles: [{
        createdAt: '2025-06-01T12:00:00.000Z',
        engine: 'alltalk',
        files: [{ bytes: 4, filename: 'reference.wav', role: 'referenceAudio' }],
        id: profileId,
        name: 'Voz antiga',
      }],
    }, null, 2)}\n`, 'utf8')

    const store = makeStore(rootDir)
    const listed = await store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.engine).toBe('alltalk')
    expect((await store.get(profileId))?.name).toBe('Voz antiga')
    expect(store.resolveFile(profileId, 'reference.wav')).toContain(profileId)
  })

  it('reports a missing file as a clear condition instead of throwing', async () => {
    const store = makeStore(rootDir)
    const model = await makeSource(sourceDir, 'model.pth')
    const imported = await store.importProfile(importRequest({}, [{ path: model, role: 'model' }]), new Set([model]))
    expect(imported.ok).toBe(true)
    if (!imported.ok)
      throw new Error('import failed')
    const profile = imported.value

    expect(await findMissingFiles(store, profile)).toEqual([])

    // Simulate the file disappearing (moved userData, partial restore).
    const { rm } = await import('node:fs/promises')
    await rm(store.resolveFile(profile.id, 'model.pth')!)

    expect(await findMissingFiles(store, profile)).toEqual(['model.pth'])
  })

  it('treats a damaged or absent registry as an empty library', async () => {
    const store = createLiaVoiceProfileStore({ rootDir })
    expect(await store.list()).toEqual([])

    await writeFile(join(rootDir, 'index.json'), '{ not json', 'utf8')
    expect(await store.list()).toEqual([])
  })

  it('never resolves a file outside the profile folder', () => {
    const store = createLiaVoiceProfileStore({ rootDir })

    // A hostile id is rejected outright.
    expect(store.resolveFile('../../etc', 'passwd')).toBeNull()
    expect(store.resolveFile('a/b', 'passwd')).toBeNull()
    expect(store.resolveFile('', 'passwd')).toBeNull()

    // A hostile filename is neutralized rather than rejected, and the result is
    // always inside the profile's own directory - which is the property that
    // actually matters for containment.
    for (const hostile of ['../index.json', '/etc/passwd', '..\\..\\x.pth', 'a/b/c.pth']) {
      const resolved = store.resolveFile('abc', hostile)
      expect(resolved, hostile).not.toBeNull()
      expect(isInside(join(rootDir, 'abc'), resolved!), hostile).toBe(true)
    }

    // Hidden files are not addressable at all.
    expect(store.resolveFile('abc', '.hidden')).toBeNull()
  })

  it('holds the engine-registry contract: real runnable engines only, legacy data read-compatible', () => {
    expect(MAX_FILE_BYTES).toBeGreaterThan(1024 * 1024 * 1024)

    // Phase 7.8D: NO runnable TTS engine is registered yet - there is no
    // 'lia-cloning'-style placeholder, and no other fake generic id either.
    expect(VOICE_ENGINES).toEqual([])

    // Legacy ids resolve old documents only; they are always flagged and
    // never leak into the runnable registry above.
    expect(LEGACY_VOICE_ENGINES.map(engine => engine.id)).toEqual(['alltalk'])
    expect(LEGACY_VOICE_ENGINES.every(engine => engine.legacy)).toBe(true)

    // A registered engine declaration (real or test fixture) must still be
    // well-formed: roles and dotted extensions are what import validates
    // against.
    for (const engine of [TEST_ENGINE]) {
      expect(engine.roles.length).toBeGreaterThan(0)
      expect(engine.extensions.length).toBeGreaterThan(0)
      expect(engine.extensions.every(extension => extension.startsWith('.'))).toBe(true)
    }
  })
})
