import type { LiaVoiceEngine, LiaVoiceEngineHealth, LiaVoiceSynthesisInput, LiaVoiceSynthesisOutput } from '../types'

import { readFile, rm } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import nodePath from 'node:path'
import process from 'node:process'

import { errorMessageFrom } from '@moeru/std'

import { LiaVoiceEngineError } from '../types'
import { KOKORO_ENGINE_ADAPTER } from '../registry'

import { defaultKokoroInstallDeps, ensureKokoroInstalled } from './install'
import { inspectKokoroInstall, resolveKokoroLayout } from './layout'
import {
  KOKORO_DEFAULT_LANGUAGE,
  KOKORO_DEFAULT_VOICE_ID,
  KOKORO_ENGINE_ID,
} from './manifest'
import { createKokoroWorkerClient, KokoroWorkerError } from './process-worker'
import type { KokoroInstallDeps, KokoroInstallFacts } from './install'
import type { KokoroLayout } from './layout'
import type { KokoroSpawn, KokoroWorkerClient, KokoroWorkerFacts } from './process-worker'

export type { KokoroInstallFacts, KokoroLayout, KokoroSpawn, KokoroWorkerClient, KokoroWorkerFacts }

// The dev-only smoke path (Phase 7.9D) and layout inspection compose the
// same adapter surface as the engine itself - one production module.
export { runKokoroSmoke, kokoroSmokeSummaryLine, KOKORO_SMOKE_PHRASES } from './smoke'
export { inspectKokoroInstall, resolveKokoroLayout } from './layout'
export { KOKORO_MODEL_SHA256, KOKORO_MODEL_BYTES, KOKORO_SAMPLE_RATE } from './manifest'
export type { KokoroSmokeFileSystem, KokoroSmokeOptions, KokoroSmokeReport } from './smoke'

/**
 * Phase 7.9C: the Kokoro voice engine - Lia's first real modular TTS
 * engine. CPU-only by measured QA (DirectML initialized and then failed
 * during inference on the target GPU, so it is not declared anywhere in
 * this build). The engine owns its whole runtime (venv, model, voices,
 * worker, tmp); everything crosses the device boundary through this
 * adapter, metadata-only.
 */

export interface KokoroEngineFileSystem {
  existsSync: (path: string) => boolean
  mkdirSync: (path: string) => void
  readFile: (path: string) => Promise<Uint8Array>
  remove: (path: string) => Promise<void>
}

export interface KokoroEngineOptions {
  /** Engine-neutral voice-runtime home (`resolveVoiceRuntimeHome` result). */
  runtimeHome: () => string
  /** Optional product-config override (`voice.runtime.installDir`). */
  installDirOverride?: () => string | undefined
  platform?: string
  spawnImpl?: KokoroSpawn
  fileSystem?: KokoroEngineFileSystem
  /** Extra/override dep entries for the installer (install-time injection). */
  installDeps?: Partial<KokoroInstallDeps>
  env?: NodeJS.ProcessEnv
  readyTimeoutMs?: number
  shutdownGraceMs?: number
  synthesizeTimeoutMs?: number
  log?: (entry: Record<string, string | number | boolean>) => void
}

export interface KokoroVoiceEngine extends LiaVoiceEngine {
  /** Idempotent engine-owned install. Failures leave a retryable tree. */
  install(): Promise<KokoroInstallFacts>
  /** The composed layout (diagnostics/tests; persona never sees it). */
  layout(): KokoroLayout
}

