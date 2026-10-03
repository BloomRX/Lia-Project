import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { beforeEach, describe, it } from 'node:test'

import {
  buildInventoryReport,
  deleteAllManagedRuns,
  deleteManagedRun,
  inventoryCandidates,
  listManagedRuns,
  pruneRunLogs,
  retentionPlan,
} from './qa-storage.mjs'
import { ACTIVE_MARKER, MANAGED_ROOTS, isInsideManagedRoot } from './qa-shared.mjs'

let workRoot
let runsDir

function makeRun(id, { active = false, files = 1 } = {}) {
  const runDir = nodePath.join(runsDir, id)
  for (const sub of ['logs', 'metrics', 'snapshots', nodePath.join('artifacts', 'smoke')])
    mkdirSync(nodePath.join(runDir, sub), { recursive: true })
  for (let index = 0; index < files; index++)
    writeFileSync(nodePath.join(runDir, 'logs', `f${index}.log`), 'x'.repeat(10), 'utf-8')
  writeFileSync(nodePath.join(runDir, 'artifacts', 'smoke', 'greeting.wav'), 'wav-bytes', 'utf-8')
  writeFileSync(nodePath.join(runDir, 'USER-NOTES.txt'), 'notes\n', 'utf-8')
  writeFileSync(nodePath.join(runDir, 'QA-CHECKLIST.txt'), 'checklist\n', 'utf-8')
  if (active)
    writeFileSync(nodePath.join(runDir, ACTIVE_MARKER), `configFile=x\nrunDir=${runDir}\noriginalInstallDir=(absent)\n`, 'utf-8')
  return runDir
}

beforeEach(() => {
  workRoot = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-storage-'))
  runsDir = nodePath.join(workRoot, 'runs')
  mkdirSync(runsDir, { recursive: true })
})

describe('qa-storage: guarded deletion of managed runs', () => {
  it('deletes a valid run id inside the managed root, artifacts included', () => {
    const runDir = makeRun('20990101-000001')
    const artifact = nodePath.join(runDir, 'artifacts', 'smoke', 'greeting.wav')
    assert.ok(existsSync(artifact), 'fixture artifact must exist before deletion')
    deleteManagedRun({ id: '20990101-000001', runsDir })
    assert.ok(!existsSync(runDir), 'the whole managed run tree is gone')
    assert.ok(!existsSync(artifact), 'smoke artifacts die with their run')
  })

  it('refuses ids that are not harness run ids (no traversal possible)', () => {
    makeRun('20990101-000001')
    for (const evil of ['..', '..', '../..', 'x', '20990101-000001/../../etc'])
      assert.throws(() => deleteManagedRun({ id: evil, runsDir }))
    assert.ok(existsSync(nodePath.join(runsDir, '20990101-000001')))
  })

  it('refuses a run that does not exist', () => {
    assert.throws(() => deleteManagedRun({ id: '20990101-999999', runsDir }), /does not exist/)
  })

  it('NEVER deletes the ACTIVE run', () => {
    makeRun('20990101-000002', { active: true })
    assert.throws(() => deleteManagedRun({ id: '20990101-000002', runsDir }), /ACTIVE/)
    assert.ok(existsSync(nodePath.join(runsDir, '20990101-000002')))
  })

  it('delete-all removes every run EXCEPT the active one', () => {
    makeRun('20990101-000001')
    makeRun('20990101-000002', { active: true })
    makeRun('20990101-000003')
    const { deleted, skipped } = deleteAllManagedRuns({ runsDir })
    assert.deepEqual(deleted.sort(), ['20990101-000001', '20990101-000003'])
    assert.deepEqual(skipped, ['20990101-000002'])
    assert.ok(existsSync(nodePath.join(runsDir, '20990101-000002')))
  })
})

describe('qa-storage: retention policy is dry-run data, never a side effect', () => {
  it('keep-last protects the newest runs; the active run is always kept', () => {
    makeRun('20990101-000001')
    makeRun('20990101-000002')
    makeRun('20990101-000003', { active: true }) // newest
    const plan = retentionPlan({ keepLast: 1, runsDir })
    assert.deepEqual(plan.remove.map(run => run.id).sort(), ['20990101-000001', '20990101-000002'])
    assert.ok(plan.keep.some(run => run.id === '20990101-000003' && /active/.test(run.why)))
    // dry-run: nothing deleted by planning
    assert.equal(listManagedRuns({ runsDir }).length, 3)
  })

  it('older-than-days keeps fresh runs even beyond keep-last', () => {
    const oldRun = makeRun('20990101-000001')
    makeRun('20990101-000002')
    makeRun('20990101-000003')
    const past = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    utimesSync(oldRun, past, past)
    const plan = retentionPlan({ keepLast: 0, olderThanDays: 30, runsDir })
    assert.deepEqual(plan.remove.map(run => run.id), ['20990101-000001'])
  })
})

