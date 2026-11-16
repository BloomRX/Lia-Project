/** Build-time opt-in. The internal Stage build keeps the legacy OIDC path off. */
export function isStageOidcEnabled(): boolean {
  return import.meta.env.VITE_LIA_ENABLE_OIDC === '1'
}
