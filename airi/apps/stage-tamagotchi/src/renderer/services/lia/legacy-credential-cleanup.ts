/**
 * Removing the pre-vault plaintext credential that a migration left behind.
 *
 * The state this repairs
 * ----------------------
 *
 * Before the vault existed, a provider's API key lived in two `localStorage`
 * blobs owned by the shared Stage store:
 *
 *  - `settings/credentials/providers` — `{ [providerId]: { apiKey, ... } }`
 *  - `settings/providers/configured`  — `{ [providerId]: { config: { apiKey, ... } } }`
 *
 * The migration copies that key into the vault and builds a transport record,
 * but until now it never removed the original. The key therefore survived in
 * Chromium's LevelDB, unencrypted, for the life of the install — including after
 * the user deleted the provider from the Lia.
 *
 * Why it is not simply deleted
 * ----------------------------
 *
 * Deleting is only safe when the vault is known to hold the same value. Main
 * answers that with `adopt` (`stored` / `matching` / `conflict` / `unavailable`)
 * without ever returning the value. This module is called only on `stored` or
 * `matching`, and it is idempotent: a blob with no key produces no write.
 *
 * What it deliberately does NOT do
 * --------------------------------
 *
 *  - It does not touch a divergent vault value (`conflict`). The newer value
 *    wins, and the stale local copy is left for a human decision rather than
 *    silently destroyed.
 *  - It does not remove the provider's other fields. A user's custom `baseUrl`
 *    or model selection in the same object survives; only `apiKey` goes.
 *  - It does not read a secret. It only removes one it was handed.
 */

/** The two legacy blobs, and where the key sits inside each one. */
export const LEGACY_CREDENTIAL_KEYS = {
  /** `{ [providerId]: { apiKey } }` — the original credential store. */
  credentials: 'settings/credentials/providers',
  /** `{ [providerId]: { config: { apiKey } } }` — the later provider record. */
  configured: 'settings/providers/configured',
} as const

export type LegacyCredentialShape = keyof typeof LEGACY_CREDENTIAL_KEYS

function parseRecord(raw: string | null): Record<string, unknown> | undefined {
  if (!raw)
    return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  }
  catch {
    return undefined
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A copy of one legacy blob with `providerId`'s plaintext key removed.
 *
 * Returns `undefined` when there is nothing to remove, so the caller can skip
 * the write — and so an idempotent second run is a no-op rather than a rewrite
 * that could race another window.
 */
export function withoutLegacyApiKey(
  raw: string | null,
  providerId: string,
  shape: LegacyCredentialShape,
): string | undefined {
  const blob = parseRecord(raw)
  if (!blob || !plainObject(blob[providerId]))
    return undefined

  const entry = { ...blob[providerId] as Record<string, unknown> }
  if (shape === 'credentials') {
    if (typeof entry.apiKey !== 'string')
      return undefined
    delete entry.apiKey
  }
  else {
    if (!plainObject(entry.config) || typeof (entry.config as Record<string, unknown>).apiKey !== 'string')
      return undefined
    const { apiKey: _removed, ...config } = entry.config as Record<string, unknown>
    entry.config = config
  }

  return JSON.stringify({ ...blob, [providerId]: entry })
}

/** Storage the cleanup writes to. Narrowed so tests need no browser. */
export interface LegacyCleanupStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/**
 * Removes the plaintext key for `providerId` from both legacy blobs.
 *
 * Returns which blobs actually changed, which is what a test asserts and what a
 * log line can report without naming a value.
 */
export function removeLegacyApiKey(
  storage: LegacyCleanupStorage,
  providerId: string,
): { credentials: boolean, configured: boolean } {
  const changed = { credentials: false, configured: false }
  for (const shape of Object.keys(LEGACY_CREDENTIAL_KEYS) as LegacyCredentialShape[]) {
    const key = LEGACY_CREDENTIAL_KEYS[shape]
    try {
      const next = withoutLegacyApiKey(storage.getItem(key), providerId, shape)
      if (next === undefined)
        continue
      storage.setItem(key, next)
      changed[shape] = true
    }
    catch {
      // A storage that refuses to write is not a reason to fail the session; the
      // vault already holds the value and the next launch retries.
    }
  }
  return changed
}

/**
 * The same provider payload without its plaintext key, for the reactive copy of
 * the shared store.
 *
 * The stored blob and the in-memory record are two places, and a fix in only one
 * of them does not survive: the ref is deep-watched and the key comes back on the
 * next write. This is the in-memory half.
 */
export function stripCredentialField(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!config || typeof config.apiKey !== 'string')
    return config
  const { apiKey: _removed, ...rest } = config
  return rest
}
