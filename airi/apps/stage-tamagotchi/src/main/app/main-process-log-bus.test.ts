import { describe, expect, it } from 'vitest'

import { sanitizeLogText } from './main-process-log-bus'

describe('sanitizeLogText', () => {
  it('redacts query keys and quoted JSON fields including escaped values', () => {
    const text = `request https://example.invalid/path?key=SYNTHETIC_QUERY_SECRET&x=1 ${JSON.stringify({ apiKey: 'SYNTHETIC_JSON_SECRET with "quoted" data', accessKeySecret: 'SYNTHETIC_ACCESS_SECRET', idToken: 'SYNTHETIC_ID_SECRET' })}`
    const result = sanitizeLogText(text)
    expect(result).not.toContain('SYNTHETIC_')
    expect(result).toContain('?key=***&x=1')
  })
  it('strips ANSI escape codes', () => {
    expect(sanitizeLogText('\u001B[32mgreen\u001B[0m message')).toBe('green message')
  })

  it('masks Bearer tokens and Authorization headers', () => {
    expect(sanitizeLogText('Authorization: Bearer abc.def-1234')).toBe('Authorization: Bearer ***')
    expect(sanitizeLogText('got token=abc123 more')).toContain('token=***')
    expect(sanitizeLogText('Bearer xyz987')).toBe('Bearer ***')
  })

  it('masks common key/secret assignments', () => {
    const out = sanitizeLogText('api_key="sk-secret"; client_secret: zz; password=p@ss')
    expect(out).toContain('api_key="***"')
    expect(out).toContain('client_secret: ***')
    expect(out).toContain('password=***')
    expect(out).not.toContain('sk-secret')
    expect(out).not.toContain('p@ss')
  })

  it('trims trailing whitespace/newlines', () => {
    expect(sanitizeLogText('  hello world  \n')).toBe('hello world')
  })

  it('truncates very long lines', () => {
    const long = 'x'.repeat(5000)
    const out = sanitizeLogText(long)
    expect(out.length).toBeLessThan(2010)
    expect(out.endsWith('…')).toBe(true)
  })
})
