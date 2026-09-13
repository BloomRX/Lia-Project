import type {
  LiaCustomVoiceFile,
  LiaCustomVoiceProfile,
  LiaVoiceProfileErrorCode,
  LiaVoiceProfileImportRequest,
  LiaVoiceProfileResult,
} from '../../../shared/eventa'

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'

/**
 * The private, per-user voice library.
 *
 * Layout, entirely under Electron's `userData`:
 *
 * ```
 * userData/lia-voices/
 *   index.json                  <- the registry: metadata only, no binaries
 *   <profile-id>/               <- one folder per imported voice
 *     model.pth
 *     index.index
 * ```
 *
 * Why copy into `userData` rather than keep an external reference:
 * - the source file is typically in Downloads, and users move or delete those;
 * - one directory is the whole backup, and uninstalling takes it with the app;
 * - it can never end up inside the repository or the installer;
 * - the cost is one copy at import time, which is bounded by `maxFileBytes`.
 *
 * The registry stores names, sizes and bare filenames. No absolute paths, no
 * binaries, no base64 - so nothing private can leak into a config that might be
 * shared, and a profile can be relocated with the app.
 */

/** Per-file ceiling. Voice models run from tens of MB to a couple of GB. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024

const REGISTRY_FILENAME = 'index.json'

/**
 * What the current build knows how to drive.
 *
 * An engine is a declaration, not an implementation: `roles` says which files a
 * profile of that engine needs and `extensions` what the picker should offer.
 * Adding an engine is adding an entry here plus a synthesis adapter; nothing in
 * the core branches on a specific one.
 */
export const VOICE_ENGINES = [
  {
    id: 'generic',
    label: 'Generic (local server)',
    roles: ['model'],
    extensions: ['.pth', '.pt', '.onnx', '.ckpt', '.safetensors', '.bin', '.json'],
  },
  {
    id: 'rvc',
    label: 'RVC',
    roles: ['model', 'index'],
    extensions: ['.pth', '.index'],
  },
] as const

export type VoiceEngineId = typeof VOICE_ENGINES[number]['id']

function fail<T>(error: LiaVoiceProfileErrorCode, message: string): LiaVoiceProfileResult<T> {
  return { ok: false, error, message }
}

/**
 * Reduces a user-chosen filename to a safe bare name.
 *
 * Everything but the last path segment is dropped, separators and NULs are
 * stripped, and dotfiles are rejected. The result is joined onto the profile
 * directory with `join`, so a name that tried to escape (`..`, an absolute path,
 * a Windows drive letter) cannot.
 */
