type CredentialPurpose = 'speech' | 'transcription' | 'chat'

/** Versioned content of an encrypted vault slot, separate from editable transport metadata. */
export function bindCredential(scope: string, url: URL, apiKey: string, purpose: CredentialPurpose = 'speech'): string {
  return JSON.stringify({ version: 1, scope, origin: url.origin, apiKey, purpose })
}

function parseBoundCredential(value: string | undefined) {
  if (!value)
    return undefined
  try {
    const entry = JSON.parse(value) as Partial<Record<'version' | 'scope' | 'origin' | 'apiKey' | 'purpose', unknown>> | null
    if (entry?.version === 1 && typeof entry.scope === 'string' && typeof entry.origin === 'string'
      && typeof entry.apiKey === 'string' && /^[\x21-\x7E]{1,16384}$/.test(entry.apiKey)) {
      // The original v1 entries without a purpose were only written by TTS.
      return { scope: entry.scope, origin: entry.origin, apiKey: entry.apiKey, purpose: entry.purpose === undefined ? 'speech' : entry.purpose }
    }
  }
  catch {
    // An unbound legacy value must be re-entered by the user, never rebound on read.
  }
  return undefined
}

export function credentialForDestination(value: string | undefined, scope: string, url: URL, purpose: CredentialPurpose = 'speech'): string | undefined {
  const entry = parseBoundCredential(value)
  return entry?.scope === scope && entry.origin === url.origin && entry.purpose === purpose ? entry.apiKey : undefined
}

/** Keeps bound values out of callers that still expect a legacy raw key. */
export function unboundCredential(value: string | undefined): string | undefined {
  return parseBoundCredential(value) ? undefined : value
}
