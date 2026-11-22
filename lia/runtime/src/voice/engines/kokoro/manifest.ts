import nodePath from 'node:path'

/**
 * Phase 7.9C: measured facts pinned by the Phase 7.9A/7.9B device QA.
 * Nothing here is aspirational - every value was either produced by a
 * measured run on the target machine or hash-verified against the
 * acquisition mirrors.
 *
 * Acquisition evidence (both mirrors concatenate to the SAME bytes, the
 * sha256 below is the single integrity gate):
 * - Hugging Face `onnx-community/Kokoro-82M-v1.0-ONNX` (official ONNX mirror)
 * - npm/jsDelivr `kokoro-q8-shards@1.0.0` (5 x 17.83 MB + 1 x 3.23 MB)
 */

export const KOKORO_ENGINE_ID = 'kokoro'

export const KOKORO_MODEL_ID = 'Kokoro-82M-v1.0-ONNX'
export const KOKORO_MODEL_FILE = 'model_quantized.onnx'
export const KOKORO_MODEL_BYTES = 92_361_116
export const KOKORO_MODEL_SHA256 = 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'
export const KOKORO_MODEL_URL_PRIMARY = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx'
export const KOKORO_MODEL_SHARD_URLS = [
  'https://cdn.jsdelivr.net/npm/kokoro-q8-shards@1.0.0/kokoro-q8.part0.bin',
  'https://cdn.jsdelivr.net/npm/kokoro-q8-shards@1.0.0/kokoro-q8.part1.bin',
  'https://cdn.jsdelivr.net/npm/kokoro-q8-shards@1.0.0/kokoro-q8.part2.bin',
  'https://cdn.jsdelivr.net/npm/kokoro-q8-shards@1.0.0/kokoro-q8.part3.bin',
  'https://cdn.jsdelivr.net/npm/kokoro-q8-shards@1.0.0/kokoro-q8.part4.bin',
  'https://cdn.jsdelivr.net/npm/kokoro-q8-shards@1.0.0/kokoro-q8.part5.bin',
] as const

export interface KokoroVoiceAsset {
  name: string
  bytes: number
  sha256: string
}

/** The three pt-BR-compatible official voice packs (kokoro.js distribution). */
export const KOKORO_VOICES: readonly KokoroVoiceAsset[] = [
  { name: 'pf_dora', bytes: 522_240, sha256: '3da7b5b2d91847ebf5646f57631af6ececae3c29a89cd300f06edf9aa6cfe9ee' },
  { name: 'pm_alex', bytes: 522_240, sha256: '0175c753f59c54e7fd5a995bedef0c5ff2fb67e0043dd3dcb2ae74ec2acbeb2a' },
  { name: 'pm_santa', bytes: 522_240, sha256: '8b012db3185778afe2e45a62cbad69db73021774fe68dda634bcc748a982eede' },
]

/** More bytes than any voice pack; sha256 is still the authority, this is a fail-fast gate. */
export const KOKORO_VOICE_MAX_BYTES = 1_048_576

export function kokoroVoiceUrls(name: string): readonly string[] {
  const file = `${name}.bin`
  return [
    `https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro.js/voices/${file}`,
    `https://cdn.jsdelivr.net/gh/hexgrad/kokoro@main/kokoro.js/voices/${file}`,
  ]
}

/** The default pt-BR stock voice of this build. */
export const KOKORO_DEFAULT_VOICE_ID = 'pf_dora'
export const KOKORO_DEFAULT_LANGUAGE = 'pt-br'
export const KOKORO_SAMPLE_RATE = 24_000
export const KOKORO_CHANNELS = 1

/**
 * Python the venv is allowed to use: kokoro-onnx 0.6.1 + espeakng-loader
 * ship wheels up to cp313; 3.14 exists only in preview and is untested.
 */
export const KOKORO_PYTHON_MIN = [3, 10] as const
export const KOKORO_PYTHON_MAX = [3, 13] as const

/**
 * Pinned pip requirements. Deliberately plain `onnxruntime`: the CPU
 * execution provider is the only one this build declares. Accelerated
 * provider packages are added by a later phase AFTER hardware QA.
 */
export const KOKORO_PIP_REQUIREMENTS = [
  'kokoro-onnx==0.6.1',
  'soundfile',
] as const
export const KOKORO_ONNX_VERSION = '0.6.1'

/** The execution providers the worker session is allowed to request. */
export const KOKORO_ORT_PROVIDERS = ['CPUExecutionProvider'] as const

export const KOKORO_WORKER_PROTOCOL_VERSION = 1

/** Filenames the layout composes (worker + npz builder + install marker). */
export const KOKORO_WORKER_FILENAME = 'kokoro_worker.py'
export const KOKORO_VOICES_NPZ_FILENAME = 'voices-pt.npz'
export const KOKORO_STATE_FILENAME = 'install-state.json'
export const KOKORO_NPZ_BUILDER_FILENAME = 'build-voices-npz.py'

/** Mirrors `node:path.join` so tests can pin win32 layouts on any host. */
export function kokoroVoiceBinFile(layout: { voicesDir: string }, name: string): string {
  return nodePath.join(layout.voicesDir, `${name}.bin`)
}
