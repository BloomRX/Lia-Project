/* eslint-disable no-restricted-syntax -- Native Node strip-types tests require explicit .ts imports. */
/* eslint-disable test/no-import-node-test -- This core module is tested by native Node, without Vitest. */
import type { CredentialOwnerRequest } from '../src/credentials/owner-channel.ts'

import assert from 'node:assert/strict'

import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createConnection } from 'node:net'
import { it } from 'node:test'

import { createCredentialOwnerClient, CredentialOwnerError, startCredentialOwner, takeCredentialOwnerEnvironment } from '../src/credentials/owner-channel.ts'

const get: CredentialOwnerRequest = { operation: 'get', scope: 'chat-profile', key: 'apiKey' }
const code = (expected: string) => (error: unknown) => error instanceof CredentialOwnerError && error.code === expected && error.message === `Credential owner ${expected}`
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function vault() {
  const key = randomBytes(32)
  const store = new Map<string, Buffer>()
  return {
    store,
    async handle(request: CredentialOwnerRequest) {
      if (request.operation === 'delete')
        return store.delete(request.scope)
      if (request.operation === 'set') {
        const iv = randomBytes(12)
        const cipher = createCipheriv('aes-256-gcm', key, iv)
        const ciphertext = Buffer.concat([cipher.update(request.value!, 'utf8'), cipher.final()])
        store.set(request.scope, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))
        return true
      }
      const blob = store.get(request.scope)
      if (!blob)
        return undefined
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12))
        decipher.setAuthTag(blob.subarray(12, 28))
        return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8')
      }
      catch { throw new CredentialOwnerError('unreadable') }
    },
  }
}

it('owner keeps cryptographic material in its profile; remote reads and rotation use owner vault', async (t) => {
  const ownerVault = vault()
  const otherProfile = vault()
  const owner = await startCredentialOwner({ handle: ownerVault.handle })
  t.after(owner.close)
  const client = createCredentialOwnerClient(owner.environment)
  assert.equal(await client.request(get), undefined)
  assert.equal(await client.request({ ...get, operation: 'set', value: 'synthetic-one' }), true)
  otherProfile.store.set(get.scope, ownerVault.store.get(get.scope)!)
  await assert.rejects(otherProfile.handle(get), code('unreadable'))
  assert.equal(await client.request(get), 'synthetic-one')
  assert.notEqual(await client.request(get), ownerVault.store.get(get.scope)!.toString('base64'))
  assert.equal(JSON.stringify(owner.environment).includes('synthetic-one'), false)
  await ownerVault.handle({ ...get, operation: 'set', value: 'synthetic-two' })
  assert.equal(await client.request(get), 'synthetic-two')
  assert.equal(await client.request({ ...get, operation: 'delete' }), true)
  assert.equal(await client.request(get), undefined)
})

it('validates guarded changes and rejects reserved or ambiguous references before dispatch', async (t) => {
  let calls = 0
  const owner = await startCredentialOwner({ handle: async (request) => {
    calls++
    assert.equal(request.expectedRevision, 'legacy')
    return 'new-revision'
  } })
  t.after(owner.close)
  const client = createCredentialOwnerClient(owner.environment)
  assert.equal(await client.request({ ...get, operation: 'change', expectedRevision: 'legacy', value: 'synthetic' }), 'new-revision')
  assert.equal(await client.request({ ...get, operation: 'change', expectedRevision: 'legacy' }), 'new-revision')
  for (const request of [
    { ...get, scope: 'lia:main:oidc' },
    { ...get, scope: 'alias\0hidden' },
    { ...get, operation: 'change' },
    { ...get, operation: 'change', expectedRevision: '' },
    { ...get, operation: 'change', expectedRevision: 'legacy', value: '' },
    { ...get, expectedRevision: 'legacy' },
  ]) {
    await assert.rejects(client.request(request as CredentialOwnerRequest), code('denied'))
  }
  assert.equal(calls, 2)
})

it('authentication rejects wrong capability without invoking vault', async (t) => {
  let calls = 0
  const owner = await startCredentialOwner({ handle: async () => {
    calls++
    return 'private'
  } })
  t.after(owner.close)
  const wrong = { ...owner.environment, LIA_CREDENTIAL_OWNER_TOKEN: '0'.repeat(64) }
  await assert.rejects(createCredentialOwnerClient(wrong).request(get), code('denied'))
  assert.equal(calls, 0)
})

it('decrypt failure stays explicit; arbitrary errors are sanitized', async (t) => {
  const profile = vault()
  const owner = await startCredentialOwner({ handle: profile.handle })
  t.after(owner.close)
  profile.store.set(get.scope, Buffer.from('broken synthetic cipher'))
  await assert.rejects(createCredentialOwnerClient(owner.environment).request(get), code('unreadable'))
  const failing = await startCredentialOwner({ handle: async () => {
    throw new Error('do-not-expose-synthetic-secret')
  } })
  t.after(failing.close)
  await assert.rejects(createCredentialOwnerClient(failing.environment).request(get), code('unavailable'))
})

it('abort pending handler disconnects and discards late result', async (t) => {
  const entered = deferred<AbortSignal>()
  const release = deferred<string>()
  const aborted = deferred<void>()
  const owner = await startCredentialOwner({ handle: async (_request, signal) => {
    signal.addEventListener('abort', () => aborted.resolve(), { once: true })
    entered.resolve(signal)
    return release.promise
  } })
  t.after(owner.close)
  const controller = new AbortController()
  const pending = createCredentialOwnerClient(owner.environment).request(get, controller.signal)
  const rejection = assert.rejects(pending, code('cancelled'))
  await entered.promise
  controller.abort()
  await rejection
  await aborted.promise
  release.resolve('late synthetic secret')
})

