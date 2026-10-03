import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { quoteForCmd, buildCmdLine, isWindowsCmdShim, resolveExecutable, getComSpec, runWithRunner, selectWindowsExecutableCandidate } from './qa-process-runner.mjs'

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

describe('qa-process-runner: selectWindowsExecutableCandidate', () => {
  it('A. extensionless + pnpm.cmd → pnpm.cmd', () => {
    const lines = ['C:\\Users\\Alice\\AppData\\Roaming\\npm\\pnpm', 'C:\\Users\\Alice\\AppData\\Roaming\\npm\\pnpm.cmd']
    assert.equal(selectWindowsExecutableCandidate(lines), 'C:\\Users\\Alice\\AppData\\Roaming\\npm\\pnpm.cmd')
  })
  it('B. extensionless + ps1 + cmd → cmd', () => {
    const lines = ['pnpm', 'pnpm.ps1', 'pnpm.cmd']
    assert.equal(selectWindowsExecutableCandidate(lines), 'pnpm.cmd')
  })
  it('C. cmd + exe → exe (priority)', () => {
    const lines = ['tool.cmd', 'tool.exe']
    assert.equal(selectWindowsExecutableCandidate(lines), 'tool.exe')
  })
  it('D. only extensionless + ps1 → null', () => {
    const lines = ['C:\\Users\\Alice\\npm\\pnpm', 'C:\\Users\\Alice\\npm\\pnpm.ps1']
    assert.equal(selectWindowsExecutableCandidate(lines), null)
  })
  it('E. blank lines / CRLF handled', () => {
    const raw = '\r\n\n C:\\a\\b.cmd \r\n \r\n\n'
    const lines = raw.split(/\r?\n/)
    assert.equal(selectWindowsExecutableCandidate(lines), 'C:\\a\\b.cmd')
    const raw2 = '  \r\nC:\\a\\b.exe\r\n\r\nC:\\a\\b.cmd\r\n'
    const lines2 = raw2.split(/\r?\n/)
    assert.equal(selectWindowsExecutableCandidate(lines2), 'C:\\a\\b.exe')
  })
  it('F. duplicate candidates handled deterministically', () => {
    const lines = ['C:\\a\\tool.cmd', 'C:\\a\\tool.cmd', 'C:\\a\\tool.cmd']
    assert.equal(selectWindowsExecutableCandidate(lines), 'C:\\a\\tool.cmd')
    const lines2 = ['C:\\a\\tool.cmd', 'C:\\a\\tool.exe', 'C:\\a\\tool.exe']
    assert.equal(selectWindowsExecutableCandidate(lines2), 'C:\\a\\tool.exe')
  })
  it('priority: exe > com > cmd > bat', () => {
    assert.equal(selectWindowsExecutableCandidate(['a.bat', 'a.cmd', 'a.com', 'a.exe']), 'a.exe')
    assert.equal(selectWindowsExecutableCandidate(['a.bat', 'a.cmd', 'a.com']), 'a.com')
    assert.equal(selectWindowsExecutableCandidate(['a.bat', 'a.cmd']), 'a.cmd')
    assert.equal(selectWindowsExecutableCandidate(['a.bat']), 'a.bat')
  })
  it('ignores unsupported extensions', () => {
    assert.equal(selectWindowsExecutableCandidate(['a.ps1', 'a.lnk', 'a']), null)
    assert.equal(selectWindowsExecutableCandidate(['a.ps1', 'a.cmd']), 'a.cmd')
  })
})

describe('qa-process-runner: resolveExecutable candidate integration', () => {
  it('where.exe returns extensionless first then cmd → selects cmd', () => {
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') return { status: 0, stdout: 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm\r\nC:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.cmd\r\n' }
      return { status: 1, stdout: '' }
    }
    const res = resolveExecutable('pnpm', { platform: 'win32', spawn: fakeSpawn })
    assert.equal(res, 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.cmd')
  })
  it('where with only unsupported → null', () => {
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') return { status: 0, stdout: 'C:\\Users\\Alice\\npm\\pnpm\r\nC:\\Users\\Alice\\npm\\pnpm.ps1\r\n' }
      if (exe === 'where') return { status: 0, stdout: 'C:\\Users\\Alice\\npm\\pnpm\r\n' }
      return { status: 1, stdout: '' }
    }
    const res = resolveExecutable('pnpm', { platform: 'win32', spawn: fakeSpawn })
    assert.equal(res, null)
  })
  it('fallback where after where.exe failure', () => {
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') throw new Error('where.exe not found')
      if (exe === 'where') return { status: 0, stdout: 'C:\\tools\\pnpm.cmd\r\n' }
      return { status: 1, stdout: '' }
    }
    const res = resolveExecutable('pnpm', { platform: 'win32', spawn: fakeSpawn })
    assert.equal(res, 'C:\\tools\\pnpm.cmd')
  })
})

