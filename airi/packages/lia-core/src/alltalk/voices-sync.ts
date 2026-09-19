import type { LiaVoiceProfileStore } from '../voices/profiles'
import type { LiaCustomVoiceProfile, LiaVoiceProfileErrorCode } from '../voices/types'

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { isInside, safeFilename } from '../voices/profiles'

/**
 * Publishing a Lia voice into AllTalk, and taking it back out.
 *
 * ## Who owns which file
 *
 * ```
 * userData/lia-voices/<profile-id>/reference.wav   <- CANONICAL, owned by the Lia
 * <alltalk voicesDir>/lia-<profile-id>.wav         <- DERIVED COPY, owned by AllTalk
 * ```
 *
 * The canonical file is the only thing the Lia treats as real. The copy inside
 * AllTalk's voices folder exists solely because AllTalk resolves
 * `character_voice_gen` as a filename *inside its own folder* - it cannot be
 * handed reference audio over the API - and it can always be recreated from the
 * canonical file. Deleting AllTalk's folder, moving it, or reinstalling AllTalk
 * therefore costs the user nothing but one re-sync.
 *
 * The original is never moved out of `userData`, and nothing here ever moves or
 * renames a file the user chose.
 *
 * ## Managed filenames
 *
 * A published copy is always named `lia-<profile-id>.<ext>`. The name is
 * derived, not chosen: it never uses the user's original filename, so two
 * profiles imported from two files that happened to be called `voice.wav` cannot
 * collide, and a hand-made `lia.wav` in the folder can never be mistaken for
 * ours.
 *
 * That determinism is also what makes removal safe. `removeManagedVoice` does
 * not read a path back out of metadata and delete it - it *recomputes* the
 * expected filename from the profile id and only unlinks the file if the
 * recorded name matches that recomputation exactly and still resolves inside the
 * configured `voicesDir`. A file with a colliding name that the Lia did not
 * create cannot satisfy both.
 *
 * ## Change detection without hashing
 *
 * Idempotency is decided from the canonical file's size and mtime, not a hash.
 * A profile's reference audio is written once at import and never rewritten in
 * place - importing again mints a new profile id - so size+mtime identifies the
 * content completely. Hashing would mean reading a possibly large WAV on every
 * preview for information the metadata already carries. If a future feature ever
 * replaces a profile's audio in place, that feature has to re-sync; the
 * invariant is documented here rather than enforced by a hash.
 *
 * Migrated into Lia Core for Phase 7.5: the LAUNCHER prepares the voice before
 * the runtime starts (item 6), so the logic needed a Lia-owned home both the
 * launcher and the stage can import. Behavior is byte-for-byte the stage's
 * `alltalk-voices-sync.ts`, which is now a shim.
 */

/** Extensions AllTalk accepts as reference audio. */
export const ALLTALK_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg'] as const

/** Prefix every Lia-managed copy carries. */
export const MANAGED_VOICE_PREFIX = 'lia-'

/** Metadata keys recorded on the profile. Values are strings; never binaries. */
export const SYNC_METADATA = {
  filename: 'alltalk.voiceFilename',
  sourceBytes: 'alltalk.sourceBytes',
  sourceMtimeMs: 'alltalk.sourceMtimeMs',
  syncedAt: 'alltalk.syncedAt',
} as const

/**
 * The filename the Lia uses for a profile's copy in AllTalk.
 *
 * Pure and deterministic. Returns `null` for a profile id that is not the
 * `randomUUID()` shape the store mints, so a hand-edited registry cannot steer
 * this into a surprising name.
 */
export function managedVoiceFilename(profileId: string, extension: string): string | null {
  const id = String(profileId ?? '')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return null

  const ext = String(extension ?? '').toLowerCase()
  if (!(ALLTALK_AUDIO_EXTENSIONS as readonly string[]).includes(ext))
    return null

  const name = `${MANAGED_VOICE_PREFIX}${id}${ext}`
  return safeFilename(name) === name ? name : null
}

/** The profile file that becomes the reference audio for AllTalk. */
export function referenceFileOf(profile: LiaCustomVoiceProfile): { filename: string, role: string } | undefined {
  // Prefer the explicit role; fall back to the only file present so profiles
  // imported before the `referenceAudio` role existed still resolve.
  return profile.files.find(file => file.role === 'referenceAudio')
    ?? (profile.files.length === 1 ? profile.files[0] : undefined)
}

/** The sync failure codes - the stage's eventa type lines up against these. */
export type LiaVoiceSyncErrorCode = LiaVoiceProfileErrorCode | 'notConfigured'

export type LiaVoiceSyncResult
  = | { copied: boolean, filename: string, ok: true }
    | { error: LiaVoiceSyncErrorCode, message: string, ok: false }

function fail(error: LiaVoiceSyncErrorCode, message: string): LiaVoiceSyncResult {
  return { ok: false, error, message }
}

export interface AllTalkSyncDeps {
  /** Absolute path of AllTalk's voices folder, or undefined when not configured. */
  voicesDir?: string
  store: LiaVoiceProfileStore
}

export interface AllTalkSyncService {
  /** Publishes `profileId`'s reference audio. Idempotent. */
  ensureProfileAvailableToAllTalk: (profileId: string) => Promise<LiaVoiceSyncResult>
  /** Removes the Lia's copy for `profileId`, and only that copy. */
  removeManagedVoice: (profileId: string) => Promise<{ ok: true, removed: boolean }>
  /** The managed filename a profile would use, without touching the disk. */
  filenameFor: (profileId: string) => Promise<string | null>
}

