import type { ChildProcess } from 'node:child_process'

import { Buffer } from 'node:buffer'
import { fork } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createLiaSecretVault } from './vault'

type EventKind = 'ready' | 'reading' | 'contended' | 'bind-paused' | 'prepared' | 'done' | 'receipt' | 'rolled-back' | 'failed' | 'exit'
interface FixtureEvent {
  kind: EventKind
  result?: string | boolean
}
interface Operation {
  operation: 'set' | 'delete' | 'revision' | 'conditional' | 'receipt'
  scope: string
  key: string
  value?: string
  expectedRevision?: string
  pause?: boolean
  pauseLock?: boolean
  fail?: boolean
}

const modulePath = fileURLToPath(new URL('../../dist/secrets/vault.mjs', import.meta.url))
const workerPath = fileURLToPath(new URL('./vault-process.fixture.mjs', import.meta.url))
const session = { scope: 'lia:main:oidc', key: 'session-v1' }
const unrelated = { scope: 'unrelated-provider', key: 'apiKey' }
const cipher = {
  available: () => true,
  encrypt: (value: string) => Buffer.from(value).reverse(),
  decrypt: (bytes: Buffer) => Buffer.from(bytes).reverse().toString(),
}

function observe(child: ChildProcess) {
  const notifications = new EventEmitter()
  const events: FixtureEvent[] = []
  function report(event: FixtureEvent) {
    events.push(event)
    notifications.emit('changed')
  }
  child.on('message', (message: FixtureEvent) => report(message))
  child.once('error', () => report({ kind: 'failed' }))
  child.once('exit', () => report({ kind: 'exit' }))

  return async function waitFor(...kinds: EventKind[]): Promise<FixtureEvent> {
    const signal = AbortSignal.timeout(10_000)
    for (;;) {
      const found = events.find(event => kinds.includes(event.kind) || event.kind === 'failed' || event.kind === 'exit')
      if (found) {
        if (found.kind === 'failed' || found.kind === 'exit')
          throw new Error(`Vault process stopped before ${kinds.join(' or ')}`)
        return found
      }
      await once(notifications, 'changed', { signal })
    }
  }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'lia-vault-process-'))
  const filePath = join(directory, 'vault.json')
  const children: ChildProcess[] = []
  return {
    directory,
    filePath,
    vault: createLiaSecretVault({ filePath, cipher }),
    async start(operation: Operation) {
      const child = fork(workerPath, [filePath, modulePath], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      children.push(child)
      const waitFor = observe(child)
      await waitFor('ready')
      child.send({ kind: 'run', ...operation })
      return { child, waitFor, release: () => child.send({ kind: 'release' }) }
    },
    async cleanup() {
      try {
        await Promise.all(children.map(async (child) => {
          if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
            return
          const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) })
          child.kill()
          await exited
        }))
      }
      finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

