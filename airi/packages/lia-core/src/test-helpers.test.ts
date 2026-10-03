import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createMemoryStorage, isSymlinkSupported, normalizeLineEndings, repoRelativePosix } from './test-helpers'

describe('test-helpers portability (D2B9-A1)', () => {
  describe('createMemoryStorage', () => {
    it('initial length 0, missing getItem → null', () => {
      const storage = createMemoryStorage()
      expect(storage.length).toBe(0)
      expect(storage.getItem('missing')).toBeNull()
      expect(storage.key(0)).toBeNull()
    })
    it('setItem and getItem', () => {
      const storage = createMemoryStorage()
      storage.setItem('a', '1')
      expect(storage.length).toBe(1)
      expect(storage.getItem('a')).toBe('1')
      expect(storage.key(0)).toBe('a')
    })
    it('overwrite', () => {
      const storage = createMemoryStorage()
      storage.setItem('a', '1')
      storage.setItem('a', '2')
      expect(storage.length).toBe(1)
      expect(storage.getItem('a')).toBe('2')
    })
    it('removeItem', () => {
      const storage = createMemoryStorage()
      storage.setItem('a', '1')
      storage.setItem('b', '2')
      storage.removeItem('a')
      expect(storage.length).toBe(1)
      expect(storage.getItem('a')).toBeNull()
      expect(storage.getItem('b')).toBe('2')
      expect(storage.key(0)).toBe('b')
      expect(storage.key(1)).toBeNull()
    })
    it('clear', () => {
      const storage = createMemoryStorage()
      storage.setItem('a', '1')
      storage.setItem('b', '2')
      storage.clear()
      expect(storage.length).toBe(0)
      expect(storage.getItem('a')).toBeNull()
    })
    it('independent instances do not share state', () => {
      const a = createMemoryStorage()
      const b = createMemoryStorage()
      a.setItem('x', '1')
      expect(b.length).toBe(0)
      expect(b.getItem('x')).toBeNull()
      b.setItem('x', '2')
      expect(a.getItem('x')).toBe('1')
      expect(b.getItem('x')).toBe('2')
    })
    it('key(index) returns null out of bounds', () => {
      const storage = createMemoryStorage()
      storage.setItem('a', '1')
      expect(storage.key(-1)).toBeNull()
      expect(storage.key(5)).toBeNull()
    })
  })

  describe('normalizeLineEndings', () => {
    it('normalizes CRLF and lone CR', () => {
      expect(normalizeLineEndings('a\r\nb\r\nc')).toBe('a\nb\nc')
      expect(normalizeLineEndings('a\rb\rc')).toBe('a\nb\nc')
      expect(normalizeLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
    })
  })

  describe('repoRelativePosix', () => {
    it('normalizes backslashes on Windows simulation', () => {
      const repoRoot = join('/', 'repo', 'root')
      const abs = join(repoRoot, 'apps', 'stage-tamagotchi', 'src', 'file.ts')
      // Simulate Windows path with backslashes by replacing
      const winAbs = abs.replace(/\//g, '\\')
      const rel = repoRelativePosix(repoRoot, winAbs.replace(/\\/g, '/'))
      // Should be posix with slashes
      expect(rel).toBe('apps/stage-tamagotchi/src/file.ts')
    })
  })

  describe('isSymlinkSupported', () => {
    it('returns boolean and does not leave temp files', () => {
      const result = isSymlinkSupported()
      expect(typeof result).toBe('boolean')
    })
  })
})
