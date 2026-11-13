import { describe, expect, it } from 'vitest'

import { isRendererChannelAllowed } from './ipc-channel-policy'

describe('Stage renderer IPC channel policy', () => {
  it('allows Eventa, lifecycle signals, and exact OIDC transport channels', () => {
    for (const channel of [
      'eventa-message',
      'eventa-error',
      'lia-devflow:app-mounted',
      'lia-devflow:scene-mounted',
      'lia:oidc:resource',
      'lia:oidc:http-write',
    ]) {
      const operation = channel.startsWith('lia:oidc:') ? 'invoke' : channel === 'eventa-error' ? 'listen' : 'send'
      expect(isRendererChannelAllowed(channel, operation), channel).toBe(true)
    }
  })

  it('rejects generic Electron channels, lookalikes, and malformed names', () => {
    for (const channel of [
      'electron:open-path',
      'lia:oidc:unknown',
      'lia:oidc:resource:extra',
      'eventa:invoke:electron:app:quit',
      '',
      'x'.repeat(257),
      null,
    ]) {
      expect(isRendererChannelAllowed(channel, 'invoke')).toBe(false)
    }
  })

  it('does not let invoke, send, and listener surfaces cross operation boundaries', () => {
    expect(isRendererChannelAllowed('eventa-message', 'invoke')).toBe(false)
    expect(isRendererChannelAllowed('lia:oidc:resource', 'send')).toBe(false)
    expect(isRendererChannelAllowed('lia-devflow:app-mounted', 'listen')).toBe(false)
  })
})
