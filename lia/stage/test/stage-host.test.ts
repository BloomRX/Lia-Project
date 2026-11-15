import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { StageHostDeps, StageWindow } from '../src/main/stage-host.ts'

import { createStageHost } from '../src/main/stage-host.ts'

/** Fake de janela: registra a ordem das chamadas sem abrir nada. */
function fakeWindow(calls: string[]): StageWindow {
  return {
    show: () => calls.push('show'),
    close: async () => { calls.push('close') },
  }
}

function deps(overrides: Partial<StageHostDeps> = {}): { deps: StageHostDeps, calls: string[], terminated: number[] } {
  const calls: string[] = []
  const terminated: number[] = []
  const base: StageHostDeps = {
    createWindow: async () => {
      calls.push('createWindow')
      return fakeWindow(calls)
    },
    terminate: async (pid) => { terminated.push(pid) },
    now: () => 1_000,
    nextPid: () => 4242,
    onLog: () => {},
  }
  return { deps: { ...base, ...overrides }, calls, terminated }
}

describe('createStageHost', () => {
  it('nao fica running antes do sinal de pronto', async () => {
    const { deps: d } = deps({
      createWindow: async () => ({ show: () => {}, close: async () => {} }),
    })
    const host = createStageHost(d)

    assert.equal(host.health().phase, 'stopped')
    const snapshot = await host.start()
    assert.equal(snapshot.phase, 'running')
    assert.equal(snapshot.pid, 4242)
    // readyAt prova que o sinal de pronto foi registrado, nao presumido.
    assert.equal(snapshot.readyAt, 1_000)
  })

  it('durante a criacao da janela a fase ainda e starting, nao running', async () => {
    // Este teste existe porque uma versao anterior desta suite NAO pegava o bug
    // de declarar pronto antes da hora: ela so olhava o estado final. Aqui a
    // janela fica pendente e observamos a fase no meio do caminho.
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })

    const { deps: d } = deps({
      createWindow: async () => {
        await gate
        return { show: () => {}, close: async () => {} }
      },
    })
    const host = createStageHost(d)

    const pending = host.start()
    assert.equal(host.health().phase, 'starting', 'processo criado nao e inicializacao concluida')

    release()
    await pending
    assert.equal(host.health().phase, 'running', 'so depois do sinal de pronto')
  })

  it('mostra a janela apenas depois de pronta', async () => {
    const { deps: d, calls } = deps()
    await createStageHost(d).start()
    assert.deepEqual(calls, ['createWindow', 'show'], 'show vem depois de createWindow')
  })

  it('falha ao criar a janela termina em error, nunca em running', async () => {
    const { deps: d } = deps({
      createWindow: async () => { throw new Error('no display') },
    })
    const host = createStageHost(d)
    const snapshot = await host.start()

    assert.equal(snapshot.phase, 'error')
    assert.equal(snapshot.failure, 'no display')
  })

  it('start concorrente nao cria uma segunda janela (single-flight)', async () => {
    const { deps: d, calls } = deps()
    const host = createStageHost(d)
    await host.start()
    await host.start()

    assert.equal(calls.filter(c => c === 'createWindow').length, 1)
    assert.equal(host.health().pid, 4242)
  })

  it('stop fecha a janela e so entao reporta stopped', async () => {
    const { deps: d, calls, terminated } = deps()
    const host = createStageHost(d)
    await host.start()
    const snapshot = await host.stop()

    assert.equal(snapshot.phase, 'stopped')
    assert.equal(snapshot.exitCode, 0)
    assert.deepEqual(calls, ['createWindow', 'show', 'close'])
    assert.deepEqual(terminated, [4242])
  })

  it('stop e idempotente: dois cliques nao encerram duas vezes', async () => {
    const { deps: d, terminated } = deps()
    const host = createStageHost(d)
    await host.start()

    await Promise.all([host.stop(), host.stop()])
    assert.deepEqual(terminated, [4242], 'terminate chamado uma unica vez')
  })

  it('stop num host que nunca iniciou nao mata processo nenhum', async () => {
    const { deps: d, terminated } = deps()
    const host = createStageHost(d)
    const snapshot = await host.stop()

    assert.equal(snapshot.phase, 'stopped')
    assert.deepEqual(terminated, [], 'nenhum pid fantasma')
  })

  it('depois de error, um novo start recomeca com estado limpo', async () => {
    let attempt = 0
    const { deps: d } = deps({
      createWindow: async () => {
        attempt += 1
        if (attempt === 1)
          throw new Error('primeira tentativa falha')
        return { show: () => {}, close: async () => {} }
      },
    })
    const host = createStageHost(d)

    assert.equal((await host.start()).phase, 'error')
    const second = await host.start()
    assert.equal(second.phase, 'running')
    assert.equal(second.failure, undefined, 'falha antiga nao vaza')
  })
})
