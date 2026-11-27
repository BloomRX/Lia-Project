import { createHash } from 'node:crypto'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, sep } from 'node:path'

export const markdownLimits = { entries: 4096, depth: 12, fileBytes: 400_000, totalBytes: 8_000_000, results: 12, excerpt: 240, query: 200 } as const
export interface MarkdownRoot { path: string, identity: string }
export interface MarkdownHit {
  path: string
  sha256: string
  size: number
  modifiedAt: string
  lineStart: number
  lineEnd: number
  excerpt: string
}

const internal = (name: string) => name.startsWith('.') || ['node_modules', '$recycle.bin', 'system volume information', 'windows', 'windowsapps'].includes(name.toLowerCase())
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const identityOf = (value: { dev: bigint, ino: bigint }) => `${value.dev}:${value.ino}`
const terms = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

async function canonical(path: string) {
  return samePath(await realpath(path), path)
}

export async function selectMarkdownRoot(path: string): Promise<MarkdownRoot | undefined> {
  if (!isAbsolute(path) || path.startsWith('\\\\'))
    return undefined
  const drive = parse(path).root
  const segments = relative(drive, path).split(sep)
  if (segments.some(segment => !segment || internal(segment) || segment.includes(':')))
    return undefined
  try {
    let location = drive
    for (const segment of segments) {
      location = join(location, segment)
      if (!(await lstat(location)).isDirectory())
        return undefined
    }
    const stat = await lstat(path, { bigint: true })
    if (!stat.isDirectory() || !await canonical(path))
      return undefined
    return { path, identity: identityOf(stat) }
  }
  catch { return undefined }
}

export async function searchMarkdown(root: MarkdownRoot, query: string) {
  const current = await selectMarkdownRoot(root.path)
  if (current?.identity !== root.identity)
    return undefined
  const needle = terms(query.trim())
  if (!needle || query.length > markdownLimits.query)
    return { hits: [], limited: false }
  const hits: MarkdownHit[] = []
  let visited = 0
  let bytes = 0
  let limited = false

  async function walk(directory: string, depth: number) {
    if (depth > markdownLimits.depth) { limited = true; return }
    if (!(await lstat(directory)).isDirectory() || !await canonical(directory))
      return
    for await (const entry of await opendir(directory)) {
      if (++visited > markdownLimits.entries || bytes >= markdownLimits.totalBytes) { limited = true; return }
      if (internal(entry.name) || entry.name.includes(':') || entry.isSymbolicLink())
        continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path, depth + 1).catch(() => {})
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md'))
        continue
      try {
        const stat = await lstat(path, { bigint: true })
        if (!stat.isFile() || stat.nlink !== 1n || !await canonical(path))
          continue
        const size = Number(stat.size)
        if (size > markdownLimits.fileBytes || bytes + size + 1 > markdownLimits.totalBytes) { limited = true; continue }
        const file = await open(path, 'r')
        let buffer: Buffer
        try {
          const opened = await file.stat({ bigint: true })
          if (identityOf(opened) !== identityOf(stat) || opened.size !== stat.size || !await canonical(path))
            continue
          const data = Buffer.alloc(size + 1)
          bytes += size + 1
          let read = 0
          while (read < data.length) {
            const result = await file.read(data, read, data.length - read, read)
            if (!result.bytesRead)
              break
            read += result.bytesRead
          }
          const latest = await lstat(path, { bigint: true })
          if (read !== size || latest.mtimeNs !== stat.mtimeNs || latest.ctimeNs !== stat.ctimeNs || identityOf(latest) !== identityOf(stat) || latest.nlink !== 1n || !await canonical(path))
            continue
          buffer = data.subarray(0, size)
        }
        finally { await file.close() }
        const lines = new TextDecoder('utf-8', { fatal: true }).decode(buffer).split(/\r?\n/)
        const line = lines.findIndex(value => terms(value).includes(needle))
        if (line < 0)
          continue
        if (hits.length >= markdownLimits.results) { limited = true; continue }
        hits.push({ path: relative(root.path, path), sha256: createHash('sha256').update(buffer).digest('hex'),
          size, modifiedAt: new Date(Number(stat.mtimeMs)).toISOString(), lineStart: line + 1, lineEnd: line + 1,
          excerpt: lines[line]!.slice(0, markdownLimits.excerpt) })
      }
      catch { /* Unreadable or concurrently replaced files do not go into the index. */ }
    }
  }
  try {
    await walk(root.path, 0)
    if ((await selectMarkdownRoot(root.path))?.identity === root.identity)
      return { hits, limited }
  }
  catch { /* The selected folder may have disappeared. */ }
}