it('close revokes capability, aborts pending handlers and tolerates late rejection', async () => {
  const entered = deferred<AbortSignal>()
  const aborted = deferred<void>()
  const owner = await startCredentialOwner({ handle: async (_request, signal) => {
    entered.resolve(signal)
    await new Promise<void>(resolve => signal.addEventListener('abort', () => {
      aborted.resolve()
      resolve()
    }, { once: true }))
    throw new Error('late handler rejection')
  } })
  const client = createCredentialOwnerClient(owner.environment)
  const pending = assert.rejects(client.request(get), code('unavailable'))
  await entered.promise
  await owner.close()
  await aborted.promise
  await pending
  await owner.close()
  await assert.rejects(client.request(get), code('unavailable'))
})

it('bootstrap environment is consumed; malformed or remote pipe paths never connect', async () => {
  const env = { LIA_CREDENTIAL_OWNER_PIPE: '\\\\remote\\pipe\\lia-credential-owner-thing', LIA_CREDENTIAL_OWNER_TOKEN: 'a'.repeat(64), KEEP: 'yes' }
  const taken = takeCredentialOwnerEnvironment(env)
  assert.deepEqual(env, { KEEP: 'yes' })
  await assert.rejects(createCredentialOwnerClient(taken).request(get), code('unavailable'))
  for (const path of ['\\\\.\\pipe\\other', '/tmp/arbitrary.sock', '//remote/pipe/x'])
    await assert.rejects(createCredentialOwnerClient({ ...taken, LIA_CREDENTIAL_OWNER_PIPE: path }).request(get), code('unavailable'))
})

it('strict request bounds and pre-abort prevent vault calls', async (t) => {
  let calls = 0
  const owner = await startCredentialOwner({ handle: async () => {
    calls++
    return true
  } })
  t.after(owner.close)
  const client = createCredentialOwnerClient(owner.environment)
  const invalid = [
    { ...get, scope: '' },
    { ...get, scope: 'x'.repeat(257) },
    { ...get, scope: 'bad\n' },
    { ...get, key: 'all' },
    { ...get, operation: 'get-all' },
    { ...get, value: 'unexpected' },
    { ...get, operation: 'set', value: '' },
    { ...get, operation: 'set', value: 'x'.repeat(16_385) },
    { ...get, additional: 'ignored?' },
  ]
  for (const request of invalid) await assert.rejects(client.request(request as CredentialOwnerRequest), code('denied'))
  await assert.rejects(client.request(get, AbortSignal.abort()), code('cancelled'))
  assert.equal(calls, 0)
  assert.equal(await client.request({ ...get, scope: 'x'.repeat(256), operation: 'set', value: 'x'.repeat(16_384) }), true)
})

it('server independently rejects invalid frames and excessive bytes', async (t) => {
  let calls = 0
  const owner = await startCredentialOwner({ handle: async () => {
    calls++
    return true
  } })
  t.after(owner.close)
  const raw = (data: string) => new Promise<string>((resolve) => {
    const socket = createConnection(owner.environment.LIA_CREDENTIAL_OWNER_PIPE)
    let response = ''
    socket.on('error', () => {})
    socket.on('connect', () => socket.write(data))
    socket.on('data', (chunk) => {
      response += chunk.toString()
    })
    socket.on('close', () => resolve(response))
  })
  for (const frame of [
    { version: 2, token: owner.environment.LIA_CREDENTIAL_OWNER_TOKEN, request: get },
    { version: 1, token: owner.environment.LIA_CREDENTIAL_OWNER_TOKEN, request: { ...get, operation: 'get-all' } },
    { version: 1, token: 'short', request: get },
  ]) assert.equal(JSON.parse(await raw(`${JSON.stringify(frame)}\n`)).error, 'denied')
  assert.equal(await raw('x'.repeat(128 * 1024 + 1)), '')
  assert.equal(calls, 0)
})

it('only eight active connections are admitted and close destroys stalled peers', async () => {
  const owner = await startCredentialOwner({ handle: async () => true })
  const sockets = []
  try {
    for (let index = 0; index < 8; index++) {
      const socket = createConnection(owner.environment.LIA_CREDENTIAL_OWNER_PIPE)
      socket.on('error', () => {})
      await new Promise<void>(resolve => socket.once('connect', resolve))
      sockets.push(socket)
    }
    const ninth = createConnection(owner.environment.LIA_CREDENTIAL_OWNER_PIPE)
    ninth.on('error', () => {})
    await new Promise<void>(resolve => ninth.once('close', resolve))
    const closed = sockets.map(socket => new Promise<void>(resolve => socket.once('close', resolve)))
    await owner.close()
    await Promise.all(closed)
  }
  finally {
    for (const socket of sockets) socket.destroy()
    await owner.close()
  }
})

it('fixed five-second deadline cancels a stalled handler', async (t) => {
  const aborted = deferred<void>()
  const release = deferred<string>()
  const owner = await startCredentialOwner({ handle: async (_request, signal) => {
    signal.addEventListener('abort', () => aborted.resolve(), { once: true })
    return release.promise
  } })
  t.after(owner.close)
  const started = performance.now()
  await assert.rejects(createCredentialOwnerClient(owner.environment).request(get), code('unavailable'))
  assert.ok(performance.now() - started >= 4_500)
  await aborted.promise
  release.resolve('discarded')
})
