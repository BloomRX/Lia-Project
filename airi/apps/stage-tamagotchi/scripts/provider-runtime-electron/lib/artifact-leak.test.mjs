import assert from 'node:assert/strict'

import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'

import { createSecretRegistry, writeArtifact } from './secret-redaction.mjs'

/**
 * End to end against a real filesystem: the mission's pass/fail criterion.
 *
 * The unit tests prove `redact()` and `writeArtifact()` behave. This file proves
 * the property the mission states outright — **no synthetic credential value may
 * appear in any artifact the gate produces** — by minting the same shape the gate
 * mints (one generic, one local, ten per-provider), deliberately failing after
 * they exist, writing the artifacts exactly where the gate would, and then
 * reading every byte back off the disk and searching for every value.
 *
 * The failure path is the point. The gate writes its artifacts from a `finally`,
 * so the log is produced *because* an assertion blew up; that is the only run
 * anyone will ever inspect, and it was the one the old two-substitution code
 * left unprotected.
 *
 * No Electron, no Windows, no network: the subject here is the writer, not the
 * gate's behaviour under Electron.
 */

const CURATED = ['openai', 'groq', 'cerebras-ai', 'anthropic', 'xai', 'mistral-ai', 'openrouter-ai', 'openai-compatible', 'lm-studio', 'ollama']
const KEYLESS = new Set(['lm-studio', 'ollama'])

/** The exact generator from `gate.test.mjs`, so the shapes match production. */
function mintGateSecrets() {
  const secrets = { generic: `synthetic-A-${randomUUID()}`, local: `synthetic-B-${randomUUID()}` }
  for (const id of CURATED) {
    if (!KEYLESS.has(id))
      secrets[id] = `synthetic-${id}-${randomUUID()}`
  }
  return secrets
}

const created = []

