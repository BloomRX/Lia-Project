import { isStageTamagotchi } from '@proj-airi/stage-shared'

/** Whether this renderer owns the legacy OIDC flow and its token storage. */
export function isOidcEnabled(): boolean {
  const desktopWindow = globalThis.window as (Window & { liaOidcEnabled?: boolean }) | undefined
  return !isStageTamagotchi() && desktopWindow?.liaOidcEnabled !== false
}

export function oidcDisabledResponse(): Response {
  return Response.json({ message: 'OIDC disabled' }, { status: 403, statusText: 'Forbidden' })
}
