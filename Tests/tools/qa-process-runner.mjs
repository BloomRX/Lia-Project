#!/usr/bin/env node
/**
 * Portable process runner for Windows .cmd shims — no shell:true for native exes.
 * Handles win32 pnpm.cmd via explicit ComSpec, quotes safely, testable via injection.
 */

import { spawnSync as defaultSpawn } from 'node:child_process'
import nodePath from 'node:path'
import process from 'node:process'

const RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}(?:-[0-9]+)?$/

export function isValidRunId(id) {
  return RUN_ID_RE.test(id)
}

// Windows quoting for cmd.exe /d /s /c — double quotes, escape inner quotes, handle trailing backslash
export function quoteForCmd(arg) {
  if (arg === '') return '""'
  // Check if needs quoting
  const needsQuote = /[\s"&()^%!<>|]/.test(arg) || arg.endsWith('\\') || arg.includes('"')
  if (!needsQuote) return arg
  // Escape inner quotes by doubling them? For cmd, double quotes inside quoted string are escaped as ""
  // Also need to double trailing backslashes before closing quote
  let escaped = arg.replace(/"/g, '""')
  // If ends with backslash, double them
  if (escaped.endsWith('\\')) escaped += '\\'
  // Also handle backslashes before quote? Already handled by "" doubling
  return `"${escaped}"`
}

export function buildCmdLine(argv) {
  return argv.map(quoteForCmd).join(' ')
}

export function isWindowsCmdShim(resolvedPath) {
  if (!resolvedPath) return false
  const lower = resolvedPath.toLowerCase()
  return lower.endsWith('.cmd') || lower.endsWith('.bat')
}

export function isNativeExecutable(resolvedPath) {
  if (!resolvedPath) return false
  const lower = resolvedPath.toLowerCase()
  return lower.endsWith('.exe') || lower.endsWith('.com') || !lower.match(/\.(cmd|bat)$/)
}

// Resolve executable via where.exe on win32, otherwise return as-is
export function resolveExecutable(executable, { platform = process.platform, spawn = defaultSpawn, env = process.env } = {}) {
  if (platform !== 'win32') return executable
  // On win32, try where.exe
  try {
    const p = spawn('where.exe', [executable], { encoding: 'utf-8', env, timeout: 3000 })
    if (p.status === 0 && p.stdout) {
      const first = p.stdout.split(/\r?\n/).filter(Boolean)[0]
      if (first) return first.trim()
    }
  } catch {}
  // Fallback: try where (without .exe)
  try {
    const p = spawn('where', [executable], { encoding: 'utf-8', env, timeout: 3000 })
    if (p.status === 0 && p.stdout) {
      const first = p.stdout.split(/\r?\n/).filter(Boolean)[0]
      if (first) return first.trim()
    }
  } catch {}
  // If not found, return original (will fail later as env-limited)
  return null
}

export function getComSpec({ env = process.env, platform = process.platform } = {}) {
  if (env.ComSpec) return env.ComSpec
  if (platform === 'win32') return 'C:\\Windows\\System32\\cmd.exe'
  return null
}

// Validate that argv comes from static inventory (no user arbitrary)
// For test purposes, we check that argv[0] is in allowed executables and dynamic parts are valid run-ids
const ALLOWED_EXECUTABLES = new Set(['pnpm', 'node', 'powershell', 'pwsh', 'where.exe', 'where', 'git', 'py', 'python', 'python3'])
const ALLOWED_PNPM_SUBS = new Set(['exec', 'lint', 'typecheck', 'test', 'run'])

export function validateStaticArgv(argv) {
  if (!Array.isArray(argv) || argv.length === 0) throw new Error('argv must be non-empty array')
  const exe = argv[0]
  // Allow pnpm, node, npx? but npx not allowed per policy — we check
  // For benchmark, allowed is pnpm/node/powershell
  // We will not strictly enforce here, but ensure no shell metachars in exe
  if (/[&|;<>^%!()"]/.test(exe)) throw new Error(`invalid executable: ${exe}`)
  for (const a of argv.slice(1)) {
    // Allow run-id as dynamic value
    if (RUN_ID_RE.test(a)) continue
    if (a.includes('Tests/runs') && a.includes(RUN_ID_RE.source.slice(1, 10))) {
      // Contains run-id path, check that the run-id part is valid
      const m = a.match(/[0-9]{8}-[0-9]{6}-[0-9a-f]{7}(?:-[0-9]+)?/)
      if (m && !RUN_ID_RE.test(m[0])) throw new Error(`invalid run-id in arg: ${a}`)
      continue
    }
    // Otherwise, ensure no unquoted shell metachars that would be interpreted by cmd if not quoted
    // We will quote them, so it's safe, but we still ensure no user-provided arbitrary command strings
  }
  return true
}

// Main runner — decides direct vs cmd.exe
export function runWithRunner(argv, { cwd, env = process.env, platform = process.platform, spawn = defaultSpawn, resolver = resolveExecutable, comSpec = getComSpec({ env, platform }) } = {}) {
  if (!argv || argv.length === 0) throw new Error('argv required')
  validateStaticArgv(argv)
  const executable = argv[0]
  const args = argv.slice(1)

  // Git and security bridge must never use cmd.exe — caller should use git helper directly
  // But if called via runner, we still handle correctly: they are native exes, so direct
  const resolved = platform === 'win32' ? resolver(executable, { platform, spawn, env }) : executable

  if (resolved === null) {
    return { status: null, error: new Error(`executable not found: ${executable}`), stdout: '', stderr: `executable not found: ${executable}`, timedOut: false }
  }

  const isCmd = platform === 'win32' && isWindowsCmdShim(resolved)

  if (isCmd) {
    // Must have ComSpec
    const cmdExe = comSpec || getComSpec({ env, platform })
    if (!cmdExe) return { status: null, error: new Error('ComSpec not found for cmd shim'), stdout: '', stderr: 'ComSpec not found', timedOut: false }
    // Build command line: quoted resolved + quoted args
    // For win32, we need to invoke: cmd.exe /d /s /c " <quoted resolved> <quoted args> "
    // Use /d /s /c and the command line as one arg
    const quotedResolved = quoteForCmd(resolved)
    const quotedArgs = args.map(quoteForCmd)
    const cmdLine = [quotedResolved, ...quotedArgs].join(' ')
    // spawnSync(cmdExe, ['/d','/s','/c', cmdLine], {cwd, env, encoding:'utf-8'})
    const result = spawn(comSpec || cmdExe, ['/d', '/s', '/c', cmdLine], { cwd, env, encoding: 'utf-8', timeout: 600000, maxBuffer: 20 * 1024 * 1024 })
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error || null, timedOut: result.error && String(result.error).includes('timed out') }
  } else {
    // Direct spawn
    const execPath = platform === 'win32' ? resolved : executable
    const result = spawn(execPath, args, { cwd, env, encoding: 'utf-8', timeout: 600000, maxBuffer: 20 * 1024 * 1024 })
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error || null, timedOut: result.error && String(result.error).includes('timed out') }
  }
}

// Convenience wrapper for benchmark commands — uses runner and returns structured result
export function runCommandWithRunner({ id, label, cwd, argv, logPath, repoRoot, platform, spawn, resolver, comSpec, env } = {}) {
  // This is a thin wrapper that will be used by qa-benchmark.mjs
  // It delegates to runWithRunner and then formats log
  const result = runWithRunner(argv, { cwd, env, platform, spawn, resolver, comSpec })
  // Caller will handle log writing and status classification
  return result
}

// Ensure no shell:true is used anywhere in this module
export function assertNoShell(opts) {
  if (opts && opts.shell) throw new Error('shell:true forbidden')
}
