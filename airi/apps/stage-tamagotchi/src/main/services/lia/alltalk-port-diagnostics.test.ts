import type { PortDiagnosticDeps } from './alltalk-port-diagnostics'

import { describe, expect, it, vi } from 'vitest'

import { gatherPortOwners, parseNetstatListening, parseProcessRecord } from './alltalk-port-diagnostics'

/**
 * The Windows QA hotfix instrumentation, proven against fixtures that mimic
 * what the diagnostic machine will actually emit. Nothing here runs netstat
 * or PowerShell: the exec layer is injected, so the parser and the
 * gather-and-log flow are testable from the Linux CI box.
 */

const WIN_NETSTAT_FIXTURE = `
Conexões ativas

  Proto  Endereço local                Endereço externo              Estado           Identificação de Processo
  TCP    0.0.0.0:7851             0.0.0.0:0              LISTENING       4321
  TCP    0.0.0.0:7852             0.0.0.0:0              LISTENING       4321
  TCP    10.0.0.4:7851            20.30.40.50:443        TIME_WAIT       900
  TCP    0.0.0.0:445              0.0.0.0:0              LISTENING       4
`

const PS_FIXTURE = `
ProcessId       : 4321
ParentProcessId : 876
CreationDate    : 09/15/2026 08:31:12
ExecutablePath  : C:\\Users\\qa\\AppData\\Local\\Lia\\runtimes\\alltalk\\alltalk_environment\\env\\python.exe
CommandLine     : python script.py

`

function depsFor(overrides: Partial<PortDiagnosticDeps> = {}): { deps: PortDiagnosticDeps, lines: string[], exec: ReturnType<typeof vi.fn> } {
  const lines: string[] = []
  const exec = vi.fn(async (command: string): Promise<{ code: number | null, stdout: string }> => {
    if (command.startsWith('netstat'))
      return { code: 0, stdout: WIN_NETSTAT_FIXTURE }
    return { code: 0, stdout: PS_FIXTURE }
  }) as unknown as ReturnType<typeof vi.fn>
  const deps: PortDiagnosticDeps = {
    exec: exec as unknown as PortDiagnosticDeps['exec'],
    installDir: 'C:\\Users\\qa\\AppData\\Local\\Lia\\runtimes\\alltalk',
    log: line => lines.push(line),
    platform: 'win32',
    ports: [7851, 7852],
    ...overrides,
  }
  return { deps, exec, lines }
}

describe('parseNetstatListening', () => {
  it('keeps only LISTENING rows for the wanted ports, deduplicating by port+pid', () => {
    expect(parseNetstatListening(WIN_NETSTAT_FIXTURE, [7851, 7852])).toEqual([
      { pid: 4321, port: 7851 },
      { pid: 4321, port: 7852 },
    ])
  })

  it('ignores unrelated ports and dying connections', () => {
    expect(parseNetstatListening(WIN_NETSTAT_FIXTURE, [445])).toEqual([{ pid: 4, port: 445 }])
    expect(parseNetstatListening(WIN_NETSTAT_FIXTURE, [900])).toEqual([])
  })

  it('tolerates IPv6 locals and empty output', () => {
    const v6 = '  TCP    [::1]:7851     [::]:0    LISTENING       7000\r\n'
    expect(parseNetstatListening(v6, [7851])).toEqual([{ pid: 7000, port: 7851 }])
    expect(parseNetstatListening('', [7851])).toEqual([])
  })
})

describe('parseProcessRecord', () => {
  it('reads the Format-List key/value shape PowerShell actually emits', () => {
    expect(parseProcessRecord(PS_FIXTURE, 4321)).toEqual({
      cmdline: 'python script.py',
      created: '09/15/2026 08:31:12',
      exe: 'C:\\Users\\qa\\AppData\\Local\\Lia\\runtimes\\alltalk\\alltalk_environment\\env\\python.exe',
      parentPid: 876,
      pid: 4321,
    })
  })

  it('leaves missing fields undefined instead of failing', () => {
    expect(parseProcessRecord('ProcessId : 9\r\n', 9)).toEqual({ pid: 9 })
  })
})

describe('gatherPortOwners', () => {
  it('reports per-port owners with exe, parent, and whether they live under the Lia root', async () => {
    const { deps, lines } = depsFor()

    await gatherPortOwners(deps)

    expect(lines.some(line =>
      line.includes('port-owner port=7851 pid=4321')
      && line.includes('exe=C:\\Users\\qa\\AppData\\Local\\Lia\\runtimes\\alltalk\\alltalk_environment\\env\\python.exe')
      && line.includes('parentPid=876')
      && line.includes('underLiaInstallRoot=true'),
    )).toBe(true)
    expect(lines.some(line => line.includes('port-owner port=7852 pid=4321'))).toBe(true)
    expect(lines.some(line => line.startsWith('port-owner-cmdline port=7851 pid=4321'))).toBe(true)
  })

  it('marks owners outside the Lia root as underLiaInstallRoot=false', async () => {
    const { deps, lines } = depsFor({
      exec: (async (command: string) => command.startsWith('netstat')
        ? { code: 0, stdout: WIN_NETSTAT_FIXTURE }
        : { code: 0, stdout: 'ExecutablePath : C:\\Program Files\\Other\\svc.exe\r\nProcessId : 4321\r\n' }) as PortDiagnosticDeps['exec'],
    })

    await gatherPortOwners(deps)

    expect(lines.some(line => line.includes('underLiaInstallRoot=false') && line.includes('svchost') === false)).toBe(true)
    expect(lines.some(line => line.includes('exe=C:\\Program Files\\Other\\svc.exe'))).toBe(true)
  })

  it('says so when nobody is listening, and never throws on exec failures', async () => {
    const { deps, lines } = depsFor({
      exec: (async () => ({ code: 0, stdout: '' })) as PortDiagnosticDeps['exec'],
    })

    await gatherPortOwners(deps)
    expect(lines).toContain('port-owner ports=7851,7852 listeners=none')

    const failing = depsFor({
      exec: (async () => {
        throw new Error('access denied')
      }) as PortDiagnosticDeps['exec'],
    })
    await expect(gatherPortOwners(failing.deps)).resolves.toBeUndefined()
    expect(failing.lines.some(line => line.startsWith('port-diagnostic-error step=netstat'))).toBe(true)
  })

  it('does nothing off Windows (the platform gate is the testability seam)', async () => {
    const { deps, exec, lines } = depsFor({ platform: 'linux' })

    await gatherPortOwners(deps)

    expect(exec).not.toHaveBeenCalled()
    expect(lines).toEqual(['port-diagnostic-skipped platform=linux'])
  })

  it('never runs a shell: the command list is fixed programs with argument arrays', async () => {
    const { deps, exec } = depsFor()

    await gatherPortOwners(deps)

    for (const call of exec.mock.calls) {
      const [command, args] = call as unknown as [string, string[]]
      expect(['netstat.exe', 'powershell.exe'].some(name => command.startsWith(name))).toBe(true)
      expect(Array.isArray(args)).toBe(true)
    }
  })
})
