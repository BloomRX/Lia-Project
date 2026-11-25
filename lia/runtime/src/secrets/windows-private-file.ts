import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { env } from 'node:process'

const script = [
  '$ErrorActionPreference = \'Stop\'',
  '[Console]::WriteLine("started")',
  '$user = [Security.Principal.WindowsIdentity]::GetCurrent().User',
  '[Console]::WriteLine("identity")',
  '$rules = [Security.AccessControl.FileSecurity]::new()',
  '$rules.SetAccessRuleProtection($true, $false)',
  '$rules.SetOwner($user)',
  '$rules.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, "FullControl", "Allow"))',
  '[Console]::WriteLine("rules")',
  '$stream = [IO.FileStream]::new($env:LIA_VAULT_PENDING_PATH, "CreateNew", "Write", "None", 4096, "None", $rules)',
  '[Console]::WriteLine("opened")',
  'try { [Console]::OpenStandardInput().CopyTo($stream); $stream.Flush($true) } finally { $stream.Dispose() }',
  '[Console]::WriteLine("flushed")',
].join('\n')

const phases = ['not-started', 'started', 'identity', 'rules', 'opened', 'flushed'] as const
type PrivateWritePhase = typeof phases[number]
type PrivateWriteReason = 'spawn' | 'pipe' | 'interrupted' | 'exit'

export class PrivateWindowsWriteError extends Error {
  readonly reason: PrivateWriteReason
  readonly phase: PrivateWritePhase

  constructor(reason: PrivateWriteReason, phase: PrivateWritePhase) {
    super('Windows credential file could not be written privately')
    this.reason = reason
    this.phase = phase
  }
}

/** Create an unpublished file with a protected DACL before copying ciphertext. */
export async function writePrivateWindowsFile(path: string, data: string, signal?: AbortSignal): Promise<void> {
  const windowsDirectory = env.SystemRoot
  if (!windowsDirectory || !isAbsolute(windowsDirectory) || !isAbsolute(path))
    throw new Error('Windows credential file path is unavailable')
  const system = join(windowsDirectory, 'System32')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ], {
      cwd: system,
      env: { SystemRoot: windowsDirectory, WINDIR: windowsDirectory, LIA_VAULT_PENDING_PATH: path },
      signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true,
    })
    // Keep only a fixed phase enum. Never retain errors or output text.
    let phase: PrivateWritePhase = 'not-started'
    let line = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const parts = (line + chunk).split('\n')
      line = parts.pop()!.slice(-32)
      for (const part of parts) {
        const next = phases.find(candidate => candidate === part.trim())
        if (next && phases.indexOf(next) > phases.indexOf(phase))
          phase = next
      }
    })
    child.stderr.resume()
    let failure: PrivateWriteReason | undefined
    child.on('error', () => { failure ??= signal?.aborted ? 'interrupted' : 'spawn' })
    child.stdin.on('error', () => { failure ??= 'pipe' })
    child.stdout.on('error', () => { failure ??= 'pipe' })
    child.stderr.on('error', () => { failure ??= 'pipe' })
    child.once('close', (code, termination) => {
      if (failure || code !== 0 || phase !== 'flushed')
        reject(new PrivateWindowsWriteError(termination ? 'interrupted' : failure ?? 'exit', phase))
      else
        resolve()
    })
    child.stdin.end(data, 'utf8')
  })
}
