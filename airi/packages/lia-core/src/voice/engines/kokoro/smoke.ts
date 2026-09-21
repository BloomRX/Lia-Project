import type { KokoroVoiceEngine } from './index'
import type { KokoroLayout } from './layout'

import { createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import nodePath from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { inspectKokoroInstall } from './layout'
import { KOKORO_MODEL_SHA256, KOKORO_SAMPLE_RATE } from './manifest'

/**
 * Phase 7.9D: the developer-only Windows smoke path for the REAL engine.
 *
 * This is deliberately NOT a TTS implementation: the smoke exists to drive
 * the production `LiaVoiceEngine` end to end (install → start → synthesize
 * → stop), on the machine the app will actually run on, with measured
 * facts reported per step. Anything it prints came out of the engine
 * itself (health/deviceName) or from bytes on disk (hashes) - never from
 * assumptions about the runtime.
 */

/** The exact same 4 pt-BR phrases the 7.9B QA harness measures. */
export const KOKORO_SMOKE_PHRASES = [
  { slug: 'a', text: 'Oi, tudo bem?' },
  { slug: 'b', text: 'Oi Lucas, agora minha voz está funcionando.' },
  { slug: 'c', text: 'Hoje está um dia bonito, não acha?' },
  { slug: 'd', text: 'Você consegue me ouvir perfeitamente?' },
] as const

export interface KokoroSmokeFileSystem {
  existsSync: (path: string) => boolean
  mkdirSync: (path: string) => void
  writeFileSync: (path: string, bytes: Uint8Array) => void
  readFileSync: (path: string) => Uint8Array
}

const defaultFs: KokoroSmokeFileSystem = {
  existsSync,
  mkdirSync: path => mkdirSync(path, { recursive: true }),
  writeFileSync,
  readFileSync: path => new Uint8Array(readFileSync(path)),
}

export interface KokoroSmokeOptions {
  /** The PRODUCTION engine factory, bound to the resolved runtime layout. */
  engineFactory: () => KokoroVoiceEngine
  layout: KokoroLayout
  /** Dev-only QA folder (never inside Git, never inside the runtime tree). */
  outDir: string
  log?: (line: string) => void
  fileSystem?: KokoroSmokeFileSystem
  sha256File?: (path: string) => Promise<string>
  now?: () => number
  phrases?: ReadonlyArray<{ slug: string, text: string }>
}

export interface KokoroSmokePhraseResult {
  slug: string
  text: string
  chars: number
  generationMs: number
  audioDurationMs: number
  rtf: number
  wavPath: string
}

export interface KokoroSmokeReport {
  engineId: string
  installedPrior: boolean
  installRan: boolean
  pythonVenv: string
  pythonVersion?: string
  runtimeRoot: string
  modelSha256?: string
  modelMatchesManifest?: boolean
  providerActive?: string
  device?: string
  coldStartMs: number
  phrases: KokoroSmokePhraseResult[]
  outDir: string
  stopped: boolean
}

async function defaultSha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

function readPythonVersionFromState(layout: KokoroLayout, fs: KokoroSmokeFileSystem): string | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fs.readFileSync(layout.stateFile))) as { pythonVersion?: string }
    return typeof parsed.pythonVersion === 'string' && parsed.pythonVersion ? parsed.pythonVersion : undefined
  }
  catch {
    return undefined
  }
}

