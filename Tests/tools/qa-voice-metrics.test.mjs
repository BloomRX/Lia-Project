import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { describe, it } from 'node:test'

import {
  extractStageLines,
  finalizeRun,
  parseVoiceLog,
  renderVoiceEvents,
  renderVoiceSummary,
} from './qa-voice-metrics.mjs'

/** Real line shapes: launcher `[lia]` events + stage key=value records. */
const FIXTURE_LOG = [
  '[lia] 2026-09-23T10:00:00.000Z lia-app.voice-install phase=installing',
  '[lia] 2026-09-23T10:00:30.000Z lia-app.voice-install phase=installing step=venv',
  '[lia] 2026-09-23T10:05:00.000Z lia-app.voice-install result=ready',
  '[lia] 2026-09-23T10:05:10.000Z lia-app.stage-log event=lia.voice.prewarm managed=true engine=kokoro ok=true ms=812',
  '[lia] 2026-09-23T10:05:20.000Z lia-app.stage-log event=lia.voice.synthesize engine=kokoro generationMs=900 queueWaitMs=3 totalMs=905 audioDurationMs=3000 sampleRate=24000 textLength=42 rtf=0.3',
  '[lia] 2026-09-23T10:05:30.000Z lia-app.stage-log event=lia.voice.synthesize engine=kokoro generationMs=300 queueWaitMs=1 totalMs=302 audioDurationMs=3000 sampleRate=24000 textLength=40 rtf=0.1',
  '[lia] 2026-09-23T10:05:35.000Z lia-app.stage-log event=lia.voice.synthesize engine=kokoro generationMs=280 queueWaitMs=2 totalMs=283 audioDurationMs=2900 sampleRate=24000 textLength=38 rtf=0.097',
  '[lia] 2026-09-23T10:06:00.000Z lia-app.conversar-blocked reason=voice-runtime-not-installed',
  '[lia:shutdown] beginning graceful shutdown',
  '[lia:shutdown] stage: stopped in 230ms',
  '[lia:quit] window-close: shutdown finished - exiting 0',
].join('\n')

describe('qa-voice-metrics: parsing observed events', () => {
  const facts = parseVoiceLog(FIXTURE_LOG)

  it('selected engine comes from observed records', () => {
    assert.equal(facts.selectedEngine, 'kokoro')
  })

  it('prewarm facts: ok + ms', () => {
    assert.equal(facts.lastPrewarm.ok, 'true')
    assert.equal(facts.lastPrewarm.ms, '812')
  })

  it('every synthesis keeps generationMs/totalMs/audioDurationMs/rtf/queueWaitMs', () => {
    assert.equal(facts.syntheses.length, 3)
    const first = facts.syntheses[0]
    assert.equal(first.generationMs, 900)
    assert.equal(first.totalMs, 905)
    assert.equal(first.audioDurationMs, 3000)
    assert.equal(first.rtf, 0.3)
    assert.equal(first.queueWaitMs, 3)
  })

  it('warm RTF average excludes the first synthesis when there are >= 2', () => {
    const expected = (0.1 + 0.097) / 2
    assert.ok(Math.abs(facts.warmAverageRtf - expected) < 1e-9)
  })

  it('install and conversar-blocked lines are captured', () => {
    assert.equal(facts.installs.length, 3)
    assert.equal(facts.blocked.length, 1)
    assert.match(facts.blocked[0], /reason=voice-runtime-not-installed/)
  })

  it('clean shutdown is detected from the final quit line', () => {
    assert.equal(facts.cleanShutdown, 'yes')
  })

  it('a timed-out shutdown is reported honestly as no', () => {
    const timedOut = parseVoiceLog('[lia:quit] window-close: shutdown timed out - exiting 1')
    assert.equal(timedOut.cleanShutdown, 'no')
  })
})

describe('qa-voice-metrics: nothing is fabricated', () => {
  it('empty log: every metric reads "not observed"', () => {
    const summary = renderVoiceSummary(parseVoiceLog(''), { logFound: true })
    assert.match(summary, /selected engine\s*:\s*not observed/)
    assert.match(summary, /prewarm\s*:\s*not observed/)
    assert.match(summary, /synthesis count\s*:\s*0/)
    assert.match(summary, /warm RTF average\s*:\s*not observed/)
    assert.match(summary, /clean shutdown\s*:\s*not observed/)
  })

  it('missing log file: summary says so', () => {
    const summary = renderVoiceSummary(parseVoiceLog(''), { logFound: false })
    assert.match(summary, /NOT FOUND/)
  })

  it('one synthesis only: warm average stays "not observed (needs >= 2 syntheses)"', () => {
    const one = parseVoiceLog('event=lia.voice.synthesize engine=kokoro generationMs=100 totalMs=100 audioDurationMs=1000 rtf=0.1')
    const summary = renderVoiceSummary(one, { logFound: true })
    assert.match(summary, /warm RTF average\s*:\s*not observed \(needs >= 2 syntheses\)/)
  })
})

describe('qa-voice-metrics: events extraction and stage separation', () => {
  it('voice-events.txt groups every required category', () => {
    const rendered = renderVoiceEvents(FIXTURE_LOG)
    assert.match(rendered, /--- lia\.voice\.prewarm \(1\) ---/)
    assert.match(rendered, /--- lia\.voice\.synthesize \(3\) ---/)
    assert.match(rendered, /--- lia-app\.voice-install \(3\) ---/)
    assert.match(rendered, /--- conversar-blocked \(1\) ---/)
    assert.match(rendered, /--- shutdown \(3\) ---/)
  })

  it('stage lines are separable via the lia-app.stage-log prefix', () => {
    const stageLines = extractStageLines(FIXTURE_LOG)
    assert.equal(stageLines.length, 4)
    assert.ok(stageLines.every(line => line.startsWith('event=lia.voice.')))
  })
})

describe('qa-voice-metrics: finalize writes the full metric bundle', () => {
  it('produces voice-events.txt, voice-summary.txt and stage-console.log', () => {
    const runDir = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-metrics-'))
    mkdirSync(nodePath.join(runDir, 'logs'), { recursive: true })
    writeFileSync(nodePath.join(runDir, 'logs', 'lia-console.log'), FIXTURE_LOG, 'utf-8')

    const { logFound } = finalizeRun({ runDir })
    assert.equal(logFound, true)

    const summary = readFileSync(nodePath.join(runDir, 'metrics', 'voice-summary.txt'), 'utf-8')
    assert.match(summary, /selected engine\s*:\s*kokoro/)
    assert.match(summary, /synthesis count\s*:\s*3/)
    assert.match(summary, /clean shutdown\s*:\s*yes/)

    assert.ok(existsSync(nodePath.join(runDir, 'metrics', 'voice-events.txt')))
    const stage = readFileSync(nodePath.join(runDir, 'logs', 'stage-console.log'), 'utf-8')
    assert.match(stage, /event=lia\.voice\.prewarm/)
  })

  it('documents the combined supervisor log when no separate stage lines exist', () => {
    const runDir = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-metrics-'))
    mkdirSync(nodePath.join(runDir, 'logs'), { recursive: true })
    writeFileSync(nodePath.join(runDir, 'logs', 'lia-console.log'), '[lia] 2026-09-23T10:00:00.000Z lia-app.ready\n', 'utf-8')

    finalizeRun({ runDir })
    const stage = readFileSync(nodePath.join(runDir, 'logs', 'stage-console.log'), 'utf-8')
    assert.match(stage, /combined supervisor log/)
  })
})