const defaultFileSystem: KokoroEngineFileSystem = {
  existsSync,
  mkdirSync: path => mkdirSync(path, { recursive: true }),
  readFile: path => readFile(path),
  remove: path => rm(path, { force: true }),
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Slice precisely: Buffers can back onto a shared pool.
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** pt-BR is this build's phonetic home; anything else defers to the tag itself. */
export function resolveKokoroLanguage(language: string | undefined): string {
  const trimmed = (language ?? '').trim()
  if (!trimmed)
    return KOKORO_DEFAULT_LANGUAGE
  const lowered = trimmed.toLowerCase()
  if (lowered === 'pt' || lowered.startsWith('pt-'))
    return KOKORO_DEFAULT_LANGUAGE
  return lowered
}

export function createKokoroVoiceEngine(options: KokoroEngineOptions): KokoroVoiceEngine {
  const fs = options.fileSystem ?? defaultFileSystem
  const log = options.log ?? (() => undefined)

  let cachedLayout: KokoroLayout | undefined
  let layoutStamp: { home: string } | undefined

  function currentLayout(): KokoroLayout {
    const home = options.installDirOverride?.() || options.runtimeHome()
    if (!cachedLayout || !layoutStamp || layoutStamp.home !== home) {
      cachedLayout = resolveKokoroLayout({ home, platform: options.platform })
      layoutStamp = { home }
    }
    return cachedLayout
  }

  type EngineState = 'cold' | 'starting' | 'ready' | 'error'
  let state: EngineState = 'cold'
  let client: KokoroWorkerClient | undefined
  let facts: KokoroWorkerFacts | undefined
  let lastErrorNote: string | undefined
  let requestCounter = 0
  let startingPromise: Promise<void> | undefined

  function installedCheck(): { installed: boolean, missing: string[] } {
    const layout = currentLayout()
    return inspectKokoroInstall(layout, { existsSync: fs.existsSync })
  }

  function newClient(): KokoroWorkerClient {
    return createKokoroWorkerClient({
      env: options.env ?? process.env,
      layout: currentLayout(),
      language: KOKORO_DEFAULT_LANGUAGE,
      log,
      readyTimeoutMs: options.readyTimeoutMs,
      shutdownGraceMs: options.shutdownGraceMs,
      spawnImpl: options.spawnImpl,
      synthesizeTimeoutMs: options.synthesizeTimeoutMs,
      voice: KOKORO_DEFAULT_VOICE_ID,
    })
  }

  async function start(): Promise<void> {
    if (state === 'ready' && client?.running())
      return
    if (state === 'starting' && startingPromise)
      return startingPromise
    // A 'ready' engine whose worker died unplanned restarts honestly here.
    if (state === 'ready') {
      state = 'cold'
      facts = undefined
      client = undefined
    }

    startingPromise = (async () => {
      const layout = currentLayout()
      const check = inspectKokoroInstall(layout, { existsSync: fs.existsSync })
      if (!check.installed) {
        state = 'error'
        lastErrorNote = `kokoro-not-installed (missing: ${check.missing.join(', ')})`
        throw new LiaVoiceEngineError(KOKORO_ENGINE_ID, 'engine-unavailable', lastErrorNote)
      }
      fs.mkdirSync(layout.tmpDir)
      state = 'starting'
      client = newClient()
      const startedClient = client
      try {
        const resolvedFacts = await startedClient.start()
        if (client !== startedClient || state !== 'starting') {
          // stop() raced the worker warmup: kill the fresh child quietly rather
          // than flip the engine to ready over a worker nobody owns anymore.
          await startedClient.stop().catch(() => undefined)
          return
        }
        facts = resolvedFacts
        state = 'ready'
        lastErrorNote = undefined
        log({ event: 'lia.voice.kokoro.started', device: facts.device, loadMs: facts.loadMs, providers: facts.providersActive.join('+'), voice: facts.voice })
      }
      catch (error) {
        if (client !== startedClient) {
          // stop() raced the warmup and the engine is already cold: the
          // start caller gets an honest cancellation, the state stays clean.
          throw new LiaVoiceEngineError(KOKORO_ENGINE_ID, 'cancelled', 'kokoro-start-aborted')
        }
        state = 'error'
        const concise = error instanceof KokoroWorkerError && error.reason === 'init-failed'
          ? 'kokoro-model-load-failed'
          : `kokoro-start-failed(${errorMessageFrom(error).slice(0, 120)})`
        lastErrorNote = concise
        log({ event: 'lia.voice.kokoro.start-failed', error: concise })
        throw new LiaVoiceEngineError(KOKORO_ENGINE_ID, 'engine-unavailable', concise)
      }
      finally {
        startingPromise = undefined
      }
    })()
    return startingPromise
  }

  async function stop(): Promise<void> {
    const current = client
    client = undefined
    facts = undefined
    state = 'cold'
    lastErrorNote = undefined
    startingPromise = undefined
    if (current)
      await current.stop() // idempotent; pending in-flight work rejects with 'cancelled'
  }

  return {
    id: KOKORO_ENGINE_ID,

    capabilities: () => ({ ...KOKORO_ENGINE_ADAPTER.capabilities }),

    start,
    stop,

    async health(): Promise<LiaVoiceEngineHealth> {
      const check = installedCheck()
      if (!check.installed) {
        return { note: `kokoro-not-installed (missing: ${check.missing.join(', ')})`, ok: false, state: 'unavailable' }
      }
      if (state === 'ready' && facts) {
        if (!client?.running()) {
          // The worker died behind our back: report the crash, never a stale ready.
          state = 'error'
          lastErrorNote = 'kokoro-worker-stopped'
          return { note: lastErrorNote, ok: false, state: 'error' }
        }
        return {
          device: facts.device === 'cpu' ? 'cpu' : 'other',
          deviceName: facts.providersActive.join('+') || undefined,
          modelLoaded: true,
          note: `providers=${facts.providersActive.join('+') || 'unknown'}`,
          ok: true,
          state: 'ready',
        }
      }
      if (state === 'starting') {
        return { note: 'kokoro-worker-starting', ok: false, state: 'starting' }
      }
      if (state === 'error') {
        return { note: lastErrorNote ?? 'kokoro-error', ok: false, state: 'error' }
      }
      // Installed but cold: warm in the background so the first real
      // utterance lands on a hot model. Report starting, never a fake ready.
      void start().catch(() => undefined)
      return { note: 'kokoro-worker-starting', ok: false, state: 'starting' }
    },

    async synthesize(input: LiaVoiceSynthesisInput): Promise<LiaVoiceSynthesisOutput> {
      const text = input.text ?? ''
      if (!text.trim())
        throw new LiaVoiceEngineError(KOKORO_ENGINE_ID, 'input-invalid', 'empty synthesis input')

      if (state !== 'ready') {
        // start() throws engine-unavailable honestly when the tree is missing.
        await start()
      }
      const active = client
      if (!active)
        throw new LiaVoiceEngineError(KOKORO_ENGINE_ID, 'engine-unavailable', lastErrorNote ?? 'kokoro-worker-unavailable')

      const id = ++requestCounter
      const wavPath = nodePath.join(currentLayout().tmpDir, `lia-synth-${id}.wav`)
      let removed = false
      try {
        const result = await active.synthesize({
          id,
          language: resolveKokoroLanguage(input.language),
          out: wavPath,
          text,
          voice: KOKORO_DEFAULT_VOICE_ID,
        })
        const bytes = await fs.readFile(result.wavPath)
        await fs.remove(result.wavPath)
        removed = true
        return {
          audio: toArrayBuffer(bytes),
          audioDurationMs: result.audioDurationMs,
          channels: result.channels,
          engine: KOKORO_ENGINE_ID,
          generationMs: result.generationMs,
          sampleRate: result.sampleRate,
        }
      }
      catch (error) {
        if (!removed) {
          // Best effort scratch cleanup; the failure must never mask the real error.
          fs.remove(wavPath).catch(() => undefined)
        }
        if (error instanceof LiaVoiceEngineError)
          throw error
        if (error instanceof KokoroWorkerError && error.reason === 'cancelled')
          throw new LiaVoiceEngineError(KOKORO_ENGINE_ID, 'cancelled', errorMessageFrom(error))
        throw new LiaVoiceEngineError(KOKORO_ENGINE_ID, 'engine-error', errorMessageFrom(error).slice(0, 300))
      }
    },

    async install(): Promise<KokoroInstallFacts> {
      const deps: KokoroInstallDeps = {
        ...defaultKokoroInstallDeps(),
        ...(options.installDeps ?? {}),
        platform: options.platform ?? options.installDeps?.platform ?? process.platform,
      }
      const factsResult = await ensureKokoroInstalled(currentLayout(), deps)
      log({ event: 'lia.voice.kokoro.installed', modelSha256: factsResult.modelSha256.slice(0, 12), voices: factsResult.voices.join(',') })
      return factsResult
    },

    layout: () => currentLayout(),
  }
}
