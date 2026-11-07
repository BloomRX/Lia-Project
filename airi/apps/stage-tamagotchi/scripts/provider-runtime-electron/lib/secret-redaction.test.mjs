import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { assertNoSecrets, createSecretRegistry, REDACTED, redactionSummary, writeArtifact } from './secret-redaction.mjs'

/**
 * Secret protection in gate artifacts.
 *
 * The case that motivates all of this is not a happy path: the gate writes its
 * artifacts from a `finally` block, so the log is written **because** something
 * failed. A redaction that only covers the success path protects the one case
 * nobody reads.
 *
 * The fixtures below mirror the shape the gate mints (`synthetic-<id>-<uuid>`)
 * but use fixed values, so a failure here can be read without a UUID in it.
 */

const GENERIC = 'synthetic-A-11111111-1111-1111-1111-111111111111'
const LOCAL = 'synthetic-B-22222222-2222-2222-2222-222222222222'
const CURATED = ['openai', 'groq', 'cerebras-ai', 'anthropic', 'xai', 'mistral-ai', 'openrouter-ai']
const perProvider = Object.fromEntries(
  CURATED.map((id, index) => [id, `synthetic-${id}-3333333${index}-3333-3333-3333-33333333333${index}`]),
)

const allSecrets = [GENERIC, LOCAL, ...Object.values(perProvider)]

function registry() {
  return createSecretRegistry(allSecrets)
}

/** A memory filesystem that records exactly what would have hit the disk. */
function memoryFs() {
  const written = new Map()
  return {
    written,
    join: (directory, name) => `${directory}/${name}`,
    writeFile: async (path, content) => {
      written.set(path, content)
    },
  }
}

describe('createSecretRegistry — one collection, no exceptions', () => {
  it('registers every value, not a hand-picked two', () => {
    assert.equal(registry().size, allSecrets.length)
  })

  it('accepts an object, which is how the gate stores them', () => {
    const object = { generic: GENERIC, local: LOCAL, ...perProvider }
    assert.equal(createSecretRegistry(object).size, allSecrets.length)
  })

  it('ignores empty and non-string entries instead of registering a landmine', () => {
    const mixed = createSecretRegistry([GENERIC, '', undefined, null, 42])
    assert.equal(mixed.size, 1)
  })

  it('refuses a shape it cannot enumerate', () => {
    assert.throws(() => createSecretRegistry('a-string'), /array or an object/)
    assert.throws(() => createSecretRegistry(null), /array or an object/)
  })

  it('orders longest first, so a prefix value cannot shred a longer one', () => {
    const short = 'synthetic-prefix'
    const long = 'synthetic-prefix-and-more'
    const ordered = createSecretRegistry([short, long]).values
    assert.equal(ordered[0], long)
  })
})

describe('redact — every registered value, every path', () => {
  it('replaces the generic and the local value', () => {
    const redacted = registry().redact(`${GENERIC} ${LOCAL}`)
    assert.equal(redacted, `${REDACTED} ${REDACTED}`)
  })

  it('replaces each per-provider value, which the old two-substitution code left in clear text', () => {
    const text = Object.entries(perProvider).map(([id, value]) => `${id}=${value}`).join('\n')
    const redacted = registry().redact(text)
    for (const value of Object.values(perProvider))
      assert.ok(!redacted.includes(value), 'a per-provider key survived redaction')
    assert.equal(redacted.match(/\[REDACTED\]/g).length, CURATED.length)
  })

  it('redacts inside a JSON document without breaking it', () => {
    const payload = JSON.stringify({ error: `provider rejected ${perProvider.openai}` })
    const redacted = registry().redact(payload)
    assert.ok(!redacted.includes(perProvider.openai))
    assert.doesNotThrow(() => JSON.parse(redacted))
    assert.equal(JSON.parse(redacted).error, `provider rejected ${REDACTED}`)
  })

  it('redacts inside an Error message, which is where a fixture echoes a key', () => {
    const error = new Error(`upstream said: ${perProvider.anthropic}`)
    assert.ok(!registry().redact(error.message).includes(perProvider.anthropic))
  })

  it('collapses a synthetic-shaped value that was never registered', () => {
    // Defence in depth: an id added to the gate without registering its secret
    // still gets caught by the shape rule.
    const stray = 'synthetic-newprovider-abc123def456'
    assert.equal(registry().redact(`x ${stray} y`), `x ${REDACTED} y`)
  })

  it('leaves ordinary text untouched', () => {
    const text = 'provider=openai scope=openai hasApiKey=true'
    assert.equal(registry().redact(text), text)
  })

  it('passes undefined and null through, so an optional field needs no branch', () => {
    assert.equal(registry().redact(undefined), undefined)
    assert.equal(registry().redact(null), null)
  })

  it('handles an object by serializing it first', () => {
    const redacted = registry().redact({ nested: { value: perProvider.groq } })
    assert.ok(!redacted.includes(perProvider.groq))
  })
})

