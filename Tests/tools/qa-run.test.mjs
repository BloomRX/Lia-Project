import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { beforeEach, describe, it } from 'node:test'

import { createRun, latestRun, writeEnvironment } from './qa-run.mjs'

let workRoot
let runsDir

beforeEach(() => {
  workRoot = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-run-'))
  runsDir = nodePath.join(workRoot, 'runs')
})

describe('qa-run: run folder lifecycle', () => {
  it('creates the full skeleton for a clean-install run', () => {
    const runDir = createRun({ kind: 'clean-install', runsDir })
    for (const sub of ['runtime', 'logs', 'metrics', 'snapshots'])
      assert.ok(existsSync(nodePath.join(runDir, sub)), `${sub} missing`)
    assert.ok(existsSync(nodePath.join(runDir, 'QA-CHECKLIST.txt')))
    assert.ok(existsSync(nodePath.join(runDir, 'USER-NOTES.txt')))
    const info = readFileSync(nodePath.join(runDir, 'run-info.txt'), 'utf-8')
    assert.match(info, /kind\s*:\s*clean-install/)
    assert.match(info, /git sha/)
  })

  it('run ids are unique even inside the same second', () => {
    const now = new Date(2026, 8, 23, 23, 55, 0)
    const first = createRun({ kind: 'smoke', now, runsDir })
    const second = createRun({ kind: 'smoke', now, runsDir })
    assert.notEqual(first, second)
    assert.match(nodePath.basename(second), /^20260923-235500-\d+$/)
  })

  it('latestRun returns the newest id (lexicographic == chronological)', () => {
    createRun({ kind: 'smoke', now: new Date(2026, 8, 23, 10, 0, 0), runsDir })
    const newer = createRun({ kind: 'clean-install', now: new Date(2026, 8, 23, 11, 0, 0), runsDir })
    assert.equal(latestRun({ runsDir }), newer)
  })

  it('latestRun is undefined when no runs exist', () => {
    assert.equal(latestRun({ runsDir }), undefined)
  })

  it('clean-install runs own an artifacts root (centralized QA output)', () => {
    const runDir = createRun({ kind: 'clean-install', runsDir })
    assert.ok(existsSync(nodePath.join(runDir, 'artifacts')), 'artifacts missing')
  })

  it('smoke runs own artifacts\\smoke (the smoke WAV destination)', () => {
    const runDir = createRun({ kind: 'smoke', runsDir })
    assert.ok(existsSync(nodePath.join(runDir, 'artifacts', 'smoke')), 'artifacts/smoke missing')
  })
})

describe('qa-run: clean-install QA-CHECKLIST carries the exact product checklist', () => {
  const requiredItems = [
    '[ ] Voz da Lia card appears once',
    '[ ] Kokoro shows Não instalado',
    '[ ] Instalar voz is available',
    '[ ] Clicking it shows Instalando…',
    '[ ] Lia App stays responsive',
    '[ ] It eventually shows Pronto',
    '[ ] Kokoro remains Selecionado',
    '[ ] Conversar com Lia opens Stage',
    '[ ] Startup greeting speaks once',
    '[ ] Normal chat reply is spoken',
    '[ ] No technical backend jargon appears in normal UI',
  ]

  it('all 11 checklist items present, with the isolated runtime root named', () => {
    const runDir = createRun({ kind: 'clean-install', runsDir })
    const checklist = readFileSync(nodePath.join(runDir, 'QA-CHECKLIST.txt'), 'utf-8')
    for (const item of requiredItems)
      assert.ok(checklist.includes(item), `missing checklist item: ${item}`)
    assert.ok(checklist.includes(nodePath.join(runDir, 'runtime')), 'isolated runtime root named')
  })

  it('USER-NOTES.txt offers every observation field', () => {
    const runDir = createRun({ kind: 'clean-install', runsDir })
    const notes = readFileSync(nodePath.join(runDir, 'USER-NOTES.txt'), 'utf-8')
    for (const field of [
      'UI result:',
      'install result:',
      'greeting result:',
      'chat speech result:',
      'perceived voice latency:',
      'visual/UI issue:',
      'other notes:',
    ])
      assert.ok(notes.includes(field), `missing notes field: ${field}`)
  })
})

describe('qa-run: environment.txt captures the audit facts', () => {
  it('writes branch/SHA/status, env presence and the effective QA runtime root', () => {
    const runDir = createRun({ kind: 'clean-install', runsDir })
    writeEnvironment({ runDir, runsDir })
    const envText = readFileSync(nodePath.join(runDir, 'metrics', 'environment.txt'), 'utf-8')
    assert.match(envText, /timestamp\s*:/)
    assert.match(envText, /branch\s*:/)
    assert.match(envText, /git sha\s*:/)
    assert.match(envText, /git status --short/)
    assert.match(envText, /os\s*:/)
    assert.match(envText, /APPDATA present\s*:/)
    assert.match(envText, /LOCALAPPDATA present\s*:/)
    assert.match(envText, /effective QA runtime\s*:/)
    assert.ok(envText.includes(nodePath.join(runDir, 'runtime')), 'names the isolated runtime root')
  })

  it('smoke runs report the production runtime home, never an isolated one', () => {
    const runDir = createRun({ kind: 'smoke', runsDir })
    writeEnvironment({ runDir, runsDir })
    const envText = readFileSync(nodePath.join(runDir, 'metrics', 'environment.txt'), 'utf-8')
    assert.match(envText, /production default - smoke run/)
  })
})

describe('qa-run: smoke checklist points at the run-owned artifacts', () => {
  it('WAVs are expected under artifacts\\smoke, not .devkit-qa', () => {
    const runDir = createRun({ kind: 'smoke', runsDir })
    const checklist = readFileSync(nodePath.join(runDir, 'QA-CHECKLIST.txt'), 'utf-8')
    assert.ok(checklist.includes('artifacts\\smoke'))
    assert.ok(!checklist.includes('.devkit-qa'), 'smoke runs must not point testers at .devkit-qa')
  })
})
