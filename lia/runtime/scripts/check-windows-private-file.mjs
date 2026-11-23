import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { writePrivateWindowsFile } from '../src/secrets/windows-private-file.ts'

assert.equal(process.platform, 'win32')
const fixture = await mkdtemp(join(tmpdir(), 'lia-private-write-gate-'))
const sample = 'lia-synthetic-file-fixture'

async function measure(label, operation) {
  const start = performance.now()
  try {
    await operation()
    console.log(JSON.stringify({ label, ok: true, ms: Math.round(performance.now() - start) }))
    return true
  }
  catch {
    console.log(JSON.stringify({ label, ok: false, ms: Math.round(performance.now() - start) }))
    return false
  }
}

async function probePowerShell(label, childEnv, useInput) {
  const start = performance.now()
  const system = join(process.env.SystemRoot, 'System32')
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::WriteLine("started")',
    '$user = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    '[Console]::WriteLine("identity")',
    '$rules = New-Object Security.AccessControl.FileSecurity',
    '$rules.SetAccessRuleProtection($true, $false)',
    '$rules.SetOwner($user)',
    '$rules.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user, "FullControl", "Allow"))',
    '[Console]::WriteLine("rules")',
    '$stream = [IO.FileStream]::new($env:LIA_VAULT_PENDING_PATH, "CreateNew", "Write", "None", 4096, "None", $rules)',
    '[Console]::WriteLine("opened")',
    useInput
      ? 'try { [Console]::OpenStandardInput().CopyTo($stream); [Console]::WriteLine("copied"); $stream.Flush($true) } finally { $stream.Dispose() }'
      : 'try { $stream.WriteByte(42); $stream.Flush($true) } finally { $stream.Dispose() }',
    '[Console]::WriteLine("flushed")',
  ].join('\n')
  const child = spawn(join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], {
    cwd: system,
    env: { ...childEnv, LIA_VAULT_PENDING_PATH: join(fixture, label) },
    stdio: [useInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    timeout: 5000,
    windowsHide: true,
  })
  let output = ''
  let stderrPresent = false
  let launchFailed = false
  child.stdout.on('data', (chunk) => { output = (output + chunk.toString('utf8')).slice(-256) })
  child.stderr.on('data', () => { stderrPresent = true })
  child.on('error', () => { launchFailed = true })
  if (child.stdin) {
    child.stdin.on('error', () => {})
    child.stdin.end(sample, 'utf8')
  }
  const { code, signal } = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  const allowed = new Set(['started', 'identity', 'rules', 'opened', 'copied', 'flushed'])
  const phases = output.split(/\r?\n/).filter(line => allowed.has(line))
  console.log(JSON.stringify({ label, ms: Math.round(performance.now() - start), code, signal, launchFailed, stderrPresent, phases }))
}

try {
  const control = await measure('filesystem', async () => {
    const path = join(fixture, 'control')
    await writeFile(path, sample, { flag: 'wx' })
    assert.equal(await readFile(path, 'utf8'), sample)
  })
  const namedPipe = await measure('named-pipe', async () => {
    const server = createServer()
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen({ path: `\\\\.\\pipe\\lia-private-file-gate-${randomUUID()}`, exclusive: true }, resolve)
    })
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  const protectedWrite = await measure('private-windows-file', async () => {
    const path = join(fixture, 'protected')
    await writePrivateWindowsFile(path, sample)
    assert.equal(await readFile(path, 'utf8'), sample)
  })
  const minimal = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot }
  await probePowerShell('minimal-stdin', minimal, true)
  await probePowerShell('minimal-no-stdin', minimal, false)
  await probePowerShell('inherited-stdin', process.env, true)
  if (!control || !namedPipe || !protectedWrite)
    process.exitCode = 1
}
finally {
  await rm(fixture, { recursive: true, force: true })
}
