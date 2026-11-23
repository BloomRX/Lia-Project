import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { env } from 'node:process'

const script = [
  '$ErrorActionPreference = \'Stop\'',
  '$user = [Security.Principal.WindowsIdentity]::GetCurrent().User',
  '$rules = [Security.AccessControl.FileSecurity]::new()',
  '$rules.SetAccessRuleProtection($true, $false)',
  '$rules.SetOwner($user)',
  '$rules.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, "FullControl", "Allow"))',
  '$stream = [IO.FileStream]::new($env:LIA_VAULT_PENDING_PATH, "CreateNew", "Write", "None", 4096, "None", $rules)',
  'try { [Console]::OpenStandardInput().CopyTo($stream); $stream.Flush($true) } finally { $stream.Dispose() }',
].join('\n')

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
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    })
    let failed = false
    child.on('error', () => {
      failed = true
    })
    child.stdin.on('error', () => {
      failed = true
    })
    child.once('close', (code) => {
      if (failed || code !== 0)
        reject(new Error('Windows credential file could not be written privately'))
      else
        resolve()
    })
    child.stdin.end(data, 'utf8')
  })
}
