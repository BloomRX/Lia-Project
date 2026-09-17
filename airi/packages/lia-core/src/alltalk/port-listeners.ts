/**
 * Port *occupancy*, answered by the only thing that can answer it: the
 * socket layer (Phase 6 QA hotfix, item B).
 *
 * The boot-clean QA log proved why this module exists: the health probe
 * walked off a connection refusal, reported "offline", and the classifier
 * mapped that health answer to "an unknown process holds the port" - while
 * netstat was saying `listeners=none`. A health answer is an *application*
 * fact (does AllTalk speak here?). Occupancy is a *socket* fact (does anyone
 * LISTEN here?). One must never be inferred from the other.
 *
 * The probe is a localhost TCP connect attempt per watched port:
 *
 * - connection refused → that port is free;
 * - connected → something listens, that port is occupied;
 * - timeout or any other error → the platform refused to tell the truth
 *   (firewall drop, etc.), so the port is `unverifiable` - the safe word,
 *   never silently "free" and never silently "occupied".
 *
 * The verdict over both ports prefers the strictest honest reading: any
 * occupied => occupied; otherwise any unverifiable => unverifiable; else
 * free. `net.connect` is injected so tests run without touching sockets.
 */

export type PortOccupancy = 'free' | 'occupied' | 'unverifiable'

/** One connect attempt, shaped like `net.connect` minus the noise. */
export interface TcpConnectProbe {
  (params: { host: string, port: number, timeoutMs: number }): Promise<TcpConnectOutcome>
}

export type TcpConnectOutcome
  = | { outcome: 'connected' }
    | { code: string, outcome: 'refused' }
    | { code: string, outcome: 'error' }

/** Real probe over `net`, used by the service layer. */
async function defaultConnect(params: { host: string, port: number, timeoutMs: number }): Promise<TcpConnectOutcome> {
  const { connect } = await import('node:net')
  return await new Promise((resolve) => {
    const socket = connect({ host: params.host, port: params.port })
    let settled = false
    const settle = (outcome: TcpConnectOutcome): void => {
      if (settled)
        return
      settled = true
      socket.destroy()
      resolve(outcome)
    }
    socket.setTimeout(params.timeoutMs)
    socket.on('connect', () => settle({ outcome: 'connected' }))
    socket.on('timeout', () => settle({ code: 'ETIMEDOUT', outcome: 'error' }))
    socket.on('error', (error: NodeJS.ErrnoException) => {
      settle(error.code === 'ECONNREFUSED'
        ? { code: 'ECONNREFUSED', outcome: 'refused' }
        : { code: error.code ?? 'EUNKNOWN', outcome: 'error' })
    })
  })
}

export interface TcpListenerProbeDeps {
  host: string
  ports: number[]
  connect?: TcpConnectProbe
  timeoutMs?: number
}

/**
 * Answers "is anyone listening on any of these ports?" with zero
 * interpretation of application behaviour. Never throws: a probe failure is
 * `unverifiable`, which the caller treats as "decide conservatively".
 */
export async function probeTcpListeners(deps: TcpListenerProbeDeps): Promise<PortOccupancy> {
  const connect = deps.connect ?? defaultConnect
  const timeoutMs = deps.timeoutMs ?? 3000

  const verdicts = await Promise.all(deps.ports.map(async (port) => {
    try {
      const result = await connect({ host: deps.host, port, timeoutMs })
      if (result.outcome === 'connected')
        return 'occupied' as const
      if (result.outcome === 'refused')
        return 'free' as const
      return 'unverifiable' as const
    }
    catch {
      return 'unverifiable' as const
    }
  }))

  if (verdicts.includes('occupied'))
    return 'occupied'
  if (verdicts.includes('unverifiable'))
    return 'unverifiable'
  return 'free'
}

/**
 * Loopback host for a base URL: AllTalk binds loopback by default, and a
 * `0.0.0.0` listener is still reachable at `127.0.0.1`. Probing anywhere
 * else would let a firewall answer for the wrong box.
 */
export function loopbackHostFor(baseUrl: string): string {
  try {
    const hostname = new URL(baseUrl).hostname
    return hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]' ? '127.0.0.1' : hostname
  }
  catch {
    return '127.0.0.1'
  }
}