export function safeFilename(input: string): string | null {
  const last = String(input).split(/[\\/]/).pop() ?? ''
  // A NUL is never legitimate in a filename and is the classic truncation
  // vector, so it is refused rather than quietly removed.
  if (last.includes('\0'))
    return null
  const cleaned = last.trim()
  if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.startsWith('.'))
    return null
  if (/[<>:"|?*]/.test(cleaned))
    return null
  return cleaned.slice(0, 200)
}

/** True when `candidate` is `root` itself or lives inside it. */
export function isInside(root: string, candidate: string): boolean {
  const absoluteRoot = resolve(root)
  const absoluteCandidate = resolve(candidate)
  return absoluteCandidate === absoluteRoot
    || absoluteCandidate.startsWith(absoluteRoot.endsWith(sep) ? absoluteRoot : absoluteRoot + sep)
}

export interface LiaVoiceProfileStore {
  rootDir: string
  list: () => Promise<LiaCustomVoiceProfile[]>
  get: (id: string) => Promise<LiaCustomVoiceProfile | undefined>
  importProfile: (request: LiaVoiceProfileImportRequest, allowedSourcePaths: ReadonlySet<string>) => Promise<LiaVoiceProfileResult<LiaCustomVoiceProfile>>
  remove: (id: string) => Promise<LiaVoiceProfileResult<{ id: string }>>
  /** Absolute path of a profile file, or null if the profile/file is unknown. */
  resolveFile: (id: string, filename: string) => string | null
}

interface RegistryFile {
  profiles: LiaCustomVoiceProfile[]
}

async function readRegistry(rootDir: string): Promise<LiaCustomVoiceProfile[]> {
  try {
    const raw = await readFile(join(rootDir, REGISTRY_FILENAME), 'utf8')
    const parsed = JSON.parse(raw) as Partial<RegistryFile>
    return Array.isArray(parsed.profiles) ? parsed.profiles : []
  }
  catch {
    // A missing or unreadable registry is an empty library, never a crash.
    return []
  }
}

async function writeRegistry(rootDir: string, profiles: LiaCustomVoiceProfile[]): Promise<void> {
  await mkdir(rootDir, { recursive: true })
  await writeFile(join(rootDir, REGISTRY_FILENAME), `${JSON.stringify({ profiles }, null, 2)}\n`, 'utf8')
}

export function createLiaVoiceProfileStore(params: { rootDir: string }): LiaVoiceProfileStore {
  const { rootDir } = params

  function profileDir(id: string): string {
    return join(rootDir, id)
  }

  return {
    rootDir,

    async list() {
      return readRegistry(rootDir)
    },

    async get(id) {
      const profiles = await readRegistry(rootDir)
      return profiles.find(profile => profile.id === id)
    },

    resolveFile(id, filename) {
      if (!/^[a-z0-9-]{1,64}$/i.test(id))
        return null
      const safe = safeFilename(filename)
      if (!safe)
        return null
      const candidate = join(profileDir(id), safe)
      return isInside(profileDir(id), candidate) ? candidate : null
    },

    async importProfile(request, allowedSourcePaths) {
      const name = String(request?.name ?? '').trim()
      if (!name)
        return fail('emptyName', 'Give this voice a name first.')

      // Widened to `readonly string[]`: `VOICE_ENGINES` is `as const`, so without
      // this `includes(role)` would only accept the literal union.
      const engine = VOICE_ENGINES.find(candidate => candidate.id === request?.engine) as
        | { extensions: readonly string[], id: string, label: string, roles: readonly string[] }
        | undefined
      if (!engine)
        return fail('engineUnknown', `Unknown voice engine "${String(request?.engine ?? '')}".`)

      const profiles = await readRegistry(rootDir)
      if (profiles.some(profile => profile.name.toLowerCase() === name.toLowerCase()))
        return fail('duplicateName', `A voice named "${name}" already exists.`)

      const sources = Array.isArray(request.sources) ? request.sources : []
      if (sources.length === 0)
        return fail('fileMissing', 'Choose at least one file to import.')

      // Validate everything before writing anything, so a rejected import never
      // leaves a half-copied profile behind.
      const planned: Array<{ role: string, filename: string, sourcePath: string, bytes: number }> = []
      const seenRoles = new Set<string>()

      for (const source of sources) {
        const role = String(source?.role ?? '').trim()
        if (!engine.roles.includes(role))
          return fail('engineUnknown', `"${engine.label}" voices have no "${role}" file.`)
        if (seenRoles.has(role))
          return fail('duplicateId', `Two files were given the same role "${role}".`)

        const sourcePath = String(source?.path ?? '')
        // The renderer may only import what the OS dialog actually handed back.
        // This is what stops a crafted path from reading an arbitrary file.
        if (!allowedSourcePaths.has(sourcePath))
          return fail('pathTraversal', 'That file was not part of the selection.')

        const filename = safeFilename(basename(sourcePath))
        if (!filename)
          return fail('pathTraversal', `"${basename(sourcePath) || sourcePath}" is not a usable filename.`)

        const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase()
        if (!engine.extensions.includes(extension))
          return fail('invalidExtension', `"${extension || filename}" is not a ${engine.label} file (expected ${engine.extensions.join(', ')}).`)

        let size = 0
        try {
          size = (await stat(sourcePath)).size
        }
        catch {
          return fail('fileMissing', `"${filename}" could not be read. It may have been moved or deleted.`)
        }
        if (size === 0)
          return fail('fileMissing', `"${filename}" is empty.`)
        if (size > MAX_FILE_BYTES)
          return fail('tooLarge', `"${filename}" is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024 / 1024)} GB limit.`)

        seenRoles.add(role)
        planned.push({ role, filename, sourcePath, bytes: size })
      }

      const id = randomUUID()
      const targetDir = profileDir(id)
      await mkdir(targetDir, { recursive: true })

      const files: LiaCustomVoiceFile[] = []
      try {
        for (const item of planned) {
          const destination = join(targetDir, item.filename)
          // Belt and braces: the destination is built from a sanitized name, but
          // re-check containment before anything is written.
          if (!isInside(targetDir, destination))
            return fail('pathTraversal', `"${item.filename}" cannot be stored here.`)
          await copyFile(item.sourcePath, destination)
          files.push({ role: item.role, filename: item.filename, bytes: item.bytes })
        }
      }
      catch {
        await rm(targetDir, { recursive: true, force: true })
        return fail('fileMissing', 'The files could not be copied. Check that they still exist and are readable.')
      }

      const metadata: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.metadata ?? {})) {
        if (typeof value === 'string')
          metadata[key] = value.slice(0, 500)
      }

      const profile: LiaCustomVoiceProfile = {
        id,
        name,
        engine: engine.id,
        createdAt: new Date().toISOString(),
        files,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      }

      await writeRegistry(rootDir, [...profiles, profile])
      return { ok: true, value: profile }
    },

    async remove(id) {
      const profiles = await readRegistry(rootDir)
      if (!profiles.some(profile => profile.id === id))
        return fail('notFound', 'That voice is not in the library.')

      await rm(profileDir(id), { recursive: true, force: true })
      await writeRegistry(rootDir, profiles.filter(profile => profile.id !== id))
      return { ok: true, value: { id } }
    },
  }
}

/**
 * Reports profiles whose files have gone missing - a moved `userData`, a partial
 * restore, a cleanup tool. Kept separate from `list` so listing stays cheap and
 * never throws on a damaged library.
 */
export async function findMissingFiles(
  store: LiaVoiceProfileStore,
  profile: LiaCustomVoiceProfile,
): Promise<string[]> {
  const missing: string[] = []
  for (const file of profile.files) {
    const path = store.resolveFile(profile.id, file.filename)
    if (!path) {
      missing.push(file.filename)
      continue
    }
    try {
      await stat(path)
    }
    catch {
      missing.push(file.filename)
    }
  }
  return missing
}

/** Guards against a registry that has been hand-edited into an inconsistent state. */
export async function listProfileDirectories(rootDir: string): Promise<string[]> {
  try {
    return (await readdir(rootDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  }
  catch {
    return []
  }
}
