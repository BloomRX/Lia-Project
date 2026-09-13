import type { LiaProductConfig } from '../../configs/lia-schema'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse } from 'valibot'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { defaultLiaProductConfig, liaProductConfigSchema } from '../../configs/lia-schema'
import { mergeAllTalkRuntime, resolveAllTalkRuntime } from './alltalk-runtime-config'
import { createAllTalkSyncService } from './alltalk-voices-sync'
import { createLiaVoiceProfileStore } from './voice-profiles'

/**
 * Restarting the app must restore the whole custom-voice setup: the imported
 * profile, the runtime settings, and the fact that a profile is published.
 *
 * Simulated honestly rather than asserted from one object: a *new* store is
 * built over the same directory, which is what a fresh process does, and the
 * config is round-tripped through JSON and the schema the way `lia-product.json`
 * is on disk. Nothing here reuses in-memory state from before the "restart".
 */

let root: string
let profilesDir: string
let voicesDir: string
let downloadsDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lia-restart-'))
  profilesDir = join(root, 'lia-voices')
  voicesDir = join(root, 'alltalk', 'voices')
  downloadsDir = join(root, 'downloads')
  await mkdir(downloadsDir, { recursive: true })
  await mkdir(voicesDir, { recursive: true })
  await writeFile(join(downloadsDir, 'referencia.wav'), Buffer.alloc(1024, 4))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function importedProfile() {
  const source = join(downloadsDir, 'referencia.wav')
  const result = await createLiaVoiceProfileStore({ rootDir: profilesDir }).importProfile(
    {
      name: 'Lia pessoal',
      engine: 'alltalk',
      sources: [{ role: 'referenceAudio', path: source }],
      metadata: { language: 'pt-BR', backend: 'XTTS-v2' },
    },
    new Set([source]),
  )
  if (!result.ok)
    throw new Error(result.message)
  return result.value
}

describe('restart', () => {
  it('restores the profile from disk, without any in-memory carry-over', async () => {
    const before = await importedProfile()

    // A brand-new store over the same directory is what a new process gets.
    const after = await createLiaVoiceProfileStore({ rootDir: profilesDir }).list()

    expect(after).toHaveLength(1)
    expect(after[0]?.id).toBe(before.id)
    expect(after[0]?.name).toBe('Lia pessoal')
    expect(after[0]?.files[0]?.filename).toBe('referencia.wav')
    // Metadata survives, so the voice does not have to be re-published blindly.
    expect(after[0]?.metadata?.language).toBe('pt-BR')
    expect(after[0]?.metadata?.backend).toBe('XTTS-v2')
  })

  it('restores the runtime settings through the persisted schema', () => {
    // Built from the defaults: `LiaProductConfig` is the schema's *output* type,
    // where `persona`, `provider` and `preferences` are required because the
    // schema gives them defaults - the shape a real document on disk has.
    const existing: LiaProductConfig = {
      ...defaultLiaProductConfig,
      voice: {
        tts: {
          preferred: { providerId: 'custom-local-voice', voiceId: 'profile-1' },
          fallback: [],
        },
      },
    }
    const written = mergeAllTalkRuntime(
      existing,
      { baseUrl: 'http://127.0.0.1:7851', voicesDir, timeoutMs: 12_000 },
    )

    // What goes to disk and what comes back.
    const fromDisk = parse(liaProductConfigSchema, JSON.parse(JSON.stringify(written)))
    const runtime = resolveAllTalkRuntime(fromDisk)

    expect(runtime.baseUrl).toBe('http://127.0.0.1:7851')
    expect(runtime.voicesDir).toBe(voicesDir)
    expect(runtime.timeoutMs).toBe(12_000)
    // And the voice selection survived the same round trip untouched.
    expect(fromDisk.voice?.tts?.preferred).toEqual({ providerId: 'custom-local-voice', voiceId: 'profile-1' })
  })

  it('does not republish a voice that is already published, but does republish a lost copy', async () => {
    const profile = await importedProfile()
    const sync = () => createAllTalkSyncService({ store: createLiaVoiceProfileStore({ rootDir: profilesDir }), voicesDir })

    expect(await sync().ensureProfileAvailableToAllTalk(profile.id)).toMatchObject({ ok: true, copied: true })
    // "Restart": new store, same disk. The ownership metadata says it is already
    // there, so nothing is copied again.
    expect(await sync().ensureProfileAvailableToAllTalk(profile.id)).toMatchObject({ ok: true, copied: false })

    // If AllTalk's folder was wiped meanwhile, the derived copy is rebuilt from
    // the canonical file - which is the whole reason the canonical file is kept.
    await rm(voicesDir, { recursive: true, force: true })
    expect(await sync().ensureProfileAvailableToAllTalk(profile.id)).toMatchObject({ ok: true, copied: true })
  })
})
