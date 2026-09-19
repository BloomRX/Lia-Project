import process from 'node:process'

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Phase 7.7.2, item 6: ask the MANAGED PYTHON INTERPRETER itself what
 * device the XTTS stack will run on.
 *
 * Why this exists: the filesystem probe reads `torch/version.py`, whose
 * version string does NOT always carry the `+cpu`/`+cuXXX` suffix (the QA
 * rig showed `torchBuild=2.2.1` → `device=other`). A bare version means the
 * wheel came from a build that does not brand the suffix in the file, so
 * the only CONCLUSIVE fact is `torch.cuda.is_available()` as reported by
 * the exact interpreter AllTalk will boot with.
 *
 * Safety contract (item 6, binding):
 *
 * - executes ONLY the interpreter already inside the managed install; never
 *   downloads, installs, or modifies the runtime
 * - imports `torch` but loads NO model (no XTTS weights, no inference)
 * - prints a single `LIA-TORCH-FACTS:` JSON line; everything else is ignored
 * - returns only safe metadata: torchVersion / cudaAvailable / cudaVersion /
 *   deviceName (optional) - no paths, no environment, no system dumps
 * - bounded by a hard timeout; any failure degrades to `undefined`, never a
 *   crash and never a fabricated answer
 */

export interface AllTalkTorchFacts {
  torchVersion?: string
  cudaAvailable?: boolean
  cudaVersion?: string
  /** CUDA device 0 name - ONLY present when CUDA is actually available. */
  deviceName?: string
  error?: string
}

const PIPE_SCRIPT = [
  'import json',
  'out = {}',
  'try:',
  '    import torch',
  '    out["torchVersion"] = torch.__version__',
  '    out["cudaAvailable"] = bool(torch.cuda.is_available())',
  '    out["cudaVersion"] = torch.version.cuda',
  '    if out["cudaAvailable"]:',
  '        out["deviceName"] = torch.cuda.get_device_name(0)',
  'except Exception as e:',
  '    out["error"] = type(e).__name__',
  'print("LIA-TORCH-FACTS:" + json.dumps(out))',
].join('\n')

export const TORCH_FACTS_PREFIX = 'LIA-TORCH-FACTS:'

/** Candidate interpreters, relative to the resolved install root. */
export function torchInterpreterCandidates(installDir: string): string[] {
  if (process.platform === 'win32') {
    return [
      join(installDir, 'alltalk_environment', 'env', 'python.exe'),
      join(installDir, 'alltalk_environment', 'python', 'python.exe'),
    ]
  }
  return [
    join(installDir, 'alltalk_environment', 'env', 'bin', 'python'),
    join(installDir, 'alltalk_environment', 'python', 'bin', 'python'),
  ]
}

export interface PythonProbeDeps {
  existsImpl?: (path: string) => boolean
  execFileImpl?: (executable: string, args: string[], timeoutMs: number) => Promise<{ stdout: string }>
  timeoutMs?: number
}

export function parseTorchFacts(stdout: string): AllTalkTorchFacts | undefined {
  const line = stdout.split(/\r?\n/).find(candidate => candidate.startsWith(TORCH_FACTS_PREFIX))
  if (!line)
    return undefined
  try {
    const parsed = JSON.parse(line.slice(TORCH_FACTS_PREFIX.length)) as AllTalkTorchFacts
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  }
  catch {
    return undefined
  }
}

/**
 * Runs the torch diagnostic with the managed interpreter. `undefined` means
 * "not answerable on this machine" (no interpreter, timeout, parse miss) -
 * the caller keeps the filesystem-derived device as-is.
 */
export async function probeTorchFactsWithManagedPython(
  installDir: string,
  deps: PythonProbeDeps = {},
): Promise<AllTalkTorchFacts | undefined> {
  const existsImpl = deps.existsImpl ?? existsSync
  const timeoutMs = deps.timeoutMs ?? 120_000
  const execFileImpl = deps.execFileImpl ?? ((executable, args, timeout) => new Promise<{ stdout: string }>((resolve, reject) => {
    execFile(executable, args, { timeout, windowsHide: true }, (error, stdout) => {
      if (error)
        reject(error)
      else
        resolve({ stdout: String(stdout) })
    })
  }))

  const interpreter = torchInterpreterCandidates(installDir).find(candidate => existsImpl(candidate))
  if (!interpreter)
    return undefined

  try {
    const { stdout } = await execFileImpl(interpreter, ['-c', PIPE_SCRIPT], timeoutMs)
    return parseTorchFacts(stdout)
  }
  catch {
    return undefined
  }
}
