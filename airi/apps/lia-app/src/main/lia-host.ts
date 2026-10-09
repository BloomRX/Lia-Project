import type { LiaBridgeConfig } from '@lia/core/bridge/lia-config'
import type { LiaProductPaths } from '@lia/core/paths/product-paths'
import type { LiaProductConfigSnapshot, LiaProductConfigUpdate, LiaProductSttTarget } from '@lia/core/product/config'
import type { LiaSecretCipher, LiaSecretVault } from '@lia/core/secrets/vault'
import type { LiaCustomVoiceProfile, LiaVoiceProfileImportRequest } from '@lia/core/voices/types'

import type { AiriStageState } from './airi-stage-manager'
import type { ShutdownReport } from './shutdown-coordinator'

import process from 'node:process'

import { access, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  brainRequirementForChatTurn,
  createProductionBrainAutomaticPolicy,
  createProductionBrainCatalog,
  decideBrainRouteFromProductState,
} from '@lia/core'
import { resolveVoiceRuntimeHome } from '@lia/core/bootstrap/runtime-root'
import { buildLiaBridgeConfig, stageEnvFor } from '@lia/core/bridge/lia-config'
import { classifyInstallLocation, inspectInstallLocationTarget } from '@lia/core/paths/install-location'
import { liaProductPaths } from '@lia/core/paths/product-paths'
import { brainRoutingModeUpdate, readBrainRoutingMode, readLiaProductConfig, updateLiaProductConfig } from '@lia/core/product/config'
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

/**
 * The chat provider whose vault credential the derived Lia transcription target
 * reuses.
 */
const GROQ_CHAT_PROVIDER_ID = 'groq'

/**
 * Phase 8.0D-10B-4D4C4-SHELL-B1: the derived Lia-managed speech-to-text target
 * the Launcher writes when it is eligible to.
 *
 * `LIA_GROQ_TRANSCRIPTION_PROVIDER_ID` is a DERIVED runtime provider id, not a
 * new protocol and not a credential holder: the managed Stage projects it onto
 * the existing OpenAI-compatible transcription adapter and resolves its
 * credential from the user's EXISTING Groq vault entry - one secret, one scope,
 * zero duplication. The spelling is a product policy decision, so it lives with
 * the Launcher rather than in the vendor-neutral generic config layer.
 */
const LIA_GROQ_TRANSCRIPTION_PROVIDER_ID = 'lia-groq-transcription'

/**
 * Groq Whisper is multilingual and auto-detects the spoken language, so no
 * language hint is stored anywhere in the canonical document.
 */
const LIA_GROQ_TRANSCRIPTION_MODEL_ID = 'whisper-large-v3-turbo'

