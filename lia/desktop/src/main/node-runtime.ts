/**
 * Phase 8.0D-M3.0b: the single place that decides WHICH executable runs a Node
 * CLI on behalf of Lia.
 *
 * `src/main/*` runs inside the Electron MAIN process (`main: ./out/main/index.js`,
 * `dev: electron-vite dev`), so `process.execPath` is the Electron binary, not
 * Node. Spawning it as if it were Node starts an Electron APP instead, whose
 * lifetime is governed by the app rather than by the script - which is exactly
 * the measured M3.0b failure: on Windows the tree showed `electron.exe`
 * (PID 83592) running `tsdown/dist/run.mjs` as a child of the Lia main process
 * (PID 85772), with GPU and network helpers alongside it, and no `node.exe`
 * anywhere. The child never exited, `execFile`'s callback never fired, and the
 * prerequisite stayed in `starting` with no terminal marker.
 *
 * `ELECTRON_RUN_AS_NODE` is the documented switch that makes the binary start
 * "as a normal Node.js process" - but Electron's own fuses documentation adds
 * that with the `runAsNode` fuse DISABLED the variable is IGNORED, and that
 * `child_process.fork` then throws. So setting the variable is not by itself a
 * fix: it is a bet on a fuse nobody has read. An earlier attempt at this
 * problem shipped exactly that bet and left the command as `process.execPath`.
 *
 * This module does not bet. The Electron-as-Node fallback is taken ONLY after
 * the `runAsNode` byte has been read out of the executable that would be
 * spawned, and anything short of a positive `enabled` fails the caller closed.
 *
 * The asymmetry between the two callers is load-bearing and intentional:
 * - the build CLI (`tsdown`) spawns no Electron, so Electron-as-Node is a valid
 *   substitute for it - once the fuse proves it works;
 * - the Stage child (`electron-vite dev`) launches the window with
 *   `spawn(electronPath, [entry], { stdio: 'inherit' })` and NO `env` option,
 *   so its environment reaches the Electron app verbatim. A leaked
 *   `ELECTRON_RUN_AS_NODE` would start the WINDOW as plain Node - no window at
 *   all. That child is therefore never given the fallback, whatever the fuse.
 *
 * Neither caller's ownership contract changes: the build stays an awaited
 * prerequisite, never the Stage process the launcher owns.
 */
import { Buffer } from 'node:buffer'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { posix as posixPath, win32 as win32Path } from 'node:path'
import {
  env as processEnv,
  execPath as processExecPath,
  platform as processPlatform,
  versions as processVersions,
} from 'node:process'

/**
 * Precedes the Electron fuse wire inside the binary. Value, state bytes and
 * layout taken from `@electron/fuses@1.8.0` (`dist/constants.js`,
 * `getCurrentFuseWire`) - the package that electron-builder itself uses, so
 * this is the same wire the packager would have flipped.
 */
const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
/** `FuseState.ENABLE` - the ASCII digit `'1'`. */
const FUSE_ENABLE = 49
/** `FuseState.DISABLE` - the ASCII digit `'0'`. */
const FUSE_DISABLE = 48
const FUSE_WIRE_VERSION_V1 = 1
/** `FuseV1Options.RunAsNode` is the first entry of the V1 wire. */
const FUSE_RUN_AS_NODE_INDEX = 0
/** 1 MiB per read: a 250 MB Electron binary never has to fit in memory. */
const FUSE_SCAN_CHUNK_BYTES = 1024 * 1024
/**
 * Sanity bound on the wire length. V1 defines 9 fuses; anything outside a
 * generous range means the bytes are not a wire we understand.
 */
const FUSE_WIRE_MAX_LENGTH = 64

export type NodeRuntimeKind = 'electron-as-node' | 'node-execpath' | 'node-from-path'

/**
 * Whether the `ELECTRON_RUN_AS_NODE` variable can be trusted on `execPath`.
 * `unknown` covers an unreadable file, a missing sentinel, an unrecognised wire
 * version, and the `REMOVED`/`INHERIT` byte values - none of which is proof.
 */
export type RunAsNodeFuseState = 'disabled' | 'enabled' | 'unknown'

export interface NodeInvocation {
  /** Absolute path of the executable to spawn. */
  command: string
  /**
   * Full environment for the child, present ONLY for `electron-as-node`. Every
   * other kind omits it so the child inherits `process.env` untouched.
   */
  env?: Record<string, string | undefined>
  kind: NodeRuntimeKind
}