describe('findLeaks and assertNoSecrets — the check that fails the gate', () => {
  it('finds a value anywhere in a payload', () => {
    assert.deepEqual(registry().findLeaks(`a ${LOCAL} b`), [LOCAL])
  })

  it('finds every value when several are present', () => {
    assert.equal(registry().findLeaks(allSecrets.join(' ')).length, allSecrets.length)
  })

  it('names leaks by index, never by value', () => {
    const description = registry().describeLeaks(`x ${GENERIC}`)
    assert.match(description, /registered secret value/)
    assert.ok(!description.includes(GENERIC))
  })

  it('throws with an index-only message', () => {
    assert.throws(
      () => assertNoSecrets(registry(), { leak: perProvider.xai }, 'report.json'),
      (error) => {
        assert.ok(!error.message.includes(perProvider.xai))
        assert.match(error.message, /report\.json would contain a credential/)
        return true
      },
    )
  })

  it('does not throw for a clean payload', () => {
    assert.doesNotThrow(() => assertNoSecrets(registry(), { providerId: 'openai', hasApiKey: true }, 'report.json'))
  })
})

describe('writeArtifact — the only door to the disk', () => {
  it('redacts before writing', async () => {
    const fs = memoryFs()
    await writeArtifact(fs, 'out', 'electron.log', `line ${perProvider.openai}`, registry())
    assert.ok(!fs.written.get('out/electron.log').includes(perProvider.openai))
  })

  it('reports whether it changed anything', async () => {
    const fs = memoryFs()
    const clean = await writeArtifact(fs, 'out', 'a.txt', 'nothing here', registry())
    const dirty = await writeArtifact(fs, 'out', 'b.txt', `x ${LOCAL}`, registry())
    assert.equal(clean.redacted, false)
    assert.equal(dirty.redacted, true)
  })

  it('refuses to write when redaction did not actually remove the value', async () => {
    // A registry that substitutes nothing while claiming to be a registry must
    // not reach the disk. This is why the writer re-checks its own output
    // instead of trusting that `redact()` did something.
    const fs = memoryFs()
    const broken = {
      ...registry(),
      redact: text => text,
    }
    await assert.rejects(
      () => writeArtifact(fs, 'out', 'electron.log', `oops ${GENERIC}`, broken),
      /would contain a credential/,
    )
    assert.equal(fs.written.size, 0, 'nothing may be written when the check fails')
  })

  it('accepts a structured payload and writes it as JSON', async () => {
    const fs = memoryFs()
    await writeArtifact(fs, 'out', 'report.json', { providerId: 'openai', hasApiKey: true }, registry())
    assert.deepEqual(JSON.parse(fs.written.get('out/report.json')), { providerId: 'openai', hasApiKey: true })
  })
})

describe('redactionSummary — what the report is allowed to say', () => {
  it('reports a count and never a value', () => {
    const summary = redactionSummary(registry())
    const text = JSON.stringify(summary)
    for (const value of allSecrets)
      assert.ok(!text.includes(value))
    assert.equal(summary.registeredSecrets, allSecrets.length)
  })
})
