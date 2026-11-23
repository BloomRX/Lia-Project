/* eslint-disable test/no-import-node-test, no-restricted-syntax -- Runs directly with node --test, without a TypeScript loader. */
import assert from 'node:assert/strict'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { nativeLauncherConfiguration, packagingInputs, validateInputs, validatePackagedStage } from './package-windows.mjs'

function file(path, contents = 'fixture') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

test('packaging requires an internal test, builds, the pinned local runtime and third-party notices', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'Lia packaging & spaces '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const inputs = packagingInputs(join(root, 'lia/desktop'))
  file(inputs.builder)
  for (const app of [inputs.launcher, inputs.stage]) {
    for (const name of ['out/main/index.js', 'out/renderer/index.html', 'package.json'])
      file(join(app, name))
  }
  file(join(inputs.launcher, 'out/preload/index.cjs'))
  file(join(inputs.stage, 'out/preload/index.cjs'))
  const notice = join(inputs.launcher, 'scripts/DISTRIBUTION-NOTICE.txt')
  file(notice)
  file(join(inputs.electron, '../package.json'), JSON.stringify({ version: '43.4.1' }))
  for (const name of ['electron.exe', 'icudtl.dat', 'LICENSE', 'LICENSES.chromium.html'])
    file(join(inputs.electron, name))
  assert.throws(() => validateInputs(inputs), /Distribuição pública bloqueada/)
  assert.doesNotThrow(() => validateInputs(inputs, { internalTest: true }))
  rmSync(notice)
  assert.throws(() => validateInputs(inputs, { internalTest: true }), /Aviso de distribuição interna/)
  file(notice)
  file(join(inputs.electron, '../package.json'), JSON.stringify({ version: '1.0.0' }))
  assert.throws(() => validateInputs(inputs, { internalTest: true }), /Runtime esperado/)
})

test('packaged stage rejects incomplete payloads and an inherited updater feed', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'Lia payload '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const runtime = join(root, 'official-runtime')
  file(join(runtime, 'LICENSE'))
  file(join(runtime, 'LICENSES.chromium.html'))
  assert.throws(() => validatePackagedStage(root, runtime), /Stage empacotado ausente/)
  for (const name of ['LiaStage.exe', 'resources/app.asar', 'icudtl.dat', 'LICENSE.electron.txt', 'LICENSES.chromium.html'])
    file(join(root, name))
  file(join(root, 'version'), '43.4.1')
  assert.doesNotThrow(() => validatePackagedStage(root, runtime))
  file(join(root, 'LICENSE.electron.txt'), 'changed-notice')
  assert.throws(() => validatePackagedStage(root, runtime), /Licença do runtime divergente/)
  file(join(root, 'LICENSE.electron.txt'))
  file(join(root, 'version'), '1.0.0')
  assert.throws(() => validatePackagedStage(root, runtime), /Versão do runtime empacotado/)
  file(join(root, 'version'), '43.4.1')
  file(join(root, 'resources/app-update.yml'), 'upstream-feed')
  assert.throws(() => validatePackagedStage(root, runtime), /canal de atualização não autorizado/)
})

test('default packaging requires no AIRI files and preserves the internal installer identity', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'Lia native packaging '))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const inputs = packagingInputs(join(root, 'lia/desktop'))
  assert.equal(inputs.stage, join(root, 'lia/stage'))
  file(inputs.builder)
  for (const app of [inputs.launcher, inputs.stage]) {
    for (const name of ['out/main/index.js', 'out/preload/index.cjs', 'out/renderer/index.html', 'package.json'])
      file(join(app, name))
  }
  file(join(inputs.launcher, 'scripts/DISTRIBUTION-NOTICE.txt'))
  file(join(inputs.electron, '../package.json'), JSON.stringify({ version: '43.4.1' }))
  for (const name of ['electron.exe', 'icudtl.dat', 'LICENSE', 'LICENSES.chromium.html'])
    file(join(inputs.electron, name))
  assert.throws(() => validateInputs(inputs), /Distribuição pública bloqueada/)
  assert.doesNotThrow(() => validateInputs(inputs, { internalTest: true }))
  const config = nativeLauncherConfiguration(inputs)
  assert.equal(config.appId, 'ai.lia.launcher.preview')
  assert.equal(config.extraMetadata.liaNativeStagePreview, true)
  assert.deepEqual(config.extraResources[0], { from: inputs.stageOutput, to: 'stage', filter: ['**/*'] })
  assert.equal(config.publish, null)
})