/** The canonical default STT target, metadata only - never a credential. */
function liaGroqTranscriptionTarget(): LiaProductSttTarget {
  return {
    modelId: LIA_GROQ_TRANSCRIPTION_MODEL_ID,
    providerId: LIA_GROQ_TRANSCRIPTION_PROVIDER_ID,
  }
}

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
  /**
   * Phase 7.9E.1: the runtime-home resolver's `env` contract is a LOOKUP
   * (`ResolveLocalAppDataEnv` is `(name) => string | undefined`), never the
   * raw object the rest of this host reads (`env.APPDATA` & friends).
   * Handing the object over used to explode on Windows -
   * `TypeError: env is not a function` - inside resolveLocalAppDataDir,
   * before "Conversar com Lia" could even start the stage. One adapter,
   * still reading from the ONE environment above, keeps both contracts.
   */
  const envLookup = (name: string): string | undefined => env[name]

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
  /**
   * Phase 8.0D-10B-4D4C4-SHELL-B1: materialize the canonical speech-to-text
   * selection BEFORE the Stage child launches, so the managed Stage reads an
   * already-resolved hearing target and the user never opens AIRI Settings.
   *
   * The gate is deliberately narrow. All four must hold:
   *   1. voice is not explicitly opted out (`voice.enabled !== false`);
   *   2. no STT selection exists yet - an explicit one is authoritative;
   *   3. the selected chat provider is the one with a proven transcription
   *      target that can REUSE an already-stored credential;
   *   4. that credential actually exists in the vault.
   *
   * Otherwise the Launcher refuses to guess. In particular it never selects
   * Web Speech - the Windows runtime evidence showed it starting, reporting
   * `network`, then restarting indefinitely without producing a transcript, so
   * being keyless is not the same as being reliable.
   *
   * Returns whether a usable canonical STT target exists afterwards.
   */
  async function ensureSttReadyForConversar(snapshot: LiaProductConfigSnapshot | undefined): Promise<'configured' | 'not-configured'> {
    // An explicit voice opt-out is respected absolutely: text-only mode never
    // grows a microphone preference behind the user's back.
    if (snapshot?.voice?.enabled === false)
      return 'not-configured'

    // An existing selection is authoritative and preserved exactly. The launcher
    // never overrides a deliberate user or operator choice.
    if (snapshot?.voice?.stt?.preferred)
      return 'configured'

    const preferredAi = snapshot?.provider?.chat?.preferred
    // Only the Groq chat path has a proven transcription target today, because
    // only it can reuse an already-stored credential without duplicating it.
    if (preferredAi?.providerId !== GROQ_CHAT_PROVIDER_ID)
      return 'not-configured'

    // Without the existing Groq secret there is nothing to reuse, and writing a
    // target anyway would advertise a false-ready capability.
    if (!vault.hasSecret(preferredAi.providerId, 'apiKey'))
      return 'not-configured'

    const written = await updateLiaProductConfig(paths.productConfigFile, {
      voice: { stt: { preferred: liaGroqTranscriptionTarget() } },
    })
    if (written.status !== 'ok') {
      // Degraded, never corrupting: the document is left exactly as it was, no
      // secret is touched, and text conversation still proceeds. STT is simply
      // reported as unconfigured for a later Launcher surface to own.
      emit('lia-app.conversar-stt-not-ready', `reason=config-write-failed status=${written.status}`)
      return 'not-configured'
    }

    emit('lia-app.conversar-stt-defaulted', `target=${LIA_GROQ_TRANSCRIPTION_PROVIDER_ID}`)
    return 'configured'
  }

  /**
   * Phase 8.0D-M2: materialize the canonical Brain ROUTING MODE BEFORE the
   * Stage child launches, so the managed Stage's Brain can route at all.
   *
   * Why this belongs to the Launcher: `brain.mode` is optional in the canonical
   * schema and its absence is preserved deliberately, so an absent mode answers
   * `modeUnspecified` - which selects no route and leaves an image-bearing turn
   * on the globally active chat model. Nothing else in the product writes the
   * field, and the Launcher is already the product-configuration authority for
   * the managed speech-to-text default above. This is the Brain analogue of it:
   * one product-layer default, owned here, persisted through the same canonical
   * writer. It is NOT a second routing authority - the routing decision stays
   * owned by Lia Core's canonical router, and the Stage still makes it.
   *
   * The gate is deliberately narrow. An EXPLICIT mode is absolute and is never
   * touched: `disabled` and `manual` are the user's authority, and an existing
   * `automatic` is preserved without a redundant write. Only an ABSENT mode may
   * be defaulted, and only when ALL of these hold:
   *   1. a chat provider is configured at all;
   *   2. the REAL production Brain - the same catalog, the same product policy
   *      and the same canonical decision the Stage runs - would actually SELECT
   *      a route for a plain text turn under automatic mode. Eligibility is
   *      ASKED of the router, never assumed here;
   *   3. that selected route's engine IS the configured chat provider. A Brain
   *      engine id is the canonical chat provider id by construction, so this
   *      is an identity check and not a second mapping table - and it is what
   *      keeps a Brain engine this user's chat configuration does not justify
   *      from being selected for them;
   *   4. that provider's EXISTING vault credential is present. Only its
   *      presence is consulted: the value is never read, copied or reported.
   *
   * Otherwise the Launcher refuses to guess and says why, in metadata.
   *
   * A degraded default never blocks conversation: the document is left exactly
   * as it was and text chat proceeds exactly as before.
   *
   * Returns whether the canonical document declares automatic Brain routing
   * afterwards.
   */
  async function ensureBrainReadyForConversar(snapshot: LiaProductConfigSnapshot | undefined): Promise<'automatic' | 'not-automatic'> {
    const mode = readBrainRoutingMode(snapshot)
    // The canonical routing intent this launch runs with, reported by the owner
    // of the field - metadata only, so nobody has to infer it from a routing
    // outcome downstream.
    emit('lia-app.conversar-brain-mode', `mode=${mode ?? 'absent'}`)

    // An explicit mode is absolute: never overridden, never re-written.
    if (mode !== undefined)
      return mode === 'automatic' ? 'automatic' : 'not-automatic'

    const preferredAi = snapshot?.provider?.chat?.preferred
    if (!preferredAi) {
      emit('lia-app.conversar-brain-not-ready', 'reason=chat-provider-unset')
      return 'not-automatic'
    }

    // Ask the REAL Brain, against a PROBE snapshot that exists only inside this
    // call: the persisted document is not touched by asking the question. The
    // requirement is a plain text turn - the baseline every conversation starts
    // with - so the default never depends on a capability this turn may not use.
    const catalog = createProductionBrainCatalog()
    const probe = decideBrainRouteFromProductState({
      automaticPolicy: createProductionBrainAutomaticPolicy(),
      engines: catalog.engines,
      models: catalog.models,
      requirement: brainRequirementForChatTurn({}),
      snapshot: { brain: { ...snapshot?.brain, mode: 'automatic' } },
    })
    const selected = probe.status === 'automatic' && probe.selection.status === 'selected'
      ? probe.selection.route
      : undefined
    if (selected === undefined) {
      emit('lia-app.conversar-brain-not-ready', `reason=automatic-route-unavailable status=${probe.status}`)
      return 'not-automatic'
    }

    // No silent provider selection: the route the Brain would run has to belong
    // to the engine this user already chats through.
    if (selected.engine.id !== preferredAi.providerId) {
      emit('lia-app.conversar-brain-not-ready', 'reason=chat-provider-not-eligible')
      return 'not-automatic'
    }

    // Reuse the EXISTING credential. Presence only - never the value.
    if (!vault.hasSecret(preferredAi.providerId, 'apiKey')) {
      emit('lia-app.conversar-brain-not-ready', 'reason=credential-missing')
      return 'not-automatic'
    }

    const written = await updateLiaProductConfig(paths.productConfigFile, brainRoutingModeUpdate('automatic'))
    if (written.status !== 'ok') {
      // Degraded, never corrupting: the document is left exactly as it was, no
      // secret is touched, and conversation still proceeds. Brain routing is
      // simply reported as unconfigured.
      emit('lia-app.conversar-brain-not-ready', `reason=config-write-failed status=${written.status}`)
      return 'not-automatic'
    }

    emit('lia-app.conversar-brain-defaulted', 'mode=automatic')
    return 'automatic'
  }

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
      // Phase 7.9H: voice preparation is NO LONGER a hard gate for
      // conversation. The text path works while the launcher provisions the
      // voice automatically (or retries after an honest failure); spoken
      // output simply joins once the capability is ready. The fix belongs
      // to provisioning, not to a blocking error.
      emit('lia-app.conversar-voice-not-ready', 'reason=voice-runtime-not-installed')
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
    return resolveVoiceRuntimeHome({ env: envLookup, platform, userDataDir: paths.userDataDir })
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
      canonicalDefaultDir: resolveVoiceRuntimeHome({ env: envLookup, platform, userDataDir: paths.userDataDir }),
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
      // Phase 8.0D-10B-4D4C4-SHELL-B1: the canonical STT default is materialized
      // BEFORE the child launches, so the managed Stage reads an already-resolved
      // hearing target. A degraded STT never blocks text conversation.
      await ensureSttReadyForConversar(snapshot)
      // Phase 8.0D-M2: the canonical Brain routing mode is materialized BEFORE
      // the child launches, so the managed Stage's Brain can select a route at
      // all. A degraded Brain default never blocks conversation.
      await ensureBrainReadyForConversar(snapshot)
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