export type NodeRuntimeResolution
  = | NodeInvocation
    | { kind: 'unavailable', reason: string }

export interface NodeRuntimeRequest {
  /**
   * `true` when the child will itself launch Electron (the Stage). Such a child
   * is NEVER given Electron-as-Node, because the variable would leak into the
   * window it is supposed to open.
   */
  childLaunchesElectron: boolean
  /** Environment to scan for PATH and to hand to the child. Default: `process.env`. */
  env?: Record<string, string | undefined>
  /** Default: `process.execPath`. */
  execPath?: string
  /** For tests: answering the PATH scan without touching the disk. */
  existsImpl?: (path: string) => boolean
  /** For tests: answering the fuse read without a real binary. */
  fuseImpl?: (execPath: string) => RunAsNodeFuseState
  /** For tests: the platform the PATH scan uses. Default: `process.platform`. */
  platform?: string
  /**
   * For tests: the runtime facts behind the executable decision. Default: this
   * process's own `process.versions`, which under Vitest is plain Node - the
   * blind spot that let the original defect ship, so tests inject an
   * Electron-shaped value.
   */
  versions?: { electron?: string }
}

/** The three filesystem calls the fuse scan needs, so tests can serve bytes. */
export interface FuseBinaryReader {
  closeSync: (fd: number) => void
  openSync: (path: string, flags: string) => number
  readSync: (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ) => number
}

const defaultFuseReader: FuseBinaryReader = { closeSync, openSync, readSync }

/**
 * `process.versions.electron` exists only under Electron. A packaged build
 * renames the binary to the product, so the executable's NAME cannot answer
 * this - only the runtime facts can.
 */
export function isElectronRuntime(versions?: { electron?: string }): boolean {
  return (versions ?? processVersions).electron !== undefined
}

/**
 * First real Node found by scanning PATH, or `undefined`.
 *
 * Scanning PATH deliberately does NOT consult PATHEXT and does NOT use a shell:
 * the caller spawns the resolved path directly, so an entry that is not the
 * platform's Node spelling is not a candidate.
 *
 * The delimiter and the path spelling follow the REQUESTED platform, never the
 * host's. Reading `node:path`'s module-level `delimiter` would make this parse a
 * Windows PATH with `:` on a Linux test host, silently finding nothing - a
 * win32 regression that only ever shows up on Windows.
 */
export function findNodeOnPath(options: {
  env?: Record<string, string | undefined>
  existsImpl?: (path: string) => boolean
  platform?: string
}): string | undefined {
  const platform = options.platform ?? processPlatform
  const pathImpl = platform === 'win32' ? win32Path : posixPath
  const env = options.env ?? processEnv
  const existsImpl = options.existsImpl ?? existsSync
  const exe = platform === 'win32' ? 'node.exe' : 'node'
  for (const dir of (env.PATH ?? '').split(pathImpl.delimiter)) {
    if (!dir)
      continue
    const candidate = pathImpl.join(dir, exe)
    if (existsImpl(candidate))
      return candidate
  }
  return undefined
}

/**
 * Where the fuse wire lives for a given executable.
 *
 * Mirrors `pathToFuseFile` in `@electron/fuses`: on macOS the wire is in the
 * framework binary inside the bundle, not in the `.app` executable itself. On
 * Windows and Linux it is the executable.
 */
export function fuseFilePathFor(execPath: string, platform?: string): string {
  if ((platform ?? processPlatform) !== 'darwin')
    return execPath
  // This branch is darwin-only, so the POSIX spelling is the right one.
  if (execPath.endsWith('.app')) {
    return posixPath.resolve(
      execPath,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    )
  }
  if (execPath.includes('.app')) {
    return posixPath.resolve(
      execPath,
      '..',
      '..',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    )
  }
  return execPath
}

/**
 * Reads the `runAsNode` fuse out of the executable, scanning in 1 MiB windows
 * so a large binary is never buffered whole.
 *
 * Returns `unknown` - never a guess - when the file cannot be opened, the
 * sentinel is absent, the wire version is not V1, or the state byte is
 * `REMOVED`/`INHERIT` rather than an explicit enable or disable.
 */
