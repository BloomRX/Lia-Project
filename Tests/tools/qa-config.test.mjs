import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'

import { activateRun, restoreRun } from './qa-config.mjs'
import { ACTIVE_MARKER, getInstallDir, readJsonSafe, resolveProductPaths } from './qa-shared.mjs'

let workRoot
let appData
let run1
let run2

function makeRun(id) {
  const runDir = nodePath.join(workRoot, 'runs', id)
  mkdirSync(nodePath.join(runDir, 'snapshots'), { recursive: true })
  return runDir
}

function env(extra = {}) {
  return { APPDATA: appData, ...extra }
}

const configFile = () => nodePath.join(appData, 'Lia', 'lia-product.json')

function writeConfig(value) {
  mkdirSync(nodePath.dirname(configFile()), { recursive: true })
  writeFileSync(configFile(), `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

beforeEach(() => {
  workRoot = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-config-'))
  appData = nodePath.join(workRoot, 'AppData-Roaming')
  mkdirSync(appData, { recursive: true })
  run1 = makeRun('20990101-000001')
  run2 = makeRun('20990101-000002')
})

after(() => {
  // Temp dirs only; the harness never cleans anything outside its own tmpdirs.
})

describe('qa-config: product-config resolution mirrors lia-core order', () => {
  it('LIA_USER_DATA wins over everything', () => {
    
    const paths = resolveProductPaths(env({ APP_USER_DATA_PATH: '/elsewhere', LIA_USER_DATA: nodePath.join(workRoot, 'explicit') }))
    assert.equal(paths.source, 'lia-user-data-env')
    assert.equal(paths.productConfigFile, nodePath.join(workRoot, 'explicit', 'lia-product.json'))
  })

  it('APP_USER_DATA_PATH wins over candidates', () => {
    const paths = resolveProductPaths(env({ APP_USER_DATA_PATH: nodePath.join(workRoot, 'shared') }))
    assert.equal(paths.source, 'app-user-data-env')
  })

  it('an existing candidate with lia-product.json wins over the default', () => {
    const legacy = nodePath.join(appData, '@proj-airi', 'stage-tamagotchi')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(nodePath.join(legacy, 'lia-product.json'), '{}', 'utf-8')
    const paths = resolveProductPaths(env())
    assert.equal(paths.source, 'existing-data-candidate')
    assert.equal(paths.userDataDir, legacy)
  })

  it('falls back to the product default when nothing exists yet', () => {
    const paths = resolveProductPaths(env())
    assert.equal(paths.source, 'product-default')
    assert.equal(paths.userDataDir, nodePath.join(appData, 'Lia'))
  })
})

describe('qa-config: activate backs up BEFORE mutating and touches only the runtime key', () => {
  it('existing config: byte-identical backup, single-key mutation, marker last', () => {
    const original = {
      persona: { activeCardId: 'card-1' },
      voice: { engine: { preferred: 'kokoro' }, runtime: {} },
    }
    writeConfig(original)
    const before = readFileSync(configFile(), 'utf-8')

    const facts = activateRun({ environment: env(), runDir: run1 })

    const backup = nodePath.join(run1, 'snapshots', 'lia-product.before.json')
    assert.equal(readFileSync(backup, 'utf-8'), before, 'backup must be byte-identical')
    assert.equal(facts.originalInstallDir, '(absent)')

    const mutated = readJsonSafe(configFile())
    assert.equal(getInstallDir(mutated), nodePath.join(run1, 'runtime'))
    assert.deepEqual(mutated.persona, original.persona, 'unrelated keys untouched')
    assert.deepEqual(mutated.voice.engine, original.voice.engine, 'voice selection untouched')

    assert.ok(existsSync(nodePath.join(run1, ACTIVE_MARKER)), 'ACTIVE marker written')
    const marker = readFileSync(nodePath.join(run1, ACTIVE_MARKER), 'utf-8')
    assert.ok(marker.includes(`configFile=${configFile()}`))
    assert.ok(marker.includes('originalInstallDir=(absent)'))
    assert.ok(existsSync(nodePath.join(run1, 'snapshots', 'restore-instructions.txt')))
  })

  it('no config file yet: creates one with only the runtime key', () => {
    const facts = activateRun({ environment: env(), runDir: run1 })
    assert.equal(facts.backupFile, undefined)
    const created = readJsonSafe(configFile())
    assert.equal(getInstallDir(created), nodePath.join(run1, 'runtime'))
    assert.equal(created.persona, undefined)
  })

  it('an existing installDir value is preserved as the restore target', () => {
    const customRoot = nodePath.join(workRoot, 'My Runtimes', 'Lia RT') // spaces on purpose
    writeConfig({ voice: { runtime: { installDir: customRoot } } })
    const facts = activateRun({ environment: env(), runDir: run1 })
    assert.equal(facts.originalInstallDir, customRoot)
  })
})

describe('qa-config: restore reverts EXACTLY the one key', () => {
  it('restore with no active run is a no-op', () => {
    assert.equal(restoreRun({ environment: env(), runsDir: nodePath.join(workRoot, 'runs') }), undefined)
  })

  it('original value (with spaces) comes back exactly; other QA-time changes are preserved', () => {
    const customRoot = nodePath.join(workRoot, 'My Runtimes', 'Lia RT')
    writeConfig({ voice: { engine: { preferred: 'kokoro' }, runtime: { installDir: customRoot } } })
    activateRun({ environment: env(), runDir: run1 })

    // During QA the user changes an UNRELATED setting through the product UI.
    const during = readJsonSafe(configFile())
    during.voice.engine.preferred = 'kokoro'
    during.persona = { activeCardId: 'changed-during-qa' }
    writeFileSync(configFile(), JSON.stringify(during, null, 2), 'utf-8')

    const facts = restoreRun({ environment: env(), runsDir: nodePath.join(workRoot, 'runs') })
    assert.equal(facts.restoredValue, customRoot)

    const restored = readJsonSafe(configFile())
    assert.equal(getInstallDir(restored), customRoot)
    assert.equal(restored.persona.activeCardId, 'changed-during-qa', 'unrelated QA-time change preserved')
    assert.ok(!existsSync(nodePath.join(run1, ACTIVE_MARKER)), 'marker removed after restore')
  })

  it('key that was absent gets removed on restore', () => {
    writeConfig({ persona: { activeCardId: 'card-1' } })
    activateRun({ environment: env(), runDir: run1 })
    restoreRun({ environment: env(), runsDir: nodePath.join(workRoot, 'runs') })
    const restored = readJsonSafe(configFile())
    assert.equal(getInstallDir(restored), undefined)
    assert.deepEqual(restored.persona, { activeCardId: 'card-1' })
  })

  it('two stacked runs restore in order: newest first, then the true original', () => {
    const originalRoot = nodePath.join(workRoot, 'orig root')
    writeConfig({ voice: { runtime: { installDir: originalRoot } } })

    activateRun({ environment: env(), runDir: run1 })
    activateRun({ environment: env(), runDir: run2 })

    const runsDir = nodePath.join(workRoot, 'runs')
    const first = restoreRun({ environment: env(), runsDir })
    assert.equal(first.runId, '20990101-000002', 'newest active run restores first')
    assert.equal(getInstallDir(readJsonSafe(configFile())), nodePath.join(run1, 'runtime'))

    const second = restoreRun({ environment: env(), runsDir })
    assert.equal(second.runId, '20990101-000001')
    assert.equal(getInstallDir(readJsonSafe(configFile())), originalRoot)

    assert.equal(restoreRun({ environment: env(), runsDir }), undefined, 'nothing left to restore')
  })
})
