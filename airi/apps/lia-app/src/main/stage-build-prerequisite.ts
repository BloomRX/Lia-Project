import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { execPath as nodeExecPath } from 'node:process'

/**
 * Phase 8.0D-M3.0b: the managed Stage build prerequisite.
 *
 * THE problem this closes. `@proj-airi/core-agent` publishes through its
 * built `dist/` (`main: ./dist/index.mjs`) and `dist/` is gitignored, so a
 * fresh pull never carries it. M3 added public exports to that package which
 * `stage-ui` re-exports from RENDERER SOURCE, and the managed launch runs
 *
 *   Lia.bat -> Launcher -> "Conversar com Lia" -> AiriStageManager.start()
 *
 * which spawns `node <stage>/node_modules/electron-vite/bin/electron-vite.js
 * dev` DIRECTLY. That is deliberate and stays: the Phase 7.2 ownership fix
 * makes the launcher's child the very process that parents the Electron
 * window, with no shell and no package-manager wrapper. But it also means
 * nothing on that path ever rebuilt core-agent, so a stale `dist` made the
 * renderer fail at ESM LINK time and the transparent window showed nothing.
 *
 * Phase 8.0D-M3.0a put the rebuild into `apps/stage-tamagotchi`'s `dev`
 * script. That protects a manual `pnpm dev:tamagotchi` and nothing else - the
 * managed launch never reads that script (proven by the Windows log:
 * `spawn: node ...\electron-vite.js dev`, and by test G, which asserts the
 * spawn carries no shell and no pnpm). This module closes the managed path.
 *
 * PORTABILITY, verified rather than assumed. `execFile('pnpm', ...)` does NOT
 * work: pnpm is not an executable on PATH in a Corepack workspace (measured
 * here as `ERR ENOENT`), and on Windows the shim is `pnpm.cmd`, which Node
 * refuses to spawn without `shell: true` since the CVE-2024-27980 hardening -
 * the same DEP0190 route Phase 7.2 removed. So the build is run the way the
 * Stage itself is run: resolve the tool's bin as a concrete FILE and execute
 * it with `process.execPath`. One code path, every platform, no shell, no
 * PATHEXT, no cmd.exe, and the prerequisite is a short-lived awaited child
 * that is never owned by the launcher.
 */

/**
 * Result of one prerequisite run. Reasons are metadata only: identifiers and
 * exit codes, never stdout/stderr bodies, never paths or user content.
 */
export interface StagePrerequisiteOutcome {
  ok: boolean
  reason?: string
  /** True when the prerequisite does not apply here, so nothing was run. */
  skipped?: boolean
}

export interface StageBuildPrerequisite {
  /**
   * Synchronous and cheap: does this prerequisite apply on this machine?
   *
   * Keeping the "not applicable" answer out of the async path matters. The
   * managed start() must stay single-flight, but it must also not delay the
   * spawn when there is nothing to build - a packaged production install has
   * no source workspace, and inserting an await there would defer the child's
   * listeners and change the launch the ownership tests pin.
   */
  applies: () => boolean
  /** Stable identifier used in diagnostics, e.g. `core-agent-build`. */
  name: string
  run: () => Promise<StagePrerequisiteOutcome>
}

export interface CoreAgentBuildPrerequisiteDeps {
  /** For tests: injecting exec keeps this module electron-free. */
  execFileImpl?: typeof execFile
  /** Milliseconds before a build that never finishes is failed. */
  timeoutMs?: number
  /** The AIRI monorepo root that holds `packages/core-agent`. */
  workspaceRoot: string
}

/**
 * Shell metacharacters. This prerequisite never spawns a shell, so a build
 * script that needs one cannot be honoured - and is reported instead of
 * silently half-executed.
 */
