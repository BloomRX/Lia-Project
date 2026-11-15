import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isServing, isTerminal, Lifecycle, transition } from '../src/lifecycle.ts'

describe('transition — a tabela, isolada da classe', () => {
  it('caminho feliz completo', () => {
    assert.equal(transition('stopped', 'spawn'), 'starting')
    assert.equal(transition('starting', 'ready'), 'running')
    assert.equal(transition('running', 'stop'), 'stopping')
    assert.equal(transition('stopping', 'exit'), 'stopped')
  })

  it('"processo criado" nao e "pronto": nao existe atalho de spawn para running', () => {
    assert.equal(transition('stopped', 'ready'), null)
    assert.equal(transition('starting', 'exit'), null)
  })

  it('error e terminal: nenhum evento resgata a instancia', () => {
    for (const event of ['ready', 'stop', 'exit', 'fail'] as const)
      assert.equal(transition('error', event), null, `error + ${event}`)
  })

  it('falha pode acontecer em qualquer fase ativa', () => {
    for (const phase of ['starting', 'running', 'stopping'] as const)
      assert.equal(transition(phase, 'fail'), 'error', `${phase} + fail`)
  })

  it('transicoes repetidas sao recusadas, nao silenciosamente aceitas', () => {
    assert.equal(transition('running', 'ready'), null)
    assert.equal(transition('stopped', 'stop'), null)
  })
})

describe('predicados', () => {
  it('isServing so vale em running', () => {
    assert.equal(isServing('running'), true)
    for (const phase of ['starting', 'stopping', 'stopped', 'error'] as const)
      assert.equal(isServing(phase), false, phase)
  })

  it('isTerminal cobre stopped e error', () => {
    assert.equal(isTerminal('stopped'), true)
    assert.equal(isTerminal('error'), true)
    assert.equal(isTerminal('running'), false)
    assert.equal(isTerminal('starting'), false)
    assert.equal(isTerminal('stopping'), false)
  })
})

describe('Lifecycle — estado observavel', () => {
  it('nasce parado', () => {
    const lc = new Lifecycle(() => 1_000)
    assert.equal(lc.phase, 'stopped')
    assert.deepEqual(lc.snapshot(), { phase: 'stopped' })
  })

  it('snapshot omite campos que nao existem', () => {
    const lc = new Lifecycle(() => 1_000)
    lc.apply('spawn', { pid: 10 })
    const snap = lc.snapshot()
    assert.equal('readyAt' in snap, false, 'readyAt nao pode existir antes de ready')
    assert.equal('failure' in snap, false)
    assert.equal(snap.pid, 10)
  })

  it('registra o instante real de cada fase com relogio injetado', () => {
    let t = 1_000
    const lc = new Lifecycle(() => t)
    lc.apply('spawn', { pid: 10 })
    t = 1_500
    lc.apply('ready')
    t = 2_000
    lc.apply('stop')
    t = 2_200
    lc.apply('exit', { exitCode: 0 })

    const snap = lc.snapshot()
    assert.equal(snap.startedAt, 1_000)
    assert.equal(snap.readyAt, 1_500)
    assert.equal(snap.stoppedAt, 2_200)
    assert.equal(snap.exitCode, 0)
  })

  it('transicao recusada nao muda nada nem entra no historico', () => {
    const lc = new Lifecycle(() => 1_000)
    assert.equal(lc.apply('ready'), null, 'ready sem spawn e recusado')
    assert.equal(lc.phase, 'stopped')
    assert.equal(lc.history.length, 0)
  })

  it('historico guarda apenas transicoes aceitas, em ordem', () => {
    const lc = new Lifecycle(() => 1_000)
    lc.apply('spawn', { pid: 3 })
    lc.apply('ready')
    lc.apply('ready')
    lc.apply('stop')

    assert.deepEqual(
      lc.history.map(h => `${h.from}->${h.to}`),
      ['stopped->starting', 'starting->running', 'running->stopping'],
    )
  })

  it('failure sem motivo informado nao vira campo vazio', () => {
    const lc = new Lifecycle(() => 1_000)
    lc.apply('spawn', { pid: 3 })
    lc.apply('fail')
    assert.equal(lc.snapshot().failure, 'falha sem motivo informado')
  })

  it('a falha de uma tentativa nao vaza para a seguinte', () => {
    const lc = new Lifecycle(() => 1_000)
    lc.apply('spawn', { pid: 3 })
    lc.apply('fail', { failure: 'sem display' })
    assert.equal(lc.snapshot().failure, 'sem display')

    lc.apply('spawn', { pid: 4 })
    assert.equal(lc.snapshot().failure, undefined)
    assert.equal(lc.snapshot().pid, 4, 'pid novo, sem herdar o anterior')
    lc.apply('ready')
    assert.equal(lc.phase, 'running')
  })

  it('stop a partir de running exige exit para chegar a stopped', () => {
    const lc = new Lifecycle(() => 1_000)
    lc.apply('spawn', { pid: 3 })
    lc.apply('ready')
    lc.apply('stop')
    assert.equal(lc.phase, 'stopping', 'parar nao e o mesmo que ter parado')
    lc.apply('exit', { exitCode: 0 })
    assert.equal(lc.phase, 'stopped')
  })
})
