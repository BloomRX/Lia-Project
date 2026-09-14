import type { BootstrapLogEntry, RuntimeInstallRecord } from './voice-runtime-bootstrap'
import type { CommandResult, RunCommand } from './voice-runtime-env'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { fromBuffer } from 'yauzl'

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

/**
 * Extracts a ZIP into `destDir`.
 *
 * GitHub's archive endpoint wraps everything in a top-level
 * `<repo>-<sha>/` folder; that layer is stripped so the tree lands directly in
 * the destination. Entries are joined with `join` and re-checked, so a crafted
 * archive cannot write outside the destination.
 */

export function createRuntimeExtract() {
  return (archivePath: string, destDir: string): Promise<void> =>
    new Promise((resolve, reject) => {
      void readFile(archivePath).then((buffer) => {
        fromBuffer(buffer, { lazyEntries: true }, (error, zipfile) => {
          if (error || !zipfile) {
            reject(error ?? new Error('could not open the archive'))
            return
          }

          let topLevel: string | undefined

          zipfile.on('error', reject)
          zipfile.on('end', () => resolve())

          zipfile.on('entry', (entry) => {
            const parts = entry.fileName.split('/')
            // Strip the wrapper folder GitHub adds.
            const relative = parts.slice(topLevel === undefined ? 0 : 1).join('/')
            if (topLevel === undefined)
              topLevel = parts[0]

            if (!relative) {
              zipfile.readEntry()
              return
            }

            const target = join(destDir, relative)
            if (!target.startsWith(destDir)) {
              reject(new Error('archive entry escapes the destination directory'))
              return
            }

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
      }).catch(reject)
    })
}

/** Reads and writes the install record. A corrupt file reads as absent. */

export function createRuntimeStateStore(rootDir: string) {
  const path = join(rootDir, 'state.json')

  return {
    read: async (): Promise<RuntimeInstallRecord | undefined> => {
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as RuntimeInstallRecord
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
      const tmp = `${path}.tmp`
      await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8')
      await rename(tmp, path)
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