describe('qa-storage: log pruning keeps notes, checklist and snapshots', () => {
  it('dry-run lists, apply removes only logs/metrics files', () => {
    makeRun('20990101-000001')
    const runDir = nodePath.join(runsDir, '20990101-000001')
    writeFileSync(nodePath.join(runDir, 'metrics', 'voice-summary.txt'), 'summary', 'utf-8')

    const dry = pruneRunLogs({ apply: false, id: '20990101-000001', runsDir })
    assert.equal(dry.affected.length, 2) // f0.log + voice-summary.txt
    assert.ok(existsSync(nodePath.join(runDir, 'logs', 'f0.log')), 'dry-run deletes nothing')

    pruneRunLogs({ apply: true, id: '20990101-000001', runsDir })
    assert.ok(!existsSync(nodePath.join(runDir, 'logs', 'f0.log')))
    assert.ok(!existsSync(nodePath.join(runDir, 'metrics', 'voice-summary.txt')))
    assert.ok(existsSync(nodePath.join(runDir, 'USER-NOTES.txt')), 'user notes survive')
    assert.ok(existsSync(nodePath.join(runDir, 'QA-CHECKLIST.txt')), 'checklist survives')
  })

  it('refuses to prune the ACTIVE run', () => {
    makeRun('20990101-000001', { active: true })
    assert.throws(() => pruneRunLogs({ apply: true, id: '20990101-000001', runsDir }), /ACTIVE/)
  })
})

describe('qa-storage: legacy inventory is non-destructive and classifies honestly', () => {
  it('production locations are production-do-not-delete; QA roots are managed-test', () => {
    const localAppData = nodePath.join(workRoot, 'Local')
    const appData = nodePath.join(workRoot, 'Roaming')
    mkdirSync(nodePath.join(localAppData, 'Lia', 'runtimes'), { recursive: true })
    mkdirSync(nodePath.join(localAppData, 'Lia-QA'), { recursive: true })
    mkdirSync(nodePath.join(appData, 'Lia'), { recursive: true })
    mkdirSync(nodePath.join(appData, '@proj-airi', 'stage-tamagotchi'), { recursive: true })
    const repoRoot = nodePath.join(workRoot, 'repo')
    mkdirSync(nodePath.join(repoRoot, '.devkit-qa'), { recursive: true })
    mkdirSync(nodePath.join(repoRoot, 'Tests', 'runs'), { recursive: true })

    const env = { APPDATA: appData, LOCALAPPDATA: localAppData }
    const candidates = inventoryCandidates({ env, repoRoot })
    const byPath = new Map(candidates.map(c => [c.path, c]))

    assert.equal(byPath.get(nodePath.join(localAppData, 'Lia', 'runtimes'))?.confidence, 'production-do-not-delete')
    assert.equal(byPath.get(nodePath.join(appData, 'Lia'))?.confidence, 'production-do-not-delete')
    assert.equal(byPath.get(nodePath.join(appData, '@proj-airi', 'stage-tamagotchi'))?.confidence, 'production-do-not-delete')
    assert.equal(byPath.get(nodePath.join(localAppData, 'Lia-QA'))?.confidence, 'likely-test')
    assert.equal(byPath.get(nodePath.join(repoRoot, '.devkit-qa'))?.confidence, 'managed-test')
    assert.equal(byPath.get(nodePath.join(repoRoot, 'Tests', 'runs'))?.confidence, 'managed-test')

    // Every candidate carries a reason.
    for (const candidate of candidates)
      assert.ok(candidate.reason.length > 0)
  })

  it('the report carries totals per confidence and a largest-20 section', () => {
    const repoRoot = nodePath.join(workRoot, 'repo2')
    mkdirSync(nodePath.join(repoRoot, '.devkit-qa'), { recursive: true })
    writeFileSync(nodePath.join(repoRoot, '.devkit-qa', 'big.wav'), 'x'.repeat(1000), 'utf-8')
    const { report, totals } = buildInventoryReport({ env: {}, repoRoot })
    assert.ok(totals['managed-test'] >= 1000)
    assert.match(report, /== summary ==/)
    assert.match(report, /== largest 20 candidates ==/)
    assert.match(report, /NON-DESTRUCTIVE/)
  })

  it('isInsideManagedRoot: only strict children of managed roots qualify', () => {
    const root = nodePath.join(workRoot, 'managed')
    assert.ok(isInsideManagedRoot(nodePath.join(root, 'a', 'b'), [root]))
    assert.ok(!isInsideManagedRoot(root, [root]), 'the root itself is not inside itself')
    assert.ok(!isInsideManagedRoot(nodePath.join(root, '..', 'evil'), [root]))
    assert.ok(!isInsideManagedRoot('/etc/passwd', [root]))
  })

  it('no production runtime deletion path exists: default managed roots never contain production data', () => {
    for (const root of MANAGED_ROOTS) {
      // Every managed root lives under <repo>/Tests - structurally incapable
      // of covering the production runtime or user profile trees.
      assert.ok(root.includes(`${nodePath.sep}Tests${nodePath.sep}`), `unexpected managed root: ${root}`)
    }
    const productionLike = [
      nodePath.join(workRoot, 'AppData', 'Local', 'Lia', 'runtimes', 'kokoro'),
      nodePath.join(workRoot, 'AppData', 'Roaming', 'Lia', 'lia-product.json'),
    ]
    for (const target of productionLike)
      assert.ok(!isInsideManagedRoot(target), `production-like path wrongly managed: ${target}`)
  })
})
