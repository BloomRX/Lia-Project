import type { RuntimeStateSnapshot } from '@lia/core/alltalk/runtime'
import type { LiaBridgeConfig } from '@lia/core/bridge/lia-config'
import type { LiaProductPaths } from '@lia/core/paths/product-paths'
import type { LiaProductConfigSnapshot } from '@lia/core/product/config'
import type { LiaSecretCipher, LiaSecretVault } from '@lia/core/secrets/vault'
import type { LiaCustomVoiceProfile } from '@lia/core/voices/types'

import type { AiriStageState } from './airi-stage-manager'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAllTalkClient, DEFAULT_ALLTALK_BASE_URL, DEFAULT_ALLTALK_TIMEOUT_MS } from '@lia/core/alltalk/client'
import { gatherPortOwners, inspectProcess } from '@lia/core/alltalk/port-diagnostics'
import { loopbackHostFor, probeTcpListeners } from '@lia/core/alltalk/port-listeners'
import { createRuntimeManager } from '@lia/core/alltalk/runtime'
import { buildLiaBridgeConfig, stageEnvFor } from '@lia/core/bridge/lia-config'
import { liaProductPaths } from '@lia/core/paths/product-paths'
import { readLiaProductConfig } from '@lia/core/product/config'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createLiaVoiceProfileStore } from '@lia/core/voices/profiles'

import { AiriStageManager } from './airi-stage-manager'

/**
 * The Lia host (Phase 7): where the launcher PROCESS meets Lia Core.
 *
 * This module imports ZERO Electron symbols - the OS cipher and the
 * user-data home arrive here as injections from the Electron entry, which
 * is the only place `electron` may appear. The app therefore boots, reads
 * its config, lists voices, inspects its runtimes and manages the stage
 * even when the whole AIRI folder is missing or broken (contract items A/B
 * and 1/8), and every piece of it is unit-testable as plain Node code.
 *
 * What the host deliberately is NOT: a mini-AIRI. No plugin host, no chat,
 * no stage UI - "Conversar com Lia" delegates the entire companion
 * experience to the stage child.
 */

export interface LiaHomeStatus {
  /** Chat provider onboarding: has a preferred target AND its key present. */
  ai: { ready: boolean }
  /** Voice selection + runtime facts for the home strip. */
  alltalk: {
    installed: boolean
    installDir?: string
    phase: 'unconfigured' | RuntimeStateSnapshot['phase']
  }
  config: {
    filePath: string
    status: 'invalid' | 'missing' | 'ok' | 'read-error'
  }
  /** Canonical user-data root and how it was resolved. */
  paths: LiaProductPaths
  stage: {
    available: boolean
    state: AiriStageState
  }
  voices: {
    count: number
    profiles: LiaCustomVoiceProfile[]
  }
}

export interface LiaHostDeps {
  /**
   * The OS cipher for the secret vault (injected by the Electron entry from
   * `safeStorage`; tests inject an identity cipher).
   */
  cipher: LiaSecretCipher
  /** Env for path resolution (tests point it at fixture folders). */
  env?: Record<string, string | undefined>
  exists?: (path: string) => boolean
  /** Never-secret log lines; the renderer log strip shows a pass-through. */
  onEvent?: (event: string, detail?: string) => void
  /** Never-crashes platform override for tests. */
  platform?: NodeJS.Platform
  /** Where the AIRI monorepo lives (default: sibling of the app package). */
  workspaceRoot?: string
  /** Test seam: the stage manager is replaceable without touching spawn. */
  stageManagerFactory?: (deps: ConstructorParameters<typeof AiriStageManager>[0]) => AiriStageManager
}

export interface LiaHost {
  /** The resolved bridge contract for THIS launch (built fresh from disk). */
  bridgeConfig: () => Promise<LiaBridgeConfig>
  /** The "Conversar com Lia" pipeline (architecture items 9/12). */
  conversar: () => Promise<AiriStageState>
  homeStatus: () => Promise<LiaHomeStatus>
  listVoices: () => Promise<LiaCustomVoiceProfile[]>
  paths: LiaProductPaths
  productSnapshot: () => Promise<LiaProductConfigSnapshot | undefined>
  runtime: () => Promise<ReturnType<typeof createRuntimeManager>>
  stage: AiriStageManager
  /** Launch facts the stage child will receive (bridge env + shared home). */
  stageEnv: () => Promise<Record<string, string>>
  vault: LiaSecretVault
}

