/**
 * Phase 8.0D-M3.0a: the Stage **dev** build contract.
 *
 * Root cause this pins, proven at runtime on Windows:
 *
 *   - `@proj-airi/core-agent` publishes through its built `dist/`, and `dist/`
 *     is gitignored;
 *   - M3 added new public exports to it (`selectProviderContextMessages` and
 *     friends) that `stage-ui` consumes from **renderer source**;
 *   - `Lia.bat -> pnpm dev:lia -> @lia/lia-app dev` rebuilds `@lia/core`, and
 *     the managed Stage launch runs `@proj-airi/stage-tamagotchi dev` - neither
 *     built core-agent;
 *   - so pulling product code could leave renderer source and package `dist`
 *     inconsistent. The renderer then fails at ESM **link** time on a missing
 *     named export, nothing mounts, and because the main window is
 *     `transparent: true` the Stage exists only as a taskbar icon.
 *
 * Release is NOT affected and must stay that way: `stage-ui` declares
 * `@proj-airi/core-agent` as a workspace dependency and turbo's `build` task
 * has `dependsOn: ["^build"]`, so `turbo run build` already orders it. Only the
 * `dev` scripts sit outside that graph - which is exactly what this contract
 * fixes, and why nothing here touches `build`/`start`.
 *
 * These are executable tests, not source scans: the ordering and the
 * abort-on-failure properties are proven by running the REAL script string from
 * `package.json` in a real shell against stubbed commands, and the artifact
 * property is proven by running real ES modules in a child Node process and
 * by reading the export clause of the real built artifact.
 */
import { execFileSync, execSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = resolve(HERE, '..', '..')
const WORKSPACE_ROOT = resolve(APP_ROOT, '..', '..')
const STAGE_PACKAGE = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>
}
const CORE_AGENT_DIST = join(WORKSPACE_ROOT, 'packages', 'core-agent', 'dist', 'index.mjs')

/** The M3 public symbols `stage-ui` renderer source imports from core-agent. */
const M3_SYMBOLS = [
  'countImagePartsInMessage',
  'countProviderContextImageParts',
  'hasProviderContextImageInput',
  'isProviderContextMessage',
  'selectProviderContextMessages',
] as const

const CORE_AGENT_BUILD_STEP = 'pnpm -F @proj-airi/core-agent run build'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stage-dev-contract-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { force: true, recursive: true })
    }
    catch {
      // Best effort: the OS owns its own temp directory.
    }
  }
})

/**
 * Creates a directory of stub commands that record their invocation, so the
 * REAL npm script can be executed without building or launching anything.
 *
 * Both a POSIX executable and a `.cmd` shim are written for every name, so the
 * same script string runs under `/bin/sh` and under `cmd.exe`.
 */
function createStubBin(labels: Record<string, { exitCode?: number }>): { bin: string, log: string } {
  const dir = makeTempDir()
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  const log = join(dir, 'invocations.log')
  writeFileSync(log, '')
  for (const [name, options] of Object.entries(labels)) {
    const exitCode = options.exitCode ?? 0
    const posix = join(bin, name)
    writeFileSync(
      posix,
      [
        '#!/bin/sh',
        `printf '%s %s\\n' '${name}' "$*" >> "$DEV_CONTRACT_LOG"`,
        `exit ${exitCode}`,
        '',
      ].join('\n'),
    )
    chmodSync(posix, 0o755)
    writeFileSync(
      join(bin, `${name}.cmd`),
      [
        '@echo off',
        `>>"%DEV_CONTRACT_LOG%" echo ${name} %*`,
        `exit /b ${exitCode}`,
        '',
      ].join('\r\n'),
    )
  }
  return { bin, log }
}

/** Runs one npm script for real, with the stub bin first on PATH. */
function runScript(script: string, stubs: { bin: string, log: string }): { failed: boolean } {
  try {
    execSync(script, {
      cwd: APP_ROOT,
      env: { ...process.env, DEV_CONTRACT_LOG: stubs.log, PATH: `${stubs.bin}${delimiter}${process.env.PATH ?? ''}` },
      stdio: 'ignore',
    })
    return { failed: false }
  }
  catch {
    return { failed: true }
  }
}

