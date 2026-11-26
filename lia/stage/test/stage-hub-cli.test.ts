import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStageHubCli } from '../src/main/stage-hub-cli.ts'

const id = '1'.repeat(32)
const token = '2'.repeat(43)
const options = { executable: join(tmpdir(), 'lia-test-hub.exe'), home: tmpdir(), token }
const fixture = {
  taskId: id, requestId: 'request-1', capability: 'skill.validate', state: 'queued',
  progress: 0, result: null, error: null,
}
const result = (value: unknown) => ({ exitCode: 0, output: Buffer.from(JSON.stringify({ schemaVersion: 1, ok: true, result: value })) })

test('scopes submission to skill.validate and projects response to public fields only', async () => {
  const hub = createStageHubCli(options, async (executable, home, input) => {
    assert.equal(executable, options.executable)
    assert.equal(home, options.home)
    assert.deepEqual(JSON.parse(input.toString('utf8')), {
      schemaVersion: 1, token, action: 'submit', requestId: 'request-1', grantId: id,
      capability: 'skill.validate', context: { text: 'synthetic Skill' },
    })
    return result({ ...fixture, text: 'private', token })
  })
  assert.deepEqual(await hub.submit({ requestId: 'request-1', grantId: id, text: 'synthetic Skill' }), {
    ok: true, value: { taskId: id, state: 'queued', progress: 0, error: null, counts: null },
  })
})

test('refuses mismatched task identity, impossible states, invalid UTF-8 and oversized text', async () => {
  const badResponses = [
    result({ ...fixture, taskId: '3'.repeat(32) }),
    result({ ...fixture, state: 'queued', progress: 100 }),
    { exitCode: 0, output: Buffer.from([0x80]) },
  ]
  for (const response of badResponses) {
    const hub = createStageHubCli(options, async () => response)
    assert.deepEqual(await hub.start(id), { ok: false, code: 'unavailable' })
  }
  const hub = createStageHubCli(options, async () => assert.fail('Must not invoke the CLI'))
  assert.deepEqual(await hub.submit({ requestId: 'request-1', grantId: id, text: 'é'.repeat(32769) }), {
    ok: false, code: 'invalid-request',
  })
})

test('passes only recognized failure codes and projects ordered audit metadata', async () => {
  const event = { sequence: 1, state: 'queued', at: 100, code: null }
  const hub = createStageHubCli(options, async (_executable, _home, input) => {
    if (JSON.parse(input.toString('utf8')).action === 'audit')
      return result({ taskId: id, events: [{ ...event, token, text: 'private' }] })
    return {
      exitCode: 1,
      output: Buffer.from(JSON.stringify({ schemaVersion: 1, ok: false, error: { code: 'forbidden', message: token } })),
    }
  })
  assert.deepEqual(await hub.start(id), { ok: false, code: 'forbidden' })
  assert.deepEqual(await hub.audit(id), { ok: true, value: [event] })
})

test('handles an unavailable executable without returning internal diagnostics', async () => {
  const hub = createStageHubCli({ ...options, executable: join(tmpdir(), 'lia-hub-absent', 'agent.exe') })
  assert.deepEqual(await hub.discover(), { ok: false, code: 'unavailable' })
})
