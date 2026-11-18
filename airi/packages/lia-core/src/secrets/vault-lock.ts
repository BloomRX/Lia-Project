import process from 'node:process'

import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

// One OS-owned listener per domain also covers aliases of the same file.
// It exposes no application protocol or data.
function endpointFor(domain: 'vault' | 'product') {
  const name = `lia-${domain}-writer-v1`
  if (process.platform === 'win32')
    return { path: `\\\\.\\pipe\\${name}` }
  if (process.platform === 'linux')
    return { path: `\0${name}` }
  return { host: '127.0.0.1', port: domain === 'vault' ? 49376 : 49377 }
}

async function tryAcquire(endpoint: ReturnType<typeof endpointFor>) {
  const server = createServer((socket) => {
    socket.on('error', () => {})
    socket.destroy()
  })
  server.maxConnections = 1
  const acquired = await new Promise<boolean>((resolve, reject) => {
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE')
        resolve(false)
      else
        reject(error)
    })
    server.listen({ ...endpoint, exclusive: true }, () => resolve(true))
  })
  return acquired ? server : undefined
}

export async function withVaultWriteLock<T>(write: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return withOsWriteLock('vault', write, signal)
}

export async function withOsWriteLock<T>(domain: 'vault' | 'product', write: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const endpoint = endpointFor(domain)
  const deadline = performance.now() + 5000
  for (;;) {
    signal?.throwIfAborted()
    const server = await tryAcquire(endpoint)
    if (server) {
      try {
        signal?.throwIfAborted()
        return await write()
      }
      finally {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
    }
    if (performance.now() >= deadline)
      throw new Error(domain === 'vault' ? 'Credential storage busy' : 'Product configuration busy')
    await delay(20, undefined, { signal })
  }
}
