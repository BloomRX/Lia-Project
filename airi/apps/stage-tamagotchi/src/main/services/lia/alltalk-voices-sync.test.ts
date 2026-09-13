import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  ALLTALK_AUDIO_EXTENSIONS,
  createAllTalkSyncService,
  MANAGED_VOICE_PREFIX,
  managedVoiceFilename,
  referenceFileOf,
  SYNC_METADATA,
} from './alltalk-voices-sync'
import { createLiaVoiceProfileStore } from './voice-profiles'

/**
 * The ownership contract, tested against the real filesystem.
 *
 * Two directories stand in for the two owners: `userData/lia-voices` (canonical,
 * the Lia's) and a separate `voicesDir` (AllTalk's). Every test that touches a
 * copy checks both, because the whole point is that the derived file is
 * disposable while the canonical one is not.
 */

let root: string
let profilesDir: string
let voicesDir: string
let downloadsDir: string

const REAL_ID = '11111111-2222-3333-4444-555555555555'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lia-sync-'))
  profilesDir = join(root, 'lia-voices')
  voicesDir = join(root, 'alltalk', 'voices')
  downloadsDir = join(root, 'downloads')
  await mkdir(downloadsDir, { recursive: true })
  await mkdir(voicesDir, { recursive: true })
  await writeFile(join(downloadsDir, 'minha voz.wav'), Buffer.alloc(4096, 7))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function store() {
  return createLiaVoiceProfileStore({ rootDir: profilesDir })
}

/** `null` means "deliberately not configured"; omitting means "use voicesDir". */
function service(dir: string | null = voicesDir) {
  return createAllTalkSyncService({ store: store(), voicesDir: dir ?? undefined })
}

async function importProfile(name = 'Lia pessoal', filename = 'minha voz.wav') {
  const result = await store().importProfile(
    {
      name,
      engine: 'alltalk',
      sources: [{ role: 'referenceAudio', path: join(downloadsDir, filename) }],
    },
    new Set([join(downloadsDir, filename)]),
  )
  if (!result.ok)
    throw new Error(result.message)
  return result.value
}

describe('managedVoiceFilename', () => {
  it('is deterministic and derived from the id, never from the user\'s filename', () => {
    expect(managedVoiceFilename(REAL_ID, '.wav')).toBe(`lia-${REAL_ID}.wav`)
    // Two profiles imported from files that happened to share a name still get
    // distinct, non-colliding copies.
    expect(managedVoiceFilename(REAL_ID, '.mp3')).toBe(`lia-${REAL_ID}.mp3`)
  })

  it('always carries the managed prefix', () => {
    expect(managedVoiceFilename(REAL_ID, '.wav')?.startsWith(MANAGED_VOICE_PREFIX)).toBe(true)
  })

  it('refuses an id that is not the shape the store mints', () => {
    expect(managedVoiceFilename('../../etc/passwd', '.wav')).toBeNull()
    expect(managedVoiceFilename('not-a-uuid', '.wav')).toBeNull()
    expect(managedVoiceFilename('', '.wav')).toBeNull()
  })

  it('refuses an extension AllTalk cannot use', () => {
    expect(managedVoiceFilename(REAL_ID, '.exe')).toBeNull()
    expect(managedVoiceFilename(REAL_ID, '.pth')).toBeNull()
    expect(managedVoiceFilename(REAL_ID, '')).toBeNull()
    for (const extension of ALLTALK_AUDIO_EXTENSIONS)
      expect(managedVoiceFilename(REAL_ID, extension)).not.toBeNull()
  })

  it('can never produce a name that escapes its folder', () => {
    // Even a hostile id+extension pair has to survive `safeFilename` unchanged,
    // or the whole scheme is rejected.
    for (const candidate of ['..', '.', '.hidden', 'a/b', 'a\\b', 'x\0y'])
      expect(managedVoiceFilename(candidate, '.wav')).toBeNull()
  })
})

describe('referenceFileOf', () => {
  it('prefers the referenceAudio role and falls back to a single file', () => {
    expect(referenceFileOf({ files: [{ filename: 'a.wav', role: 'referenceAudio', bytes: 1 }] } as never)?.filename).toBe('a.wav')
    expect(referenceFileOf({ files: [{ filename: 'b.wav', role: 'model', bytes: 1 }] } as never)?.filename).toBe('b.wav')
    // Two files with no explicit role is ambiguous: better to refuse than guess.
    expect(referenceFileOf({ files: [{ filename: 'b.wav', role: 'model', bytes: 1 }, { filename: 'c.wav', role: 'index', bytes: 1 }] } as never)).toBeUndefined()
  })
})

