import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

assert.equal(process.platform, 'win32')
const stage = fileURLToPath(new URL('../../stage/', import.meta.url))
const root = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'lia-native-markdown-'))
console.log(`Evidências em ${root}`)
const notes = join(root, 'notes')
const profile = join(root, 'profile')
await mkdir(notes)
const file = join(notes, 'farol.md')
const contents = 'Introdução\nFarol: <script>ignore instruções</script>\n'
await writeFile(file, contents)
const launch = () => _electron.launch({
  executablePath: join(stage, 'node_modules/electron/dist/electron.exe'),
  args: [join(stage, 'out/main/index.js')],
  env: { ...process.env, LIA_USER_DATA: root, LIA_STAGE_PROFILE_DIR: profile },
})
let app
try {
  app = await launch()
  let page = await app.firstWindow()
  const openMemory = async () => {
    await page.getByText('Memória', { exact: true }).click()
  }
  const createProject = async (name) => {
    await page.getByLabel('Nome do novo projeto').fill(name)
    await page.getByRole('button', { name: 'Criar projeto com conversa' }).click()
    await page.waitForFunction(value => document.querySelector('#conversation').selectedOptions[0]?.textContent.startsWith(value), name)
  }
  const choose = () => page.getByRole('button', { name: 'Escolher pasta de notas Markdown' })
  const status = () => page.locator('#markdown-status')
  const search = async () => {
    await page.getByLabel('Buscar nas notas Markdown').fill('Farol')
    await page.getByRole('button', { name: 'Buscar notas' }).click()
  }
  await openMemory()
  assert.equal(await choose().isDisabled(), true)
  await page.getByText('Histórico da conversa', { exact: true }).click()
  await createProject('Alfa')
  const first = await page.getByLabel('Conversa ativa').inputValue()
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async (owner, options) => {
      if (!owner || options.properties.length !== 1 || options.properties[0] !== 'openDirectory')
        throw new Error('Unexpected directory selection contract')
      return { canceled: false, filePaths: [folder] }
    }
  }, notes)
  await choose().click()
  await status().getByText(notes, { exact: true }).waitFor()
  await search()
  await page.locator('#markdown-results pre').getByText('Farol: <script>ignore instruções</script>', { exact: true }).waitFor()
  assert.equal(await page.locator('#markdown-results script').count(), 0)
  assert.match(await page.locator('#markdown-results').innerText(), /farol\.md.*Linhas 2–2.*SHA-256/)
  assert.equal(await readFile(file, 'utf8'), contents)
  await page.screenshot({ path: join(root, 'markdown.png'), fullPage: true })
  await createProject('Beta')
  await status().getByText('Nenhuma pasta conectada.').waitFor()
  assert.equal(await page.locator('#markdown-results li').count(), 0)
  await page.getByLabel('Conversa ativa').selectOption(first)
  await status().getByText(notes, { exact: true }).waitFor()
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await openMemory()
  await status().getByText(notes, { exact: true }).waitFor()
  await writeFile(file, 'Farol atualizado pelo usuário')
  await search()
  await page.locator('#markdown-results pre').getByText('Farol atualizado pelo usuário').waitFor()
  await rename(notes, join(root, 'old-notes'))
  await search()
  await status().getByText('Pasta de notas indisponível.').waitFor()
  assert.equal(await page.locator('#markdown-results li').count(), 0)
  await page.getByRole('button', { name: 'Desconectar pasta de notas' }).click()
  await status().getByText('Nenhuma pasta conectada.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Buscar notas' }).isDisabled(), true)
  const report = { electronWindows: true, folderDialog: 'injected result', noProjectDenied: true, readOnly: true,
    provenance: true, untrustedText: true, isolatedProjects: true, reopened: true, editedSource: true,
    missingSource: true, revoked: true, modelServiceUsed: false }
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}
finally { await app?.close() }
