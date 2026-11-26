import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

import { createHubSkillFixture, fixtureSkill } from './check-hub-skill-cli.mjs'

assert.equal(process.platform, 'win32')
assert.equal(process.argv.length, 3, 'Informe o caminho da CLI do Hub.')
const cli = resolve(process.argv[2])
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-hub-skill-'))
console.log(`Evidências em ${root}`)
const hubHome = join(root, 'hub')
await mkdir(hubHome)
const fixture = createHubSkillFixture(cli, hubHome)
const sentinel = 'TEXTO NAO SELECIONADO NAO DEVE SER ENVIADO'

async function inStage(grant, test, binary = cli) {
  const profile = await mkdtemp(join(root, 'profile-'))
  const app = await _electron.launch({
    executablePath: join(stage, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [join(stage, 'out', 'main', 'index.js')],
    env: {
      ...process.env, LIA_USER_DATA: profile, LIA_STAGE_PROFILE_DIR: profile,
      LIA_AGENTHUB_CLI: binary, LIA_AGENTHUB_EXECUTION_HOME: hubHome,
      LIA_AGENTHUB_CONSUMER_TOKEN: fixture.token, LIA_AGENTHUB_GRANT_ID: grant.grantId,
    },
  })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(10_000)
    await page.getByText('Lia Agent Hub', { exact: true }).click()
    const input = page.getByLabel('Texto da Skill', { exact: true })
    await input.fill(fixtureSkill + sentinel)
    const select = () => input.evaluate((field, length) => field.setSelectionRange(0, length), fixtureSkill.length)
    const validate = page.getByRole('button', { name: 'Validar esta Skill com o Hub' })
    const state = page.locator('#hub-skill-status')
    const confirm = response => app.evaluate(({ dialog }, choice) => {
      dialog.showMessageBox = async (owner, options) => {
        assertOwned(owner, options)
        return { response: choice }
      }
      function assertOwned(owner, options) {
        if (!owner || options.defaultId !== 0 || options.cancelId !== 0 || options.buttons[1] !== 'Validar')
          throw new Error('Diálogo de validação incompatível.')
      }
    }, response)
    await test({ page, app, select, validate, state, confirm })
    const projection = await page.evaluate(async () => ({
      state: await window.liaStageHub.skillStatus(),
      audit: await window.liaStageHub.skillAudit(),
      rendered: document.body.innerText,
    }))
    const output = JSON.stringify(projection)
    assert.ok(!output.includes(fixture.token) && !output.includes(grant.grantId) && !output.includes(sentinel))
  }
  finally { await app.close() }
}

await inStage(fixture.grant(300), async ({ page, select, validate, state, confirm }) => {
  await page.getByLabel('Texto da Skill', { exact: true }).evaluate((field) => field.setSelectionRange(0, 0))
  await validate.click()
  await state.getByText('Selecione o texto da Skill antes de validar.').waitFor()
  await confirm(0)
  await select()
  await validate.click()
  await state.getByText('Validação cancelada.', { exact: true }).waitFor()
  await confirm(1)
  await select()
  await validate.click()
  await state.getByText(/Validação estrutural concluída.*Erros: 0.*Avisos: 0.*Informações: 0.*Revisões: 0/).waitFor()
  await page.getByRole('button', { name: 'Ver auditoria' }).click()
  await page.locator('#hub-skill-events li').nth(2).waitFor()
  const rows = await page.locator('#hub-skill-events li').allTextContents()
  assert.match(rows[0], /na fila/)
  assert.match(rows[1], /em andamento/)
  assert.match(rows[2], /concluída/)
  await page.screenshot({ path: join(root, 'hub-skill.png'), fullPage: true })
})
await inStage(fixture.grant(300), async ({ page, confirm }) => {
  await confirm(1)
  const result = await page.evaluate(async text => {
    const api = window.liaStageHub
    const queued = await api.validateSkill(text)
    await api.cancelSkill()
    const restarted = await api.startSkill()
    const repeated = await api.startSkill()
    const audit = await api.skillAudit()
    return { queued, restarted, repeated, audit }
  }, fixtureSkill)
  assert.equal(result.queued.value?.state, 'queued')
  assert.equal(result.restarted.value?.state, 'cancelled')
  assert.deepEqual(result.repeated, result.restarted)
  assert.deepEqual(result.audit.value?.map(event => event.state), ['queued', 'cancelled'])
})
const denied = async ({ select, validate, state, confirm }) => {
  await confirm(1)
  await select()
  await validate.click()
  await state.getByText('Autorização do operador indisponível ou recusada.').waitFor()
}
const expired = fixture.grant(1)
await delay(Math.max(0, expired.expiresAt * 1000 - Date.now()) + 500)
await inStage(expired, denied)
const used = fixture.grant(300)
const queued = fixture.call('submit', {
  requestId: randomUUID(), grantId: used.grantId, capability: 'skill.validate', context: { text: fixtureSkill },
})
assert.ok(queued.ok && queued.result.state === 'queued')
assert.equal(fixture.call('cancel', { taskId: queued.result.taskId }).result?.state, 'cancelled')
await inStage(used, denied)
await inStage(fixture.grant(300), async ({ select, validate, state, confirm }) => {
  await confirm(1)
  await select()
  await validate.click()
  await state.getByText('O Hub está indisponível.', { exact: true }).waitFor()
}, join(root, 'missing-cli.exe'))
const report = { electronWindows: true, realCli: true, injectedConfirmation: true,
  explicitSelection: true, refusalThenSuccess: true, expiredDenied: true,
  reusedDenied: true, unavailable: true, counts: true, audit: true,
  queuedCancellation: true, terminalStartIdempotent: true,
  submitIdempotency: 'Exercised by the real CLI gate.' }
await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