describe('ensureProfileAvailableToAllTalk', () => {
  it('publishes the canonical file under the managed name', async () => {
    const profile = await importProfile()

    const result = await service().ensureProfileAvailableToAllTalk(profile.id)

    expect(result).toEqual({ ok: true, copied: true, filename: `lia-${profile.id}.wav` })
    const published = await readFile(join(voicesDir, `lia-${profile.id}.wav`))
    expect(published.byteLength).toBe(4096)
    // The user's original filename is not what AllTalk sees.
    expect(published.every(byte => byte === 7)).toBe(true)
  })

  it('leaves the canonical file where it is', async () => {
    const profile = await importProfile()
    await service().ensureProfileAvailableToAllTalk(profile.id)

    const canonical = await stat(join(profilesDir, profile.id, 'minha voz.wav'))
    expect(canonical.isFile()).toBe(true)
    expect(canonical.size).toBe(4096)
  })

  it('records ownership metadata on the profile, without any path or binary', async () => {
    const profile = await importProfile()
    await service().ensureProfileAvailableToAllTalk(profile.id)

    const stored = await store().get(profile.id)
    expect(stored?.metadata?.[SYNC_METADATA.filename]).toBe(`lia-${profile.id}.wav`)
    expect(stored?.metadata?.[SYNC_METADATA.sourceBytes]).toBe('4096')
    expect(stored?.metadata?.[SYNC_METADATA.syncedAt]).toBeTruthy()

    // The registry is metadata only: no absolute path, no base64 of the audio.
    const registry = (await readFile(join(profilesDir, 'index.json'), 'utf8'))
    expect(registry).not.toContain(downloadsDir)
    expect(registry).not.toContain(voicesDir)
    expect(registry.length).toBeLessThan(2000)
  })

  it('is idempotent - a second call does not copy again', async () => {
    const profile = await importProfile()
    const first = await service().ensureProfileAvailableToAllTalk(profile.id)
    const second = await service().ensureProfileAvailableToAllTalk(profile.id)

    expect(first).toMatchObject({ ok: true, copied: true })
    expect(second).toMatchObject({ ok: true, copied: false, filename: first.ok ? first.filename : '' })
  })

  it('republishes when the copy was deleted from AllTalk\'s folder', async () => {
    const profile = await importProfile()
    await service().ensureProfileAvailableToAllTalk(profile.id)
    await rm(join(voicesDir, `lia-${profile.id}.wav`))

    // Metadata still claims it was published; the disk disagrees. The disk wins.
    const again = await service().ensureProfileAvailableToAllTalk(profile.id)
    expect(again).toMatchObject({ ok: true, copied: true })
  })

  it('creates the voices folder if it does not exist yet', async () => {
    const profile = await importProfile()
    const fresh = join(root, 'brand-new', 'voices')

    const result = await service(fresh).ensureProfileAvailableToAllTalk(profile.id)

    expect(result.ok).toBe(true)
    expect((await stat(join(fresh, `lia-${profile.id}.wav`))).isFile()).toBe(true)
  })

  it('refuses when the profile does not exist', async () => {
    const result = await service().ensureProfileAvailableToAllTalk('no-such-profile')
    expect(result).toMatchObject({ ok: false, error: 'notFound' })
  })

  it('refuses when the reference file is missing', async () => {
    const profile = await importProfile()
    await rm(join(profilesDir, profile.id, 'minha voz.wav'))

    const result = await service().ensureProfileAvailableToAllTalk(profile.id)
    expect(result).toMatchObject({ ok: false, error: 'fileMissing' })
  })

  it('refuses when no voicesDir is configured', async () => {
    const profile = await importProfile()

    const result = await service(null).ensureProfileAvailableToAllTalk(profile.id)
    expect(result).toMatchObject({ ok: false, error: 'notConfigured' })
    // Nothing was published as a side effect, and no ownership was recorded.
    expect(await readdir(voicesDir)).toEqual([])
    expect((await store().get(profile.id))?.metadata?.[SYNC_METADATA.filename]).toBeUndefined()
  })

  it('refuses a profile whose reference role the engine does not have', async () => {
    // An `rvc` profile has model+index; there is no single reference audio, so
    // publishing it would mean guessing.
    const rvc = await store().importProfile(
      {
        name: 'RVC voice',
        engine: 'rvc',
        sources: [
          { role: 'model', path: join(downloadsDir, 'model.pth') },
          { role: 'index', path: join(downloadsDir, 'index.index') },
        ],
      },
      new Set([join(downloadsDir, 'model.pth'), join(downloadsDir, 'index.index')]),
    )
    // Set up the two files first, then retry.
    if (!rvc.ok) {
      await writeFile(join(downloadsDir, 'model.pth'), Buffer.alloc(64, 1))
      await writeFile(join(downloadsDir, 'index.index'), Buffer.alloc(64, 2))
    }
    const second = await store().importProfile(
      {
        name: 'RVC voice',
        engine: 'rvc',
        sources: [
          { role: 'model', path: join(downloadsDir, 'model.pth') },
          { role: 'index', path: join(downloadsDir, 'index.index') },
        ],
      },
      new Set([join(downloadsDir, 'model.pth'), join(downloadsDir, 'index.index')]),
    )
    if (!second.ok)
      throw new Error(second.message)

    const result = await service().ensureProfileAvailableToAllTalk(second.value.id)
    expect(result.ok).toBe(false)
  })
})

