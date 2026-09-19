import type { AllTalkStatus } from '@lia/core/alltalk/client'
import type { CustomVoiceEngineStatus } from '@lia/core/alltalk/engine-config'
import type { RuntimeStateSnapshot } from '@lia/core/alltalk/runtime'
import type { LiaBridgeConfig } from '@lia/core/bridge/lia-config'
import type { LiaProductPaths } from '@lia/core/paths/product-paths'
import type { LiaInstallDirCandidate } from '@lia/core/paths/runtime-paths'
import type { LiaProductAllTalkRuntime, LiaProductConfigSnapshot, LiaProductConfigUpdate } from '@lia/core/product/config'
import type { LiaSecretCipher, LiaSecretVault } from '@lia/core/secrets/vault'
import type { LiaCustomVoiceProfile, LiaVoiceProfileImportRequest } from '@lia/core/voices/types'

import type { AiriStageState } from './airi-stage-manager'
import type { ShutdownReport } from './shutdown-coordinator'

import process from 'node:process'

import { execFile } from 'node:child_process'
import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAllTalkClient, DEFAULT_ALLTALK_BASE_URL, DEFAULT_ALLTALK_TIMEOUT_MS } from '@lia/core/alltalk/client'
import { readCustomVoiceEngineStatus } from '@lia/core/alltalk/engine-config'
import { gatherPortOwners, inspectProcess } from '@lia/core/alltalk/port-diagnostics'
import { loopbackHostFor, probeTcpListeners } from '@lia/core/alltalk/port-listeners'
import { createRuntimeManager, inspectAllTalkInstall } from '@lia/core/alltalk/runtime'
import { createAllTalkSyncService, isVoiceVisibleToAllTalk } from '@lia/core/alltalk/voices-sync'
import { buildLiaBridgeConfig, stageEnvFor } from '@lia/core/bridge/lia-config'
import { classifyInstallLocation, inspectInstallLocationTarget } from '@lia/core/paths/install-location'
import { liaProductPaths } from '@lia/core/paths/product-paths'
import { resolveAllTalkInstallCandidates, resolveAllTalkRuntimeDir, resolveAllTalkVoicesDirForInstallDir } from '@lia/core/paths/runtime-paths'
import { readLiaProductConfig, updateLiaProductConfig } from '@lia/core/product/config'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { createLiaVoiceProfileStore, findMissingFiles } from '@lia/core/voices/profiles'

import { AiriStageManager } from './airi-stage-manager'
import { ShutdownCoordinator } from './shutdown-coordinator'

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
  /**
   * Voice runtime facts, on four SEPARATE axes (integration hotfix, item 6):
   * an installation can exist without running; a process can be stopped
   * without the configuration being absent. "Unconfigured" was the old
   * single-bucket lie - it is gone.
   */
  /**
   * Resilience contract (follow-up hotfix, item 5): if detection never ran
   * (path resolution threw, snapshot unreadable) the fields are ABSENT and
   * `error` carries the operational reason - never a fabricated
   * `installed: false` invented by an exception.
   */
  alltalk: {
    /** Voice configuration targets the custom runtime? Absent when the document could not be read. */
    configured?: boolean
    /** Why inspection did not produce facts, when it did not. */
    error?: string
    /** Install markers all present at the effective install dir? Absent = inspection never ran (unknown). */
    installed?: boolean
    /** The effective install dir - only when it was PROVEN installed. */
    installDir?: string
    /** The manager's own phase; 'unknown' when inspection failed before any phase could exist. */
    phase: 'unknown' | RuntimeStateSnapshot['phase']
    /** A voice profile id is actively selected. Absent when the document could not be read. */
    profileSelected?: boolean
    /** The runtime answers health / holds a li-managed tree right now. */
    running: boolean
  }
  config: {
    error?: string
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
    error?: string
    profiles: LiaCustomVoiceProfile[]
  }
}

/**
 * One renderer "save" of the Config screen. Secrets travel ONLY through
 * `secrets` - never inside `update`, where the core writer's recursive
 * secret-field veto would (correctly) refuse them (contract item 5).
 */
export interface LiaConfigUpdatePayload {
  secrets?: { key: string, scope: string, value: string }[]
  update: LiaProductConfigUpdate
}

export type LiaConfigUpdateResult
  = | { status: 'ok', value: LiaProductConfigSnapshot }
    | { message: string, status: 'invalid-source' | 'secret-forbidden' | 'secret-vault-failed' | 'write-failed' }

