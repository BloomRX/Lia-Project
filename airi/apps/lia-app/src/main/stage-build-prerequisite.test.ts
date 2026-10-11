/**
 * Phase 8.0D-M3.0b: the managed Stage build prerequisite itself.
 *
 * What has to hold, and why each leg exists:
 *
 *  - PORTABILITY. The prerequisite must never depend on a package manager
 *    being an executable. `execFile('pnpm', ...)` is not one: in a Corepack
 *    workspace pnpm is not on PATH at all (measured: `ERR ENOENT`), and on
 *    Windows the shim is `pnpm.cmd`, which Node refuses to spawn without
 *    `shell: true` since the CVE-2024-27980 hardening - the DEP0190 route
 *    Phase 7.2 removed. So every leg here asserts the shape that IS portable:
 *    `process.execPath` running a concrete `.mjs` file, no shell option.
 *  - FAIL CLOSED. A build we cannot run must stop the launch, because
 *    launching anyway is precisely the stale-`dist` bug that made the Stage
 *    invisible on Windows.
 *  - PRODUCTION SKIP. A packaged install has no source workspace and must not
 *    pay for - or fail on - a build it does not need.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execPath } from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import {
  CORE_AGENT_BUILD_PREREQUISITE_NAME,
  createCoreAgentBuildPrerequisite,
} from './stage-build-prerequisite'

const AIRI_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

/** A workspace holding only what the parameter under test provides. */
async function makeWorkspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lia-prereq-'))
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content)
  }
  return root
}

/** Records every exec call so the command SHAPE can be asserted, not assumed. */
function fakeExec(options: { code?: number, error?: string } = {}) {
  const calls: { args: string[], command: string, opts: Record<string, unknown> }[] = []
  const impl = vi.fn((
    command: string,
    args: string[],
    opts: Record<string, unknown>,
    cb: (error: null | { code?: number | string }, stderr: string, stdout: string) => void,
  ) => {
    calls.push({ args, command, opts })
    const failure = options.error ?? (options.code === undefined ? undefined : options.code)
    cb(failure === undefined ? null : { code: failure }, '', '')
    return {} as never
  })
  return { calls, impl }
}

/** A core-agent package whose build script runs `mytool`, resolvable locally. */
function resolvableToolFixture(buildScript: string): Record<string, string> {
  return {
    'packages/core-agent/node_modules/mytool/cli.mjs': 'console.log(\'built\')\n',
    'packages/core-agent/node_modules/mytool/package.json':
      JSON.stringify({ bin: { mytool: './cli.mjs' }, name: 'mytool', version: '0.0.0' }),
    'packages/core-agent/package.json':
      JSON.stringify({ name: '@proj-airi/core-agent', scripts: { build: buildScript } }),
  }
}

