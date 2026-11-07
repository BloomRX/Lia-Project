import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { defaultPresence, fitPresence, isPresenceConfig, presenceTarget } from '../src/presence/index.ts'

describe('presence desktop geometry', () => {
  const displays = [{ id: 1, workArea: { x: -1000, y: 0, width: 1000, height: 700 } }, { id: 2, workArea: { x: 400, y: -600, width: 800, height: 600 } }]
  it('shrinks proportionally and recovers an unplugged monitor', () => {
    assert.deepEqual(fitPresence({ x: 9000, y: -9000, width: 600, height: 900 }, { x: -100, y: 10, width: 200, height: 300 }), { x: -100, y: 10, width: 200, height: 300 })
  })
  it('stays in the selected work area even with negative coordinates', () => {
    const target = presenceTarget(displays, { ...defaultPresence, monitorId: 1 }, { x: 450, y: -500, width: 240, height: 360 }, () => 1)
    assert.deepEqual(target, { x: -240, y: 340, width: 240, height: 360 })
  })
  it('crosses monitors only after opt-in and chooses a physical area', () => {
    const target = presenceTarget(displays, { ...defaultPresence, allMonitors: true }, { x: -900, y: 50, width: 240, height: 360 }, () => 0.9)
    assert.equal(target.x >= 400 && target.x + target.width <= 1200, true)
    assert.equal(target.y >= -600 && target.y + target.height <= 0, true)
  })
  it('rejects unknown fields, invalid dimensions, malformed homes and non-finite values', () => {
    assert.equal(isPresenceConfig(defaultPresence), true)
    for (const value of [{ ...defaultPresence, scale: NaN }, { ...defaultPresence, scale: 9 }, { ...defaultPresence, command: 'run' }, { ...defaultPresence, home: { x: 2 } }])
      assert.equal(isPresenceConfig(value), false)
  })
})
