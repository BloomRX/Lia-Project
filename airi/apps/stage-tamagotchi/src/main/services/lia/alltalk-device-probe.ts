import type { AllTalkRuntimeConfig } from './alltalk-client'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DEFAULT_ALLTALK_BASE_URL } from './alltalk-client'

/**
 * Phase 7.7, Part 2: determine the ACTUAL execution device of the running
 * XTTS/AllTalk stack - measured, never inferred from hardware.
 *
 * Why each source:
 *
 * - The user's machine has an AMD RX 580, which means "no CUDA" as a hardware
 *   guess - but a GUESS is not an audit. The decisive fact is what the
 *   embedded python environment ships: PyTorch wheels are device-builds whose
 *   version string in `torch/version.py` ends in `+cpu`, `+cu121`, ... That
 *   file is read from the install in USE and tells the device-direct truth:
 *   a `+cpu` wheel cannot use a GPU no matter what the driver supports.
 *
 * - `/api/currentsettings` (documented AllTalk endpoint) confirms WHICH
 *   model/method is loaded and whether deepspeed/low-VRAM are on - both are
 *   CPU/GPU-relevant knobs the server itself reports.
 *
 * - Electron's `app.getGPUInfo('basic')` reports the GPU the OS driver
 *   advertises to the app. It is metadata only (name + vendor) and is what
 *   the report's `gpuName=<if safely available>` field needs.
 *
 * Everything is optional and failure-tolerant: an unanswerable question is
 * reported as `unknown`, never as a crash, and never as a fabricated yes/no.
 */

export interface AllTalkDeviceReport {
  /** What the stack is empirically running on. */
  device: 'cpu' | 'cuda' | 'other' | 'unknown'
  /** The packaged PyTorch build, e.g. `2.4.1+cpu` - when readable. */
  torchBuild?: string
  /** The server-reported model method, e.g. `XTTSv2 Local`. */
  currentModelLoaded?: string
  deepspeedStatus?: boolean
  lowVramStatus?: boolean
  /** GPU as the OS driver advertises it to this app - when available. */
  gpuName?: string
  /** Note explaining uncertainty, when the device is not fully proven. */
  note?: string
}

interface ProbeDeps {
  readFileImpl?: (path: string) => Promise<string>
  fetchImpl?: typeof fetch
  /** Electron GPU info, injectable so the unit test never touches Electron. */
  getGpuInfoImpl?: () => Promise<Array<{ deviceName?: string, deviceVendor?: string }>>
}

/**
 * Reads the embedded python's torch build from the AllTalk install root.
 * Windows embedded layout: `<root>/alltalk_environment/env/Lib/site-packages/torch/version.py`.
 */
function extractTorchBuild(versionPy: string): string | undefined {
  const match = versionPy.match(/__version__\s*=\s*'([^']+)'/) ?? versionPy.match(/__version__\s*=\s*"([^"]+)"/)
  return match?.[1]
}

function deviceFromTorchBuild(build: string | undefined): AllTalkDeviceReport['device'] {
  if (!build)
    return 'unknown'
  if (build.includes('+cpu'))
    return 'cpu'
  if (build.includes('+cu'))
    return 'cuda'
  return 'other'
}

export async function probeAllTalkDevice(
  runtime: AllTalkRuntimeConfig & { installDir?: string },
  deps: ProbeDeps = {},
): Promise<AllTalkDeviceReport> {
  const report: AllTalkDeviceReport = { device: 'unknown' }
  const readImpl = deps.readFileImpl ?? (async (path: string) => readFile(path, 'utf8'))

  // 1. The embedded torch wheel answers the device question directly.
  const installDir = runtime.installDir?.trim()
  if (installDir) {
    try {
      const versionPy = await readImpl(
        join(installDir, 'alltalk_environment', 'env', 'Lib', 'site-packages', 'torch', 'version.py'),
      )
      report.torchBuild = extractTorchBuild(versionPy)
      report.device = deviceFromTorchBuild(report.torchBuild)
      if (!report.torchBuild)
        report.note = 'torch/version.py readable but the version line was not found'
    }
    catch {
      report.note = 'embedded torch build not readable from the install in use'
    }
  }
  else {
    report.note = 'no install directory on the runtime config - using an external server'
  }

  // 2. The server confirms what model method is actually loaded.
  try {
    const settings = await clientRequestJson('/api/currentsettings', runtime, deps.fetchImpl) as {
      current_model_loaded?: string
      deepspeed_status?: boolean
      low_vram_status?: boolean
    } | undefined
    if (settings) {
      report.currentModelLoaded = settings.current_model_loaded
      report.deepspeedStatus = settings.deepspeed_status
      report.lowVramStatus = settings.low_vram_status
    }
  }
  catch { /* a server-only question stays unanswered; never a crash */ }

  // 3. The GPU the OS shows this app (metadata only, name-safe).
  try {
    const gpus = await (deps.getGpuInfoImpl?.() ?? Promise.resolve(undefined))
    const gpu = Array.isArray(gpus) ? gpus[0] : undefined
    const name = gpu?.deviceName?.trim()
    if (name)
      report.gpuName = name
  }
  catch { /* gpuName is optional by contract */ }

  return report
}

/** Small, dependency-free `/api/currentsettings` fetch (avoids widening the client interface). */
async function clientRequestJson(
  path: string,
  runtime: AllTalkRuntimeConfig,
  fetchImpl: typeof fetch | undefined,
): Promise<unknown> {
  const base = runtime.baseUrl?.trim() || DEFAULT_ALLTALK_BASE_URL
  const controller = new AbortController()
  const timeoutMs = runtime.timeoutMs > 0 ? runtime.timeoutMs : 5000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const fn = fetchImpl ?? fetch
    const response = await fn(new URL(path, base).toString(), { signal: controller.signal })
    if (!response.ok)
      return undefined
    return await response.json()
  }
  finally {
    clearTimeout(timer)
  }
}

/** Structured metadata-only log line for the main-process diagnostics. */
export function logAllTalkDeviceReport(report: AllTalkDeviceReport): void {
  const fields: Record<string, string | number | boolean> = {
    device: report.device,
    event: 'lia.voice.device',
    torchBuild: report.torchBuild ?? 'unknown',
    ...(report.currentModelLoaded ? { currentModelLoaded: report.currentModelLoaded } : {}),
    ...(report.deepspeedStatus !== undefined ? { deepspeedStatus: report.deepspeedStatus } : {}),
    ...(report.lowVramStatus !== undefined ? { lowVramStatus: report.lowVramStatus } : {}),
    ...(report.gpuName ? { gpuName: report.gpuName } : {}),
    ...(report.note ? { note: report.note } : {}),
  }
  const line = Object.entries(fields).map(([key, value]) => `${key}=${String(value)}`).join(' ')
  console.info(line)
}
