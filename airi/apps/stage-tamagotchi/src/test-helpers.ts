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

/**
 * Path segments that mark generated output rather than authored source.
 *
 * A Windows checkout materialises build artefacts (for example the Live2D SDK
 * copy under `renderer/.cache/...`) inside the scanned tree, so every recursive
 * production scanner has to reject them - otherwise a vendored sample file is
 * mistaken for a production caller.
 */
export const GENERATED_PATH_SEGMENTS: readonly string[] = ['.cache', 'dist', 'node_modules', 'coverage', '.turbo']

/**
 * True when any path segment is a generated directory. Native, POSIX and mixed
 * separators are all accepted: the decision is made on the normalized form, so
 * a Windows path classifies exactly like its POSIX equivalent.
 */
export function isGeneratedRepoPath(path: string): boolean {
  return normalizeRepoPath(path)
    .split('/')
    .filter(Boolean)
    .some(segment => GENERATED_PATH_SEGMENTS.includes(segment))
}

export interface AuthoredSourceEntry {
  /** Absolute path, safe to read. */
  file: string
  /** Repo-relative POSIX path, safe to compare with forward-slash allowlists. */
  relativePosix: string
}

/**
 * Resolves one recursive `readdirSync` entry to an authored production source.
 *
 * Returns `null` for anything that is not a readable source file: directories,
 * and files inside generated directories. The path is built with `join()` and
 * reduced with `repoRelativePosix` - never by string concatenation or by slicing
 * a root prefix - so Windows checkouts yield the same POSIX values.
 */
export function authoredSourceEntry(repoRoot: string, entry: { isFile: () => boolean, name: string, parentPath: string }): AuthoredSourceEntry | null {
  if (!entry.isFile())
    return null
  const file = join(entry.parentPath, entry.name)
  const relativePosix = repoRelativePosix(repoRoot, file)
  if (isGeneratedRepoPath(relativePosix))
    return null
  return { file, relativePosix }
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
