import { once } from 'node:events'
import { createServer } from 'node:http'

const host = '127.0.0.1'

/** One disposable listener for the Main-owned authorization attempt. */
export async function startOidcLoopback(expectedState: string, relayOrigin: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const callback = Promise.withResolvers<string>()
  // A callback can arrive before the system browser invocation settles.
  void callback.promise.catch(() => {})
  let settled = false
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000, keepAliveTimeout: 1_000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    const origin = request.headers.origin
    if (origin !== undefined && origin !== relayOrigin) {
      response.writeHead(403).end()
      return
    }
    if (origin === relayOrigin) {
      response.setHeader('Access-Control-Allow-Origin', relayOrigin)
      response.setHeader('Vary', 'Origin')
    }
    const target = URL.parse(request.url ?? '/', 'http://127.0.0.1')
    if (request.headers.host !== `${host}:${port}` || !target || target.origin !== `http://${host}` || target.pathname !== '/callback') {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'OPTIONS' && origin === relayOrigin && request.headers['access-control-request-method'] === 'GET') {
      response.setHeader('Access-Control-Allow-Methods', 'GET')
      if (request.headers['access-control-request-private-network'] === 'true')
        response.setHeader('Access-Control-Allow-Private-Network', 'true')
      response.writeHead(204).end()
      return
    }
    if (request.method !== 'GET' || target.searchParams.getAll('state').length !== 1
      || target.searchParams.get('state') !== expectedState || settled) {
      response.writeHead(400).end()
      return
    }
    const errors = target.searchParams.getAll('error')
    const codes = target.searchParams.getAll('code')
    if (errors.length === 1 && errors[0] && !codes.length) {
      response.end('A autorização foi recusada. Volte à Lia.')
      finish(() => callback.reject(new Error('OIDC authorization was rejected')))
      return
    }
    if (errors.length || codes.length !== 1 || !/^[\x21-\x7E]{1,2048}$/.test(codes[0])) {
      response.writeHead(400).end()
      return
    }
    response.end('A autorização foi recebida. Volte à Lia.')
    finish(() => callback.resolve(codes[0]))
  })
  let port: number
  const close = () => finish(() => callback.reject(new Error('OIDC authorization was cancelled')), true)
  const deadline = setTimeout(close, 5 * 60 * 1_000)

  function finish(settle: () => void, force = false) {
    if (settled)
      return
    settled = true
    clearTimeout(deadline)
    signal.removeEventListener('abort', close)
    server.close()
    if (force)
      server.closeAllConnections()
    settle()
  }

  try {
    const listening = once(server, 'listening')
    server.listen(0, host)
    await listening
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('OIDC loopback has no local address')
    port = address.port
    signal.addEventListener('abort', close, { once: true })
    signal.throwIfAborted()
    return { port, result: callback.promise, close }
  }
  catch {
    close()
    signal.throwIfAborted()
    throw new Error('OIDC loopback could not start')
  }
}
