import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { quoteForCmd, buildCmdLine, isWindowsCmdShim, resolveExecutable, getComSpec, runWithRunner } from './qa-process-runner.mjs'

describe('qa-process-runner: quoting', () => {
  it('quotes spaces', () => {
    assert.equal(quoteForCmd('C:\\Users\\Alice\\My Docs\\file.txt'), '"C:\\Users\\Alice\\My Docs\\file.txt"')
  })
  it('quotes parentheses', () => {
    assert.equal(quoteForCmd('C:\\Program Files (x86)\\App\\file'), '"C:\\Program Files (x86)\\App\\file"')
  })
  it('quotes ampersand cannot become second command', () => {
    const cmd = quoteForCmd('C:\\Temp\\a & b\\file.txt')
    assert.ok(cmd.startsWith('"') && cmd.endsWith('"'))
    assert.ok(!cmd.includes(' & ') || cmd.includes('"'))
    // When joined, the & is inside quotes, not interpreted
    const line = buildCmdLine(['pnpm', 'exec', 'vitest', 'run', 'C:\\Temp\\a & b\\file.txt'])
    // The ampersand arg should be quoted
    assert.ok(line.includes('"C:\\Temp\\a & b\\file.txt"'))
  })
  it('quotes inner quotes', () => {
    assert.equal(quoteForCmd('a"b'), '"a""b"')
  })
  it('handles trailing backslash', () => {
    assert.equal(quoteForCmd('C:\\path\\'), '"C:\\path\\\\"')
  })
})

describe('qa-process-runner: isWindowsCmdShim', () => {
  it('detects .cmd/.bat', () => {
    assert.ok(isWindowsCmdShim('C:\\npm\\pnpm.cmd'))
    assert.ok(isWindowsCmdShim('C:\\test\\run.BAT'))
    assert.ok(!isWindowsCmdShim('C:\\Windows\\System32\\git.exe'))
    assert.ok(!isWindowsCmdShim('/usr/bin/pnpm'))
  })
})

describe('qa-process-runner: resolveExecutable', () => {
  it('linux returns as-is', () => {
    const res = resolveExecutable('pnpm', { platform: 'linux', spawn: () => ({ status: 1, stdout: '' }) })
    assert.equal(res, 'pnpm')
  })
  it('win32 uses where.exe', () => {
    let called = null
    const fakeSpawn = (exe, args) => {
      called = { exe, args }
      if (exe === 'where.exe' && args[0] === 'pnpm') return { status: 0, stdout: 'C:\\Users\\Alice\\AppData\\Roaming\\npm\\pnpm.cmd\r\n' }
      return { status: 1, stdout: '' }
    }
    const res = resolveExecutable('pnpm', { platform: 'win32', spawn: fakeSpawn })
    assert.equal(res, 'C:\\Users\\Alice\\AppData\\Roaming\\npm\\pnpm.cmd')
    assert.equal(called.exe, 'where.exe')
  })
})