export interface LiaHostDeps {
  /**
   * The OS cipher for the secret vault (injected by the Electron entry from
   * `safeStorage`; tests inject an identity cipher).
   */
  cipher: LiaSecretCipher
  /** Env for path resolution (tests point it at fixture folders). */
  env?: Record<string, string | undefined>
  exists?: (path: string) => boolean
  /**
   * Install-marker inspection, injected so integration tests can exercise
   * the REAL resolver and manager against a virtual disk (the canonical
   * LocalAppData root only exists on a real Windows profile).
   */
  inspectInstallImpl?: typeof inspectAllTalkInstall
  /**
   * Engine-config read-back (Phase 7.5 Part 9). Default: the core's real
   * file read; tests stub the disk outcome only.
   */
  engineStatusImpl?: (appDir: string) => Promise<CustomVoiceEngineStatus>
  /**
   * The `/api/voices` probe used by the Part-8 visibility check. Default:
   * the real client; tests answer from a scripted server state.
   */
  voiceVisibilityProbeImpl?: (config: RuntimeManagerConfig) => Promise<AllTalkStatus>
  /** Never-secret log lines; the renderer log strip shows a pass-through. */
  onEvent?: (event: string, detail?: string) => void
  /** Never-crashes platform override for tests. */
  platform?: NodeJS.Platform
  /** Where the AIRI monorepo lives (default: sibling of the app package). */
  workspaceRoot?: string
  /** Test seam: the stage manager is replaceable without touching spawn. */
  stageManagerFactory?: (deps: ConstructorParameters<typeof AiriStageManager>[0]) => AiriStageManager
  /**
   * Test seam: replace the runtime manager construction (e.g. to hand the
   * coordinator a manager that owns a fake child, for contract test B).
   */
  runtimeManagerFactory?: (config: RuntimeManagerConfig) => ReturnType<typeof createRuntimeManager>
}

/** The slice of product config the runtime manager is built from. */
export interface RuntimeManagerConfig {
  baseUrl: string
  installDir?: string
  timeoutMs: number
  voicesDir?: string
}

/**
 * Phase 7.4 (Part G/H/J): what the Voice screen renders about WHERE the
 * heavy runtime lives. `effectiveInstallDir` is the first trusted
 * candidate (configured first, canonical default otherwise) - the dir the
 * markers would be checked against, whether installed or not.
 */
export interface LiaRuntimeLocationStatus {
  /** `%LOCALAPPDATA%\Lia\runtimes\alltalk\app` (Windows) - the Phase 7.1 canonical default. */
  canonicalDefaultDir: string
  configuredInstallDir?: string
  customActive: boolean
  effectiveInstallDir: string
  /** Marker-proven install at the effective dir (never "the folder exists"). */
  installed: boolean
}

/** The pick outcome, in UI vocabulary; raw reasons stay in events. */
export type LiaRuntimeLocationPickResult
  = | { status: 'canceled' }
    | {
      installDir: string
      /** Exactly why nothing was moved to the new root (Part J choice A). */
      note: 'new-location-applies-to-future-install'
      status: 'ok'
    }
    | { message: string, reason: string, status: 'rejected' }

export interface LiaHost {
  /** The resolved bridge contract for THIS launch (built fresh from disk). */
  bridgeConfig: () => Promise<LiaBridgeConfig>
  /** The "Conversar com Lia" pipeline (architecture items 9/12). */
  conversar: () => Promise<AiriStageState>
  /** The supervisor's single graceful-shutdown officer (Phase 7.1, items 1/3). */
  coordinator: ShutdownCoordinator
  homeStatus: () => Promise<LiaHomeStatus>
  /** Imports a voice profile picked via the main-process dialog (allowlist). */
  importVoice: (
    request: LiaVoiceProfileImportRequest,
    allowedSourcePaths: ReadonlySet<string>,
  ) => Promise<Awaited<ReturnType<ReturnType<typeof createLiaVoiceProfileStore>['importProfile']>>>
  listVoices: () => Promise<LiaCustomVoiceProfile[]>
  paths: LiaProductPaths
  productSnapshot: () => Promise<LiaProductConfigSnapshot | undefined>
  /** Graceful supervisor shutdown; safe to call more than once (single-flight). */
  quit: () => Promise<ShutdownReport>
  runtime: () => Promise<ReturnType<typeof createRuntimeManager>>
  stage: AiriStageManager
  /** Launch facts the stage child will receive (bridge env + shared home). */
  stageEnv: () => Promise<Record<string, string>>
  /** Persists the Config screen through the core writer; secrets to the vault only. */
  updateConfig: (payload: LiaConfigUpdatePayload) => Promise<LiaConfigUpdateResult>
  /** Where the heavy runtime lives now (Part G/J status for the Voice screen). */
  runtimeLocationStatus: () => Promise<LiaRuntimeLocationStatus>
  /**
   * Applies a dialog-chosen runtime root (Part H/K). NEVER moves bytes: a
   * valid new location pins the NEXT install; an invalid one is rejected
   * with a human message and changes nothing. The directory path only ever
   * enters through the main-process dialog, validated by the core rules.
   */
  applyRuntimeLocation: (chosenDir: string | null) => Promise<LiaRuntimeLocationPickResult>
  /** Clears the configured root, restoring the canonical default. */
  clearRuntimeLocation: () => Promise<LiaRuntimeLocationStatus>
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
  /**
   * The ONE environment every core resolver sees (hotfix, items 1-3): the
   * injected test block, otherwise the process's REAL one. Passing an
   * absent env down used to reach the resolvers as an EMPTY lookup, which
   * made the core believe LOCALAPPDATA did not exist on a healthy profile.
   */
  const env = deps.env ?? process.env
  const paths = liaProductPaths({ env, exists: deps.exists })

