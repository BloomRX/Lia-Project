import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isPresenceAvatarBytes } from '../src/shared/chat-ipc.ts'

test('bounds both the avatar payload and the buffer copied by Electron IPC', () => {
  const limit = 64 * 1024 * 1024
  assert.equal(isPresenceAvatarBytes(new Uint8Array(20)), true)
  assert.equal(isPresenceAvatarBytes(new Uint8Array(limit)), true)
  assert.equal(isPresenceAvatarBytes(new Uint8Array(19)), false)
  assert.equal(isPresenceAvatarBytes(new Uint8Array(limit + 1)), false)
  assert.equal(isPresenceAvatarBytes(new ArrayBuffer(20)), false)
  assert.equal(isPresenceAvatarBytes(new Uint8Array(new ArrayBuffer(32), 0, 20)), false)
  assert.equal(isPresenceAvatarBytes(new Uint8Array(new ArrayBuffer(32), 12, 20)), false)
})
