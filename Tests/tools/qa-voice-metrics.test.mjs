import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import nodePath from 'node:path'
import { describe, it } from 'node:test'

import { decodeLogBuffer } from './qa-shared.mjs'
import {
  extractStageLines,
  finalizeRun,
  parseSmokeLog,
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

/* ------------------------------------------------------------------ */
/* Phase 7.9G-QA2: Windows findings regression tests                   */
/* ------------------------------------------------------------------ */

const utf16leWithBom = text => Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')])
const utf8WithBom = text => Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf-8')])
const utf16beWithBom = (text) => {
  const le = Buffer.from(text, 'utf16le')
  const swapped = Buffer.alloc(le.length)
  for (let index = 0; index + 1 < le.length; index += 2) {
    swapped[index] = le[index + 1]
    swapped[index + 1] = le[index]
  }
  return Buffer.concat([Buffer.from([0xFE, 0xFF]), swapped])
}

describe('7.9G-QA2 A/B: log decoding is encoding-robust (Windows PowerShell capture)', () => {
  it('decodes plain UTF-8 unchanged', () => {
    assert.equal(decodeLogBuffer(Buffer.from(FIXTURE_LOG, 'utf-8')), FIXTURE_LOG)
  })

  it('decodes UTF-8 with BOM, stripping the BOM', () => {
    const decoded = decodeLogBuffer(utf8WithBom(FIXTURE_LOG))
    assert.equal(decoded, FIXTURE_LOG)
    assert.notEqual(decoded.charCodeAt(0), 0xFEFF)
  })

  it('decodes UTF-16LE with BOM (the PowerShell default that broke metrics)', () => {
    const decoded = decodeLogBuffer(utf16leWithBom(FIXTURE_LOG))
    assert.equal(decoded, FIXTURE_LOG)
  })

  it('decodes UTF-16BE with BOM as well', () => {
    assert.equal(decodeLogBuffer(utf16beWithBom(FIXTURE_LOG)), FIXTURE_LOG)
  })

  it('empty buffer decodes to empty text without crashing', () => {
    assert.equal(decodeLogBuffer(Buffer.alloc(0)), '')
  })
})

describe('7.9G-QA2 B: a UTF-16LE+BOM Lia log parses exactly like UTF-8', () => {
  it('finalize on a UTF-16LE+BOM log finds prewarm, syntheses and shutdown', () => {
    const runDir = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-utf16-'))
    mkdirSync(nodePath.join(runDir, 'logs'), { recursive: true })
    writeFileSync(nodePath.join(runDir, 'logs', 'lia-console.log'), utf16leWithBom(FIXTURE_LOG))

    finalizeRun({ runDir })
    const summary = readFileSync(nodePath.join(runDir, 'metrics', 'voice-summary.txt'), 'utf-8')
    assert.match(summary, /selected engine\s*:\s*kokoro/)
    assert.match(summary, /prewarm\s*:\s*ok \(812 ms\)/)
    assert.match(summary, /synthesis count\s*:\s*3/)
    assert.match(summary, /clean shutdown\s*:\s*yes/)
  })

  it('finalize on a UTF-8+BOM log behaves identically', () => {
    const runDir = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-bom-'))
    mkdirSync(nodePath.join(runDir, 'logs'), { recursive: true })
    writeFileSync(nodePath.join(runDir, 'logs', 'lia-console.log'), utf8WithBom(FIXTURE_LOG))

    finalizeRun({ runDir })
    const summary = readFileSync(nodePath.join(runDir, 'metrics', 'voice-summary.txt'), 'utf-8')
    assert.match(summary, /synthesis count\s*:\s*3/)
  })
})

describe('7.9G-QA2 C/D/E/F: real-style Windows events are detected', () => {
  // Shapes transcribed from the real Windows clean-install run.
  const REAL_WINDOWS_LOG = [
    '[lia] 2026-09-24T01:10:02.123Z lia-app.voice-install phase=installing',
    '[lia] 2026-09-24T01:10:20.500Z lia-app.voice-install phase=installing step=venv',
    '[lia] 2026-09-24T01:13:41.012Z lia-app.voice-install phase=installing step=model',
    '[lia] 2026-09-24T01:18:09.900Z lia-app.voice-install result=ready',
    '[lia] 2026-09-24T01:18:30.000Z lia-app.stage-log event=lia.voice.prewarm managed=true engine=kokoro ok=true ms=1620',
    '[lia] 2026-09-24T01:18:41.100Z lia-app.stage-log event=lia.voice.synthesize engine=kokoro generationMs=1480 queueWaitMs=2 totalMs=1484 audioDurationMs=2650 sampleRate=24000 textLength=37 rtf=0.558',
    '[lia] 2026-09-24T01:19:02.200Z lia-app.stage-log event=lia.voice.synthesize engine=kokoro generationMs=330 queueWaitMs=1 totalMs=332 audioDurationMs=3100 sampleRate=24000 textLength=45 rtf=0.106',
    '[lia:shutdown] beginning graceful shutdown',
    '[lia:shutdown] stage: stopped in 195ms',
    '[lia:quit] window-close: shutdown finished - exiting 0',
  ].join('\r\n') // Windows CRLF on purpose

  const facts = parseVoiceLog(REAL_WINDOWS_LOG)

  it('C: real install events are detected with their step metadata', () => {
    assert.equal(facts.installs.length, 4)
    const rendered = renderVoiceSummary(facts, { logFound: true })
    assert.match(rendered, /install events/)
    assert.match(rendered, /step=venv/)
    assert.match(rendered, /result=ready/)
  })

  it('D: real prewarm is detected (ok + ms)', () => {
    assert.equal(facts.lastPrewarm.ok, 'true')
    assert.equal(facts.lastPrewarm.ms, '1620')
    assert.match(renderVoiceSummary(facts, { logFound: true }), /prewarm\s*:\s*ok \(1620 ms\)/)
  })

  it('E: real syntheses are counted with metrics', () => {
    assert.equal(facts.syntheses.length, 2)
    assert.equal(facts.syntheses[0].generationMs, 1480)
    assert.equal(facts.syntheses[1].rtf, 0.106)
  })

  it('F: real graceful shutdown is detected', () => {
    assert.equal(facts.cleanShutdown, 'yes')
  })
})

describe('7.9G-QA2 G: kokoro-smoke standalone output produces real metrics', () => {
  const SMOKE_LOG = [
    '[kokoro-smoke] voice runtime home (production resolution): C:\\Users\\qa\\AppData\\Local\\Lia\\runtimes',
    '[kokoro-smoke] verified runtime already present - reuse, zero redownload',
    '[kokoro-smoke] python (venv): C:\\Users\\qa\\AppData\\Local\\Lia\\runtimes\\kokoro\\venv\\Scripts\\python.exe (3.12.4)',
    '[kokoro-smoke] runtime root: C:\\Users\\qa\\AppData\\Local\\Lia\\runtimes',
    '[kokoro-smoke] model sha256: 0123456789abcdef (matches the QA-pinned hash)',
    '[kokoro-smoke] starting the real engine (worker spawn + model cold load)...',
    '[kokoro-smoke] active ORT provider (measured): DML (device=dml)',
    '[kokoro-smoke] cold start (worker spawn + model load): 4321ms',
    '[kokoro-smoke] worker RAM: not instrumented in the 7.9C health contract',
    '[kokoro-smoke] a: gen 980ms | audio 2600ms | RTF 0.377 | J:\\Lia-Project\\Tests\\runs\\20260924-001000\\artifacts\\smoke\\smoke-a.wav',
    '[kokoro-smoke] b: gen 310ms | audio 2900ms | RTF 0.107 | J:\\Lia-Project\\Tests\\runs\\20260924-001000\\artifacts\\smoke\\smoke-b.wav',
    '[kokoro-smoke] c: gen 295ms | audio 2750ms | RTF 0.107 | J:\\Lia-Project\\Tests\\runs\\20260924-001000\\artifacts\\smoke\\smoke-c.wav',
    '[kokoro-smoke] worker stopped cleanly (shutdown frame acknowledged)',
    '[kokoro-smoke] DONE - dev-only WAV files at: J:\\Lia-Project\\Tests\\runs\\20260924-001000\\artifacts\\smoke',
  ].join('\n')

  it('parses a non-zero synthesis count with gen/audio/RTF', () => {
    const smoke = parseSmokeLog(SMOKE_LOG)
    assert.equal(smoke.syntheses.length, 3)
    assert.equal(smoke.syntheses[0].generationMs, 980)
    assert.equal(smoke.syntheses[0].audioDurationMs, 2600)
    assert.equal(smoke.syntheses[0].rtf, 0.377)
    assert.equal(smoke.coldStartMs, 4321)
    assert.equal(smoke.reused, true)
    assert.equal(smoke.stoppedCleanly, true)
  })

  it('the summary reports the smoke metrics instead of zeros', () => {
    const summary = renderVoiceSummary(parseVoiceLog(SMOKE_LOG), { logFound: true })
    assert.match(summary, /synthesis count\s*:\s*3 \(kokoro-smoke standalone output\)/)
    assert.match(summary, /smoke #1 a: gen=980ms audio=2600ms rtf=0\.377/)
    assert.match(summary, /smoke cold start\s*:\s*4321 ms/)
    assert.match(summary, /smoke runtime state\s*:\s*reused \(zero redownload\)/)
    assert.match(summary, /smoke RTF average\s*:\s*0\.107/)
    assert.match(summary, /selected engine\s*:\s*kokoro/)
    assert.match(summary, /clean shutdown\s*:\s*yes \(smoke worker stopped cleanly\)/)
  })

  it('install-during-run is also reported honestly', () => {
    const withInstall = SMOKE_LOG.replace(
      '[kokoro-smoke] verified runtime already present - reuse, zero redownload',
      '[kokoro-smoke] runtime not installed (missing: model) - installing via the engine-owned installer',
    )
    const summary = renderVoiceSummary(parseVoiceLog(withInstall), { logFound: true })
    assert.match(summary, /smoke runtime state\s*:\s*installed during this run/)
  })

  it('smoke values of -1 stay "not observed" (never fabricated)', () => {
    const smoke = parseSmokeLog('[kokoro-smoke] x: gen -1ms | audio -1ms | RTF -1 | C:\\out\\x.wav')
    assert.equal(smoke.syntheses.length, 1)
    assert.equal(smoke.syntheses[0].generationMs, undefined)
    assert.equal(smoke.syntheses[0].audioDurationMs, undefined)
    assert.equal(smoke.syntheses[0].rtf, undefined)
  })
})

describe('7.9G-QA2 H: malformed/empty/degenerate logs fail gracefully', () => {
  it('empty log: no crash, everything "not observed"', () => {
    const facts = parseVoiceLog('')
    const summary = renderVoiceSummary(facts, { logFound: true })
    assert.match(summary, /synthesis count\s*:\s*0/)
    assert.match(summary, /clean shutdown\s*:\s*not observed/)
  })

  it('binary garbage buffer: decode + parse survive without throwing', () => {
    const garbage = Buffer.from([0xFF, 0xFE, 0x00, 0xD8, 0x41, 0x00, 0x00, 0x00, 0xFD, 0xFF])
    const text = decodeLogBuffer(garbage)
    const facts = parseVoiceLog(text)
    assert.equal(facts.syntheses.length, 0)
    assert.equal(parseSmokeLog(text).syntheses.length, 0)
  })

  it('truncated/half-keyvalue lines: parser keeps the valid parts only', () => {
    const facts = parseVoiceLog('event=lia.voice.synthesize engine=kokoro generationMs=\nevent=lia.voice.synthesize engine=kokoro generationMs=120 totalMs=121 audioDurationMs=1000 rtf=0.12')
    assert.equal(facts.syntheses.length, 2)
    assert.equal(facts.syntheses[1].generationMs, 120)
  })

  it('finalize on a run with a garbage log still writes both metric files', () => {
    const runDir = mkdtempSync(nodePath.join(tmpdir(), 'lia-qa-garbage-'))
    mkdirSync(nodePath.join(runDir, 'logs'), { recursive: true })
    writeFileSync(nodePath.join(runDir, 'logs', 'lia-console.log'), Buffer.from([0x00, 0x01, 0x02, 0xFF]))
    const { logFound } = finalizeRun({ runDir })
    assert.equal(logFound, true)
    assert.ok(existsSync(nodePath.join(runDir, 'metrics', 'voice-summary.txt')))
    assert.ok(existsSync(nodePath.join(runDir, 'metrics', 'voice-events.txt')))
  })
})