describe('shared vault process coordination', () => {
  it.each(['launcher', 'stage'])('preserves deletion when the %s pauses an unrelated write', async (holder) => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(session.scope, session.key, 'old-session')).toBe(true)
      const other = holder === 'launcher' ? 'stage' : 'launcher'
      const update = await f.start({ operation: 'set', ...unrelated, value: `${holder}-key`, pause: true })
      await update.waitFor('prepared')
      const logout = await f.start({ operation: 'delete', ...session })
      const contender = await logout.waitFor('contended', 'reading')
      // On an uncoordinated build, force the stale snapshot to commit after
      // the confirmed deletion. The final assertion then exposes resurrection.
      if (contender.kind === 'reading')
        expect((await logout.waitFor('done')).result, other).toBe(true)
      update.release()
      expect((await update.waitFor('done')).result, holder).toBe(true)
      expect((await logout.waitFor('done')).result, other).toBe(true)
      expect(f.vault.hasSecret(session.scope, session.key)).toBe(false)
      expect(f.vault.getSecret(unrelated.scope, unrelated.key)).toBe(`${holder}-key`)
      expect(contender.kind).toBe('contended')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it('fences a refresh using a revision observed by another process before logout', async () => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(session.scope, session.key, 'old-session')).toBe(true)
      const reader = await f.start({ operation: 'revision', ...session })
      const revision = (await reader.waitFor('done')).result
      expect(typeof revision).toBe('string')
      const logout = await f.start({ operation: 'delete', ...session })
      expect((await logout.waitFor('done')).result).toBe(true)
      const refresh = await f.start({ operation: 'conditional', ...session, value: 'stale-session', expectedRevision: revision as string })
      expect((await refresh.waitFor('done')).result).toBe(false)
      expect(f.vault.hasSecret(session.scope, session.key)).toBe(false)
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it('merges two processes updating different entries without discarding existing secrets', async () => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(session.scope, session.key, 'current-session')).toBe(true)
      const first = await f.start({ operation: 'set', ...unrelated, value: 'first', pause: true })
      await first.waitFor('prepared')
      const second = await f.start({ operation: 'set', scope: 'second-provider', key: 'apiKey', value: 'second' })
      // Ordinary set reads its revision before attempting the lock. Only a
      // completed write or a rejected bind identifies the interleaving here.
      await second.waitFor('contended', 'done')
      first.release()
      expect((await first.waitFor('done')).result).toBe(true)
      expect((await second.waitFor('done')).result).toBe(true)
      expect(f.vault.getSecret(unrelated.scope, unrelated.key)).toBe('first')
      expect(f.vault.getSecret('second-provider', 'apiKey')).toBe('second')
      expect(f.vault.getSecret(session.scope, session.key)).toBe('current-session')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it('fences a pending login after another process confirms deletion of an absent session', async () => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(unrelated.scope, unrelated.key, 'keep')).toBe(true)
      const reader = await f.start({ operation: 'revision', ...session })
      const revision = (await reader.waitFor('done')).result
      expect(typeof revision).toBe('string')
      const logout = await f.start({ operation: 'delete', ...session })
      expect((await logout.waitFor('done')).result).toBe(true)
      const pendingLogin = await f.start({ operation: 'conditional', ...session, value: 'late-login', expectedRevision: revision as string })
      expect((await pendingLogin.waitFor('done')).result).toBe(false)
      expect(f.vault.hasSecret(session.scope, session.key)).toBe(false)
      expect(f.vault.getSecret(unrelated.scope, unrelated.key)).toBe('keep')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it.each([false, true])('rejects an ordinary set admitted before logout when the session initially exists=%s', async (present) => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(unrelated.scope, unrelated.key, 'keep')).toBe(true)
      if (present)
        expect(await f.vault.setSecret(session.scope, session.key, 'old-session')).toBe(true)
      const pending = await f.start({ operation: 'set', ...session, value: 'late-session', pauseLock: true })
      // The child has captured its revision but has not entered the OS lock.
      await pending.waitFor('bind-paused')
      const logout = await f.start({ operation: 'delete', ...session })
      expect((await logout.waitFor('done')).result).toBe(true)
      pending.release()
      expect((await pending.waitFor('done')).result).toBe(false)
      expect(f.vault.hasSecret(session.scope, session.key)).toBe(false)
      expect(f.vault.getSecret(unrelated.scope, unrelated.key)).toBe('keep')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it.each(['delete', 'replace'] as const)('rejects an old rollback receipt after a different process commits %s', async (next) => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(session.scope, session.key, 'original-session')).toBe(true)
      expect(await f.vault.setSecret(unrelated.scope, unrelated.key, 'keep')).toBe(true)
      const earlier = await f.start({ operation: 'receipt', ...session, value: 'candidate-session' })
      expect((await earlier.waitFor('receipt')).result).toBe(true)
      const later = await f.start({ operation: next === 'delete' ? 'delete' : 'set', ...session, value: 'new-session' })
      expect((await later.waitFor('done')).result).toBe(true)
      earlier.child.send({ kind: 'rollback' })
      expect((await earlier.waitFor('rolled-back')).result).toBe(false)
      expect(f.vault.getSecret(session.scope, session.key)).toBe(next === 'delete' ? undefined : 'new-session')
      expect(f.vault.getSecret(unrelated.scope, unrelated.key)).toBe('keep')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it('serializes a session update before a queued logout and leaves no session', async () => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(session.scope, session.key, 'old-session')).toBe(true)
      const update = await f.start({ operation: 'set', ...session, value: 'rotated-session', pause: true })
      await update.waitFor('prepared')
      const logout = await f.start({ operation: 'delete', ...session })
      const contender = await logout.waitFor('contended', 'reading')
      if (contender.kind === 'reading')
        await logout.waitFor('done')
      update.release()
      expect((await update.waitFor('done')).result).toBe(true)
      expect((await logout.waitFor('done')).result).toBe(true)
      expect(f.vault.hasSecret(session.scope, session.key)).toBe(false)
      expect(contender.kind).toBe('contended')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it('recovers after the lock holder dies with a complete temporary file before rename', async () => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(session.scope, session.key, 'current-session')).toBe(true)
      const oldBytes = await readFile(f.filePath, 'utf8')
      const interrupted = await f.start({ operation: 'set', ...session, value: 'uncommitted', pause: true })
      await interrupted.waitFor('prepared')
      expect((await readdir(f.directory)).some(name => name.endsWith('.tmp'))).toBe(true)
      const exited = once(interrupted.child, 'exit', { signal: AbortSignal.timeout(5_000) })
      expect(interrupted.child.kill()).toBe(true)
      await exited
      expect(await readFile(f.filePath, 'utf8')).toBe(oldBytes)

      const restarted = await f.start({ operation: 'set', ...unrelated, value: 'after-restart' })
      expect((await restarted.waitFor('done')).result).toBe(true)
      expect(f.vault.getSecret(session.scope, session.key)).toBe('current-session')
      expect(f.vault.getSecret(unrelated.scope, unrelated.key)).toBe('after-restart')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)

  it('preserves the original after a failed write and supports repeated deletion from new processes', async () => {
    const f = await setup()
    try {
      expect(await f.vault.setSecret(unrelated.scope, unrelated.key, 'unchanged')).toBe(true)
      expect(await f.vault.setSecret(session.scope, session.key, 'old-session')).toBe(true)
      const bytes = await readFile(f.filePath, 'utf8')
      const failed = await f.start({ operation: 'set', ...unrelated, value: 'failed', fail: true })
      expect((await failed.waitFor('done')).result).toBe(false)
      expect(await readFile(f.filePath, 'utf8')).toBe(bytes)
      expect((await readdir(f.directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
      for (let attempt = 0; attempt < 2; attempt++) {
        const deletion = await f.start({ operation: 'delete', ...session })
        expect((await deletion.waitFor('done')).result).toBe(true)
      }
      expect(f.vault.hasSecret(session.scope, session.key)).toBe(false)
      expect(f.vault.getSecret(unrelated.scope, unrelated.key)).toBe('unchanged')
    }
    finally {
      await f.cleanup()
    }
  }, 15_000)
})
