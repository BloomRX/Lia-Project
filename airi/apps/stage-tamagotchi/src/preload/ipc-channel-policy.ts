const OIDC_CHANNELS = new Set([
  'lia:oidc:account',
  'lia:oidc:cancel',
  'lia:oidc:http-cancel',
  'lia:oidc:http-open',
  'lia:oidc:http-pull',
  'lia:oidc:http-write',
  'lia:oidc:link',
  'lia:oidc:logout',
  'lia:oidc:resource',
])

export type RendererIpcOperation = 'invoke' | 'listen' | 'send'

export function isRendererChannelAllowed(channel: unknown, operation: RendererIpcOperation): channel is string {
  if (typeof channel !== 'string' || channel.length > 256)
    return false
  if (operation === 'invoke')
    return OIDC_CHANNELS.has(channel)
  if (operation === 'listen')
    return channel === 'eventa-message' || channel === 'eventa-error'
  return channel === 'eventa-message'
    || channel === 'lia-devflow:app-mounted'
    || channel === 'lia-devflow:scene-mounted'
}
