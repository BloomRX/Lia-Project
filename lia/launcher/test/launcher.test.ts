import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createLauncher } from '../src/index.ts'
import { resolveStageTarget } from '../src/resolve-stage-target.ts'

function fakeStage(phase: 'running' | 'error') {
  const calls: string[] = []
  return {
    calls,
    stage: {
      start: async () => {
        calls.push('start')
        return { phase, pid: 7 } as never
      },
      stop: async () => {
        calls.push('stop')
        return { phase: 'stopped' } as never
      },
      health: () => ({ phase }) as never,
    },
  }
}

describe('resolveStageTarget — a decisao, nao o spawn', () => {
  it('empacotado vence a existencia de build', () => {
    const r = resolveStageTarget({
      isPackaged: true,
      appPath: '/app',
      stageEntryExists: false,
    })
    assert.equal(r.mode, 'packaged')
    assert.match(r.reason, /isPackaged/)
  })

  it('sem build do Stage nao finge estar empacotado', () => {
    const r = resolveStageTarget({
      isPackaged: false,
      appPath: '/src',
      stageEntryExists: false,
    })
    assert.equal(r.mode, 'development')
    assert.match(r.reason, /sem build/)
  })

  it('override explicito vence a inferencia', () => {
    const r = resolveStageTarget({
      isPackaged: true,
      appPath: '/app',
      stageEntryExists: true,
      override: 'dev',
    })
    assert.equal(r.mode, 'development')
    assert.match(r.reason, /forcado/)
  })

  it('override invalido cai na inferencia e diz isso, em vez de lancar', () => {
    const r = resolveStageTarget({
      isPackaged: true,
      appPath: '/app',
      stageEntryExists: true,
      override: 'xyz',
    })
    assert.equal(r.mode, 'packaged')
    assert.match(r.reason, /nao reconhecido/)
  })

  it('override em branco e ignorado (set VAR= de um .bat)', () => {
    const r = resolveStageTarget({
      isPackaged: false,
      appPath: '/src',
      stageEntryExists: true,
      override: '   ',
    })
    assert.equal(r.reason.includes('nao reconhecido'), false)
    assert.match(r.reason, /isPackaged/)
  })
})

describe('createLauncher', () => {
  it('devolve o estado observado do Stage, nao um estado presumido', async () => {
    const { stage, calls } = fakeStage('running')
    const launcher = createLauncher({ stage })

    const snapshot = await launcher.launch({
      isPackaged: false,
      appPath: '/src',
      stageEntryExists: true,
    })

    assert.equal(snapshot.phase, 'running')
    assert.deepEqual(calls, ['start'])
  })

  it('propaga falha do Stage sem transformar em sucesso', async () => {
    const { stage } = fakeStage('error')
    const launcher = createLauncher({ stage })

    const snapshot = await launcher.launch({
      isPackaged: false,
      appPath: '/src',
      stageEntryExists: true,
    })

    assert.equal(snapshot.phase, 'error', 'erro nao pode virar running no caminho')
  })

  it('shutdown delega ao Stage', async () => {
    const { stage, calls } = fakeStage('running')
    const launcher = createLauncher({ stage })

    await launcher.shutdown()
    assert.deepEqual(calls, ['stop'])
  })
})