  // Safe boot evidence (hotfix, item 1): booleans only, never values.
  if ((deps.platform ?? process.platform) === 'win32') {
    deps.onEvent?.('lia:env', JSON.stringify({
      hasAPPDATA: env.APPDATA !== undefined && env.APPDATA !== '',
      hasLOCALAPPDATA: env.LOCALAPPDATA !== undefined && env.LOCALAPPDATA !== '',
      hasUSERPROFILE: env.USERPROFILE !== undefined && env.USERPROFILE !== '',
      source: deps.env ? 'injected' : 'process',
    }))
  }
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

  /**
   * The supervisor shutdown officer (Phase 7.1, items 1/2/3). Registration
   * order IS teardown order: the stage leaves first (its children may talk
   * to the voice runtime), the owned voice runtime second.
   *
   * `holdsOwnedProcess` is ownership, by this session, of a LIVE process -
   * the exact round-7 axiom. An adopted/external runtime and any stage we
   * did not spawn answer 'no-owned-process' and are never touched
   * (contract tests C/D).
   */
  const coordinator = new ShutdownCoordinator({
    onLog: line => emit('lia-app.shutdown', line),
  })
  coordinator.register({
    holdsOwnedProcess: () => stage.holdsOwnedStage(),
    name: 'stage',
    stop: async () => await stage.stop(),
  })
  coordinator.register({
    // Ownership semantics (Phase 7.1 correction): the question is never
    // "did WE spawn it this session?" - it is "is it PROVEN lia-managed?".
    // A recovered pre-existing Lia runtime answers true and IS stopped on
    // quit (test B); external and unknown answer false and are never
    // touched (tests C/D). Origin and ownership stay separate.
    holdsOwnedProcess: () => cached?.manager.hasManagedRuntime() ?? false,
    name: 'voice-runtime',
    stop: async () => {
      await (await manager()).stop()
    },
  })

  async function readSnapshot(): Promise<{ snapshot: LiaProductConfigSnapshot | undefined, status: LiaHomeStatus['config']['status'] }> {
    const read = await readLiaProductConfig(paths.productConfigFile)
    return { snapshot: read.status === 'ok' ? read.value : undefined, status: read.status }
  }