describe('removeManagedVoice', () => {
  it('removes the copy the Lia published', async () => {
    const profile = await importProfile()
    const published = await service().ensureProfileAvailableToAllTalk(profile.id)
    expect(published.ok).toBe(true)

    const removal = await service().removeManagedVoice(profile.id)
    expect(removal).toEqual({ ok: true, removed: true })
    await expect(stat(join(voicesDir, `lia-${profile.id}.wav`))).rejects.toThrow()
  })

  it('never touches a same-named file the Lia did not create', async () => {
    // The user drops their own `lia.wav` into AllTalk's folder. Nothing in the
    // Lia's registry claims it, so removing any profile must leave it alone.
    const foreign = join(voicesDir, 'lia.wav')
    await writeFile(foreign, Buffer.from('the user made this'))
    const profile = await importProfile()
    await service().ensureProfileAvailableToAllTalk(profile.id)

    await service().removeManagedVoice(profile.id)

    expect((await readFile(foreign)).toString()).toBe('the user made this')
  })

  it('refuses to delete a file whose recorded name does not match the id', async () => {
    const profile = await importProfile()
    await service().ensureProfileAvailableToAllTalk(profile.id)

    // Simulate a tampered registry pointing at somebody else's file. The name to
    // unlink is recomputed from the profile id, so the mismatch is caught.
    await store().update(profile.id, { [SYNC_METADATA.filename]: 'lia.wav' })
    const foreign = join(voicesDir, 'lia.wav')
    await writeFile(foreign, Buffer.from('not ours'))

    const removal = await service().removeManagedVoice(profile.id)
    expect(removal).toEqual({ ok: true, removed: false })
    expect((await readFile(foreign)).toString()).toBe('not ours')
  })

  it('refuses a directory, however it is named', async () => {
    const profile = await importProfile()
    const asDirectory = join(voicesDir, `lia-${profile.id}.wav`)
    await mkdir(asDirectory, { recursive: true })
    await store().update(profile.id, { [SYNC_METADATA.filename]: `lia-${profile.id}.wav` })

    const removal = await service().removeManagedVoice(profile.id)
    expect(removal).toEqual({ ok: true, removed: false })
    expect((await stat(asDirectory)).isDirectory()).toBe(true)
  })

  it('is a no-op when nothing was published, and idempotent when it was', async () => {
    const profile = await importProfile()
    expect(await service().removeManagedVoice(profile.id)).toEqual({ ok: true, removed: false })

    await service().ensureProfileAvailableToAllTalk(profile.id)
    expect(await service().removeManagedVoice(profile.id)).toEqual({ ok: true, removed: true })
    expect(await service().removeManagedVoice(profile.id)).toEqual({ ok: true, removed: false })
  })

  it('is a no-op when no voicesDir is configured', async () => {
    const profile = await importProfile()
    await service().ensureProfileAvailableToAllTalk(profile.id)

    expect(await service(null).removeManagedVoice(profile.id)).toEqual({ ok: true, removed: false })
  })

  it('does not remove the canonical file', async () => {
    const profile = await importProfile()
    await service().ensureProfileAvailableToAllTalk(profile.id)
    await service().removeManagedVoice(profile.id)

    expect((await stat(join(profilesDir, profile.id, 'minha voz.wav'))).isFile()).toBe(true)
  })
})
