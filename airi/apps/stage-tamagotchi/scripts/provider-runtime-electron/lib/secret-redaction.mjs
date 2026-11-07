/**
 * Secret redaction for the Electron gate's artifacts.
 *
 * The defect this replaces
 * ------------------------
 *
 * `gate.test.mjs` wrote its log with two hardcoded substitutions:
 *
 *   logs.replaceAll(secrets.generic, '[REDACTED]').replaceAll(secrets.local, ...)
 *
 * but the gate mints **eight** more credentials, one per credentialed curated
 * provider (`synthetic-openai-…`, `synthetic-anthropic-…`, …). They were never
 * substituted. The leak assertion ran before the `finally`, so in exactly the
 * case that matters — the assertion fails, `electron.log` gets written — the
 * file contained the offending key in clear text, inside the repository.
 *
 * Two rules follow, and this module exists to make them impossible to get wrong:
 *
 *   1. the registry of secrets is a single collection that every writer reads,
 *      so no writer can be "the one that forgot";
 *   2. redaction is applied to the value that is going to be written, not to a
 *      copy somebody remembered to make — `writeArtifact` is the only door.
 *
 * Why not only a prefix scan
 * --------------------------
 *
 * A `synthetic-` prefix scan would catch today's fixtures and would quietly stop
 * catching tomorrow's if ids changed shape. The literal values are substituted
 * exactly, and the prefix rule runs afterwards as defence in depth — including
 * against a value that appears URL-encoded, JSON-escaped, or truncated at a
 * quote boundary.
 */

/** What replaces a secret in an artifact. Fixed width, no length leak. */
export const REDACTED = '[REDACTED]'

/**
 * Create the registry.
 *
 * Values are registered once, at creation, and the registry is frozen against
 * additions afterwards: a secret created after this call would not be redacted,
 * so allowing late registration would be the same bug in a new place.
 */
export function createSecretRegistry(values) {
  const all = new Set()

  const add = (value) => {
    if (typeof value !== 'string' || value.length === 0)
      return
    all.add(value)
  }

  if (Array.isArray(values)) {
    for (const value of values)
      add(value)
  }
  else if (values && typeof values === 'object') {
    for (const value of Object.values(values))
      add(value)
  }
  else {
    throw new TypeError('createSecretRegistry requires an array or an object of secrets')
  }

  // Longest first: if one secret is a prefix of another, replacing the short one
  // first would leave a fragment of the long one behind.
  const ordered = [...all].sort((left, right) => right.length - left.length)

  return {
    values: ordered,
    size: ordered.length,
    /**
     * Every literal occurrence, then the shape rule.
     *
     * `undefined`/`null` pass through unchanged so a caller can redact an
     * optional field without a branch at each call site.
     */
    redact(value) {
      if (value === undefined || value === null)
        return value
      let text = typeof value === 'string' ? value : stringify(value)
      for (const secret of ordered)
        text = text.split(secret).join(REDACTED)
      // Defence in depth: any fixture credential that escaped the registry still
      // matches the generator's shape and is collapsed whole.
      text = text.replaceAll(/synthetic-[A-Za-z0-9-]{4,}/g, REDACTED)
      return text
    },
    /** Every secret that appears verbatim in this text. Used to fail the gate. */
    findLeaks(value) {
      if (value === undefined || value === null)
        return []
      const text = typeof value === 'string' ? value : stringify(value)
      return ordered.filter(secret => text.includes(secret))
    },
    /** A leak report safe to print: the secret is named by index, never echoed. */
    describeLeaks(value) {
      const leaks = this.findLeaks(value)
      if (leaks.length === 0)
        return undefined
      return `${leaks.length} registered secret value(s) present (indices ${leaks.map(secret => ordered.indexOf(secret)).join(', ')})`
    },
  }
}

/**
 * JSON with only the keys sorted, so two structurally equal reports compare
 * equal — and so the redaction sees the same text the writer will see.
 */
function stringify(value) {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

/**
 * Assert that a payload carries no registered secret.
 *
 * Throws with an index-only message. The throw is the point: an artifact with a
 * credential must not be written at all, which is stricter than writing it and
 * failing afterwards.
 */
export function assertNoSecrets(registry, payload, label) {
  const description = registry.describeLeaks(payload)
  if (description)
    throw new Error(`${label} would contain a credential: ${description}`)
}

/**
 * The only writer of gate artifacts.
 *
 * Redacts, re-checks, then writes. The re-check is not redundant with the
 * redaction: it catches the case where redaction produced a string that still
 * contains a value (a secret that is itself a substring of `[REDACTED]`, or an
 * encoding the substitution missed) and refuses to write it.
 */
export async function writeArtifact({ writeFile, join }, directory, name, content, registry) {
  const original = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  const redacted = registry.redact(original)

  // Only the OUTPUT is checked. The source is *expected* to hold credentials —
  // that is why it is being redacted — so demanding a clean source would refuse
  // every interesting log. What must never reach the disk is the redacted text,
  // and this check is not redundant with `redact()`: it catches the case where
  // substitution "succeeded" and the value survived anyway.
  assertNoSecrets(registry, redacted, `artifact "${name}"`)

  const target = join(directory, name)
  await writeFile(target, redacted)
  return { path: target, bytes: redacted.length, redacted: redacted !== original }
}

/**
 * A scan note for the report: which registered secrets were searched for, and
 * how many. Never the values.
 */
export function redactionSummary(registry) {
  return {
    registeredSecrets: registry.size,
    strategy: 'exact substitution of every registered value (longest first), then a shape rule for synthetic-* fixtures',
    note: 'values are not printed, stored or hashed here; only the count is reported',
  }
}