  /**
   * Phase 7.4 + 7.5 voice gate (items B/E + Part 6/7/8/9): when the
   * preferred voice is `custom-local-voice`, prove the whole slice - in the
   * order the facts make cheap - before the stage is ever asked to start:
   *   1. the selected profile exists in the canonical library (+ its files);
   *   2. a marker-proven install exists (any trusted candidate);
   *   3. the managed voice copy is PUBLISHED into the voices folder of that
   *      same install (fs-only step - so it happens before any start, and
   *      the voices folder derives FROM the proven install when none was
   *      configured, closing the "sync wrote to the wrong server" split);
   *   4. the engine config says the custom model is actually usable
   *      (engine_loaded=xtts + complete weights - read-back, never a guess);
   *   5. the runtime starts and reaches real health (the manager's poll);
   *   6. the voice the request will name is CONFIRMED visible via
   *      `GET /api/voices` before the stage enters speech.
   * Each failure is a human pt-BR message thrown to the CTA plus a
   * `conversar-blocked` diagnostic event carrying only safe metadata
   * (reason codes, counts, the managed FILENAME - never text, audio or
   * source paths).
   *
   * A non-custom provider starts NOTHING: AllTalk stays at rest (item D).
   */
  async function ensureVoiceReadyForConversar(snapshot: LiaProductConfigSnapshot | undefined): Promise<void> {
    const preferredVoice = snapshot?.voice?.tts?.preferred
    if (preferredVoice?.providerId !== 'custom-local-voice')
      return

    const profileId = preferredVoice.voiceId
    const profile = profileId ? await voices.get(profileId) : undefined
    if (!profile) {
      emit('lia-app.conversar-blocked', 'reason=voice-profile-missing')
      throw new Error('Não encontrei a voz selecionada. Confira a voz ativa nas configurações de Voz da Lia.')
    }
    const missing = await findMissingFiles(voices, profile)
    if (missing.length > 0) {
      emit('lia-app.conversar-blocked', `reason=voice-profile-files-missing count=${missing.length}`)
      throw new Error('Não encontrei a voz selecionada. Importe-a novamente nas configurações de Voz da Lia.')
    }

    const runtime = await manager()
    if (!(await runtime.isInstalled())) {
      emit('lia-app.conversar-blocked', 'reason=voice-runtime-not-installed')
      throw new Error('O sistema de voz precisa ser instalado. Abra as configurações da Lia para instalar.')
    }

    const alltalkConfig = snapshot?.voice?.runtime?.alltalk
    // The preflights and the spawn MUST agree on ONE install. The manager
    // owns that contract (ownership beats resolution, item G), so the
    // effective install here is the manager's - never a second, divergent
    // resolve.
    const effectiveInstallDir = cached?.installDir ?? ''
    const resolution = effectiveInstallDir ? undefined : await resolveInstallDir(alltalkConfig?.installDir)
    const installDirForPrep = effectiveInstallDir || (resolution?.candidate?.dir ?? '')

    // Phase 7.5.1, items A/D: the voices folder the PREP writes into is
    // derived EXCLUSIVELY from the install the manager will run -
    // `<install app dir>\voices`, the same folder `/api/voices` lists and
    // `/api/tts-generate` resolves from (verified upstream: list_files
    // this_dir/"voices", fresh per request, `*.wav` only, exact-shape
    // `{"voices": string[]}`). A configured voicesDir that diverges would
    // be the split-brain the QA proved present=false with, so divergence is
    // diagnosed and the DERIVED root wins, never the configured one.
    const voicesDir = resolveAllTalkVoicesDirForInstallDir(installDirForPrep)
    const configuredVoicesDir = alltalkConfig?.voicesDir?.trim() ?? ''
    if (configuredVoicesDir && configuredVoicesDir.toLowerCase() !== voicesDir.toLowerCase()) {
      emit('lia-app.conversar-note', `reason=voices-dir-diverges configured=${configuredVoicesDir} derived=${voicesDir}`)
    }

    // Prep is a pure FILESYSTEM step: publish the canonical reference audio
    // as the deterministic managed copy BEFORE the runtime starts, so no
    // engine restart cycle is ever spent discovering a missing voice later.
    const sync = await voicesSyncService(voicesDir).ensureProfileAvailableToAllTalk(profile.id)
    if (!sync.ok) {
      emit('lia-app.conversar-blocked', `reason=voice-sync-failed code=${sync.error}`)
      throw new Error('Não foi possível preparar a voz da Lia. Tente novamente ou veja Diagnósticos.')
    }
    emit('lia-app.voice-synced', `voice=${sync.filename} copied=${sync.copied}`)

    // Engine truth is read back from config files, never assumed: a runtime
    // that boots Piper answers every XTTS request with a 500.
    if (installDirForPrep) {
      const engine = await (deps.engineStatusImpl?.(installDirForPrep)
        ?? readCustomVoiceEngineStatus(fsEngineConfigDeps(), installDirForPrep))
      if (!engine.ready) {
        emit('lia-app.conversar-blocked', `reason=voice-engine-not-ready engine=${engine.engine ?? 'unknown'} modelLoaded=${engine.modelComplete} firstRunPending=${engine.firstRunPending}`)
        throw new Error('O sistema de voz não conseguiu carregar o modelo. Veja Diagnósticos para detalhes.')
      }
      emit('lia-app.voice-engine-ready', `engine=${engine.engine ?? 'unknown'} modelLoaded=${engine.modelComplete}`)
    }

    // Diagnostic D (7.5.1): the ONE line that proves the sync destination
    // and the running server live under the same root, before we spend a
    // start on it. Safe paths only - no contents, no audio.
    emit('lia-app.voice-prep', `runtimeInstallDir=${installDirForPrep} voicesDir=${voicesDir} managedVoice=${sync.filename}`)

    let state: RuntimeStateSnapshot
    try {
      state = await runtime.start({ source: 'conversar' })
    }
    catch (thrown) {
      emit('lia-app.conversar-blocked', `reason=voice-runtime-start-failed detail=${briefReason(thrown)}`)
      throw new Error('Não foi possível iniciar o sistema de voz. Veja Diagnósticos para detalhes.')
    }
    if (state.phase !== 'ready') {
      emit('lia-app.conversar-blocked', `reason=voice-runtime-readiness-timeout phase=${state.phase}`)
      throw new Error('O sistema de voz não ficou pronto a tempo. Tente novamente ou veja Diagnósticos.')
    }

    // The last proof is on the API itself: the filename the synthesis
    // request will name must be visible to THIS server (Part 8). A probe
    // failure is inconclusive, never a silent pass.
    // The probe answers about the same voices dir the sync wrote into -
    // the derived root, not whatever is configured (that configured value
    // is precisely what the QA proved wrong).
    const probeConfig = { ...runtimeConfigFor(alltalkConfig, installDirForPrep), voicesDir }
    const probe = await (deps.voiceVisibilityProbeImpl?.(probeConfig)
      ?? createAllTalkClient(probeConfig).status())
    if (!probe.ok) {
      emit('lia-app.conversar-blocked', `reason=voice-probe-inconclusive state=${probe.state}`)
      throw new Error('Não foi possível confirmar a voz selecionada. Veja Diagnósticos para detalhes.')
    }
    if (!isVoiceVisibleToAllTalk(probe.voices, sync.filename)) {
      // The file may exist yet be invisible: `.WAV` uppercase never matches
      // the upstream `.wav` filter. The disk cross-check keeps that reason
      // reportable without audio contents.
      const existsOnDisk = await probeVoiceCopyOnDisk(voicesDir, sync.filename)
      emit('lia-app.conversar-blocked', `reason=voice-not-visible voice=${sync.filename} present=false onDisk=${existsOnDisk} knownVoices=${probe.voices.length}`)
      throw new Error('Não foi possível carregar a voz selecionada.')
    }
    emit('lia-app.voice-visible', `voice=${sync.filename} present=true`)
    emit('lia-app.voice-runtime-ready', `phase=${state.phase} source=conversar`)
  }