export function createAllTalkSyncService(deps: AllTalkSyncDeps): AllTalkSyncService {
  const { store } = deps

  function voicesDir(): string | undefined {
    const dir = deps.voicesDir?.trim()
    return dir || undefined
  }

  return {
    async filenameFor(profileId) {
      const profile = await store.get(profileId)
      if (!profile)
        return null
      const reference = referenceFileOf(profile)
      if (!reference)
        return null
      const ext = reference.filename.slice(reference.filename.lastIndexOf('.')).toLowerCase()
      return managedVoiceFilename(profile.id, ext)
    },

    async ensureProfileAvailableToAllTalk(profileId) {
      const profile = await store.get(profileId)
      if (!profile)
        return fail('notFound', 'That voice is not in the library.')

      const reference = referenceFileOf(profile)
      if (!reference)
        return fail('fileMissing', 'This voice has no reference audio to publish.')

      const sourcePath = store.resolveFile(profile.id, reference.filename)
      if (!sourcePath)
        return fail('pathTraversal', 'This voice is stored in an unexpected location.')

      let sourceStat
      try {
        sourceStat = await stat(sourcePath)
      }
      catch {
        return fail('fileMissing', `The voice's audio file is missing from the library. It may have been moved or deleted.`)
      }
      if (sourceStat.size === 0)
        return fail('fileMissing', 'The voice audio file in the library is empty.')

      const targetDir = voicesDir()
      if (!targetDir)
        return fail('notConfigured', 'Choose the AllTalk voices folder before using this voice.')

      const ext = reference.filename.slice(reference.filename.lastIndexOf('.')).toLowerCase()
      const filename = managedVoiceFilename(profile.id, ext)
      if (!filename)
        return fail('invalidExtension', `The reference audio kind is not usable by AllTalk (expected ${ALLTALK_AUDIO_EXTENSIONS.join(', ')}).`)

      const destination = join(targetDir, filename)
      // Containment on the way in: a `voicesDir` that somehow ended up odd must
      // still never let the copy land outside it.
      if (!isInside(targetDir, destination))
        return fail('pathTraversal', 'The AllTalk voices folder could not be used.')

      const sourceMtimeMs = String(sourceStat.mtimeMs)
      const recorded = profile.metadata ?? {}
      const alreadyPublished = recorded[SYNC_METADATA.filename] === filename
        && recorded[SYNC_METADATA.sourceBytes] === String(sourceStat.size)
        && recorded[SYNC_METADATA.sourceMtimeMs] === sourceMtimeMs

      if (alreadyPublished) {
        // Confirm the copy is really still there: the user may have cleaned
        // AllTalk's folder since the last sync.
        try {
          const existing = await stat(destination)
          if (existing.isFile() && existing.size === sourceStat.size)
            return { ok: true, copied: false, filename }
        }
        catch {
          // Fall through and publish again.
        }
      }

      await mkdir(targetDir, { recursive: true })

      // Atomic: a reader that arrives mid-copy sees either the previous complete
      // file or the new one, never a truncated WAV.
      const staging = join(targetDir, `.${filename}.${randomUUID()}.tmp`)
      try {
        await copyFile(sourcePath, staging)
        await rename(staging, destination)
      }
      catch {
        await unlink(staging).catch(() => {})
        return fail('fileMissing', 'The voice could not be published to the AllTalk folder. Check that the folder is writable.')
      }

      await store.update(profile.id, {
        [SYNC_METADATA.filename]: filename,
        [SYNC_METADATA.sourceBytes]: String(sourceStat.size),
        [SYNC_METADATA.sourceMtimeMs]: sourceMtimeMs,
        [SYNC_METADATA.syncedAt]: new Date().toISOString(),
      })

      return { ok: true, copied: true, filename }
    },

    async removeManagedVoice(profileId) {
      const profile = await store.get(profileId)
      if (!profile)
        return { ok: true as const, removed: false }

      const recorded = profile.metadata?.[SYNC_METADATA.filename]
      if (!recorded)
        return { ok: true as const, removed: false }

      const targetDir = voicesDir()
      if (!targetDir)
        return { ok: true as const, removed: false }

      // Ownership, checked rather than trusted: the name to delete is recomputed
      // from the profile id. If the recorded metadata disagrees with what this
      // profile would own, the file is left alone.
      const reference = referenceFileOf(profile)
      const ext = reference ? reference.filename.slice(reference.filename.lastIndexOf('.')).toLowerCase() : ''
      const expected = managedVoiceFilename(profile.id, ext)
      if (!expected || expected !== recorded)
        return { ok: true as const, removed: false }

      const candidate = join(targetDir, expected)
      if (!isInside(targetDir, candidate))
        return { ok: true as const, removed: false }

      try {
        const info = await stat(candidate)
        // A directory is never ours, whatever it is named.
        if (!info.isFile())
          return { ok: true as const, removed: false }
        await unlink(candidate)
        return { ok: true as const, removed: true }
      }
      catch {
        // Already gone - removal is idempotent, not an error.
        return { ok: true as const, removed: false }
      }
    },
  }
}

/**
 * The bare name of the file a copy would use, for diagnostics. Exported for
 * tests: it must never be handed a path.
 */
export function describeManagedFilename(path: string): string {
  return basename(path)
}
