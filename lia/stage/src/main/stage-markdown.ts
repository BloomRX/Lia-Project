import type { MarkdownRoot } from '../../../core/src/memory/markdown.ts'

import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'

import { markdownLimits, searchMarkdown, selectMarkdownRoot } from '../../../core/src/memory/markdown.ts'

export function createStageMarkdown(file: string) {
  let busy = false
  async function read(): Promise<Record<string, MarkdownRoot>> {
    const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        return undefined
      throw error
    })
    if (!stat)
      return {}
    if (!stat.isFile() || stat.size > 64_000)
      throw new Error('markdown-config')
    const entries: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 64)
      throw new Error('markdown-config')
    return Object.fromEntries(Object.entries(entries).map(([id, root]) => {
      if (!/^[a-f0-9-]{36}$/.test(id) || typeof root?.path !== 'string' || root.path.length > 512
        || typeof root.identity !== 'string' || !/^\d+:\d+$/.test(root.identity))
        throw new Error('markdown-config')
      return [id, { path: root.path, identity: root.identity }]
    }))
  }

  async function update(project: string, root?: MarkdownRoot) {
    const entries = await read()
    if (root)
      entries[project] = root
    else
      delete entries[project]
    if (Object.keys(entries).length > 64)
      throw new Error('markdown-config')
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(entries), { flag: 'wx', mode: 0o600 })
      await rename(temporary, file)
    }
    finally { await unlink(temporary).catch(() => {}) }
  }

  async function exclusive<T>(work: () => Promise<T>) {
    if (busy)
      return { status: 'busy' } as const
    busy = true
    try { return await work() }
    catch { return { status: 'unavailable' } as const }
    finally { busy = false }
  }

  return {
    async status(project: string) {
      try {
        const root = (await read())[project]
        return root ? { status: 'connected' as const, path: root.path } : { status: 'disconnected' as const }
      }
      catch { return { status: 'unavailable' as const } }
    },
    connect: (project: string, choose: () => Promise<string | undefined>) => exclusive(async () => {
      const path = await choose()
      if (!path)
        return { status: 'cancelled' } as const
      const root = await selectMarkdownRoot(path)
      if (!root)
        return { status: 'unavailable' } as const
      await update(project, root)
      return { status: 'connected', path: root.path } as const
    }),
    disconnect: (project: string) => exclusive(async () => {
      await update(project)
      return { status: 'disconnected' } as const
    }),
    async search(project: string, query: unknown) {
      if (typeof query !== 'string' || !query.trim() || query.length > markdownLimits.query)
        return { status: 'invalid' } as const
      return exclusive(async () => {
        const root = (await read())[project]
        if (!root)
          return { status: 'disconnected' } as const
        const result = await searchMarkdown(root, query)
        return result ? { status: 'ready', ...result } as const : { status: 'unavailable' } as const
      })
    },
  }
}