  /** Filesystem cross-check for the not-visible diagnostic: exists on disk? */
  /** Filesystem cross-check for the not-visible diagnostic: exists on disk? */
  async function probeVoiceCopyOnDisk(voicesDir: string, filename: string): Promise<boolean> {
    try {
      await stat(join(voicesDir, filename))
      return true
    }
    catch {
      return false
    }
  }

  /** The shared voices sync service for one resolved folder. */
  function voicesSyncService(voicesDir: string) {
    return createAllTalkSyncService({ store: voices, voicesDir })
  }

  /** Real fs deps for the engine read-back (tests ride the real tmp disk). */
  function fsEngineConfigDeps() {
    return {
      listFiles: async (dir: string) => {
        try {
          return await readdir(dir)
        }
        catch {
          return undefined
        }
      },
      readFile: async (path: string) => {
        try {
          return await readFile(path, 'utf8')
        }
        catch {
          return undefined
        }
      },
      writeFile: async (path: string, content: string) => {
        await writeFile(path, content)
      },
    }
  }

  /** Doc values merged with the proven install (probe + client boundary). */
  function runtimeConfigFor(alltalkConfig: LiaProductAllTalkRuntime | undefined, effectiveInstallDir: string): RuntimeManagerConfig {
    return {
      baseUrl: alltalkConfig?.baseUrl?.trim() || DEFAULT_ALLTALK_BASE_URL,
      timeoutMs: alltalkConfig?.timeoutMs && alltalkConfig.timeoutMs > 0 ? alltalkConfig.timeoutMs : DEFAULT_ALLTALK_TIMEOUT_MS,
      ...(alltalkConfig?.voicesDir?.trim() ? { voicesDir: alltalkConfig.voicesDir.trim() } : {}),
      ...(effectiveInstallDir ? { installDir: effectiveInstallDir } : {}),
    }
  }

