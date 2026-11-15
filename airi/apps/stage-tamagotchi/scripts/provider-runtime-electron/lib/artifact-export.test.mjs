import assert from 'node:assert/strict'

import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import {
  buildManifest,
  describeEnvironment,
  isEnvironmentConclusive,
  selectRunFolder,
  sha256,
  verifyManifest,
} from './artifact-export.mjs'

/**
 * Artifact preservation.
 *
 * The failure being fixed is not a bug in the gate's assertions — it is that the
 * evidence died with the workspace. So the properties that matter are: a copy
 * survives outside, it can be proved unmodified afterwards, and it says which
 * PowerShell produced it. A folder named after a timestamp proves none of that.
 */

const buffer = text => Buffer.from(text, 'utf8')

describe('sha256 — the value the manifest publishes', () => {
  it('matches a digest produced by an independent implementation', () => {
    // `printf abc | sha256sum` — the NIST vector. Pinned so a broken hasher
    // cannot make every package verify against itself.
    assert.equal(sha256(buffer('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('produces 64 lowercase hex characters', () => {
    assert.match(sha256(buffer('anything')), /^[0-9a-f]{64}$/)
  })

  it('changes when a single byte changes', () => {
    assert.notEqual(sha256(buffer('a')), sha256(buffer('b')))
  })
})

describe('buildManifest — identity a reader can check', () => {
  const files = [
    { name: 'report.json', buffer: buffer('{"result":"PASS"}') },
    { name: 'electron.log', buffer: buffer('log') },
  ]

  const manifest = buildManifest({
    runId: 'run-abc',
    environment: describeEnvironment({ powershell: { version: '5.1.19041.1', edition: 'Desktop', major: 5 }, windows: { version: '10.0.19045' }, node: 'v22.22.3', electron: '43.4.1', pnpm: '11.24.0' }),
    git: { branch: 'arena/01a10290-lia-project', commit: '91f0e99' },
    startedAt: '2026-11-06T03:22:58.941Z',
    finishedAt: '2026-11-06T03:24:06.469Z',
    result: 'PASS Electron components with local HTTP fixture',
    groups: { total: 16, passed: 16, failed: 0 },
    files,
  })

  it('carries the run identity, the commit and the timestamps', () => {
    assert.equal(manifest.runId, 'run-abc')
    assert.equal(manifest.git.commit, '91f0e99')
    assert.equal(manifest.startedAt, '2026-11-06T03:22:58.941Z')
  })

  it('records a size and a hash for every file', () => {
    assert.equal(manifest.files.length, 2)
    for (const entry of manifest.files) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/)
      assert.equal(typeof entry.bytes, 'number')
    }
  })

  it('sorts the file list, so two manifests diff cleanly', () => {
    assert.deepEqual(manifest.files.map(entry => entry.name), ['electron.log', 'report.json'])
  })

  it('states how to verify it, in the artifact itself', () => {
    assert.match(manifest.verification, /createHash/)
  })

  it('holds no credential-shaped value', () => {
    const text = JSON.stringify(manifest)
    assert.ok(!text.includes('synthetic-'))
  })
})

describe('verifyManifest — a tampered package must not verify', () => {
  const files = [
    { name: 'report.json', buffer: buffer('original') },
    { name: 'electron.log', buffer: buffer('log line') },
  ]
  const manifest = buildManifest({
    runId: 'r',
    environment: {},
    git: {},
    startedAt: 'a',
    finishedAt: 'b',
    result: 'PASS',
    groups: {},
    files,
  })

  it('accepts an intact copy', () => {
    assert.deepEqual(verifyManifest(manifest, files).map(entry => entry.status), ['ok', 'ok'])
  })

  it('reports a modified file of the same size as a hash mismatch', () => {
    // Same byte count on purpose: a size check alone would wave this through,
    // and only the hash catches it.
    const tampered = [{ name: 'report.json', buffer: buffer('originaX') }, files[1]]
    const verdicts = verifyManifest(manifest, tampered)
    assert.equal(verdicts.find(entry => entry.name === 'report.json').status, 'hash-mismatch')
  })

  it('reports a missing file', () => {
    const verdicts = verifyManifest(manifest, [files[0]])
    assert.equal(verdicts.find(entry => entry.name === 'electron.log').status, 'missing')
  })

  it('reports a size mismatch before hashing', () => {
    const truncated = [{ name: 'report.json', buffer: buffer('orig') }, files[1]]
    const verdicts = verifyManifest(manifest, truncated)
    assert.equal(verdicts.find(entry => entry.name === 'report.json').status, 'size-mismatch')
  })
})

describe('describeEnvironment — unknown is a value, an empty string is not', () => {
  it('records the PowerShell version and edition that answer "5.1 or 7?"', () => {
    const environment = describeEnvironment({
      powershell: { version: '7.4.6', edition: 'Core', major: 7, host: 'pwsh' },
      windows: { version: '10.0.19045', build: '19045', caption: 'Windows 10 Pro', arch: 'x64' },
      node: 'v22.22.3',
      electron: '43.4.1',
      pnpm: '11.24.0',
    })
    assert.equal(environment.powershell.major, 7)
    assert.equal(environment.powershell.edition, 'Core')
    assert.equal(environment.windows.build, '19045')
  })

  it('writes unknown when a value could not be read, instead of inventing one', () => {
    const environment = describeEnvironment({})
    assert.equal(environment.powershell.version, 'unknown')
    assert.equal(environment.node, 'unknown')
    assert.equal(environment.electron, 'unknown')
  })

  it('treats whitespace as absent', () => {
    assert.equal(describeEnvironment({ node: '   ' }).node, 'unknown')
  })
})

describe('isEnvironmentConclusive — the check that refuses a nameless run', () => {
  it('accepts a real PowerShell version', () => {
    assert.equal(isEnvironmentConclusive(describeEnvironment({ powershell: { version: '5.1.19041.1' } })), true)
    assert.equal(isEnvironmentConclusive(describeEnvironment({ powershell: { version: '7.4.6' } })), true)
  })

  it('rejects a missing or unknown version', () => {
    assert.equal(isEnvironmentConclusive(describeEnvironment({})), false)
    assert.equal(isEnvironmentConclusive({ powershell: {} }), false)
    assert.equal(isEnvironmentConclusive(undefined), false)
  })
})

describe('selectRunFolder — this run, not last week’s', () => {
  const RUN = 1_700_000_000_000
  const minute = 60_000

  it('ignores a folder from a previous run', () => {
    const { folder } = selectRunFolder({
      folders: [
        { name: 'last-week', createdAtMs: RUN - 7 * 24 * 60 * minute },
        { name: 'yesterday', createdAtMs: RUN - 24 * 60 * minute },
      ],
      runStartedAt: RUN,
    })
    assert.equal(folder, undefined)
  })

  it('accepts a folder created just before the clock stamp', () => {
    // The gate names its folder from `Date.now()` and the runner records its own
    // start a moment later, so the folder can legitimately be seconds older.
    const { folder } = selectRunFolder({
      folders: [{ name: 'this-run', createdAtMs: RUN - 5_000 }],
      runStartedAt: RUN,
    })
    assert.equal(folder.name, 'this-run')
  })

  it('prefers the newest when several qualify', () => {
    const { folder } = selectRunFolder({
      folders: [
        { name: 'first', createdAtMs: RUN + 100 },
        { name: 'second', createdAtMs: RUN + 500 },
      ],
      runStartedAt: RUN,
    })
    assert.equal(folder.name, 'second')
  })

  it('rejects a folder older than the tolerance even if it is the newest', () => {
    const { folder } = selectRunFolder({
      folders: [{ name: 'stale', createdAtMs: RUN - 2 * minute }],
      runStartedAt: RUN,
    })
    assert.equal(folder, undefined)
  })

  it('explains itself when nothing qualifies', () => {
    const { reason } = selectRunFolder({ folders: [], runStartedAt: RUN })
    assert.match(reason, /no artifact folder/)
  })

  it('ignores an entry with no usable timestamp rather than guessing', () => {
    const { folder } = selectRunFolder({
      folders: [{ name: 'broken', createdAtMs: Number.NaN }],
      runStartedAt: RUN,
    })
    assert.equal(folder, undefined)
  })
})
