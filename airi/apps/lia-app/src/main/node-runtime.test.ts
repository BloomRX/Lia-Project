/**
 * Tests for the executable decision itself - not for "did we call the injected
 * executable", which would only prove the injection worked.
 *
 * The load-bearing cases are the ones that distinguish the four outcomes, and
 * the fuse decoder, which is exercised against real bytes on disk so a wrong
 * offset or a wrong state byte fails here rather than in production.
 */
import { Buffer } from 'node:buffer'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, win32 } from 'node:path'
import { execPath } from 'node:process'

import { describe, expect, it } from 'vitest'

import {
  findNodeOnPath,
  fuseFilePathFor,
  isElectronRuntime,
  readRunAsNodeFuse,
  resolveNodeInvocation,
} from './node-runtime'

const ELECTRON = { electron: '43.4.1' }
/** Must match `FUSE_SENTINEL` in node-runtime.ts, sourced from @electron/fuses. */
const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'

describe('isElectronRuntime', () => {
  it('a: the runtime fact, not the executable name, decides', () => {
    // A packaged build renames electron.exe to the product, so only the
    // runtime fact can answer this.
    expect(isElectronRuntime(ELECTRON)).toBe(true)
    expect(isElectronRuntime({})).toBe(false)
    expect(isElectronRuntime({ electron: undefined })).toBe(false)
  })
})

describe('findNodeOnPath', () => {
  it('b: it scans PATH with the platform spelling and ignores dead entries', () => {
    // Windows-shaped values on a Linux host: the delimiter must come from the
    // REQUESTED platform, or this scan silently finds nothing here and only
    // ever fails on Windows.
    const winBin = win32.join('C:', 'bin', 'node.exe')
    const env = { PATH: ['C:\\gone', 'C:\\bin'].join(';') }
    const win = findNodeOnPath({
      env,
      existsImpl: path => path === winBin,
      platform: 'win32',
    })
    expect(win).toBe(winBin)

    // Same PATH, POSIX spelling: a `node.exe` match is not a `node` match.
    expect(
      findNodeOnPath({
        env: { PATH: '/gone:/bin' },
        existsImpl: path => path === '/bin/node',
        platform: 'linux',
      }),
    ).toBe('/bin/node')

    // Nothing there, and no PATH at all.
    expect(findNodeOnPath({ env, existsImpl: () => false, platform: 'win32' })).toBeUndefined()
    expect(findNodeOnPath({ env: {}, existsImpl: () => true, platform: 'win32' })).toBeUndefined()
    // A bare `node` is not a candidate on Windows: PATHEXT is deliberately
    // never consulted, because the caller spawns the resolved path directly.
    expect(
      findNodeOnPath({
        env: { PATH: 'C:\\bin' },
        existsImpl: path => path === '/bin/node',
        platform: 'win32',
      }),
    ).toBeUndefined()
  })
})