function recordedInvocations(log: string): string[] {
  return readFileSync(log, 'utf-8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

describe('stage dev build contract (Phase 8.0D-M3.0a)', () => {
  it('a: dev rebuilds core-agent before electron-vite, and aborts if that build fails', () => {
    const stubs = createStubBin({
      'electron-vite': {},
      'install-electron': {},
      'pnpm': {},
    })

    const result = runScript(STAGE_PACKAGE.scripts.dev, stubs)
    const invocations = recordedInvocations(stubs.log)

    // The real script string ran to completion under a real shell.
    expect(result.failed).toBe(false)
    // 3: ordering - the core-agent rebuild happens, and happens FIRST, so the
    // renderer can never be served against a stale dist.
    expect(invocations[0]).toBe(`${CORE_AGENT_BUILD_STEP}`)
    expect(invocations[1]).toBe('install-electron')
    expect(invocations[2]).toBe('electron-vite dev')
    expect(invocations).toHaveLength(3)
    expect(invocations.indexOf(CORE_AGENT_BUILD_STEP))
      .toBeLessThan(invocations.findIndex(line => line.startsWith('electron-vite')))
  })

  it('b: a failed core-agent build stops the launch - never serves stale output', () => {
    const stubs = createStubBin({
      'electron-vite': {},
      'install-electron': {},
      'pnpm': { exitCode: 1 },
    })

    const result = runScript(STAGE_PACKAGE.scripts.dev, stubs)
    const invocations = recordedInvocations(stubs.log)

    // 4: `&&` chaining means the failed build is terminal.
    expect(result.failed).toBe(true)
    expect(invocations).toEqual([CORE_AGENT_BUILD_STEP])
    expect(invocations.some(line => line.startsWith('electron-vite'))).toBe(false)
    expect(invocations.some(line => line.startsWith('install-electron'))).toBe(false)
  })

  it('c: the xwayland dev variant carries the same guarantee', () => {
    const stubs = createStubBin({
      'electron-vite': {},
      'install-electron': {},
      'pnpm': {},
    })

    const result = runScript(STAGE_PACKAGE.scripts['dev:xwayland'], stubs)
    const invocations = recordedInvocations(stubs.log)

    expect(result.failed).toBe(false)
    expect(invocations[0]).toBe(CORE_AGENT_BUILD_STEP)
    expect(invocations[2]).toBe('electron-vite dev -- --ozone-platform=x11')
  })

  it('d: release and preview scripts are untouched by the dev-only fix', () => {
    // 5: the development build contract must not leak into build/runtime.
    expect(STAGE_PACKAGE.scripts.build).toBe('electron-vite build')
    expect(STAGE_PACKAGE.scripts.start).toBe('install-electron && electron-vite preview')
    expect(STAGE_PACKAGE.scripts['start:xwayland']).toBe('install-electron && electron-vite preview -- --ozone-platform=x11')
    expect(STAGE_PACKAGE.scripts['app:build']).toBe('pnpm run build')
    expect(STAGE_PACKAGE.scripts['app:dev']).toBe('pnpm run dev')

    for (const name of ['build', 'start', 'start:xwayland', 'app:build'])
      expect(STAGE_PACKAGE.scripts[name]).not.toContain('core-agent')
  })

  it('e: the dev scripts are exactly the contracted command lines', () => {
    expect(STAGE_PACKAGE.scripts.dev)
      .toBe(`${CORE_AGENT_BUILD_STEP} && install-electron && electron-vite dev`)
    expect(STAGE_PACKAGE.scripts['dev:xwayland'])
      .toBe(`${CORE_AGENT_BUILD_STEP} && install-electron && electron-vite dev -- --ozone-platform=x11`)
  })

  it('f: an artifact without the M3 exports fails at ESM link, not at call time', () => {
    // 1: the pre-M3 public surface, modelled as a real ES module. This is the
    // shape the Windows machine had: a dist built before M3, so the name the
    // renderer imports simply is not exported.
    //
    // This MUST run in a real Node child process. Vitest serves modules through
    // Vite's transform, which does not enforce ESM named-export linkage - there
    // the import silently resolves to `undefined`. A real ES module loader is
    // what rejects, and that loader is what the Electron renderer uses.
    const dir = makeTempDir()
    writeFileSync(
      join(dir, 'stale-artifact.mjs'),
      'export function createChatOrchestratorRuntime() { return \'pre-m3\' }\n',
    )
    writeFileSync(
      join(dir, 'consumer.mjs'),
      'import { selectProviderContextMessages } from \'./stale-artifact.mjs\'\n'
      + 'console.log(typeof selectProviderContextMessages)\n',
    )

    let stderr = ''
    let failed = false
    try {
      execFileSync(process.execPath, [join(dir, 'consumer.mjs')], {
        encoding: 'utf-8',
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    }
    catch (error) {
      failed = true
      stderr = String((error as { stderr?: string }).stderr ?? '')
    }

    // The failure is a link-time SyntaxError: the renderer graph aborts before
    // any code runs, which is why the Stage showed nothing and logged nothing.
    expect(failed).toBe(true)
    expect(stderr).toMatch(/SyntaxError/)
    expect(stderr).toMatch(/does not provide an export named 'selectProviderContextMessages'/)
  })

  it('g: the rebuilt artifact exposes every M3 symbol the renderer imports', () => {
    // 2, control side: with the export present the very same import links.
    const dir = makeTempDir()
    writeFileSync(
      join(dir, 'fresh-artifact.mjs'),
      'export function selectProviderContextMessages() { return [] }\n',
    )
    writeFileSync(
      join(dir, 'consumer.mjs'),
      'import { selectProviderContextMessages } from \'./fresh-artifact.mjs\'\n'
      + 'console.log(typeof selectProviderContextMessages)\n',
    )

    const stdout = execFileSync(process.execPath, [join(dir, 'consumer.mjs')], { encoding: 'utf-8' })
    expect(stdout.trim()).toBe('function')
  })

  // dist/ is gitignored, so it only exists where the packages were built.
  it.skipIf(!existsSync(CORE_AGENT_DIST))(
    'h: the real built core-agent artifact publishes the M3 symbols',
    () => {
      // This reads the BUILT artifact, not the source - the artifact is what
      // was stale on Windows, so it is the artifact that has to be checked.
      //
      // It parses the export clause instead of importing the module on
      // purpose: `dist/index.mjs` imports transitive workspace packages whose
      // own `dist/` is not necessarily built in a test environment, so a real
      // import fails for reasons unrelated to this contract. The export clause
      // is exactly the surface the renderer's ESM link step reads.
      const artifact = readFileSync(CORE_AGENT_DIST, 'utf-8')
      const exportClause = /export\s*\{([^}]*)\}/.exec(artifact)?.[1] ?? ''
      const published = new Set(
        exportClause.split(',').map(name => name.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean),
      )

      expect(published.size).toBeGreaterThan(0)
      for (const symbol of M3_SYMBOLS)
        expect(published.has(symbol), `${symbol} missing from the built artifact`).toBe(true)
      // Control: a pre-M3 symbol that was always published stays published.
      expect(published.has('createChatOrchestratorRuntime')).toBe(true)
    },
  )

  it('i: core-agent is reachable from the Stage only through stage-ui, which turbo orders for release', () => {
    // Why the fix is dev-only: the Stage does not depend on core-agent
    // directly, it reaches it through stage-ui, and stage-ui declares it as a
    // runtime workspace dependency - so `turbo run build`'s `^build` edge
    // already covers build/release.
    const stage = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(stage.dependencies?.['@proj-airi/core-agent']).toBeUndefined()
    expect(stage.dependencies?.['@proj-airi/stage-ui']).toBeDefined()

    const stageUi = JSON.parse(
      readFileSync(join(WORKSPACE_ROOT, 'packages', 'stage-ui', 'package.json'), 'utf-8'),
    ) as { dependencies?: Record<string, string> }
    expect(stageUi.dependencies?.['@proj-airi/core-agent']).toBe('workspace:^')

    const turbo = JSON.parse(readFileSync(join(WORKSPACE_ROOT, 'turbo.json'), 'utf-8')) as {
      tasks: Record<string, { dependsOn?: string[] }>
    }
    expect(turbo.tasks.build.dependsOn).toContain('^build')
  })

  it('j: the core-agent package really does publish through dist', () => {
    // The premise of the whole contract: there is no source entry point to
    // fall back on, so a stale dist is a stale package.
    const pkg = JSON.parse(
      readFileSync(join(WORKSPACE_ROOT, 'packages', 'core-agent', 'package.json'), 'utf-8'),
    ) as { exports?: Record<string, unknown>, main?: string }
    expect(pkg.main).toBe('./dist/index.mjs')
    expect(JSON.stringify(pkg.exports)).toContain('./dist/index.mjs')
  })
})