  function buildManager(runtimeConfig: RuntimeManagerConfig): ReturnType<typeof createRuntimeManager> {
    const installDir = runtimeConfig.installDir?.trim() ?? ''
    return createRuntimeManager({
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
  }

  /**
   * Where the install lives, decided with EVIDENCE (integration hotfix):
   * the document's configured path wins only when it proves installed;
   * the canonical `%LOCALAPPDATA%\Lia\runtimes\alltalk\app` is the
   * default the Windows installer actually wrote. Detection is the same
   * marker set as the runtime's own - never "the folder exists".
   */
  async function resolveInstallDir(configuredInstallDir?: string): Promise<{ candidate: LiaInstallDirCandidate | undefined, installed: boolean }> {
    const candidates = resolveAllTalkInstallCandidates({
      configuredInstallDir,
      env,
      platform,
      userDataDir: paths.userDataDir,
    })
    const inspect = deps.inspectInstallImpl ?? inspectAllTalkInstall
    const first = candidates[0]
    for (const candidate of candidates) {
      if (await inspect(candidate.dir, { platform })) {
        return { candidate, installed: true }
      }
    }
    // Nothing installed: keep the document's pointer if one exists (a
    // broken-but-explicit path the user can fix at instead of a silent
    // reroute), otherwise the canonical future home.
    return { candidate: first, installed: false }
  }

  async function manager(): Promise<ReturnType<typeof createRuntimeManager>> {
    const { snapshot } = await readSnapshot()
    const alltalk = snapshot?.voice?.runtime?.alltalk
    const resolution = await resolveInstallDir(alltalk?.installDir)
    const installDir = resolution.candidate?.dir ?? ''

    // Phase 7.5.1, item G: ownership beats resolution. A cached manager that
    // currently HOLDS a live runtime (spawned child or proven attachment)
    // is never thrown away because the re-resolved install string drifted:
    // discarding it here orphaned the live process and re-classified our
    // own tree as an unknown intruder on the next start - the exact
    // `port-occupied-unknown-process` the QA logged, and the exact reason
    // the shutdown later skipped a runtime this session had started.
    if (cached && cached.manager.hasManagedRuntime()) {
      if (cached.installDir !== installDir)
        emit('lia-app.runtime-ownership-retained', `session=<held> resolved=<drifted>`)
      return cached.manager
    }
    if (cached && cached.installDir === installDir)
      return cached.manager

    const runtimeConfig: RuntimeManagerConfig = {
      baseUrl: alltalk?.baseUrl ?? DEFAULT_ALLTALK_BASE_URL,
      installDir: installDir || undefined,
      timeoutMs: alltalk?.timeoutMs ?? DEFAULT_ALLTALK_TIMEOUT_MS,
      voicesDir: alltalk?.voicesDir,
    }

    const built = (deps.runtimeManagerFactory ?? buildManager)(runtimeConfig)
    cached = { installDir, manager: built, snapshot }
    return built
  }

  /**
   * Sections computed INDEPENDENTLY (follow-up hotfix, item 5): a runtime
   * path exception must not hide stage availability, a bad document must
   * not zero the voice list, and a detection that never ran must surface
   * "unknown" - never a fabricated `false`.
   */
  const homeStatus = async (): Promise<LiaHomeStatus> => {
    const reason = (thrown: unknown): string => {
      // Lint policy forbids the instanceof ternary; this is its contract.
      try {
        if (thrown instanceof Error)
          return thrown.message
        return String(thrown)
      }
      catch {
        return 'unknown operational error'
      }
    }

    const configSection = readSnapshot()
      .then(({ snapshot, status }): { error?: string, snapshot: LiaProductConfigSnapshot | undefined, status: LiaHomeStatus['config']['status'] } =>
        ({ snapshot, status }))
      .catch(thrown => ({ error: reason(thrown), snapshot: undefined, status: 'read-error' as const }))

    const voicesSection = voices.list()
      .then(profiles => ({ count: profiles.length, profiles }))
      .catch((thrown): { count: number, error: string, profiles: LiaCustomVoiceProfile[] } =>
        ({ count: 0, error: reason(thrown), profiles: [] }))

    const [config, voiceList] = await Promise.all([configSection, voicesSection])
    const { snapshot } = config
    const preferredVoice = snapshot?.voice?.tts?.preferred

    let alltalk: LiaHomeStatus['alltalk']
    try {
      const runtime = await manager()
      const installed = await runtime.isInstalled()
      const runtimeState = runtime.state()
      alltalk = {
        configured: snapshot === undefined ? undefined : preferredVoice?.providerId === 'custom-local-voice',
        installed,
        // The dir is named only when the install there PROVED valid; a
        // guessed location remains out of a status users act on.
        installDir: installed ? cached?.installDir : undefined,
        phase: runtimeState.phase === 'ready'
          ? 'ready'
          : installed ? runtimeState.phase : 'notInstalled',
        profileSelected: snapshot === undefined ? undefined : preferredVoice?.voiceId !== undefined,
        running: runtimeState.phase === 'ready',
      }
    }
    catch (thrown) {
      alltalk = {
        configured: snapshot === undefined ? undefined : preferredVoice?.providerId === 'custom-local-voice',
        error: reason(thrown),
        phase: 'unknown',
        profileSelected: snapshot === undefined ? undefined : preferredVoice?.voiceId !== undefined,
        running: false,
      }
    }

    let aiReady = false
    try {
      const preferredAi = snapshot?.provider?.chat?.preferred
      aiReady = preferredAi !== undefined && vault.hasSecret(preferredAi.providerId, 'apiKey')
    }
    catch { /* a vault read failure is degraded status, not a crash */ }

    return {
      ai: { ready: aiReady },
      alltalk,
      config: { error: config.error, filePath: paths.productConfigFile, status: config.status },
      paths,
      stage: { available: stage.isAvailable(), state: stage.state() },
      voices: voiceList,
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

  /** Short, safe failure evidence for diagnostics: bounded, space-free. */
  function briefReason(thrown: unknown): string {
    try {
      // Lint policy forbids the instanceof ternary; this is its contract.
      let text = ''
      if (thrown instanceof Error)
        text = thrown.message
      else
        text = String(thrown)
      return text.replace(/\s+/g, ' ').slice(0, 80).trim() || 'unknown'
    }
    catch {
      return 'unknown'
    }
  }

  /**
   * Part G/H: the user-facing WHERE. `resolveInstallDir` already implements
   * the precedence (configured-proven > canonical-proven > configured-unproven
   * > canonical) with markers as the only "installed" proof; this only
   * renders the outcome to the Voice screen.
   */
  async function runtimeLocationStatus(): Promise<LiaRuntimeLocationStatus> {
    const { snapshot } = await readSnapshot()
    const configuredInstallDir = snapshot?.voice?.runtime?.alltalk?.installDir?.trim() || undefined
    const resolution = await resolveInstallDir(configuredInstallDir)
    return {
      canonicalDefaultDir: resolveAllTalkRuntimeDir({ env, platform, userDataDir: paths.userDataDir }),
      customActive: configuredInstallDir !== undefined,
      ...(configuredInstallDir ? { configuredInstallDir } : {}),
      effectiveInstallDir: resolution.candidate?.dir ?? '',
      installed: resolution.installed,
    }
  }

  /** Human vocabulary for each machine reject reason (pt-BR, Part J). */
  function locationRejectMessage(reason: string): string {
    const messages: Record<string, string> = {
      'empty': 'Escolha uma pasta para o sistema de voz.',
      'not-absolute': 'Escolha uma pasta válida no computador (por exemplo D:\\Lia\\VoiceRuntime).',
      'filesystem-root': 'Não é possível instalar o sistema de voz na raiz do disco. Escolha uma pasta.',
      'system-root': 'Escolha uma pasta fora das pastas do sistema (Windows, Arquivos de Programas).',
      'too-long': 'Esse caminho é muito longo. Escolha uma pasta mais próxima do disco.',
      'exists-as-file': 'Esse caminho é um arquivo, não uma pasta. Escolha uma pasta.',
    }
    return messages[reason] ?? 'Esse local não pode ser usado para o sistema de voz.'
  }

  async function applyRuntimeLocation(chosenDir: string | null): Promise<LiaRuntimeLocationPickResult> {
    if (!chosenDir)
      return { status: 'canceled' }

    const decision = classifyInstallLocation(chosenDir, platform)
    if (decision.status !== 'ok') {
      emit('lia-app.runtime-location-blocked', `reason=${decision.reason}`)
      return { message: locationRejectMessage(decision.reason), reason: decision.reason, status: 'rejected' }
    }
    const fsDecision = await inspectInstallLocationTarget(decision.normalized, {
      // Tests inject a virtual DISK (sync); production falls back to real fs.
      exists: deps.exists
        ? async path => Boolean(deps.exists?.(path))
        : async (path) => {
          try {
            await access(path)
            return true
          }
          catch {
            return false
          }
        },
      isDirectory: deps.exists
        ? async () => true
        : async path => (await stat(path)).isDirectory(),
    })
    if (fsDecision.status !== 'ok') {
      emit('lia-app.runtime-location-blocked', `reason=${fsDecision.reason}`)
      return { message: locationRejectMessage(fsDecision.reason), reason: fsDecision.reason, status: 'rejected' }
    }

    const written = await updateLiaProductConfig(paths.productConfigFile, {
      voice: { runtime: { alltalk: { installDir: decision.normalized } } },
    })
    if (written.status !== 'ok') {
      emit('lia-app.runtime-location-blocked', `reason=${written.status}`)
      return { message: written.error.message, reason: written.status, status: 'rejected' }
    }

    // The runtime manager memoizes the previous document; the next start
    // must see the new root (same rule as updateConfig).
    cached = undefined
    emit('lia-app.runtime-location-updated', 'source=user-pick move=never')
    return {
      installDir: decision.normalized,
      note: 'new-location-applies-to-future-install',
      status: 'ok',
    }
  }

  async function clearRuntimeLocation(): Promise<LiaRuntimeLocationStatus> {
    const written = await updateLiaProductConfig(paths.productConfigFile, {
      voice: { runtime: { alltalk: { installDir: '' } } },
    })
    if (written.status === 'ok') {
      cached = undefined
      emit('lia-app.runtime-location-updated', 'source=user-clear')
    }
    return runtimeLocationStatus()
  }

  async function updateConfig(payload: LiaConfigUpdatePayload): Promise<LiaConfigUpdateResult> {
    // Secrets first, into the vault and ONLY the vault. If the later
    // document write fails, a stray vault entry is inert - the reverse
    // order would risk a preferred-provider pointing at a missing key.
    for (const secret of payload.secrets ?? []) {
      const stored = await vault.setSecret(secret.scope, secret.key, secret.value)
      if (!stored) {
        emit('lia-app.config-blocked', 'reason=secret-vault-failed')
        return { message: 'The key could not be stored securely on this device.', status: 'secret-vault-failed' }
      }
    }
    const written = await updateLiaProductConfig(paths.productConfigFile, payload.update)
    if (written.status !== 'ok') {
      emit('lia-app.config-blocked', `reason=${written.status}`)
      return { message: written.error.message, status: written.status }
    }
    // The runtime manager memoizes launch facts from the PREVIOUS document;
    // configuration edits must reach the next start.
    cached = undefined
    emit('lia-app.config-updated', written.filePath)
    return { status: 'ok', value: written.value }
  }

  return {
    bridgeConfig: bridgeFactory,
    coordinator,
    /**
     * "Conversar com Lia": validate configuration, ensure the managed voice
     * runtime is up ONLY when the chosen voice needs it (contract item 12),
     * then launch the stage - separate child, single-flight (items 9/10).
     *
     * Phase 7.4 voice contract (items B/D/E): a custom local voice implies
     * an ordered, evidence-gated pipeline, and EVERY refusal carries a human
     * message plus a machine-readable diagnostic event - never a silent
     * broken speech pipeline.
     */
    conversar: async () => {
      // Supervisor rule (item 1): once Lia is closing, NOTHING new starts.
      if (coordinator.isShuttingDown()) {
        emit('lia-app.conversar-blocked', 'reason=lia-closing')
        throw new Error('Lia is closing. Start a new conversation after reopening it.')
      }
      const { snapshot } = await readSnapshot()
      const preferredAi = snapshot?.provider?.chat?.preferred
      if (!preferredAi || !vault.hasSecret(preferredAi.providerId, 'apiKey')) {
        emit('lia-app.conversar-blocked', 'reason=ai-not-ready')
        throw new Error('Lia is not fully configured yet. Finish the AI setup first.')
      }
      await ensureVoiceReadyForConversar(snapshot)
      return await stage.start({ env: await hostStageEnv() })
    },
    homeStatus,
    importVoice: async (request, allowedSourcePaths) => {
      const result = await voices.importProfile(request, allowedSourcePaths)
      if (result.ok)
        emit('lia-app.voice-imported', result.value.id)
      return result
    },
    listVoices: async () => await voices.list(),
    paths,
    productSnapshot: async () => (await readSnapshot()).snapshot,
    quit: async () => await coordinator.stopAll(),
    runtime: manager,
    runtimeLocationStatus,
    applyRuntimeLocation,
    clearRuntimeLocation,
    stage,
    stageEnv: hostStageEnv,
    updateConfig,
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