describe('readRunAsNodeFuse', () => {
  /** Builds a binary with `wire` appended after `sentinelOffset` zero bytes. */
  async function fakeBinary(sentinelOffset: number, wire?: number[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lia-fuse-'))
    const target = join(dir, 'electron')
    const pad = Buffer.alloc(sentinelOffset)
    const parts = [pad, Buffer.from(SENTINEL, 'utf-8')]
    if (wire)
      parts.push(Buffer.from(wire))
    await writeFile(target, Buffer.concat(parts))
    return target
  }

  it('c: it reads the runAsNode byte out of a real binary', async () => {
    // V1 wire: [version, length, ...states], RunAsNode first.
    expect(await readRunAsNodeFuse(await fakeBinary(64, [1, 9, 49, 49, 49, 49, 48, 48, 48, 48, 49]))).toBe('enabled')
    expect(await readRunAsNodeFuse(await fakeBinary(64, [1, 9, 48, 49, 49, 49, 48, 48, 48, 48, 49]))).toBe('disabled')
  })

  it('d: it finds a wire that straddles the 1 MiB scan boundary', async () => {
    // The sentinel starts 16 bytes before the chunk boundary, so it cannot be
    // found unless the reads overlap.
    const offset = 1024 * 1024 - 16
    expect(await readRunAsNodeFuse(await fakeBinary(offset, [1, 9, 49, 49, 49, 49, 48, 48, 48, 48, 49]))).toBe('enabled')
  })

  it('e: anything short of an explicit enable or disable is unknown', async () => {
    // REMOVED (114) and INHERIT (144) are not proof of anything.
    expect(await readRunAsNodeFuse(await fakeBinary(64, [1, 9, 114, 49, 49, 49, 48, 48, 48, 48, 49]))).toBe('unknown')
    expect(await readRunAsNodeFuse(await fakeBinary(64, [1, 9, 144, 49, 49, 49, 48, 48, 48, 48, 49]))).toBe('unknown')
    // A wire version this code does not understand.
    expect(await readRunAsNodeFuse(await fakeBinary(64, [2, 9, 49, 49, 49, 49, 48, 48, 48, 48, 49]))).toBe('unknown')
    // A sentinel with a truncated wire.
    expect(await readRunAsNodeFuse(await fakeBinary(64, [1]))).toBe('unknown')
    // No sentinel at all: pre-fuse Electron, or not an Electron binary.
    expect(await readRunAsNodeFuse(await fakeBinary(64))).toBe('unknown')
  })

  it('f: an unreadable binary is unknown, not a crash', async () => {
    expect(await readRunAsNodeFuse(join(tmpdir(), 'lia-fuse-nope', 'electron'))).toBe('unknown')
  })

  it('g: on macOS the wire lives in the framework binary, not the executable', () => {
    const app = '/Applications/Lia.app/Contents/MacOS/Lia'
    expect(fuseFilePathFor(app, 'darwin')).toBe(
      resolve('/Applications/Lia.app/Contents/Frameworks/Electron Framework.framework/Electron Framework'),
    )
    // Everywhere else the executable carries the wire itself.
    expect(fuseFilePathFor('C:\\Lia\\Lia.exe', 'win32')).toBe('C:\\Lia\\Lia.exe')
    expect(fuseFilePathFor('/opt/lia/lia', 'linux')).toBe('/opt/lia/lia')
  })
})

describe('resolveNodeInvocation', () => {
  it('h: under Electron it prefers a real node from PATH, needing no fuse at all', () => {
    const resolution = resolveNodeInvocation({
      childLaunchesElectron: false,
      env: { PATH: 'C:\\bin' },
      execPath: 'C:\\Lia\\electron.exe',
      existsImpl: path => path === win32.join('C:', 'bin', 'node.exe'),
      // The fuse must not even be consulted on this path.
      fuseImpl: () => {
        throw new Error('the fuse must not be read when PATH has a real node')
      },
      platform: 'win32',
      versions: ELECTRON,
    })
    expect(resolution).toEqual({
      command: win32.join('C:', 'bin', 'node.exe'),
      kind: 'node-from-path',
    })
  })

  it('i: the Electron fallback needs a POSITIVE fuse read, and keeps the environment', () => {
    const base = {
      childLaunchesElectron: false,
      env: { PATH: join('C:', 'nowhere'), PROXY: 'http://corp:3128' },
      execPath: 'C:\\Lia\\electron.exe',
      existsImpl: () => false,
      platform: 'win32',
      versions: ELECTRON,
    }

    const enabled = resolveNodeInvocation({ ...base, fuseImpl: () => 'enabled' })
    expect(enabled.kind).toBe('electron-as-node')
    if ('command' in enabled) {
      const env = enabled.env as Record<string, string | undefined>
      expect(enabled.command).toBe('C:\\Lia\\electron.exe')
      expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
      // The fallback must not COST the child its own environment.
      expect(env.PATH).toBe(join('C:', 'nowhere'))
      expect(env.PROXY).toBe('http://corp:3128')
    }

    // A disabled fuse means the variable is IGNORED: betting on it reproduces
    // the exact hang this module exists to prevent.
    const disabled = resolveNodeInvocation({ ...base, fuseImpl: () => 'disabled' })
    expect(disabled.kind).toBe('unavailable')
    if (!('command' in disabled))
      expect(disabled.reason).toContain('runAsNode fuse reads disabled')

    // Neither does an unreadable one.
    const unknown = resolveNodeInvocation({ ...base, fuseImpl: () => 'unknown' })
    expect(unknown.kind).toBe('unavailable')
    if (!('command' in unknown))
      expect(unknown.reason).toContain('runAsNode fuse reads unknown')
  })

  it('j: the Stage child is NEVER given Electron-as-Node, whatever the fuse says', () => {
    // `electron-vite` launches the window with no `env` option, so the child's
    // environment reaches the Electron app verbatim; a leaked variable would
    // start the WINDOW as plain Node and no window would open.
    for (const fuse of ['enabled', 'disabled', 'unknown'] as const) {
      const resolution = resolveNodeInvocation({
        childLaunchesElectron: true,
        env: { PATH: join('C:', 'nowhere') },
        execPath: 'C:\\Lia\\electron.exe',
        existsImpl: () => false,
        fuseImpl: () => fuse,
        platform: 'win32',
        versions: ELECTRON,
      })
      expect('command' in resolution, `fuse=${fuse} must not yield an invocation`).toBe(false)
      if (!('command' in resolution))
        expect(resolution.kind).toBe('unavailable')
    }
  })

  it('k: under plain Node nothing changes - this executable is already the runtime', () => {
    for (const childLaunchesElectron of [false, true]) {
      const resolution = resolveNodeInvocation({ childLaunchesElectron, versions: {} })
      expect(resolution).toEqual({ command: execPath, kind: 'node-execpath' })
    }
  })

  it('l: no reason ever leaks PATH contents or environment values', () => {
    const secret = 'http://user:hunter2@corp:3128'
    const resolution = resolveNodeInvocation({
      childLaunchesElectron: true,
      env: { PATH: 'C:\\secret\\dir', PROXY: secret },
      execPath: 'C:\\Lia\\electron.exe',
      existsImpl: () => false,
      platform: 'win32',
      versions: ELECTRON,
    })
    expect('command' in resolution).toBe(false)
    if (!('command' in resolution)) {
      expect(resolution.reason).not.toContain(secret)
      expect(resolution.reason).not.toContain('C:\\secret\\dir')
    }
  })
})
