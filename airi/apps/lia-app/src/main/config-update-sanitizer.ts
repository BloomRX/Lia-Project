import type { LiaConfigUpdatePayload } from './lia-host'

/**
 * Renderer -> vault credential envelope (Phase 7.1, item 5; hardened 12/11).
 *
 * This module is Electron-free on purpose: it is the boundary that decides
 * WHAT a renderer is allowed to hand to the vault, so it must be testable
 * without a window. Invalid entries are DROPPED, never repaired; the canonical
 * writer in `lia-host` remains the final validator.
 */

/** At most this many credentials in one batch; a write is never unbounded. */
const MAX_SECRETS_PER_UPDATE = 8
/** Provider id / credential key shape. No control characters, no path syntax. */
const CREDENTIAL_REFERENCE = /^[\w.:-]{1,64}$/

/**
 * Rejeita caracteres de controle em valores de configuracao, preservando a
 * semantica anterior de [\u0000-\u0008\v\f\u000E-\u001F\u007F]: TAB, LF e CR
 * continuam permitidos (segredos multilinha), o restante e recusado.
 * Implementado sem regex de controle por causa da regra `no-control-regex`.
 */
function containsDisallowedControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.codePointAt(i)!
    if (code <= 0x08 || code === 0x0B || code === 0x0C || (code >= 0x0E && code <= 0x1F) || code === 0x7F)
      return true
  }
  return false
}

export function sanitizeConfigUpdate(payload: unknown): LiaConfigUpdatePayload {
  const source = (payload !== null && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const secrets: LiaConfigUpdatePayload['secrets'] = []
  if (Array.isArray(source.secrets) && source.secrets.length <= MAX_SECRETS_PER_UPDATE) {
    for (const entry of source.secrets) {
      if (entry === null || typeof entry !== 'object')
        continue
      const { key, scope, value } = entry as Record<string, unknown>
      if (typeof scope !== 'string' || typeof key !== 'string' || typeof value !== 'string')
        continue
      // The renderer may write a credential for a named provider and nothing
      // else: no arbitrary scope, no control characters, no oversized value.
      if (!CREDENTIAL_REFERENCE.test(scope) || !CREDENTIAL_REFERENCE.test(key))
        continue
      // An EMPTY value is a deliberate deletion of that reference (the vault
      // interprets it as "remove"); anything longer than 4 KiB or carrying
      // control characters is refused instead of being repaired.
      if (value.length > 4096 || containsDisallowedControlCharacter(value))
        continue
      secrets.push({ key, scope, value })
    }
  }
  const update = (source.update !== null && typeof source.update === 'object' ? source.update : {}) as LiaConfigUpdatePayload['update']
  return {
    secrets,
    update,
    ...(Object.hasOwn(source, 'expectedPreferred') ? { expectedPreferred: source.expectedPreferred } : {}),
  }
}
