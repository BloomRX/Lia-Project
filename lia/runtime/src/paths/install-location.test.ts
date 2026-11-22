/**
 * Phase 7.4 Part K/J/I: user-chosen runtime location - the shape and the
 * one filesystem fact. Windows rules are exercised with `platform: 'win32'`
 * so they test green on any runner.
 */
import { describe, expect, it } from 'vitest'

import { classifyInstallLocation, inspectInstallLocationTarget } from './install-location'

describe('classifyInstallLocation (win32)', () => {
  it('accepts a second drive with spaces in the name', () => {
    const decision = classifyInstallLocation(' D:\\Lia\\Voice Runtime ', 'win32')
    expect(decision).toEqual({ status: 'ok', normalized: 'D:/Lia/Voice Runtime' })
  })

  it('accepts a deep path on C: outside system roots', () => {
    expect(classifyInstallLocation('C:\\LiaData\\runtimes\\voice', 'win32').status).toBe('ok')
    expect(classifyInstallLocation('C:\\Users\\Ana R\\Lia\\VoiceRuntime\\', 'win32').status).toBe('ok')
  })

  it('rejects relative and bare paths', () => {
    expect(classifyInstallLocation('Lia\\Voice', 'win32')).toEqual({ status: 'invalid', reason: 'not-absolute' })
    expect(classifyInstallLocation('C:Voice', 'win32')).toEqual({ status: 'invalid', reason: 'not-absolute' })
    expect(classifyInstallLocation('   ', 'win32')).toEqual({ status: 'invalid', reason: 'empty' })
  })

  it('rejects drive/filesystem roots', () => {
    expect(classifyInstallLocation('C:\\', 'win32')).toEqual({ status: 'invalid', reason: 'filesystem-root' })
    expect(classifyInstallLocation('D:', 'win32')).toEqual({ status: 'invalid', reason: 'not-absolute' })
    expect(classifyInstallLocation('D:\\\\', 'win32')).toEqual({ status: 'invalid', reason: 'filesystem-root' })
  })

  it('rejects system roots, case-insensitively and separator-insensitively', () => {
    expect(classifyInstallLocation('C:\\Windows\\TempLia', 'win32')).toEqual({ status: 'invalid', reason: 'system-root' })
    expect(classifyInstallLocation('c:/Program Files/Lia', 'win32')).toEqual({ status: 'invalid', reason: 'system-root' })
    expect(classifyInstallLocation('C:\\Program Files (x86)\\LiaVoice', 'win32')).toEqual({ status: 'invalid', reason: 'system-root' })
    expect(classifyInstallLocation('D:\\WINDOWS\\nope', 'win32')).toEqual({ status: 'invalid', reason: 'system-root' })
  })

  it('rejects oversized paths and UNC shares', () => {
    expect(classifyInstallLocation(`D:\\${'x'.repeat(300)}`, 'win32')).toEqual({ status: 'invalid', reason: 'too-long' })
    // UNC network shares are out of contract (absolute LOCAL filesystem only).
    expect(classifyInstallLocation('\\\\server\\share\\voice', 'win32')).toEqual({ status: 'invalid', reason: 'not-absolute' })
  })
})

describe('classifyInstallLocation (posix)', () => {
  it('accepts user-writable areas, rejects system roots', () => {
    expect(classifyInstallLocation('/home/ana/Lia Voice/runtime', 'linux')).toEqual({ status: 'ok', normalized: '/home/ana/Lia Voice/runtime' })
    expect(classifyInstallLocation('/usr/local/lia', 'linux')).toEqual({ status: 'invalid', reason: 'system-root' })
    expect(classifyInstallLocation('/', 'linux')).toEqual({ status: 'invalid', reason: 'filesystem-root' })
    expect(classifyInstallLocation('relative/path', 'linux')).toEqual({ status: 'invalid', reason: 'not-absolute' })
    expect(classifyInstallLocation('/System/Voice', 'darwin')).toEqual({ status: 'invalid', reason: 'system-root' })
  })
})

describe('inspectInstallLocationTarget - the one fs fact (I)', () => {
  it('a missing directory is a valid future install root', async () => {
    const decision = await inspectInstallLocationTarget('/future/home', { exists: async () => false })
    expect(decision).toEqual({ status: 'ok' })
  })

  it('an existing FILE is never a runtime root', async () => {
    const decision = await inspectInstallLocationTarget('/data/voice.txt', {
      exists: async () => true,
      isDirectory: async () => false,
    })
    expect(decision).toEqual({ status: 'invalid', reason: 'exists-as-file' })
  })

  it('an existing directory is ALLOWED but not "installed" (markers decide that)', async () => {
    const decision = await inspectInstallLocationTarget('/data/voice', {
      exists: async () => true,
      isDirectory: async () => true,
    })
    expect(decision).toEqual({ status: 'ok' })
  })
})
