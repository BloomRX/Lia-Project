import { createReadStream } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

const maxBytes = 1024 * 1024
const types = new Set(['agent-skill', 'mcp-server', 'cli-tool', 'api-service', 'plugin', 'framework', 'provider-model', 'workflow', 'template', 'reference'])

interface Capability {
  id: string
  name: string
  type: string
}
export type HubCatalogResult
  = { status: 'ready', capabilities: Capability[] }
    | { status: 'missing' | 'unavailable' }

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Hub's published, unsigned index contract. A capability listed here grants no permission. */
export async function readPublishedHubCatalog(userHome: string, hubHome?: string): Promise<HubCatalogResult> {
  const root = hubHome ?? join(userHome, 'Lia')
  if (!isAbsolute(root))
    return { status: 'unavailable' }
  const path = join(root, 'Comum', 'Capacidades', 'index.json')
  try {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > maxBytes)
      return { status: 'unavailable' }
    const chunks: Buffer[] = []
    for await (const chunk of createReadStream(path, { end: maxBytes }))
      chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    if (bytes.length > maxBytes)
      return { status: 'unavailable' }
    const index: unknown = JSON.parse(bytes.toString('utf8'))
    if (!record(index) || index.schemaVersion !== 1 || index.scope !== 'active' || !Array.isArray(index.capabilities))
      return { status: 'unavailable' }

    const capabilities: Capability[] = []
    const seen = new Set<string>()
    for (const entry of index.capabilities) {
      if (!record(entry) || entry.lifecycle !== 'active')
        continue
      const { id, name, type } = entry
      if (typeof id !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(id) || seen.has(id)
        || typeof name !== 'string' || !name.trim() || name.length > 160
        || typeof type !== 'string' || !types.has(type))
        continue
      seen.add(id)
      capabilities.push({ id, name: name.trim(), type })
      if (capabilities.length === 500)
        break
    }
    return { status: 'ready', capabilities }
  }
  catch (error) {
    return { status: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' }
  }
}