async function scratch() {
  const directory = await mkdtemp(join(tmpdir(), 'lia-artifact-leak-'))
  created.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(created.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

/**
 * Search every file in `directory` for every value in `secrets`.
 *
 * Returns the offending file names — never the values, so a failure message is
 * safe to paste into a report.
 */
async function scan(directory, secrets) {
  const entries = await readdir(directory)
  const offenders = []
  for (const entry of entries) {
    const text = await readFile(join(directory, entry), 'utf8')
    for (const value of Object.values(secrets)) {
      if (text.includes(value)) {
        offenders.push(entry)
        break
      }
    }
  }
  return offenders
}

/** Writes the two artifacts the gate writes, through the same door. */
async function writeLikeTheGate(directory, report, logs, registry) {
  await writeArtifact({ writeFile, join }, directory, 'report.json', report, registry)
  await writeArtifact({ writeFile, join }, directory, 'electron.log', logs, registry)
}

describe('artifact leak — a failing run must not leave a credential behind', () => {
  it('leaks nothing when the failure is an assertion after every key was minted', async () => {
    const secrets = mintGateSecrets()
    const registry = createSecretRegistry(secrets)
    const directory = await scratch()

    // What the gate would have accumulated by the time a mid-run assertion
    // failed: the fixture echoed a key in a 401 body, the transport surfaced it
    // in an error message, and the teardown logged it once more.
    const report = {
      runId: randomUUID(),
      result: 'FAIL in group 8',
      failure: {
        group: 8,
        name: 'AssertionError',
        message: `expected 401, got 200 for ${secrets.openai}`,
      },
      requests: [
        { path: '/openai/v1/chat/completions', authorization: 'present', authenticated: false },
      ],
    }
    const logs = [
      'AssertionError: provider rejected the sample',
      `  fixture body: {"error":{"message":"${secrets.anthropic}"}}`,
      `  teardown closed request for ${secrets.generic}`,
      `  local provider kept ${secrets.local}`,
      `  concurrency failure: ${secrets.cerebras} vs ${secrets.groq}`,
    ].join('\n')

    await writeLikeTheGate(directory, report, logs, registry)

    assert.deepEqual(await scan(directory, secrets), [], 'an artifact still carried a credential')
  })

  it('leaks nothing when the failure happens during teardown, after both files exist', async () => {
    const secrets = mintGateSecrets()
    const registry = createSecretRegistry(secrets)
    const directory = await scratch()

    // Teardown runs after the interesting work; the keys are all still in scope.
    const report = { runId: randomUUID(), result: 'FAIL cleanup', cleanupError: 'Electron application.close failed' }
    const logs = `cleanup failed while holding ${secrets.mistral} and ${secrets.xai}`

    await writeLikeTheGate(directory, report, logs, registry)

    // A second write, as a retried teardown would do.
    await writeLikeTheGate(directory, { ...report, retry: true }, `${logs}\nretry ${secrets.openrouter}`, registry)

    assert.deepEqual(await scan(directory, secrets), [])
  })

  it('covers every one of the ten providers, not just the two old substitutions', async () => {
    const secrets = mintGateSecrets()
    const registry = createSecretRegistry(secrets)
    const directory = await scratch()

    // One line per credential-bearing provider, as a fixture log would show them.
    const logs = CURATED
      .filter(id => !KEYLESS.has(id))
      .map(id => `provider=${id} authorization=Bearer ${secrets[id]}`)
      .join('\n')

    await writeLikeTheGate(directory, { runId: randomUUID() }, logs, registry)

    // Eight values (ten providers minus the two keyless local ones) must be gone.
    const written = await readFile(join(directory, 'electron.log'), 'utf8')
    assert.equal((written.match(/\[REDACTED\]/g) ?? []).length, CURATED.length - KEYLESS.size)
    assert.deepEqual(await scan(directory, secrets), [])
  })

  it('keeps the diagnostic value of the log while removing the secret', async () => {
    // Redaction must not be achieved by throwing the log away: a reviewer still
    // needs provider, scope, presence and outcome.
    const secrets = mintGateSecrets()
    const registry = createSecretRegistry(secrets)
    const directory = await scratch()

    await writeLikeTheGate(
      directory,
      { runId: randomUUID() },
      `provider=openai scope=openai hasApiKey=true outcome=http-401 authorization=Bearer ${secrets.openai}`,
      registry,
    )

    const written = await readFile(join(directory, 'electron.log'), 'utf8')
    assert.match(written, /provider=openai/)
    assert.match(written, /scope=openai/)
    assert.match(written, /hasApiKey=true/)
    assert.match(written, /outcome=http-401/)
    assert.match(written, /\[REDACTED\]/)
  })

  it('leaks nothing into a report that embeds a whole request list', async () => {
    const secrets = mintGateSecrets()
    const registry = createSecretRegistry(secrets)
    const directory = await scratch()

    const report = {
      runId: randomUUID(),
      requests: CURATED.map(id => ({ path: `/${id}/v1/chat/completions`, authorization: 'present', note: `fixture expected ${secrets[id] ?? 'none'}` })),
      finalProcessCheck: { alive: [], gone: 3, unknown: [] },
    }

    await writeLikeTheGate(directory, report, '', registry)

    assert.deepEqual(await scan(directory, secrets), [])
    // And the report is still valid JSON a reviewer can open.
    const parsed = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))
    assert.equal(parsed.requests.length, CURATED.length)
  })

  it('refuses to write at all when redaction leaves a value intact', async () => {
    // The worst case is not a leak; it is a leak nobody noticed. When the writer
    // cannot prove the payload is clean, it must not create the file.
    const secrets = mintGateSecrets()
    const registry = createSecretRegistry(secrets)
    const directory = await scratch()

    const broken = { ...registry, redact: text => text }
    // The report is written first and is clean, so it lands. The log is the file
    // that would carry the value, and it must not be created at all.
    await assert.rejects(
      () => writeArtifact({ writeFile, join }, directory, 'electron.log', `still here: ${secrets.groq}`, broken),
      /would contain a credential/,
    )
    assert.deepEqual(await readdir(directory), [], 'a refused write must create no file')
    await assert.rejects(
      () => writeLikeTheGate(directory, { runId: 'x' }, `still here: ${secrets.groq}`, broken),
      /would contain a credential/,
    )
    const survivors = await readdir(directory)
    assert.deepEqual(survivors, ['report.json'], 'only the clean report may survive a refused log write')
    assert.deepEqual(await scan(directory, secrets), [])
  })
})
