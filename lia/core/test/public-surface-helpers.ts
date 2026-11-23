import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Subpaths servidos por `exports` e sua pureza declarada. */
export const PUBLIC_SURFACE: Record<string, { nodeOnly: boolean }> = {
  './credentials/destination': { nodeOnly: false },
  './credentials/owner-channel': { nodeOnly: true },
  './presence': { nodeOnly: false },
  './presence/service': { nodeOnly: true },
  './providers': { nodeOnly: false },
  './providers/brain-engine-provider-mapping': { nodeOnly: false },
  './providers/catalog': { nodeOnly: false },
  './providers/selection-write-policy': { nodeOnly: false },
  './runtime': { nodeOnly: true },
  './transcription': { nodeOnly: false },
  './transcription/transport': { nodeOnly: true },
  './transcription/service': { nodeOnly: true },
  './transports': { nodeOnly: false },
  './transports/repository': { nodeOnly: true },
  '.': { nodeOnly: false },
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out' || entry === '.turbo')
      continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory())
      walk(full, out)
    else if (/\.(?:ts|tsx|mts|vue)$/.test(entry))
      out.push(full)
  }
  return out
}

/** Extrai especificadores de `from '...'` e `import('...')`. */
export function specifiers(text: string): string[] {
  const found: string[] = []
  const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\s+['"]([^'"]+)['"]/g]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1])
        found.push(match[1])
    }
  }
  return found
}
