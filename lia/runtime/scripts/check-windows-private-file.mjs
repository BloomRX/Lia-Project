import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'

import { writePrivateWindowsFile } from '../src/secrets/windows-private-file.ts'

assert.equal(process.platform, 'win32')
const fixture = await mkdtemp(join(tmpdir(), 'lia-private-write-gate-'))
const sample = 'lia-synthetic-file-fixture'

async function measure(label, operation) {
  const start = performance.now()
  try {
    await operation()
    console.log(JSON.stringify({ label, ok: true, ms: Math.round(performance.now() - start) }))
    return true
  }
  catch {
    console.log(JSON.stringify({ label, ok: false, ms: Math.round(performance.now() - start) }))
    return false
  }
}

try {
  const control = await measure('filesystem', async () => {
    const path = join(fixture, 'control')
    await writeFile(path, sample, { flag: 'wx' })
    assert.equal(await readFile(path, 'utf8'), sample)
  })
  const namedPipe = await measure('named-pipe', async () => {
    const server = createServer()
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen({ path: `\\\\.\\pipe\\lia-private-file-gate-${randomUUID()}`, exclusive: true }, resolve)
    })
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  })
  const protectedWrite = await measure('private-windows-file', async () => {
    const path = join(fixture, 'protected')
    await writePrivateWindowsFile(path, sample)
    assert.equal(await readFile(path, 'utf8'), sample)
  })
  if (!control || !namedPipe || !protectedWrite)
    process.exitCode = 1
}
finally {
  await rm(fixture, { recursive: true, force: true })
}