export function readRunAsNodeFuse(
  execPath: string,
  reader: FuseBinaryReader = defaultFuseReader,
  platform?: string,
): RunAsNodeFuseState {
  const target = fuseFilePathFor(execPath, platform)
  let fd: number | undefined
  try {
    fd = reader.openSync(target, 'r')
    const chunk = Buffer.allocUnsafe(FUSE_SCAN_CHUNK_BYTES)
    // Reads overlap by one sentinel-minus-one so a wire that straddles a chunk
    // boundary still appears whole inside a single window.
    const overlap = FUSE_SENTINEL.length - 1
    let readAt = 0
    for (;;) {
      const read = reader.readSync(fd, chunk, 0, chunk.length, readAt)
      if (read <= 0)
        return 'unknown'
      const hit = chunk.subarray(0, read).indexOf(FUSE_SENTINEL)
      if (hit !== -1) {
        const wireAt = readAt + hit + FUSE_SENTINEL.length
        const header = Buffer.alloc(2)
        if (reader.readSync(fd, header, 0, 2, wireAt) !== 2)
          return 'unknown'
        const [version, length] = header
        if (version !== FUSE_WIRE_VERSION_V1)
          return 'unknown'
        if (length < FUSE_RUN_AS_NODE_INDEX + 1 || length > FUSE_WIRE_MAX_LENGTH)
          return 'unknown'
        const states = Buffer.alloc(length)
        if (reader.readSync(fd, states, 0, length, wireAt + 2) !== length)
          return 'unknown'
        const byte = states[FUSE_RUN_AS_NODE_INDEX]
        if (byte === FUSE_ENABLE)
          return 'enabled'
        if (byte === FUSE_DISABLE)
          return 'disabled'
        return 'unknown'
      }
      if (read < chunk.length)
        return 'unknown'
      readAt += read - overlap
    }
  }
  catch {
    // An unreadable binary is not proof of anything: report `unknown` and let
    // the caller fail closed with a reason it can log.
    return 'unknown'
  }
  finally {
    if (fd !== undefined) {
      try {
        reader.closeSync(fd)
      }
      catch {
        // Nothing useful to do with a failed close on a read-only descriptor.
      }
    }
  }
}

/**
 * Decides the executable for one child process.
 *
 * 1. Not Electron: this process IS Node, so `process.execPath` is correct.
 * 2. Electron with a real Node on PATH: use it. Preferred in every case, since
 *    it needs no fuse and no environment variable.
 * 3. Electron, no Node on PATH, child launches Electron: unavailable. The
 *    variable must never reach that child.
 * 4. Electron, no Node on PATH, child is a plain CLI: use Electron-as-Node ONLY
 *    when the `runAsNode` fuse reads `enabled`; otherwise unavailable.
 *
 * Every `unavailable` carries a static reason - no PATH entries, no environment
 * values - so callers can log it verbatim without leaking anything sensitive.
 */
export function resolveNodeInvocation(request: NodeRuntimeRequest): NodeRuntimeResolution {
  const versions = request.versions ?? processVersions
  const execPath = request.execPath ?? processExecPath

  if (!isElectronRuntime(versions))
    return { command: execPath, kind: 'node-execpath' }

  const fromPath = findNodeOnPath({
    env: request.env,
    existsImpl: request.existsImpl,
    platform: request.platform,
  })
  if (fromPath)
    return { command: fromPath, kind: 'node-from-path' }

  if (request.childLaunchesElectron) {
    return {
      kind: 'unavailable',
      reason:
        'no-node-runtime-for-stage: PATH has no node, and the stage child launches '
        + 'Electron itself, so ELECTRON_RUN_AS_NODE must never be passed to it',
    }
  }

  const fuse = (request.fuseImpl ?? readRunAsNodeFuse)(execPath)
  if (fuse === 'enabled') {
    return {
      command: execPath,
      // The parent environment is spread in full: the fallback must not COST
      // the child its PATH, proxy or locale settings.
      env: { ...(request.env ?? processEnv), ELECTRON_RUN_AS_NODE: '1' },
      kind: 'electron-as-node',
    }
  }

  return {
    kind: 'unavailable',
    reason:
      'no-node-runtime: PATH has no node and the Electron runAsNode fuse reads '
      + `${fuse}, so ELECTRON_RUN_AS_NODE cannot be trusted to start a Node CLI`,
  }
}
