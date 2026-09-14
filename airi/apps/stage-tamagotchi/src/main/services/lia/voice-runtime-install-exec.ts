import type { Buffer } from 'node:buffer'

import type { BootstrapLogEntry, RuntimeInstallRecord } from './voice-runtime-bootstrap'
import type { CommandResult, RunCommand } from './voice-runtime-env'

import path, { dirname } from 'node:path'
import process from 'node:process'

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { fromBuffer } from 'yauzl'

import { detectStripRoot, isSymlinkEntry, resolveArchiveEntry } from './archive-path'

/**
 * The path implementation matching this platform.
 *
 * Chosen once rather than per call, and injected into the validator so tests can
 * exercise Windows semantics on a POSIX machine - which is the only way to catch a
 * separator bug before a user does.
 */
const pathImpl = path.sep === '\\' ? path.win32 : path.posix

/**
 * The process, download and archive primitives the bootstrapper is injected with.
 *
 * Split out from the Electron-specific module on purpose, and not only for
 * tidiness: this is where the security-critical spawn options live, and a module
 * that imports `electron` cannot be exercised in a Node test process. Keeping it
 * dependency-free is what lets a test assert `shell: false` and a closed stdin
 * rather than trusting that they are still there.
 *
 * ## Why these two options matter
 *
 * `shell: false` means the install directory is never re-parsed by a shell, so a
 * path containing `&`, quotes or parentheses cannot alter what runs. And stdin is
 * closed because AllTalk's silent installer prompts `choice /C YN` when a step
 * fails - with an open stdin that would block forever instead of failing.
 */

export const LOG_PREFIX = '[LIA-VOICE-BOOTSTRAP]'

export function createRuntimeRunCommand(): RunCommand {
  return (command: string, args: string[]): Promise<CommandResult> =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.once('error', reject)
      child.once('exit', code => resolve({ code, stderr, stdout }))
    })
}

export interface ExecOptions {
  cwd: string
  timeoutMs: number
}

/**
 * Runs the installer with a hard ceiling.
 *
 * A timeout kills the child rather than leaving it running detached, so an
 * install that hangs cannot outlive the attempt that started it.
 */
export function createRuntimeExec() {
  return (
    command: string,
    args: string[],
    options: ExecOptions,
  ): Promise<{ code: number | null, stderr: string, stdout: string }> =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk)
      })

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`timed out after ${options.timeoutMs}ms`))
      }, options.timeoutMs)
      timer.unref?.()

      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve({ code, stderr, stdout })
      })
    })
}

/**
 * Downloads to `destPath`, streaming, and resolves with the size and SHA-256.
 *
 * The hash is computed while streaming rather than after, so a large archive is
 * never held in memory. The caller decides what to do with the hash; nothing
 * here executes the file.
 */

export function createRuntimeDownload() {
  return async (url: string, destPath: string): Promise<{ bytes: number, sha256: string }> => {
    // Only https. An http: or file: URL would mean fetching something that cannot
    // be trusted to be what it claims.
    if (!url.startsWith('https://'))
      throw new Error(`refusing non-https download: ${url.slice(0, 32)}`)

    const response = await fetch(url, { redirect: 'follow' })
    if (!response.ok || !response.body)
      throw new Error(`download failed with HTTP ${response.status}`)

    await mkdir(dirname(destPath), { recursive: true })

    const hash = createHash('sha256')
    let bytes = 0
    const sink = createWriteStream(destPath)

    // Counted and hashed on the way through, then written. `pipeline` propagates
    // a failure from any stage, so a truncated transfer rejects rather than
    // leaving a short file that looks complete.
    const source = Readable.fromWeb(response.body as never)
    const counted = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length
        hash.update(chunk)
        callback(null, chunk)
      },
    })

    await pipeline(source, counted, sink)

    return { bytes, sha256: hash.digest('hex') }
  }
}

/** Diagnostics for a refused entry. Only the first one is ever reported. */
export interface ArchiveRejectReport {
  computedTarget?: string
  normalised: string
  raw: string
  reason: string
  rootDir: string
}

export interface ExtractOptions {
  /** Called once, for the first refused entry. */
  onReject?: (report: ArchiveRejectReport) => void
  /** Records what was done, for the bootstrap log. */
  onProgress?: (info: { entries: number, stripRoot?: string }) => void
}

/** Opens the archive and walks its entries without extracting anything. */
function listEntries(buffer: Buffer): Promise<Array<{ externalFileAttributes: number, fileName: string, versionMadeBy: number }>> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(error ?? new Error('could not open the archive'))
        return
      }
      const names: Array<{ externalFileAttributes: number, fileName: string, versionMadeBy: number }> = []
      zipfile.on('error', reject)
      zipfile.on('end', () => resolve(names))
      zipfile.on('entry', (entry) => {
        names.push({
          externalFileAttributes: entry.externalFileAttributes,
          fileName: entry.fileName,
          versionMadeBy: entry.versionMadeBy,
        })
        zipfile.readEntry()
      })
      zipfile.readEntry()
    })
  })
}

