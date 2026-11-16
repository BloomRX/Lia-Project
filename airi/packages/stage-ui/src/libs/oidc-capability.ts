/** Desktop preload sets the trusted capability. Web and Pocket keep their existing flow. */
export function isOidcEnabled(): boolean {
  const desktopWindow = globalThis.window as (Window & { liaOidcEnabled?: boolean }) | undefined
  return desktopWindow?.liaOidcEnabled !== false
}

export function oidcDisabledResponse(): Response {
  return Response.json({ message: 'OIDC disabled' }, { status: 403, statusText: 'Forbidden' })
}