describe('phase 8.0D-M3.0b: core-agent build prerequisite', () => {
  it('a: it applies exactly when a core-agent source workspace exists', async () => {
    const bare = await makeWorkspace({ 'apps/stage-tamagotchi/package.json': '{}' })
    expect(createCoreAgentBuildPrerequisite({ workspaceRoot: bare }).applies()).toBe(false)

    const withSource = await makeWorkspace({
      'packages/core-agent/package.json': '{"scripts":{"build":"tsdown"}}',
    })
    expect(createCoreAgentBuildPrerequisite({ workspaceRoot: withSource }).applies()).toBe(true)
  })

  it('b: with no source workspace it skips honestly instead of failing', async () => {
    const root = await makeWorkspace({ 'apps/stage-tamagotchi/package.json': '{}' })
    const exec = fakeExec()
    const outcome = await createCoreAgentBuildPrerequisite({
      execFileImpl: exec.impl as never,
      workspaceRoot: root,
    }).run()

    expect(outcome).toEqual({ ok: true, reason: 'no-source-workspace', skipped: true })
    expect(exec.calls).toHaveLength(0)
  })

  it('c: it runs the build as `node <resolved .mjs>`, never a package manager and never a shell', async () => {
    const root = await makeWorkspace(resolvableToolFixture('mytool --flag'))
    const exec = fakeExec()
    const outcome = await createCoreAgentBuildPrerequisite({
      execFileImpl: exec.impl as never,
      workspaceRoot: root,
    }).run()

    expect(outcome.ok).toBe(true)
    expect(exec.calls).toHaveLength(1)
    const call = exec.calls[0]

    // THE portability invariant: our own Node, a concrete script file, the
    // package dir as cwd. No 'pnpm', no '.cmd', no '.bat', no shell.
    expect(call.command).toBe(execPath)
    expect(call.args[0].endsWith('.mjs')).toBe(true)
    expect(call.args[0]).toContain(join('mytool', 'cli.mjs'))
    expect(call.args.slice(1)).toEqual(['--flag'])
    expect(call.command).not.toContain('pnpm')
    expect(call.args[0]).not.toMatch(/\.(cmd|bat|ps1)$/i)
    expect(call.opts.shell, 'a shell would reopen the DEP0190 route').toBeUndefined()
    expect(call.opts.cwd).toBe(join(root, 'packages', 'core-agent'))
  })

  it('d: a build that exits non-zero fails the prerequisite with the exit code', async () => {
    const root = await makeWorkspace(resolvableToolFixture('mytool'))
    const exec = fakeExec({ code: 1 })
    const outcome = await createCoreAgentBuildPrerequisite({
      execFileImpl: exec.impl as never,
      workspaceRoot: root,
    }).run()

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('exit:1')
  })

  it('e: an unrunnable build tool fails closed rather than launching anyway', async () => {
    const root = await makeWorkspace({
      'packages/core-agent/package.json':
        JSON.stringify({ name: '@proj-airi/core-agent', scripts: { build: 'not-installed-anywhere' } }),
    })
    const exec = fakeExec()
    const outcome = await createCoreAgentBuildPrerequisite({
      execFileImpl: exec.impl as never,
      workspaceRoot: root,
    }).run()

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('build-tool-unresolved')
    expect(exec.calls, 'nothing may be spawned for a tool we could not resolve').toHaveLength(0)
  })

  it('f: a compound build script is reported, never half-executed through a shell', async () => {
    const root = await makeWorkspace(resolvableToolFixture('mytool && echo done'))
    const exec = fakeExec()
    const outcome = await createCoreAgentBuildPrerequisite({
      execFileImpl: exec.impl as never,
      workspaceRoot: root,
    }).run()

    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('compound-build-script')
    expect(exec.calls).toHaveLength(0)
  })

  it('g: a package with no build script fails closed', async () => {
    const root = await makeWorkspace({
      'packages/core-agent/package.json': JSON.stringify({ name: '@proj-airi/core-agent' }),
    })
    const outcome = await createCoreAgentBuildPrerequisite({ workspaceRoot: root }).run()
    expect(outcome).toEqual({ ok: false, reason: 'no-build-script' })
  })

  it('h: an unreadable manifest fails closed instead of being treated as fresh', async () => {
    const root = await makeWorkspace({ 'packages/core-agent/package.json': '{ not json' })
    const outcome = await createCoreAgentBuildPrerequisite({ workspaceRoot: root }).run()
    expect(outcome).toEqual({ ok: false, reason: 'manifest-unreadable' })
  })

  it('i: it names itself for diagnostics', () => {
    expect(CORE_AGENT_BUILD_PREREQUISITE_NAME).toBe('core-agent-build')
    expect(createCoreAgentBuildPrerequisite({ workspaceRoot: '/nonexistent' }).name)
      .toBe(CORE_AGENT_BUILD_PREREQUISITE_NAME)
  })

  // The real workspace, real tsdown, real artifact. This is the leg that
  // proves the mechanism end to end rather than against a fixture.
  const realManifest = join(AIRI_ROOT, 'packages', 'core-agent', 'package.json')
  it.skipIf(!existsSync(realManifest))(
    'j: against the real workspace it rebuilds the real core-agent artifact',
    async () => {
      const prerequisite = createCoreAgentBuildPrerequisite({ workspaceRoot: AIRI_ROOT })
      expect(prerequisite.applies()).toBe(true)

      const dist = join(AIRI_ROOT, 'packages', 'core-agent', 'dist', 'index.mjs')
      const outcome = await prerequisite.run()
      expect(outcome.ok, `real core-agent build failed: ${outcome.reason ?? 'unknown'}`).toBe(true)
      expect(existsSync(dist), 'the build must really emit the artifact').toBe(true)

      // The exports stage-ui re-exports from renderer source - the exact
      // surface whose absence made the Stage invisible on Windows.
      const artifact = readFileSync(dist, 'utf-8')
      const published = /export\s*\{([^}]*)\}/.exec(artifact)?.[1] ?? ''
      for (const symbol of [
        'countImagePartsInMessage',
        'countProviderContextImageParts',
        'hasProviderContextImageInput',
        'isProviderContextMessage',
        'selectProviderContextMessages',
      ]) {
        expect(published, `${symbol} missing from the rebuilt artifact`).toContain(symbol)
      }
    },
    300_000,
  )
})