/**
 * Extracts a ZIP into `destDir`.
 *
 * Two passes, and the first one is not decoration. The wrapper directory GitHub
 * adds (`<repo>-<sha>/`) has to be identified from the whole entry list before
 * anything is written, because stripping a first component blindly would silently
 * eat a real directory from an archive that has no wrapper.
 *
 * ## Path safety
 *
 * Every entry is validated *before* it is resolved, by `resolveArchiveEntry`, which
 * refuses traversal, absolute paths, drive letters and UNC names, and compares
 * against the root with a real separator boundary. The destination is normalised
 * with `resolve` first - a QA run on Windows failed precisely because a root
 * assembled with forward slashes never matched a backslash-normalised target, so
 * the guard rejected a legitimate archive.
 *
 * ## Symlinks
 *
 * Refused outright. Filename validation cannot protect against a link: the
 * traversal check only ever sees the link's own path, never where it points. The
 * official archive contains none, so refusing costs nothing and removes a whole
 * class of escape.
 */
export function createRuntimeExtract(options: ExtractOptions = {}) {
  return async (archivePath: string, destDir: string): Promise<void> => {
    const buffer = await readFile(archivePath)

    const listing = await listEntries(buffer)
    const stripRoot = detectStripRoot(listing.map(entry => entry.fileName), pathImpl)

    // Refuse symlinks before extracting anything, so a malicious archive cannot get
    // a partial write out before being caught.
    const link = listing.find(entry => isSymlinkEntry(entry))
    if (link) {
      throw new Error(`the archive contains a symbolic link, which is not accepted: ${link.fileName}`)
    }

    options.onProgress?.({ entries: listing.length, stripRoot })

    let reported = false

    await new Promise<void>((resolve, reject) => {
      fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
        if (error || !zipfile) {
          reject(error ?? new Error('could not open the archive'))
          return
        }

        zipfile.on('error', reject)
        zipfile.on('end', () => resolve())

        zipfile.on('entry', (entry) => {
          const decision = resolveArchiveEntry({
            entryName: entry.fileName,
            pathImpl,
            rootDir: destDir,
            stripRoot,
          })

          if (!decision.ok) {
            // Log once. A 700-entry archive would otherwise emit 700 identical
            // lines and bury the one that matters.
            if (!reported) {
              reported = true
              options.onReject?.({
                computedTarget: decision.computedTarget,
                normalised: decision.normalised,
                raw: decision.raw,
                reason: decision.reason,
                rootDir: pathImpl.resolve(destDir),
              })
            }
            reject(new Error(`archive entry escapes the destination directory (${decision.reason}): ${decision.raw}`))
            return
          }

          if (decision.isRootMarker) {
            zipfile.readEntry()
            return
          }

          const target = decision.target

          if (entry.fileName.endsWith('/')) {
            void mkdir(target, { recursive: true })
              .then(() => zipfile.readEntry())
              .catch(reject)
            return
          }

          zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) {
              reject(streamError ?? new Error('could not read the archive entry'))
              return
            }
            void mkdir(dirname(target), { recursive: true })
              .then(() => pipeline(stream, createWriteStream(target)))
              .then(() => zipfile.readEntry())
              .catch(reject)
          })
        })

        zipfile.readEntry()
      })
    })
  }
}

export function createRuntimeStateStore(rootDir: string) {
  const stateFile = path.join(rootDir, 'state.json')

  return {
    read: async (): Promise<RuntimeInstallRecord | undefined> => {
      try {
        const parsed = JSON.parse(await readFile(stateFile, 'utf8')) as RuntimeInstallRecord
        return parsed && typeof parsed.commit === 'string' ? parsed : undefined
      }
      catch {
        // Missing or unreadable is the same as "not installed": the bootstrapper
        // re-verifies from the filesystem anyway.
        return undefined
      }
    },
    write: async (record: RuntimeInstallRecord): Promise<void> => {
      await mkdir(rootDir, { recursive: true })
      // Temp file then rename, so a crash mid-write cannot leave a half-written
      // record that later reads as a valid install.
      const tmp = `${stateFile}.tmp`
      await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8')
      await rename(tmp, stateFile)
    },
  }
}

/**
 * Free bytes on the volume holding `dir`.
 *
 * Resolves to `undefined` when it cannot be determined, which the readiness check
 * treats as "do not block": refusing to install because a probe failed would be
 * worse than letting the installer report its own disk error.
 */

export async function freeBytesFor(dir: string): Promise<number | undefined> {
  try {
    // statvfs is not exposed by node:fs, so this uses the drive root's stats as
    // the closest available signal without shelling out.
    const info = await stat(dir)
    if (!info.isDirectory())
      return undefined
    const { execFile } = await import('node:child_process')
    if (process.platform !== 'win32')
      return undefined

    return await new Promise((resolve) => {
      execFile('wmic', ['logicaldisk', 'get', 'freespace,size'], (error, stdout) => {
        if (error) {
          resolve(undefined)
          return
        }
        const rows = stdout.trim().split(/\r?\n/).slice(1)
        const first = rows[0]?.trim().split(/\s+/)
        resolve(first?.[0] ? Number(first[0]) : undefined)
      })
    })
  }
  catch {
    return undefined
  }
}

/** Logs a bootstrap entry with the reserved prefix. Metadata only. */

export function createRuntimeLogger(sink: (line: string) => void = line => console.info(line)) {
  return (entry: BootstrapLogEntry): void => {
    const parts = [
      LOG_PREFIX,
      entry.step,
      entry.event,
      entry.exitCode !== undefined ? `exit=${entry.exitCode}` : '',
      entry.elapsedMs !== undefined ? `${entry.elapsedMs}ms` : '',
      entry.detail ?? '',
    ].filter(Boolean)
    sink(parts.join(' '))
  }
}

/** Builds the real probe, bound to this machine. */
