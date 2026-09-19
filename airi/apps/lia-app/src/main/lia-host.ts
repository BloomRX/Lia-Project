import type { LiaBridgeConfig } from '@lia/core/bridge/lia-config'
import type { LiaProductPaths } from '@lia/core/paths/product-paths'
import type { LiaProductConfigSnapshot, LiaProductConfigUpdate } from '@lia/core/product/config'
import type { LiaSecretCipher, LiaSecretVault } from '@lia/core/secrets/vault'
import type { LiaCustomVoiceProfile, LiaVoiceProfileImportRequest } from '@lia/core/voices/types'

import type { AiriStageState } from './airi-stage-manager'
import type { ShutdownReport } from './shutdown-coordinator'

import process from 'node:process'

import { access, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLiaBridgeConfig, stageEnvFor } from '@lia/core/bridge/lia-config'
import { resolveVoiceRuntimeHome } from '@lia/core/bootstrap/runtime-root'
import { classifyInstallLocation, inspectInstallLocationTarget } from '@lia/core/paths/install-location'
import { liaProductPaths } from '@lia/core/paths/product-paths'
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
  /** The voice product's runtime facts (`voice` since Phase 7.8; engine-neutral). */
  voice: {
    /** Voice configuration targets the custom runtime? Absent when the document could not be read. */
    configured?: boolean
    /** Why inspection did not produce facts, when it did not. */
    error?: string
    /** Install markers all present at the effective install dir? Absent = inspection never ran (unknown). */
    installed?: boolean
    /** The effective install dir - only when it was PROVEN installed. */
    installDir?: string
    /** The worker's own state label; 'unknown' when inspection failed before any state could exist. */
    phase: 'unknown' | 'stopped' | 'starting' | 'ready' | 'stopping' | 'error' | 'notInstalled'
    /** A voice profile id is actively selected. Absent when the document could not be read. */
    profileSelected?: boolean
    /** The runtime answers health / holds a launcher-owned worker right now. */
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
   * Install inspection, injected so integration tests can exercise the REAL
   * resolver against a virtual disk (the canonical LocalAppData root only
   * exists on a real Windows profile). Phase 7.8C: no modular engine is
   * registered yet, so the default answer is honestly `false` until an
   * engine (Kokoro first) declares what "installed" means for its tree.
   */
  inspectInstallImpl?: (runtimeHome: string, platform?: string) => Promise<boolean>
  /** Never-secret log lines; the renderer log strip shows a pass-through. */
  onEvent?: (event: string, detail?: string) => void
  /** Never-crashes platform override for tests. */
  platform?: NodeJS.Platform
  /** Where the AIRI monorepo lives (default: sibling of the app package). */
  workspaceRoot?: string
  /** Test seam: the stage manager is replaceable without touching spawn. */
  stageManagerFactory?: (deps: ConstructorParameters<typeof AiriStageManager>[0]) => AiriStageManager
}

/**
 * What the Voice screen renders about WHERE the managed voice runtime
 * lives. `effectiveInstallDir` is the configured root when one exists,
 * otherwise the canonical engine-neutral home (`%LOCALAPPDATA%\Lia\runtimes`)
 * - the dir install state is checked against, whether installed or not.
 */
export interface LiaRuntimeLocationStatus {
  /** The canonical default home of the managed voice runtime. */
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
  stage: AiriStageManager
  /** Launch facts the stage child will receive (bridge env + shared home). */
  stageEnv: () => Promise<Record<string, string>>
  /** Persists the Config screen through the core writer; secrets to the vault only. */
  updateConfig: (payload: LiaConfigUpdatePayload) => Promise<LiaConfigUpdateResult>
  /** Where the managed voice runtime lives now (Part G/J status for the Voice screen). */
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

  // The canonical runtime facts come from the product document; the
  // launcher's boot NEVER starts a voice runtime (contract item 12).

  const workspaceRoot = deps.workspaceRoot ?? defaultWorkspaceRoot()

  const stage = (deps.stageManagerFactory ?? ((d: ConstructorParameters<typeof AiriStageManager>[0]) => new AiriStageManager(d)))({
    onLog: line => emit('lia-app.stage-log', line),
    workspaceRoot,
  })

  /**
   * The supervisor shutdown officer (Phase 7.1, items 1/2/3). Registration
   * order IS teardown order: the stage leaves first (its children may talk
   * to a voice runtime).
   *
   * `holdsOwnedProcess` is ownership, by this session, of a LIVE process -
   * the exact round-7 axiom. Phase 7.8C: no voice-engine worker is owned by
   * the host (F5 manager removed; modular engines - Kokoro first - register
   * their own owned-process entry HERE when they land), so the stage is the
   * only registrant for now.
   */
  const coordinator = new ShutdownCoordinator({
    onLog: line => emit('lia-app.shutdown', line),
  })
  coordinator.register({
    holdsOwnedProcess: () => stage.holdsOwnedStage(),
    name: 'stage',
    stop: async () => await stage.stop(),
  })