describe('qa-process-runner: runWithRunner routing', () => {
  it('A: win32 pnpm resolves pnpm.cmd → ComSpec selected', () => {
    const calls = []
    const fakeSpawn = (exe, args, opts) => {
      calls.push({ exe, args })
      if (exe === 'where.exe') return { status: 0, stdout: 'C:\\npm\\pnpm.cmd\r\n' }
      if (exe === 'C:\\Windows\\System32\\cmd.exe') return { status: 0, stdout: 'ok', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
    const fakeResolver = () => 'C:\\npm\\pnpm.cmd'
    const res = runWithRunner(['pnpm', 'exec', 'vitest', 'run'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, resolver: fakeResolver, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    assert.ok(calls.some(c => c.exe === 'C:\\Windows\\System32\\cmd.exe' && c.args.includes('/d') && c.args.includes('/s') && c.args.includes('/c')))
    // Ensure no shell:true
    for (const c of calls) assert.ok(!c.args.includes('shell:true'))
  })
  it('B: win32 native git.exe → direct spawn', () => {
    const calls = []
    const fakeSpawn = (exe, args) => { calls.push({ exe, args }); return { status: 0, stdout: '', stderr: '' } }
    const fakeResolver = () => 'C:\\Program Files\\Git\\cmd\\git.exe'
    runWithRunner(['git', '--version'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, resolver: fakeResolver, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    assert.ok(calls.some(c => c.exe === 'C:\\Program Files\\Git\\cmd\\git.exe'))
    assert.ok(!calls.some(c => c.exe === 'C:\\Windows\\System32\\cmd.exe'))
  })
  it('C: win32 python.exe → direct spawn', () => {
    const calls = []
    const fakeSpawn = (exe, args) => { calls.push({ exe, args }); return { status: 0, stdout: '', stderr: '' } }
    const fakeResolver = () => 'C:\\Python\\python.exe'
    runWithRunner(['python', '--version'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, resolver: fakeResolver })
    assert.ok(calls.some(c => c.exe === 'C:\\Python\\python.exe'))
  })
  it('D: linux pnpm → direct spawn', () => {
    const calls = []
    const fakeSpawn = (exe, args) => { calls.push({ exe, args }); return { status: 0, stdout: '', stderr: '' } }
    runWithRunner(['pnpm', 'exec', 'vitest', 'run'], { cwd: '/tmp', platform: 'linux', spawn: fakeSpawn, resolver: () => 'pnpm' })
    assert.ok(calls.some(c => c.exe === 'pnpm'))
    assert.ok(!calls.some(c => c.exe.includes('cmd.exe')))
  })
  it('E: path containing spaces is quoted', () => {
    const calls = []
    const fakeSpawn = (exe, args) => { calls.push({ exe, args }); return { status: 0, stdout: '', stderr: '' } }
    const fakeResolver = () => 'C:\\My Tools\\pnpm.cmd'
    runWithRunner(['pnpm', 'exec', 'vitest', 'run', 'C:\\My Repo\\airi\\foo.ts'], { cwd: 'C:\\My Repo', platform: 'win32', spawn: fakeSpawn, resolver: fakeResolver, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    const cmdCall = calls.find(c => c.exe === 'C:\\Windows\\System32\\cmd.exe')
    assert.ok(cmdCall)
    const cmdLine = cmdCall.args[3]
    assert.ok(cmdLine.includes('"C:\\My Repo\\airi\\foo.ts"') || cmdLine.includes('"C:\\My Tools\\pnpm.cmd"'))
  })
  it('F: path containing & cannot become second command', () => {
    const calls = []
    const fakeSpawn = (exe, args) => { calls.push({ exe, args }); return { status: 0, stdout: '', stderr: '' } }
    const fakeResolver = () => 'C:\\npm\\pnpm.cmd'
    runWithRunner(['pnpm', 'exec', 'vitest', 'run', 'C:\\Temp\\a & b'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, resolver: fakeResolver, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    const cmdLine = calls.find(c => c.exe === 'C:\\Windows\\System32\\cmd.exe').args[3]
    // The & must be inside quotes, not as separator – the quoted form must appear
    assert.ok(cmdLine.includes('"C:\\Temp\\a & b"'))
    // And the raw unquoted sequence must not exist as a separate command
    // If quoting were missing, cmdLine would contain ' & b & ' or similar outside quotes
    assert.ok(cmdLine.indexOf('"C:\\Temp\\a & b"') !== -1)
  })
  it('G: static argv preserved exactly', () => {
    const calls = []
    const fakeSpawn = (exe, args) => { calls.push({ exe, args }); return { status: 0, stdout: '', stderr: '' } }
    const argv = ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser']
    runWithRunner(argv, { cwd: '/tmp', platform: 'linux', spawn: fakeSpawn, resolver: () => 'pnpm' })
    const call = calls.find(c => c.exe === 'pnpm')
    assert.deepEqual(call.args, ['exec', 'vitest', 'run', '--project', 'browser'])
  })
  it('H: unresolved executable → environment-limited launch failure', () => {
    const fakeSpawn = () => ({ status: 1, stdout: '', stderr: '' })
    const fakeResolver = () => null
    const res = runWithRunner(['pnpm', 'exec', 'vitest', 'run'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, resolver: fakeResolver, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    assert.equal(res.status, null)
    assert.ok(res.error)
    assert.match(String(res.error), /not found/)
  })
  it('I: no shell:true', () => {
    const calls = []
    const fakeSpawn = (exe, args, opts) => {
      calls.push({ opts })
      assert.ok(!opts || !opts.shell, 'shell:true forbidden')
      return { status: 0, stdout: '', stderr: '' }
    }
    runWithRunner(['pnpm', '--version'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, resolver: () => 'C:\\npm\\pnpm.cmd', comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    runWithRunner(['git', '--version'], { cwd: '/tmp', platform: 'linux', spawn: fakeSpawn, resolver: () => 'git' })
    assert.ok(calls.length >= 2)
  })
})