/** execFile with captured stdout, shaped for the diagnostics module. */
async function execCapture(command: string, args: string[], options: { timeoutMs: number }): Promise<{ code: null | number, stdout: string }> {
  return await new Promise((resolvePromise) => {
    execFile(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: options.timeoutMs }, (error, stdout) => {
      resolvePromise({
        code: typeof error?.code === 'number' ? error.code : 0,
        stdout: typeof stdout === 'string' ? stdout : '',
      })
    })
  })
}

/** The API port and the bundled-web port the diagnostics inspect. */
function runtimePorts(baseUrl: string): number[] {
  try {
    const apiPort = Number.parseInt(new URL(baseUrl).port || '7851', 10)
    return [apiPort, apiPort + 1]
  }
  catch {
    return [7851, 7852]
  }
}

export function createLiaHost(deps: LiaHostDeps): LiaHost {
  const paths = liaProductPaths({ env: deps.env, exists: deps.exists })
  const platform = deps.platform ?? process.platform
  const vault = createLiaSecretVault({
    cipher: deps.cipher,
    filePath: paths.vaultFile,
  })
  const voices = createLiaVoiceProfileStore({ rootDir: paths.voicesRoot })
  const emit = deps.onEvent ?? (() => {})

  // The canonical runtime facts, as configured in the product document.
  // The manager is rebuilt only when the document changes; the launcher's
  // boot NEVER starts the heavy runtime (contract item 12).

  const workspaceRoot = deps.workspaceRoot ?? defaultWorkspaceRoot()

  const stage = (deps.stageManagerFactory ?? ((d: ConstructorParameters<typeof AiriStageManager>[0]) => new AiriStageManager(d)))({
    onLog: line => emit('lia-app.stage-log', line),
    workspaceRoot,
  })

  let cached: { installDir: string, manager: ReturnType<typeof createRuntimeManager>, snapshot: LiaProductConfigSnapshot | undefined } | undefined

  async function readSnapshot(): Promise<{ snapshot: LiaProductConfigSnapshot | undefined, status: LiaHomeStatus['config']['status'] }> {
    const read = await readLiaProductConfig(paths.productConfigFile)
    return { snapshot: read.status === 'ok' ? read.value : undefined, status: read.status }
  }

  async function manager(): Promise<ReturnType<typeof createRuntimeManager>> {
    const { snapshot } = await readSnapshot()
    const alltalk = snapshot?.voice?.runtime?.alltalk
    const installDir = alltalk?.installDir?.trim() ?? ''
    if (cached && cached.installDir === installDir)
      return cached.manager

    const runtimeConfig = {
      baseUrl: alltalk?.baseUrl ?? DEFAULT_ALLTALK_BASE_URL,
      installDir: installDir || undefined,
      timeoutMs: alltalk?.timeoutMs ?? DEFAULT_ALLTALK_TIMEOUT_MS,
      voicesDir: alltalk?.voicesDir,
    }

    const built = createRuntimeManager({
      // The socket fact about the port, deliberately decoupled from the API
      // health fact (Phase 6 lessons travelled with the core).
      probeOccupied: platform === 'win32'
        ? async () => await probeTcpListeners({
          host: loopbackHostFor(runtimeConfig.baseUrl),
          ports: runtimePorts(runtimeConfig.baseUrl),
        })
        : async () => 'free' as const,
      execImpl: async (command, args, options) => await new Promise((resolvePromise) => {
        // The Windows process-tree kill never propagates a non-zero exit
        // into a crash - the round-7 contract.
        execFile(command, args, { timeout: options.timeoutMs }, (error) => {
          resolvePromise({ code: typeof error?.code === 'number' ? error.code : 0 })
        })
      }),
      inspectProcess: platform === 'win32'
        ? async pid => await inspectProcess({ exec: execCapture, platform }, pid)
        : undefined,
      installDir,
      isHealthy: async () => {
        const probe = await createAllTalkClient(runtimeConfig).status()
        return probe.ok
      },
      onEvent: emit,
      platform,
      portOwnerDiagnostics: platform === 'win32'
        ? async () => await gatherPortOwners({
          exec: execCapture,
          installDir,
          log: line => emit('lia-app.runtime-diagnostics', line),
          platform,
          ports: runtimePorts(runtimeConfig.baseUrl),
        })
        : undefined,
    })
    cached = { installDir, manager: built, snapshot }
    return built
  }

  const homeStatus = async (): Promise<LiaHomeStatus> => {
    const { snapshot, status } = await readSnapshot()
    const runtime = await manager()
    const profiles = await voices.list()
    const installed = await runtime.isInstalled()
    const installDir = snapshot?.voice?.runtime?.alltalk?.installDir
    const preferredAi = snapshot?.provider?.chat?.preferred
    return {
      ai: {
        ready: preferredAi !== undefined && vault.hasSecret(preferredAi.providerId, 'apiKey'),
      },
      alltalk: {
        installed,
        installDir,
        phase: installDir ? runtime.state().phase : 'unconfigured',
      },
      config: { filePath: paths.productConfigFile, status },
      paths,
      stage: { available: stage.isAvailable(), state: stage.state() },
      voices: { count: profiles.length, profiles },
    }
  }

  const bridgeFactory = async (): Promise<LiaBridgeConfig> => {
    const { snapshot } = await readSnapshot()
    return buildLiaBridgeConfig({
      hasSecret: providerId => vault.hasSecret(providerId, 'apiKey'),
      productConfigFile: paths.productConfigFile,
      snapshot: snapshot ?? {},
      vaultFile: paths.vaultFile,
    })
  }

  async function hostStageEnv(): Promise<Record<string, string>> {
    const bridge = await bridgeFactory()
    return {
      // The stage child inherits the SAME Lia home - never a fork of the
      // user's data (contract item 7/J).
      APP_USER_DATA_PATH: paths.userDataDir,
      ...stageEnvFor(bridge),
    }
  }

  return {
    bridgeConfig: bridgeFactory,
    /**
     * "Conversar com Lia": validate configuration, ensure the managed voice
     * runtime is up ONLY when the chosen voice needs it (contract item 12),
     * then launch the stage - separate child, single-flight (items 9/10).
     */
    conversar: async () => {
      const { snapshot } = await readSnapshot()
      const preferredAi = snapshot?.provider?.chat?.preferred
      if (!preferredAi || !vault.hasSecret(preferredAi.providerId, 'apiKey')) {
        emit('lia-app.conversar-blocked', 'reason=ai-not-ready')
        throw new Error('Lia is not fully configured yet. Finish the AI setup first.')
      }
      const preferredVoice = snapshot?.voice?.tts?.preferred
      if (preferredVoice?.providerId === 'custom-local-voice' && snapshot?.voice?.runtime?.alltalk?.installDir) {
        const runtime = await manager()
        const state = await runtime.start({ source: 'conversar' })
        if (state.phase !== 'ready') {
          emit('lia-app.conversar-blocked', `reason=runtime-not-ready phase=${state.phase}`)
          throw new Error('The voice system could not be made ready.')
        }
      }
      return await stage.start({ env: await hostStageEnv() })
    },
    homeStatus,
    listVoices: async () => await voices.list(),
    paths,
    productSnapshot: async () => (await readSnapshot()).snapshot,
    runtime: manager,
    stage,
    stageEnv: hostStageEnv,
    vault,
  }
}

/**
 * The AIRI workspace the launcher manages the stage from: the app sits at
 * `<repo>/airi/apps/lia-app`, so the monorepo root is two folders up from
 * the package root. `LIA_AIRI_ROOT` overrides (QA rigs, packaged layout).
 */
function defaultWorkspaceRoot(): string {
  const override = process.env.LIA_AIRI_ROOT?.trim()
  if (override)
    return resolve(override)
  // src/main (or out/main) -> app root -> apps -> airi monorepo root
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', '..', '..', '..')
}
