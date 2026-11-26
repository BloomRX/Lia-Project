import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const consumer = 'lia-project'
export const fixtureSkill = '---\nname: fixture\ndescription: Skill estrutural de ensaio\n---\n\n# Ensaio\n'

function invoke(cli, home, command, payload) {
  const child = spawnSync(cli, ['--home', home, 'execution', ...command], {
    input: payload === undefined ? '' : JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 512 * 1024,
    shell: false,
    windowsHide: true,
  })
  assert.ok(!child.error && !child.signal && !child.stderr, 'Falha local na invocação da CLI.')
  let envelope
  try { envelope = JSON.parse(child.stdout) }
  catch { assert.fail('A CLI não devolveu um envelope JSON.') }
  assert.ok(envelope?.schemaVersion === 1 && typeof envelope.ok === 'boolean', 'Envelope incompatível.')
  assert.equal(child.status, envelope.ok ? 0 : 1)
  return envelope
}

function successful(envelope) {
  assert.ok(envelope.ok, 'A CLI recusou uma chamada esperada.')
  return envelope.result
}

function rejected(envelope, code) {
  assert.ok(!envelope.ok && envelope.error?.code === code, `Esperada recusa ${code}.`)
}

export function createHubSkillFixture(cli, home) {
  assert.ok(isAbsolute(cli) && isAbsolute(home))
  const operatorToken = successful(invoke(cli, home, ['init'])).operatorToken
  const authority = { operatorToken }
  const token = successful(invoke(cli, home, ['provision', consumer], authority)).token
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(token), 'Credencial de consumidor inválida.')
  return {
    cli,
    home,
    token,
    grant: ttl => successful(invoke(cli, home, ['grant', consumer, '--ttl', String(ttl)], authority)),
    call: (action, fields = {}) => invoke(cli, home, ['call'], { schemaVersion: 1, token, action, ...fields }),
    verifyOperatorAuthority() {
      rejected(invoke(cli, home, ['grant', consumer, '--ttl', '60'], { operatorToken: token }), 'unauthorized')
    },
  }
}

function submit(grant, text = fixtureSkill) {
  return { requestId: randomUUID(), grantId: grant.grantId, capability: 'skill.validate', context: { text } }
}

async function main() {
  assert.equal(process.platform, 'win32')
  assert.equal(process.argv.length, 3, 'Uso: node check-hub-skill-cli.mjs CAMINHO_PARA_CLI')
  const cli = resolve(process.argv[2])
  const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-hub-skill-cli-'))
  const fixture = createHubSkillFixture(cli, root)
  const { call, grant, token } = fixture
  fixture.verifyOperatorAuthority()
  rejected(call('discover', { token: 'x'.repeat(43) }), 'unauthorized')

  const discovery = successful(call('discover'))
  assert.deepEqual(discovery.capabilities, [{
    id: 'skill.validate', revision: 1, contextMaxBytes: 65536,
    permission: 'skill.validate', grantRequired: true,
  }])

  const allowed = grant(300)
  const data = submit(allowed)
  const first = successful(call('submit', data))
  assert.equal(first.state, 'queued')
  const { taskId } = first
  assert.equal(successful(call('submit', data)).taskId, taskId)
  rejected(call('submit', { ...data, context: { text: 'Texto diferente.' } }), 'conflict')
  rejected(call('submit', { ...data, requestId: randomUUID() }), 'forbidden')
  const completed = successful(call('start', { taskId }))
  assert.equal(completed.state, 'completed')
  const { counts } = completed.result
  assert.deepEqual(Object.keys(counts).sort(), ['error', 'info', 'review', 'warning'])
  assert.ok(Object.values(counts).every(count => Number.isSafeInteger(count) && count >= 0))
  assert.deepEqual(successful(call('status', { taskId })), completed)
  assert.deepEqual(successful(call('start', { taskId })), completed)
  assert.deepEqual(successful(call('cancel', { taskId })), completed)
  const audit = successful(call('audit', { taskId }))
  assert.deepEqual(audit, successful(call('events', { taskId })))
  assert.deepEqual(audit.events.map(event => event.state), ['queued', 'running', 'completed'])
  const serializedAudit = JSON.stringify(audit)
  assert.ok(!serializedAudit.includes(token) && !serializedAudit.includes(allowed.grantId)
    && !serializedAudit.includes('Skill estrutural de ensaio'), 'Material privado na auditoria.')

  const cancelled = successful(call('submit', submit(grant(300))))
  assert.equal(successful(call('cancel', { taskId: cancelled.taskId })).state, 'cancelled')
  assert.equal(successful(call('start', { taskId: cancelled.taskId })).state, 'cancelled')
  assert.deepEqual(successful(call('audit', { taskId: cancelled.taskId })).events.map(event => event.state), ['queued', 'cancelled'])

  const expiring = grant(10)
  const expiringTask = successful(call('submit', submit(expiring)))
  assert.equal(expiringTask.state, 'queued')
  await delay(Math.max(0, expiring.expiresAt * 1000 - Date.now()) + 250)
  const expired = successful(call('start', { taskId: expiringTask.taskId }))
  assert.equal(expired.state, 'failed')
  assert.equal(expired.error.code, 'grant-expired')
  rejected(call('submit', submit(expiring)), 'forbidden')

  const blocked = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-hub-unavailable-'))
  await writeFile(join(blocked, 'SupervisedExecution'), '', { flag: 'wx' })
  rejected(invoke(cli, blocked, ['call'], { schemaVersion: 1, token, action: 'discover' }), 'unavailable')
  const report = {
    provider: 'real Windows Hub CLI',
    executableSha256: createHash('sha256').update(await readFile(cli)).digest('hex'),
    authorization: { operatorOnly: true, wrongConsumerTokenRejected: true, grantOneUse: true, grantExpiry: true },
    idempotency: { sameTask: true, changedTextConflict: true, terminalStartAndCancelPreserved: true },
    audit: { orderedTransitions: true, noPrivateMaterial: true },
    cancelledBeforeStart: true,
    unavailableStorage: true,
    counts,
  }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ ...report, evidence: join(root, 'report.json') }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