  async function readSnapshot(): Promise<{ snapshot: LiaProductConfigSnapshot | undefined, status: LiaHomeStatus['config']['status'] }> {
    const read = await readLiaProductConfig(paths.productConfigFile)
    return { snapshot: read.status === 'ok' ? read.value : undefined, status: read.status }
  }

  /**
   * Voice gate (Phase 7.8 items 6/9/23; engine-neutral since 7.8C): when
   * the preferred voice is `custom-local-voice`, prove exactly the facts
   * that matter now - in the order that makes them cheap - before the
   * stage is ever asked to start:
   *   1. the selected profile exists in the canonical library (+ its files);
   *   2. a proven managed voice runtime exists at the effective home;
   *   3. the registered engine is ready - WAITING ON a modular engine to be
   *      hosted here (7.8C removed the F5 manager; Kokoro is next).
   * The canonical reference WAV is read by the engine straight from the
   * profile's own directory: there is NO derived published copy, no voices
   * folder to drift out of sync, and the transcript the engine may need
   * comes from the profile's own metadata.
   * Every refusal is a human pt-BR message plus a machine-readable event
   * (safe metadata only). A non-custom provider starts NOTHING.
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

    const runtimeHome = effectiveRuntimeHome(snapshot)
    if (!(await voiceRuntimeInstalled(runtimeHome))) {
      emit('lia-app.conversar-blocked', 'reason=voice-runtime-not-installed')
      throw new Error('O sistema de voz precisa ser instalado. Abra as configurações da Lia para instalar.')
    }

    // The engine read/ready step registers here when a modular engine
    // (Kokoro first) is hosted by the launcher again.
  }

  /**
   * The runtime home the host works against, resolved to ONE answer:
   * the configured `voice.runtime.installDir` when set, otherwise the
   * canonical engine-neutral `%LOCALAPPDATA%\Lia\runtimes` (POSIX: the
   * shared user-data home). The legacy alltalk block is read by NOBODY here.
   */
  function effectiveRuntimeHome(snapshot: LiaProductConfigSnapshot | undefined): string {
    const configured = snapshot?.voice?.runtime?.installDir?.trim()
    if (configured)
      return configured
    return resolveVoiceRuntimeHome({ env, platform, userDataDir: paths.userDataDir })
  }

  /**
   * Install proof at the effective home. Phase 7.8C: with no modular engine
   * registered there is nothing that could be "installed", so the default
   * answer is honestly false; an engine declares its own proof next phase.
   */
  async function voiceRuntimeInstalled(runtimeHome: string): Promise<boolean> {
    const inspect = deps.inspectInstallImpl ?? (async () => false)
    return inspect(runtimeHome, platform)
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

    let voice: LiaHomeStatus['voice']
    try {
      const runtimeHome = effectiveRuntimeHome(snapshot)
      const installed = await voiceRuntimeInstalled(runtimeHome)
      voice = {
        configured: snapshot === undefined ? undefined : preferredVoice?.providerId === 'custom-local-voice',
        installed,
        // The dir is named only when the install there PROVED valid; a
        // guessed location remains out of a status users act on.
        installDir: installed ? runtimeHome : undefined,
        // Phase 7.8C: no engine worker is hosted by the launcher right now,
        // so 'stopped' is the honest running-state of a proven install.
        phase: installed ? 'stopped' : 'notInstalled',
        profileSelected: snapshot === undefined ? undefined : preferredVoice?.voiceId !== undefined,
        running: false,
      }
    }
    catch (thrown) {
      voice = {
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
      voice,
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

  /**
   * Part G/H: the user-facing WHERE. Precedence is configured home when
   * set, otherwise the canonical engine-neutral home; `installed` is the
   * engine's own proof (honestly false while no modular engine is hosted).
   */
  async function runtimeLocationStatus(): Promise<LiaRuntimeLocationStatus> {
    const { snapshot } = await readSnapshot()
    const configuredInstallDir = snapshot?.voice?.runtime?.installDir?.trim() || undefined
    const effective = effectiveRuntimeHome(snapshot)
    return {
      canonicalDefaultDir: resolveVoiceRuntimeHome({ env, platform, userDataDir: paths.userDataDir }),
      customActive: configuredInstallDir !== undefined,
      ...(configuredInstallDir ? { configuredInstallDir } : {}),
      effectiveInstallDir: effective,
      installed: await voiceRuntimeInstalled(effective),
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
      voice: { runtime: { installDir: decision.normalized } },
    })
    if (written.status !== 'ok') {
      emit('lia-app.runtime-location-blocked', `reason=${written.status}`)
      return { message: written.error.message, reason: written.status, status: 'rejected' }
    }

    emit('lia-app.runtime-location-updated', 'source=user-pick move=never')
    return {
      installDir: decision.normalized,
      note: 'new-location-applies-to-future-install',
      status: 'ok',
    }
  }

  async function clearRuntimeLocation(): Promise<LiaRuntimeLocationStatus> {
    const written = await updateLiaProductConfig(paths.productConfigFile, {
      voice: { runtime: { installDir: '' } },
    })
    if (written.status === 'ok')
      emit('lia-app.runtime-location-updated', 'source=user-clear')
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
