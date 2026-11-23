import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'

import { writePrivateWindowsFile } from '../src/secrets/windows-private-file.ts'

assert.equal(process.platform, 'win32')
const fixture = await mkdtemp(join(tmpdir(), 'lia-private-write-gate-'))
const sample = 'lia-synthetic-file-fixture'
const diagnostics = process.argv.includes('--diagnostics')
const system = join(process.env.SystemRoot, 'System32')
const powershell = join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe')

async function assertPrivateAcl(path) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$sidType = [Security.Principal.SecurityIdentifier]',
    '$user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$acl = [IO.File]::GetAccessControl($env:LIA_ACL_TEST_PATH)',
    '$rules = $acl.GetAccessRules($true, $true, $sidType)',
    'if (!$acl.AreAccessRulesProtected -or $acl.GetOwner($sidType).Value -ne $user -or $rules.Count -ne 1) { exit 1 }',
    '$rule = $rules[0]',
    'if ($rule.IsInherited -or $rule.IdentityReference.Value -ne $user -or $rule.AccessControlType -ne "Allow" -or $rule.FileSystemRights -ne "FullControl") { exit 1 }',
  ].join('\n')
  await promisify(execFile)(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { cwd: system, env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot, LIA_ACL_TEST_PATH: path }, windowsHide: true, timeout: 5000 })
}

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

async function probePowerShell(label, childEnv, useInput, directConstructor = false) {
  const start = performance.now()
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::WriteLine("started")',
    '$user = [Security.Principal.WindowsIdentity]::GetCurrent().User',
    '[Console]::WriteLine("identity")',
    directConstructor
      ? '$rules = [Security.AccessControl.FileSecurity]::new()'
      : '$rules = New-Object Security.AccessControl.FileSecurity',
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
  const child = spawn(powershell, [
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
  const path = join(fixture, 'protected')
  const protectedWrite = await measure('private-windows-file', async () => {
    await writePrivateWindowsFile(path, sample)
    assert.equal(await readFile(path, 'utf8'), sample)
  })
  const acl = protectedWrite && await measure('private-windows-acl', () => assertPrivateAcl(path))
  if (!control || !namedPipe || !protectedWrite || !acl)
    process.exitCode = 1
  if (diagnostics || !protectedWrite || !acl) {
    const minimal = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot }
    await probePowerShell('production-constructor-with-phases', minimal, true, true)
    await probePowerShell('legacy-constructor-with-stdin', minimal, true)
    await probePowerShell('legacy-constructor-without-stdin', minimal, false)
    await probePowerShell('legacy-constructor-inherited-env', process.env, true)
  }
}
finally {
  await rm(fixture, { recursive: true, force: true })
}
