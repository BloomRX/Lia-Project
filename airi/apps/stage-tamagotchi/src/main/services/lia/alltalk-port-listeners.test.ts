import type { TcpConnectProbe } from './alltalk-port-listeners'

import { describe, expect, it } from 'vitest'

import { loopbackHostFor, probeTcpListeners } from './alltalk-port-listeners'

/**
 * The socket fact, divorced from the health fact (Phase 6 QA hotfix, item B).
 * The QA log that motivated this module: the server was nowhere, netstat
 * said `listeners=none`, and the classifier still cried "unknown process".
 */

describe('probeTcpListeners', () => {
  it('reads a refused connection as a free port - the clean-boot case', async () => {
    const connect: TcpConnectProbe = async () => ({ code: 'ECONNREFUSED', outcome: 'refused' })

    // This exact fixture is the QA evidence: health walks off refused, the
    // socket says nobody listens - so occupancy is free, not unknown.
    expect(await probeTcpListeners({ connect, host: '127.0.0.1', ports: [7851, 7852] })).toBe('free')
  })

  it('reads any successful connect as occupied', async () => {
    const connect: TcpConnectProbe = async ({ port }) => port === 7852
      ? { outcome: 'connected' }
      : { code: 'ECONNREFUSED', outcome: 'refused' }

    expect(await probeTcpListeners({ connect, host: '127.0.0.1', ports: [7851, 7852] })).toBe('occupied')
  })

  it('reads a filtered/timeout answer as unverifiable, never as free', async () => {
    const timingOut: TcpConnectProbe = async () => ({ code: 'ETIMEDOUT', outcome: 'error' })

    expect(await probeTcpListeners({ connect: timingOut, host: '127.0.0.1', ports: [7851] })).toBe('unverifiable')
  })

  it('prefers occupied over unverifiable, and unverifiable over free', async () => {
    const occupiedBeatsTimeout: TcpConnectProbe = async ({ port }) => port === 7851
      ? { code: 'ETIMEDOUT', outcome: 'error' }
      : { outcome: 'connected' }
    expect(await probeTcpListeners({ connect: occupiedBeatsTimeout, host: '127.0.0.1', ports: [7851, 7852] })).toBe('occupied')

    const timeoutBeatsFree: TcpConnectProbe = async ({ port }) => port === 7851
      ? { code: 'ETIMEDOUT', outcome: 'error' }
      : { code: 'ECONNREFUSED', outcome: 'refused' }
    expect(await probeTcpListeners({ connect: timeoutBeatsFree, host: '127.0.0.1', ports: [7851, 7852] })).toBe('unverifiable')
  })

  it('never throws when a connect attempt itself explodes', async () => {
    const blowing: TcpConnectProbe = async () => {
      throw new Error('socket layer gone')
    }

    expect(await probeTcpListeners({ connect: blowing, host: '127.0.0.1', ports: [7851] })).toBe('unverifiable')
  })

  it('probes both ports, because one free port is not a free runtime', async () => {
    const asked: number[] = []
    const connect: TcpConnectProbe = async ({ port }) => {
      asked.push(port)
      return { code: 'ECONNREFUSED', outcome: 'refused' }
    }

    await probeTcpListeners({ connect, host: '127.0.0.1', ports: [7851, 7852] })
    expect(asked.sort()).toEqual([7851, 7852])
  })
})

describe('loopbackHostFor', () => {
  it('maps a bind-anywhere host to loopback', () => {
    expect(loopbackHostFor('http://0.0.0.0:7851')).toBe('127.0.0.1')
    expect(loopbackHostFor('http://127.0.0.1:7851')).toBe('127.0.0.1')
    expect(loopbackHostFor('http://localhost:7851')).toBe('localhost')
    expect(loopbackHostFor('not-a-url')).toBe('127.0.0.1')
  })
})
