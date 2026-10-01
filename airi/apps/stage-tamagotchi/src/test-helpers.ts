import nodePath, { join } from 'node:path'

// TEST-ONLY portability helpers — stage
import { symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

export function normalizeLineEndings(text: string): string {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function normalizeRepoPath(p: string): string {
  // Turn every backslash into a forward slash, then collapse duplicate slashes
  // (the JSON-escaped \\ in kokoroSmokeSummaryLine becomes // and must collapse to /).
  // Keep protocol-like :// out of this helper — inputs are repo paths, not URLs.
  return p.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

export function repoRelativePosix(repoRoot: string, absolutePath: string): string {
  const a = normalizeRepoPath(repoRoot)
  const b = normalizeRepoPath(absolutePath)
  const rel = nodePath.posix.relative(a, b)
  return normalizeRepoPath(rel)
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
  const base = join(tmpdir(), `lia-symlink-probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const target = `${base}-target`
  const link = `${base}-link`
  try {
    writeFileSync(target, 'x')
    try {
      unlinkSync(link)
    }
    catch {}
    symlinkSync(target, link)
    return true
  }
  catch {
    return false
  }
  finally {
    try {
      unlinkSync(link)
    }
    catch {}
    try {
      unlinkSync(target)
    }
    catch {}
  }
}
