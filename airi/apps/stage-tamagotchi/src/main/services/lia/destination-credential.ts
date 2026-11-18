/** Versioned content of an encrypted vault slot, separate from editable transport metadata. */
export function bindCredential(scope: string, url: URL, apiKey: string): string {
  return JSON.stringify({ version: 1, scope, origin: url.origin, apiKey })
}

export function credentialForDestination(value: string | undefined, scope: string, url: URL): string | undefined {
  if (!value)
    return undefined
  try {
    const entry = JSON.parse(value)
    if (entry?.version === 1 && entry.scope === scope && entry.origin === url.origin
      && typeof entry.apiKey === 'string' && /^[\x21-\x7E]{1,16384}$/.test(entry.apiKey)) {
      return entry.apiKey
    }
  }
  catch {
    // An unbound legacy value must be re-entered by the user, never rebound on read.
  }
  return undefined
}
