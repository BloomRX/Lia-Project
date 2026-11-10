import process from 'node:process'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { Server } from 'node:net'
import { pathToFileURL } from 'node:url'

async function main() {
  const [filePath, modulePath] = process.argv.slice(2)
  const { createLiaSecretVault } = await import(pathToFileURL(modulePath).href)
  const send = message => process.send(message)
  const cipher = {
    available: () => true,
    encrypt: value => Buffer.from(value).reverse(),
    decrypt: bytes => Buffer.from(bytes).reverse().toString(),
  }

  // Observe the actual OS bind without replacing the lock. On the old build the
  // contender instead reaches the disk read while the holder is still paused.
  const release = Promise.withResolvers()
  const listen = Server.prototype.listen
  let reportedContention = false
  let pauseBeforeBind = false
  Server.prototype.listen = function (...args) {
    this.prependOnceListener('error', (error) => {
      if (error.code === 'EADDRINUSE' && !reportedContention) {
        reportedContention = true
        send({ kind: 'contended' })
      }
    })
    if (pauseBeforeBind) {
      pauseBeforeBind = false
      send({ kind: 'bind-paused' })
      void release.promise.then(() => listen.apply(this, args))
      return this
    }
    return listen.apply(this, args)
  }

  let receipt
  process.on('message', (message) => {
    if (message.kind === 'release')
      release.resolve()
    else if (message.kind === 'rollback')
      void receipt.rollback().then(result => send({ kind: 'rolled-back', result }), () => send({ kind: 'failed' }))
    else if (message.kind === 'run')
      void run(message).catch(() => send({ kind: 'failed' }))
  })

  async function run(message) {
    pauseBeforeBind = message.pauseLock === true
    let reportedRead = false
    const read = (path) => {
      if (!reportedRead) {
        reportedRead = true
        send({ kind: 'reading' })
      }
      return readFileSync(path, 'utf8')
    }
    const write = message.pause || message.fail
      ? async (path, data, signal) => {
        const temp = `${path}.${randomUUID()}.tmp`
        try {
          await writeFile(temp, data)
          send({ kind: 'prepared' })
          if (message.pause)
            await release.promise
          if (message.fail)
            throw new Error('Synthetic commit failure')
          signal?.throwIfAborted()
          renameSync(temp, path)
        }
        finally {
          await rm(temp, { force: true })
        }
      }
      : undefined
    const vault = createLiaSecretVault({ filePath, cipher, read, write })
    const { operation, scope, key, value, expectedRevision } = message
    let result
    switch (operation) {
      case 'set':
        result = await vault.setSecret(scope, key, value)
        break
      case 'delete':
        result = await vault.deleteSecret(scope, key)
        break
      case 'revision':
        result = vault.secretRevision(scope, key)
        break
      case 'conditional':
        result = (await vault.changeSecret(scope, key, value, { expectedRevision })) !== undefined
        break
      case 'receipt':
        receipt = await vault.changeSecret(scope, key, value)
        send({ kind: 'receipt', result: receipt !== undefined })
        return
      default:
        throw new Error('Unknown fixture operation')
    }
    send({ kind: 'done', result })
  }

  send({ kind: 'ready' })
}

void main().catch(() => {
  process.send?.({ kind: 'failed' })
  process.exitCode = 1
})
