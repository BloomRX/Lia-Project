import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createExpressionState } from '../src/renderer/expression-state.ts'

test('observes conversation and playback independently with a bounded response reaction', ({ mock }) => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 })
  const phases: string[] = []
  const expression = createExpressionState({ onChange: ({ phase }) => phases.push(phase) })
  assert.deepEqual(expression.snapshot(), { phase: 'idle', intensity: 0, since: 1_000, expiresAt: null })

  expression.setConversation('thinking')
  expression.setPlayback(true)
  expression.setConversation('responded')
  assert.equal(expression.snapshot().phase, 'speaking')
  mock.timers.tick(1_200)
  expression.setPlayback(false)
  assert.deepEqual(expression.snapshot(), { phase: 'responded', intensity: 0.55, since: 2_200, expiresAt: 2_800 })
  mock.timers.tick(600)
  assert.deepEqual(phases, ['thinking', 'speaking', 'responded', 'idle'])
})

test('does not revive an expired reaction and stops publishing on disposal', ({ mock }) => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const phases: string[] = []
  const expression = createExpressionState({ onChange: ({ phase }) => phases.push(phase) })
  expression.setConversation('responded')
  expression.setPlayback(true)
  mock.timers.tick(1_800)
  expression.setPlayback(false)
  assert.deepEqual(phases, ['responded', 'speaking', 'idle'])

  expression.setConversation('responded')
  expression.dispose()
  mock.timers.tick(1_800)
  expression.setConversation('idle')
  expression.setPlayback(true)
  assert.deepEqual(phases, ['responded', 'speaking', 'idle', 'responded'])
})

test('a new request replaces a pending reaction without duplicate notifications', ({ mock }) => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const phases: string[] = []
  const expression = createExpressionState({ onChange: ({ phase }) => phases.push(phase) })
  expression.setConversation('responded')
  expression.setConversation('thinking')
  expression.setConversation('thinking')
  expression.setPlayback(false)
  mock.timers.tick(1_800)
  assert.equal(expression.snapshot().phase, 'thinking')
  expression.setConversation('idle')
  assert.deepEqual(phases, ['responded', 'thinking', 'idle'])
})
