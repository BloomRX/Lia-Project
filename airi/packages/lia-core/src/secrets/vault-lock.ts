import process from 'node:process'

import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

// A single namespace on each machine also covers aliases of the same file.
// The listener is an OS-owned lock, with no application protocol or data.
const endpoint = process.platform === 'win32'
  ? { path: '\\\\.\\pipe\\lia-vault-writer-v1' }
  : process.platform === 'linux'
    ? { path: '\0lia-vault-writer-v1' }
    : { host: '127.0.0.1', port: 49376 }

async function tryAcquire() {
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
  const deadline = performance.now() + 5000
  for (;;) {
    signal?.throwIfAborted()
    const server = await tryAcquire()
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
      throw new Error('Credential storage busy')
    await delay(20, undefined, { signal })
  }
}
