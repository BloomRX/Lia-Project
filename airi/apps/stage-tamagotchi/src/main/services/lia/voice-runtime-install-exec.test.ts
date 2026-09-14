import type { Mock } from 'vitest'

import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The spawn contract of the Electron bindings.
 *
 * The bootstrapper's own tests inject a fake `exec`, which is right for testing
 * decisions but means they cannot see how the real child process is configured.
 * These tests close that gap, because two properties live *only* here and both
 * are load-bearing:
 *
 * - `shell: false`. With a shell, the install directory would be re-parsed and a
 *   path containing `&` or `"` could change what runs.
 * - `stdio[0] === 'ignore'`. AllTalk's silent installer prompts `choice /C YN`
 *   when a step fails. An open stdin would block forever; closed, the failure
 *   surfaces as a non-zero exit.
 *
 * Neither is visible from the pure layer, so neither would be caught by a
 * mutation there.
 */

const spawnCalls: Array<{ args: string[], command: string, options: Record<string, unknown> }> = []

/** A child process stub that answers like the real one. */
function fakeChild(exitCode: number | null = 0, stdout = '', stderr = '') {
  const child = new EventEmitter() as EventEmitter & {
    kill: Mock
    stderr: Readable
    stdout: Readable
  }
  child.stdout = Readable.from([stdout])
  child.stderr = Readable.from([stderr])
  child.kill = vi.fn()
  // Exit on the next tick, as a real process would.
  queueMicrotask(() => child.emit('exit', exitCode))
  return child
}

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ args, command, options })
    return fakeChild(0)
  },
}))

const { createRuntimeExec, createRuntimeRunCommand } = await import('./voice-runtime-install-exec')

beforeEach(() => {
  spawnCalls.length = 0
})

describe('how the installer is spawned', () => {
  it('never enables a shell', async () => {
    const exec = createRuntimeExec()

    await exec('cmd.exe', ['/d', '/s', '/c', 'atsetup.bat', '-silent'], {
      cwd: 'C:\\Users\\lia\\AppData\\Local\\Lia\\runtimes\\alltalk\\app',
      timeoutMs: 1000,
    })

    expect(spawnCalls).toHaveLength(1)
    // The property, not just its absence: an explicit false is what a reader of
    // the diff can see, and what a mutation to `true` has to change.
    expect(spawnCalls[0].options.shell).toBe(false)
  })

  it('passes the directory as cwd, keeping it out of the argument list', async () => {
    const exec = createRuntimeExec()
    const dir = 'C:\\Program Files (x86)\\Lia & Co\\runtime'

    await exec('cmd.exe', ['/d', '/s', '/c', 'atsetup.bat', '-silent'], { cwd: dir, timeoutMs: 1000 })

    expect(spawnCalls[0].options.cwd).toBe(dir)
    // A directory with `&`, spaces and parentheses is exactly what a shell would
    // mis-parse. It must appear nowhere in the command or its arguments.
    expect(spawnCalls[0].command).not.toContain(dir)
    for (const arg of spawnCalls[0].args)
      expect(arg).not.toContain(dir)
  })

  it('closes stdin so a failure prompt cannot hang the install', async () => {
    const exec = createRuntimeExec()

    await exec('cmd.exe', ['/c', 'atsetup.bat', '-silent'], { cwd: 'C:\\x', timeoutMs: 1000 })

    expect(spawnCalls[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
  })

  it('hides the console window', async () => {
    const exec = createRuntimeExec()

    await exec('cmd.exe', ['/c', 'atsetup.bat'], { cwd: 'C:\\x', timeoutMs: 1000 })

    expect(spawnCalls[0].options.windowsHide).toBe(true)
  })

  it('reports the exit code rather than swallowing it', async () => {
    const run = createRuntimeRunCommand()

    const result = await run('curl', ['--version'])

    expect(result.code).toBe(0)
    expect(spawnCalls[0].options.shell).toBe(false)
  })
})