describe('qa-process-runner: real Windows pnpm shim regression', () => {
  it('reproduces real class: extensionless first + cmd second → cmd and ComSpec', () => {
    const whereOutput = 'C:\\Users\\lucas\\AppData\\Roaming\\npm\\pnpm\r\nC:\\Users\\lucas\\AppData\\Roaming\\npm\\pnpm.cmd\r\n'
    const fakeSpawnWhere = (exe, args) => {
      if (exe === 'where.exe' && args[0] === 'pnpm') return { status: 0, stdout: whereOutput }
      return { status: 1, stdout: '' }
    }
    const resolved = resolveExecutable('pnpm', { platform: 'win32', spawn: fakeSpawnWhere })
    assert.equal(resolved, 'C:\\Users\\lucas\\AppData\\Roaming\\npm\\pnpm.cmd')
    // Now runWithRunner must use ComSpec
    const calls = []
    const fakeSpawn = (exe, args, opts) => {
      calls.push({ exe, args })
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      if (exe === 'C:\\Windows\\System32\\cmd.exe') return { status: 0, stdout: '12.8.1', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
    const res = runWithRunner(['pnpm', '--version'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    const comSpecCall = calls.find(c => c.exe === 'C:\\Windows\\System32\\cmd.exe')
    assert.ok(comSpecCall, 'should invoke ComSpec')
    assert.deepEqual(comSpecCall.args.slice(0, 3), ['/d', '/s', '/c'])
    assert.ok(comSpecCall.args[3].includes('pnpm.cmd'))
    assert.ok(comSpecCall.args[3].includes('--version'))
    // No direct extensionless spawn
    assert.ok(!calls.some(c => c.exe === 'C:\\Users\\lucas\\AppData\\Roaming\\npm\\pnpm'))
  })
  it('generic fixture reproduces same', () => {
    const whereOutput = 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm\r\nC:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.cmd\r\n'
    const fakeSpawn = (exe, args, opts) => {
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      if (exe === 'C:\\Windows\\System32\\cmd.exe') return { status: 0, stdout: 'ok', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
    const calls = []
    const wrapped = (exe, args, opts) => { calls.push({ exe, args }); return fakeSpawn(exe, args, opts) }
    runWithRunner(['pnpm', '--version'], { cwd: '/tmp', platform: 'win32', spawn: wrapped, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    assert.ok(calls.some(c => c.exe === 'C:\\Windows\\System32\\cmd.exe'))
    assert.ok(!calls.some(c => c.exe === 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm'))
  })
  it('ComSpec argv contains pnpm.cmd and --version, starts /d /s /c', () => {
    const whereOutput = 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm\r\nC:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.cmd\r\n'
    const calls = []
    const fakeSpawn = (exe, args) => {
      calls.push({ exe, args })
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      if (exe === 'C:\\Windows\\System32\\cmd.exe') return { status: 0, stdout: 'ok', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
    runWithRunner(['pnpm', '--version'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    const comSpecCall = calls.find(c => c.exe === 'C:\\Windows\\System32\\cmd.exe')
    assert.ok(comSpecCall)
    assert.equal(comSpecCall.args[0], '/d')
    assert.equal(comSpecCall.args[1], '/s')
    assert.equal(comSpecCall.args[2], '/c')
    assert.ok(comSpecCall.args[3].includes('pnpm.cmd'))
    assert.ok(comSpecCall.args[3].includes('--version'))
  })
  it('no extensionless spawn proof', () => {
    const whereOutput = 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm\r\nC:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.cmd\r\n'
    const calls = []
    const fakeSpawn = (exe, args) => {
      calls.push({ exe })
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      if (exe === 'C:\\Windows\\System32\\cmd.exe') return { status: 0, stdout: 'ok', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
    runWithRunner(['pnpm', '--version'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    assert.ok(!calls.some(c => c.exe === 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm'))
    assert.ok(!calls.some(c => c.exe === 'C:\\Users\\lucas\\AppData\\Roaming\\npm\\pnpm'))
  })
  it('ps1 ignored proof', () => {
    const whereOutput = 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.ps1\r\nC:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm\r\nC:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.cmd\r\n'
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      return { status: 1, stdout: '' }
    }
    const res = resolveExecutable('pnpm', { platform: 'win32', spawn: fakeSpawn })
    assert.equal(res, 'C:\\Users\\TestUser\\AppData\\Roaming\\npm\\pnpm.cmd')
  })
  it('exe-over-cmd priority proof', () => {
    const whereOutput = 'C:\\tools\\tool.cmd\r\nC:\\tools\\tool.exe\r\n'
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      return { status: 1, stdout: '' }
    }
    const res = resolveExecutable('tool', { platform: 'win32', spawn: fakeSpawn })
    assert.equal(res, 'C:\\tools\\tool.exe')
  })
  it('unsupported-only → null proof', () => {
    const whereOutput = 'C:\\a\\pnpm\r\nC:\\a\\pnpm.ps1\r\n'
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      if (exe === 'where') return { status: 0, stdout: whereOutput }
      return { status: 1, stdout: '' }
    }
    const res = resolveExecutable('pnpm', { platform: 'win32', spawn: fakeSpawn })
    assert.equal(res, null)
    const runnerRes = runWithRunner(['pnpm', '--version'], { cwd: '/tmp', platform: 'win32', spawn: fakeSpawn, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
    assert.equal(runnerRes.status, null)
    assert.match(String(runnerRes.error), /not found/)
  })
  it('CRLF/blank-line proof', () => {
    const whereOutput = '\r\n\r\nC:\\a\\b.cmd\r\n  \r\n\r\n'
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      return { status: 1, stdout: '' }
    }
    assert.equal(resolveExecutable('b', { platform: 'win32', spawn: fakeSpawn }), 'C:\\a\\b.cmd')
  })
  it('duplicate proof', () => {
    const whereOutput = 'C:\\a\\tool.cmd\r\nC:\\a\\tool.cmd\r\nC:\\a\\tool.cmd\r\n'
    const fakeSpawn = (exe, args) => {
      if (exe === 'where.exe') return { status: 0, stdout: whereOutput }
      return { status: 1, stdout: '' }
    }
    assert.equal(resolveExecutable('tool', { platform: 'win32', spawn: fakeSpawn }), 'C:\\a\\tool.cmd')
  })
  it('node/git/python native regression', () => {
    const fixtures = [
      { exe: 'node', out: 'C:\\Program Files\\nodejs\\node.exe\r\n' },
      { exe: 'git', out: 'C:\\Program Files\\Git\\cmd\\git.exe\r\n' },
      { exe: 'python', out: 'C:\\Python314\\python.exe\r\n' },
      { exe: 'powershell', out: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n' },
    ]
    for (const { exe, out } of fixtures) {
      const fakeSpawn = (e, args, opts) => {
        if (e === 'where.exe' && args[0] === exe) return { status: 0, stdout: out }
        if (e.toLowerCase().endsWith('.exe')) return { status: 0, stdout: 'ok', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      }
      const res = resolveExecutable(exe, { platform: 'win32', spawn: fakeSpawn })
      assert.ok(res.toLowerCase().endsWith('.exe'), `expected exe for ${exe}: ${res}`)
      const calls = []
      const wrapped = (e, a, o) => { calls.push({ exe: e, args: a }); if (e === 'where.exe') return { status: 0, stdout: out }; return { status: 0, stdout: 'ok', stderr: '' } }
      runWithRunner([exe, '--version'], { cwd: '/tmp', platform: 'win32', spawn: wrapped, comSpec: 'C:\\Windows\\System32\\cmd.exe' })
      assert.ok(calls.some(c => c.exe.toLowerCase().endsWith('.exe')))
      assert.ok(!calls.some(c => c.exe === 'C:\\Windows\\System32\\cmd.exe'), `native ${exe} should not use ComSpec`)
    }
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
