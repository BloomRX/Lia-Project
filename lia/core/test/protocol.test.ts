import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CONTROL_TYPES,
  makeEnvelope,
  negotiate,
  parseEnvelope,
  PROTOCOL_VERSION,
} from '../src/protocol.ts'

describe('negotiate', () => {
  it('mesmo major e compativel, ainda que minor e patch difiram', () => {
    assert.equal(negotiate('1.0.0').ok, true)
    assert.equal(negotiate('1.9.3').ok, true)
  })

  it('major diferente recusa e explica', () => {
    const r = negotiate('2.0.0')
    assert.equal(r.ok, false)
    assert.match(r.reason ?? '', /major incompativel/)
  })

  it('versao malformada recusa em vez de lancar', () => {
    for (const bad of ['', 'abc', 'v1', '1.x.0']) {
      const r = negotiate(bad)
      assert.equal(r.ok, false, `"${bad}" deveria ser recusado`)
      assert.ok(r.reason)
    }
  })
})

describe('parseEnvelope — nunca lanca', () => {
  it('aceita envelope montado por makeEnvelope', () => {
    const env = makeEnvelope('health.ping', 'launcher')
    assert.deepEqual(parseEnvelope(env), env)
  })

  it('aceita string JSON', () => {
    const env = makeEnvelope('chat.done', 'stage', { ok: true })
    assert.deepEqual(parseEnvelope(JSON.stringify(env)), env)
  })

  it('string que nao e JSON vira null, sem excecao', () => {
    assert.equal(parseEnvelope('{quebrado'), null)
  })

  it('entradas que nem sao objeto viram null', () => {
    for (const bad of [null, undefined, 42, true, [], 'null']) {
      assert.equal(parseEnvelope(bad), null, `${String(bad)}`)
    }
  })

  it('recusa tipo fora da lista fechada', () => {
    const env = { protocol: '1.0.0', type: 'chat.explodir', id: 'a', from: 'b' }
    assert.equal(parseEnvelope(env), null)
  })

  it('recusa major incompativel', () => {
    const env = { protocol: '2.0.0', type: 'health.ping', id: 'a', from: 'b' }
    assert.equal(parseEnvelope(env), null)
  })

  it('recusa id ou origem vazios', () => {
    assert.equal(parseEnvelope({ protocol: '1.0.0', type: 'health.ping', id: '', from: 'b' }), null)
    assert.equal(parseEnvelope({ protocol: '1.0.0', type: 'health.ping', id: 'a', from: '' }), null)
  })

  it('todos os tipos declarados sao aceitos', () => {
    for (const type of CONTROL_TYPES) {
      const env = { protocol: PROTOCOL_VERSION, type, id: 'x', from: 'y' }
      assert.notEqual(parseEnvelope(env), null, type)
    }
  })
})
