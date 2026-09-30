// TEST-ONLY portability helpers — stage
import nodePath from 'node:path'

export function normalizeLineEndings(text: string): string {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/')
}

export function repoRelativePosix(repoRoot: string, absolutePath: string): string {
  const rel = nodePath.relative(repoRoot, absolutePath)
  return rel.replace(/\\/g, '/')
}

export function createMemoryStorage() {
  const store = new Map<string, string>()
  return {
    getItem(key: string) { return store.has(key) ? store.get(key)! : null },
    setItem(key: string, value: string) { store.set(key, String(value)) },
    removeItem(key: string) { store.delete(key) },
    clear() { store.clear() },
    key(index: number) { return Array.from(store.keys())[index] ?? null },
    get length() { return store.size },
  }
}

export function isSymlinkSupported(): boolean {
  try {
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const tmp = os.tmpdir()
    const target = path.join(tmp, `lia-symlink-probe-target-${Date.now()}`)
    const link = path.join(tmp, `lia-symlink-probe-link-${Date.now()}`)
    fs.writeFileSync(target, 'x')
    try { fs.unlinkSync(link) } catch {}
    fs.symlinkSync(target, link)
    fs.unlinkSync(link)
    fs.unlinkSync(target)
    return true
  } catch {
    return false
  }
}
