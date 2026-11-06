/**
 * Request headers the Lia itself adds to an outbound chat request.
 *
 * Why this lives in the main process
 * ----------------------------------
 *
 * Every curated chat provider is executed here (`transport-execution-service.ts`),
 * so this is the only place that can add a header to a request the Lia makes.
 * Before Corte B the attribution below came from the shared AIRI provider
 * definition (`OPENROUTER_ATTRIBUTION_HEADERS`), which meant every Lia request
 * identified itself as **Project AIRI** and pointed at `https://airi.moeru.ai/`.
 * A third party saw another product's name on the wire, and the Lia inherited
 * that identity by importing a constant rather than by deciding anything.
 *
 * What replaces it
 * ----------------
 *
 * A neutral, truthful title and no referer. The Lia has no public product site
 * yet, so it does not claim one; sending `HTTP-Referer` at all would be a claim.
 * If a site is ever published, it becomes one line in this table.
 *
 * Invariants, enforced by tests:
 *
 *  - this table is the ONLY source of extra headers — a transport record's
 *    `adapterOptions` cannot contain a `headers` key (`isTransportRecord` in
 *    `lia/core/src/transports/validation.ts` rejects it), so a record cannot
 *    smuggle one in;
 *  - no entry here may be a credential or an identity header. `Authorization`
 *    is set by `lia/core`'s runtime from the vault, never here, and a name in
 *    this table that collides with it is ignored rather than allowed to win.
 */

/** Header names this module refuses to set, whatever the table says. */
const RESERVED = new Set(['authorization', 'cookie', 'proxy-authorization', 'host', 'content-length'])

const LIA_PROVIDER_HEADERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  /**
   * OpenRouter's documented attribution headers, reduced to the one claim that
   * is true: the app is called Lia. No referer, because there is no site.
   */
  'openrouter-ai': { 'X-OpenRouter-Title': 'Lia' },
  /**
   * Preserved verbatim from AIRI's Anthropic definition, which wraps every
   * request in a `fetch` that appends this header. The header only matters for
   * browser-origin calls, and this executor is Node — but dropping it would be
   * a behaviour change riding along on a security cut, and a user's
   * Anthropic-compatible endpoint may have been provisioned against it.
   */
  'anthropic': { 'anthropic-dangerous-direct-browser-access': 'true' },
}

/** The Lia-owned headers for one provider. Empty means "add nothing". */
export function liaProviderHeaders(providerId: string): Readonly<Record<string, string>> {
  const headers = LIA_PROVIDER_HEADERS[providerId]
  if (!headers)
    return {}
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !RESERVED.has(name.toLowerCase())),
  )
}

/**
 * Wraps a `fetch` so every request carries the Lia headers for `providerId`.
 *
 * Merges into whatever `lia/core` already built instead of replacing it, so the
 * `Authorization` and `Content-Type` the runtime set survive untouched.
 */
export function withLiaProviderHeaders(fetch: typeof globalThis.fetch, providerId: string): typeof globalThis.fetch {
  const extra = liaProviderHeaders(providerId)
  if (Object.keys(extra).length === 0)
    return fetch
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    for (const [name, value] of Object.entries(extra)) {
      if (!headers.has(name))
        headers.set(name, value)
    }
    return fetch(input, { ...init, headers })
  }
}
