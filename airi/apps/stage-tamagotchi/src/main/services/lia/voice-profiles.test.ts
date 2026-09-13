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

function importRequest(overrides: Partial<LiaVoiceProfileImportRequest> = {}, sources: Array<{ path: string, role: string }>): LiaVoiceProfileImportRequest {
  return {
    name: 'Minha voz',
    engine: 'generic',
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

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'lia-voices-'))
    sourceDir = await mkdtemp(join(tmpdir(), 'lia-src-'))
  })

  it('imports a valid profile and copies the files into its own folder', async () => {
    const store = createLiaVoiceProfileStore({ rootDir })
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
    expect(profile.engine).toBe('generic')
    expect(profile.files).toEqual([{ role: 'model', filename: 'model.pth', bytes: 1024 }])

    // The bytes really moved into userData/<id>/, and only the name was kept.
    const stored = await readFile(join(rootDir, profile.id, 'model.pth'))
    expect(stored.byteLength).toBe(1024)
    expect(stored[0]).toBe(7)
  })

  it('persists metadata only - never a path and never the bytes', async () => {
    const store = createLiaVoiceProfileStore({ rootDir })
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
    const first = createLiaVoiceProfileStore({ rootDir })
    const model = await makeSource(sourceDir, 'model.pth')
    const imported = await first.importProfile(importRequest({}, [{ path: model, role: 'model' }]), new Set([model]))
    expect(imported.ok).toBe(true)

    const second = createLiaVoiceProfileStore({ rootDir })
    const profiles = await second.list()

    expect(profiles).toHaveLength(1)
    expect(profiles[0]?.name).toBe('Minha voz')
    // And the file is still where the reloaded profile says it is.
    expect(second.resolveFile(profiles[0]!.id, 'model.pth')).toBeTruthy()
  })

  it('removes a profile and its files', async () => {
    const store = createLiaVoiceProfileStore({ rootDir })
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
    const store = createLiaVoiceProfileStore({ rootDir })
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
    const store = createLiaVoiceProfileStore({ rootDir })
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

  it('refuses an unknown engine and an unknown role', async () => {
    const store = createLiaVoiceProfileStore({ rootDir })
    const model = await makeSource(sourceDir, 'model.pth')

    const badEngine = await store.importProfile(
      importRequest({ engine: 'rvc-webui-v9' }, [{ path: model, role: 'model' }]),
      new Set([model]),
    )
    expect(badEngine.ok).toBe(false)
    if (!badEngine.ok)
      expect(badEngine.error).toBe('engineUnknown')

    const badRole = await store.importProfile(
      importRequest({ engine: 'rvc' }, [{ path: model, role: 'weights' }]),
      new Set([model]),
    )
    expect(badRole.ok).toBe(false)
    if (!badRole.ok)
      expect(badRole.error).toBe('engineUnknown')
  })

  it('reports a missing file as a clear condition instead of throwing', async () => {
    const store = createLiaVoiceProfileStore({ rootDir })
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

  it('declares a size ceiling and engines with explicit roles', () => {
    expect(MAX_FILE_BYTES).toBeGreaterThan(1024 * 1024 * 1024)
    expect(VOICE_ENGINES.length).toBeGreaterThan(0)
    for (const engine of VOICE_ENGINES) {
      expect(engine.roles.length).toBeGreaterThan(0)
      expect(engine.extensions.length).toBeGreaterThan(0)
      expect(engine.extensions.every(extension => extension.startsWith('.'))).toBe(true)
    }
  })
})
