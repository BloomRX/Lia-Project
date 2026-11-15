/** Only the host credential port decides which provider keys leave configuration. */
export function genericProviderDraft(config: Record<string, unknown>, hostOwned: boolean): Record<string, unknown> {
  const draft = { ...config }
  if (hostOwned)
    delete draft.apiKey
  return draft
}

/** Configuration saves cannot replace credentials or resurrect an older draft key. */
export function genericProviderConfigForSave(
  draft: Record<string, unknown>,
  current: Record<string, unknown>,
  hostOwned: boolean,
): Record<string, unknown> {
  const config = genericProviderDraft(draft, hostOwned)
  // Migration belongs to the host. Preserve a historical copy until its explicit
  // credential save confirms migration and removes that exact current value.
  if (hostOwned && Object.hasOwn(current, 'apiKey'))
    config.apiKey = current.apiKey
  return config
}