const SHELL_METACHARACTER = /[&|;()`<>{}$]/

export const CORE_AGENT_BUILD_PREREQUISITE_NAME = 'core-agent-build'

/**
 * Builds the real `@proj-airi/core-agent` artifact, or explains why it could
 * not. Every failure path returns `ok: false` with a stable reason so the
 * manager can refuse to launch rather than serve a stale renderer.
 */
export function createCoreAgentBuildPrerequisite(
  deps: CoreAgentBuildPrerequisiteDeps,
): StageBuildPrerequisite {
  const manifestPath = join(deps.workspaceRoot, 'packages', 'core-agent', 'package.json')
  const packageDir = dirname(manifestPath)

  return {
    applies: () => existsSync(manifestPath),
    name: CORE_AGENT_BUILD_PREREQUISITE_NAME,
    async run(): Promise<StagePrerequisiteOutcome> {
      // A packaged production install has no source workspace to compile: the
      // stage ships built. Honest skip, and the manager logs it as such.
      if (!existsSync(manifestPath))
        return { ok: true, reason: 'no-source-workspace', skipped: true }

      const buildScript = readBuildScript(manifestPath)
      if (buildScript === undefined)
        return { ok: false, reason: 'manifest-unreadable' }
      if (!buildScript)
        return { ok: false, reason: 'no-build-script' }
      if (SHELL_METACHARACTER.test(buildScript))
        return { ok: false, reason: 'compound-build-script' }

      const [tool = '', ...args] = buildScript.split(/\s+/)
      const cli = resolveToolCli(packageDir, tool)
      if (!cli)
        return { ok: false, reason: 'build-tool-unresolved' }

      return await runTool(cli, args, packageDir, deps)
    },
  }
}

/**
 * The build script of `packages/core-agent`, `''` when absent, `undefined`
 * when the manifest itself could not be read.
 */
function readBuildScript(manifestPath: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      scripts?: Record<string, string>
    }
    return (manifest.scripts?.build ?? '').trim()
  }
  catch {
    return undefined
  }
}

/**
 * Resolves a build tool to the concrete JavaScript file Node can execute,
 * using the package's OWN resolution context so pnpm's isolated store layout
 * is honoured. Returns undefined when the tool or its bin cannot be found -
 * the caller fails closed rather than guessing.
 */
function resolveToolCli(packageDir: string, tool: string): string | undefined {
  if (!tool)
    return undefined
  try {
    const nodeRequire = createRequire(join(packageDir, 'package.json'))
    const toolManifestPath = nodeRequire.resolve(`${tool}/package.json`)
    const manifest = JSON.parse(readFileSync(toolManifestPath, 'utf-8')) as {
      bin?: Record<string, string> | string
    }
    const bin = manifest.bin
    const entry = typeof bin === 'string'
      ? bin
      : bin?.[tool] ?? (bin ? Object.values(bin)[0] : undefined)
    if (!entry)
      return undefined
    const cli = join(dirname(toolManifestPath), entry)
    return existsSync(cli) ? cli : undefined
  }
  catch {
    return undefined
  }
}

/** Runs `process.execPath <cli> ...args` in the package directory. No shell. */
function runTool(
  cli: string,
  args: string[],
  cwd: string,
  deps: CoreAgentBuildPrerequisiteDeps,
): Promise<StagePrerequisiteOutcome> {
  const execFileImpl = deps.execFileImpl ?? execFile
  return new Promise<StagePrerequisiteOutcome>((resolve) => {
    execFileImpl(
      nodeExecPath,
      [cli, ...args],
      { cwd, timeout: deps.timeoutMs ?? 600_000, windowsHide: true },
      (error) => {
        if (!error) {
          resolve({ ok: true, reason: 'build-succeeded' })
          return
        }
        // `code` is the exit status for a failed build and an errno string
        // (ENOENT, ETIMEDOUT, ...) when the process itself could not run.
        // Both are safe metadata.
        const code = (error as { code?: number | string }).code
        resolve({ ok: false, reason: `exit:${String(code ?? 'error')}` })
      },
    )
  })
}
