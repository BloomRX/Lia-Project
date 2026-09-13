import { describe, expect, it } from 'vitest'

import { sanitizeLogText } from './main-process-log-bus'

describe('sanitizeLogText', () => {
  it('strips ANSI escape codes', () => {
    expect(sanitizeLogText('\u001b[32mgreen\u001b[0m message')).toBe('green message')
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
