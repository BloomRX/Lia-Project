import { describe, expect, it } from 'vitest'

import { startOidcLoopback } from './oidc-loopback'

const issuer = 'https://issuer.example.test'

describe('one-shot Main OIDC callback', () => {
  it('accepts only the matching callback and closes the listener', async () => {
    const receiver = await startOidcLoopback('fixture-state', issuer, new AbortController().signal)
    const url = `http://127.0.0.1:${receiver.port}/callback`
    try {
      const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: issuer, 'Access-Control-Request-Method': 'GET' } })
      expect(preflight.status).toBe(204)
      expect(preflight.headers.get('access-control-allow-origin')).toBe(issuer)
      const foreign = await fetch(`${url}?state=fixture-state&code=fixture-code`, { headers: { Origin: 'https://other.example.test' } })
      expect(foreign.status).toBe(403)
      for (const query of ['state=wrong&code=fixture-code', 'state=fixture-state&state=fixture-state&code=fixture-code', 'state=fixture-state&code=a&code=b']) {
        expect((await fetch(`${url}?${query}`)).status).toBe(400)
      }
      const accepted = await fetch(`${url}?state=fixture-state&code=fixture-code`, { headers: { Origin: issuer } })
      expect(accepted.status).toBe(200)
      expect(accepted.headers.get('cache-control')).toBe('no-store')
      expect(await accepted.text()).not.toContain('fixture-code')
      await expect(receiver.result).resolves.toBe('fixture-code')
      await expect(fetch(url)).rejects.toThrow()
    }
    finally {
      receiver.close()
    }
  })

  it('rejects authorization errors without using the upstream body or description', async () => {
    const receiver = await startOidcLoopback('state', issuer, new AbortController().signal)
    try {
      const response = await fetch(`http://127.0.0.1:${receiver.port}/callback?state=state&error=SECRET&error_description=PRIVATE`)
      expect(await response.text()).not.toMatch(/SECRET|PRIVATE/)
      await expect(receiver.result).rejects.toThrow(/^OIDC authorization was rejected$/)
    }
    finally {
      receiver.close()
    }
  })

  it('closes an outstanding listener on abort and refuses a cancelled start', async () => {
    const operation = new AbortController()
    const receiver = await startOidcLoopback('state', issuer, operation.signal)
    operation.abort()
    await expect(receiver.result).rejects.toThrow(/^OIDC authorization was cancelled$/)
    await expect(fetch(`http://127.0.0.1:${receiver.port}/callback`)).rejects.toThrow()
    await expect(startOidcLoopback('state', issuer, operation.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