export async function runKokoroSmoke(options: KokoroSmokeOptions): Promise<KokoroSmokeReport> {
  const fs = options.fileSystem ?? defaultFs
  const sha256File = options.sha256File ?? defaultSha256File
  const now = options.now ?? Date.now
  const log = options.log ?? (() => undefined)
  const phrases = options.phrases ?? KOKORO_SMOKE_PHRASES
  const layout = options.layout
  const engine = options.engineFactory()

  // 1. Resolve-once facts, then install only when the bytes say it is needed.
  const preCheck = inspectKokoroInstall(layout, fs)
  let installRan = false
  let pythonVersion = readPythonVersionFromState(layout, fs)
  if (!preCheck.installed) {
    log(`[kokoro-smoke] runtime not installed (missing: ${preCheck.missing.join(', ')}) - installing via the engine-owned installer`)
    const facts = await engine.install()
    installRan = true
    pythonVersion = facts.pythonVersion || pythonVersion
    log(`[kokoro-smoke] installed: python ${facts.pythonVersion} via ${facts.pythonPath}; model source: ${facts.modelSource || 'already-present'}`)
  }
  else {
    log('[kokoro-smoke] verified runtime already present - reuse, zero redownload')
  }

  log(`[kokoro-smoke] python (venv): ${layout.venvPython}${pythonVersion ? ` (${pythonVersion})` : ''}`)
  log(`[kokoro-smoke] runtime root: ${layout.rootDir}`)

  let modelSha256: string | undefined
  let modelMatchesManifest: boolean | undefined
  try {
    modelSha256 = await sha256File(layout.modelFile)
    modelMatchesManifest = modelSha256 === KOKORO_MODEL_SHA256
    log(`[kokoro-smoke] model sha256: ${modelSha256} (${modelMatchesManifest ? 'matches the QA-pinned hash' : 'DIFFERS FROM PIN - refusing to continue'})`)
    if (!modelMatchesManifest)
      throw new Error('model hash mismatch: the runtime tree is not the QA-verified model; re-run install')
  }
  catch (error) {
    throw new Error(`[kokoro-smoke] model verification failed: ${errorMessageFrom(error)}`)
  }

  // 2. Start the real engine (cold = python spawn + ORT session + model load).
  log('[kokoro-smoke] starting the real engine (worker spawn + model cold load)...')
  const coldStartedAt = now()
  await engine.start()
  const coldStartMs = now() - coldStartedAt

  const health = await engine.health()
  const providerActive = health.deviceName
  log(`[kokoro-smoke] active ORT provider (measured): ${providerActive ?? 'unknown'} (device=${health.device ?? 'unknown'})`)
  log(`[kokoro-smoke] cold start (worker spawn + model load): ${coldStartMs}ms`)
  log('[kokoro-smoke] worker RAM: not instrumented in the 7.9C health contract')

  // 3. Synthesize the QA phrases in engine-serial order; persist WAVs dev-only.
  fs.mkdirSync(options.outDir)
  const results: KokoroSmokePhraseResult[] = []
  for (const phrase of phrases) {
    const wavPath = nodePath.join(options.outDir, `smoke-${phrase.slug}.wav`)
    const output = await engine.synthesize({ language: 'pt-BR', text: phrase.text })
    fs.writeFileSync(wavPath, new Uint8Array(output.audio))
    const generationMs = output.generationMs ?? -1
    const audioDurationMs = output.audioDurationMs ?? -1
    const rtf = audioDurationMs > 0 && generationMs >= 0 ? Math.round((generationMs / audioDurationMs) * 1000) / 1000 : -1
    results.push({
      audioDurationMs,
      chars: phrase.text.length,
      generationMs,
      rtf,
      slug: phrase.slug,
      text: phrase.text,
      wavPath,
    })
    log(`[kokoro-smoke] ${phrase.slug}: gen ${generationMs}ms | audio ${audioDurationMs}ms | RTF ${rtf} | ${wavPath}`)
  }

  // 4. Clean release: the worker is a child process; stop MUST return and
  //    a doubly-called stop must be a no-op (engine contract pinned in 7.9C).
  await engine.stop()
  log('[kokoro-smoke] worker stopped cleanly (shutdown frame acknowledged)')

  return {
    coldStartMs,
    device: health.device,
    engineId: engine.id,
    installRan,
    installedPrior: preCheck.installed,
    modelMatchesManifest,
    modelSha256,
    outDir: options.outDir,
    phrases: results,
    providerActive,
    pythonVenv: layout.venvPython,
    ...(pythonVersion ? { pythonVersion } : {}),
    runtimeRoot: layout.rootDir,
    stopped: true,
  }
}

// Exported for the CLI wrapper: it prints ONE final machine-parsable line.
export function kokoroSmokeSummaryLine(report: KokoroSmokeReport): string {
  return JSON.stringify({
    engine: report.engineId,
    provider: report.providerActive,
    device: report.device,
    coldStartMs: report.coldStartMs,
    installedPrior: report.installedPrior,
    modelSha256: report.modelSha256,
    modelOk: report.modelMatchesManifest,
    phrases: report.phrases.map(p => ({
      slug: p.slug,
      gen: p.generationMs,
      audio: p.audioDurationMs,
      rtf: p.rtf,
    })),
    sampleRate: KOKORO_SAMPLE_RATE,
    outDir: report.outDir,
  })
}
