#!/usr/bin/env node
/**
 * Lia QA harness (Phase 7.9G-QA) - voice log extraction + honest summary.
 *
 * Input : <run>\logs\lia-console.log (the combined supervisor console)
 * Output: <run>\metrics\voice-events.txt   (highlighted lines)
 *         <run>\metrics\voice-summary.txt  (readable metrics)
 *         <run>\logs\stage-console.log     (stage lines, when separable)
 *
 * The stage's output is forwarded into the launcher console prefixed with
 * `lia-app.stage-log`, so the combined log IS the supervisor log; the
 * derived stage-console.log strips that prefix when lines are present.
 *
 * Nothing is fabricated: any metric that did not appear in the log is
 * reported as "not observed".
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'
import { pathToFileURL } from 'node:url'

import { decodeLogBuffer } from './qa-shared.mjs'
import * as sharedRef from './qa-shared.mjs'

/** Event-category matchers used for voice-events.txt (order = output order). */
export const EVENT_CATEGORIES = [
  { name: 'lia.voice.prewarm', test: line => /lia\.voice\.prewarm/.test(line) },
  { name: 'lia.voice.synthesize', test: line => /lia\.voice\.synthesize/.test(line) },
  { name: 'lia.voice errors', test: line => /lia\.voice\.[\w.]*error/.test(line) || (/lia\.voice\./.test(line) && /ok=false/.test(line)) },
  { name: 'lia-app.voice-install', test: line => /lia-app\.voice-install/.test(line) },
  { name: 'conversar-blocked', test: line => /conversar-blocked/.test(line) },
  { name: 'shutdown', test: line => /\[lia:shutdown\]|\[lia:quit\]|will-quit|before-quit|window-all-closed/i.test(line) },
]

/** Parses `key=value` tokens (values have no spaces in these logs). */
export function parseKeyValueTokens(line) {
  const values = {}
  for (const match of line.matchAll(/([A-Za-z][\w.]*)=(\S+)/g))
    values[match[1]] = match[2]
  return values
}

/* ------------------------------------------------------------------ */
/* kokoro-smoke standalone output (Phase 7.9G-QA2: Windows finding)    */
/* ------------------------------------------------------------------ */

/**
 * The standalone `tools\kokoro-smoke.mjs` runner prints its own line shape,
 * not the Lia structured event shape:
 *   [kokoro-smoke] <slug>: gen <ms>ms | audio <ms>ms | RTF <rtf> | <wav path>
 *   [kokoro-smoke] cold start (worker spawn + model load): <ms>ms
 *   [kokoro-smoke] verified runtime already present - reuse, zero redownload
 *   [kokoro-smoke] runtime not installed (missing: ...) - installing ...
 *   [kokoro-smoke] worker stopped cleanly (shutdown frame acknowledged)
 * This parser summarizes exactly those lines. Missing values stay -1 in the
 * runner and become "not observed" here - nothing is fabricated.
 */
export function parseSmokeLog(text) {
  const syntheses = []
  for (const match of text.matchAll(/\[kokoro-smoke\]\s+(\S+):\s+gen\s+(-?\d+)ms\s+\|\s+audio\s+(-?\d+)ms\s+\|\s+RTF\s+(-?[\d.]+)/g)) {
    const [, slug, gen, audio, rtf] = match
    syntheses.push({
      audioDurationMs: Number(audio) >= 0 ? Number(audio) : undefined,
      generationMs: Number(gen) >= 0 ? Number(gen) : undefined,
      rtf: Number(rtf) >= 0 ? Number(rtf) : undefined,
      slug,
    })
  }
  const coldMatch = text.match(/\[kokoro-smoke\]\s+cold start \(worker spawn \+ model load\):\s+(\d+)ms/)
  const reused = /\[kokoro-smoke\]\s+verified runtime already present - reuse/.test(text)
  const installRan = /\[kokoro-smoke\]\s+runtime not installed/.test(text)
  const stoppedCleanly = /\[kokoro-smoke\]\s+worker stopped cleanly/.test(text)
  return { coldStartMs: coldMatch ? Number(coldMatch[1]) : undefined, installRan, reused, stoppedCleanly, syntheses }
}

function toNumber(value) {
  if (value === undefined)
    return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Structured facts extracted from one console log. */
export function parseVoiceLog(text) {
  const lines = text.split(/\r?\n/)

  const prewarms = lines
    .filter(line => /event=lia\.voice\.prewarm/.test(line))
    .map(line => parseKeyValueTokens(line))
  const syntheses = lines
    .filter(line => /event=lia\.voice\.synthesize/.test(line))
    .map((line) => {
      const kv = parseKeyValueTokens(line)
      return {
        audioDurationMs: toNumber(kv.audioDurationMs),
        engine: kv.engine,
        generationMs: toNumber(kv.generationMs),
        queueWaitMs: toNumber(kv.queueWaitMs),
        rtf: toNumber(kv.rtf),
        textLength: toNumber(kv.textLength),
        totalMs: toNumber(kv.totalMs),
      }
    })
  const installs = lines.filter(line => /lia-app\.voice-install/.test(line))
  const blocked = lines.filter(line => /conversar-blocked/.test(line))
  const voiceErrors = lines.filter(line =>
    /lia\.voice\.[\w.]*error/.test(line) || (/lia\.voice\./.test(line) && /ok=false/.test(line)))
  const shutdownLines = lines.filter(line => /\[lia:shutdown\]|\[lia:quit\]/.test(line))

  const managedPrewarms = prewarms.filter(p => p.managed !== 'false')
  const lastPrewarm = managedPrewarms.at(-1) ?? prewarms.at(-1)

  let cleanShutdown
  if (shutdownLines.some(line => /shutdown finished/.test(line) && !/timed out/.test(line)))
    cleanShutdown = 'yes'
  else if (shutdownLines.some(line => /timed out/.test(line)))
    cleanShutdown = 'no'
  else if (shutdownLines.length > 0)
    cleanShutdown = 'not observed (shutdown lines present, no final outcome)'
  else
    cleanShutdown = 'not observed'

  const rtfs = syntheses
    .map(s => s.rtf ?? (s.generationMs !== undefined && s.audioDurationMs ? s.generationMs / s.audioDurationMs : undefined))
    .filter(value => value !== undefined)
  const warmRtfs = syntheses.length >= 2 ? rtfs.slice(1) : []
  const warmAverageRtf = warmRtfs.length > 0
    ? warmRtfs.reduce((sum, value) => sum + value, 0) / warmRtfs.length
    : undefined

  // The standalone smoke runner is Kokoro-only by construction; naming it is
  // not fabrication - it is the identity of the tool that produced the lines.
  const smoke = parseSmokeLog(text)
  const selectedEngine = syntheses.find(s => s.engine)?.engine ?? lastPrewarm?.engine ?? (smoke.syntheses.length > 0 ? 'kokoro' : undefined)
  if (cleanShutdown === 'not observed' && smoke.stoppedCleanly)
    cleanShutdown = 'yes (smoke worker stopped cleanly)'

  return {
    blocked,
    cleanShutdown,
    installs,
    lastPrewarm,
    selectedEngine,
    shutdownLines,
    smoke,
    syntheses,
    voiceErrors,
    warmAverageRtf,
  }
}

function fmt(value, digits = 3) {
  return value === undefined ? 'not observed' : String(Math.round(value * 10 ** digits) / 10 ** digits)
}

/** Renders voice-summary.txt from parsed facts (never fabricates). */
export function renderVoiceSummary(facts, { logFound = true, runId = '' } = {}) {
  const lines = [
    `Lia QA - voice summary${runId ? ` (run: ${runId})` : ''}`,
    '=============================================',
  ]
  if (!logFound) {
    lines.push('log file: NOT FOUND - nothing to summarize (did Lia run with capture?).')
    return lines.join('\n')
  }

  const { lastPrewarm } = facts
  lines.push(`selected engine      : ${facts.selectedEngine ?? 'not observed'}`)
  if (lastPrewarm) {
    lines.push(`prewarm              : ${lastPrewarm.ok === undefined ? 'not observed' : lastPrewarm.ok === 'true' ? 'ok' : 'FAIL'}${lastPrewarm.ms !== undefined ? ` (${lastPrewarm.ms} ms)` : ''}${lastPrewarm.managed === 'false' ? ' [standalone launch, lazy start]' : ''}${lastPrewarm.note ? ` note=${lastPrewarm.note}` : ''}`)
  }
  else {
    lines.push('prewarm              : not observed')
  }

  const smoke = facts.smoke ?? { syntheses: [] }
  const structuredCount = facts.syntheses.length
  const smokeCount = smoke.syntheses.length

  lines.push('')
  if (structuredCount === 0 && smokeCount > 0) {
    lines.push(`synthesis count      : ${smokeCount} (kokoro-smoke standalone output)`)
    smoke.syntheses.forEach((s, index) => {
      lines.push(`  smoke #${index + 1} ${s.slug}: gen=${fmt(s.generationMs, 0)}ms audio=${fmt(s.audioDurationMs, 0)}ms rtf=${fmt(s.rtf)}`)
    })
    const smokeRtfs = smoke.syntheses.map(s => s.rtf).filter(value => value !== undefined)
    const warmSmokeRtfs = smokeCount >= 2 ? smokeRtfs.slice(1) : []
    const warmAverage = warmSmokeRtfs.length > 0
      ? warmSmokeRtfs.reduce((sum, value) => sum + value, 0) / warmSmokeRtfs.length
      : undefined
    lines.push(`smoke RTF average    : ${smokeCount >= 2 ? fmt(warmAverage) : 'not observed (needs >= 2 syntheses)'}`)
    lines.push(`smoke cold start     : ${smoke.coldStartMs !== undefined ? `${smoke.coldStartMs} ms (worker spawn + model load)` : 'not observed'}`)
    lines.push(`smoke runtime state  : ${smoke.reused ? 'reused (zero redownload)' : smoke.installRan ? 'installed during this run' : 'not observed'}`)
  }
  else {
    lines.push(`synthesis count      : ${structuredCount}${smokeCount > 0 ? ` (+ ${smokeCount} from kokoro-smoke output)` : ''}`)
    if (structuredCount === 0) {
      lines.push('syntheses            : not observed')
    }
    facts.syntheses.forEach((s, index) => {
      lines.push(`  #${index + 1}: generationMs=${fmt(s.generationMs, 0)} totalMs=${fmt(s.totalMs, 0)} audioDurationMs=${fmt(s.audioDurationMs, 0)} rtf=${fmt(s.rtf)} queueWaitMs=${fmt(s.queueWaitMs, 0)}${s.engine ? ` engine=${s.engine}` : ''}`)
    })
    lines.push(`warm RTF average     : ${structuredCount >= 2 ? fmt(facts.warmAverageRtf) : 'not observed (needs >= 2 syntheses)'}`)
  }

  lines.push('')
  const installPhases = facts.installs.map(line => (line.match(/(phase=\S+|result=\S+|step=\S+)/g) ?? [line.trim()]).join(' '))
  lines.push(`install events       : ${facts.installs.length > 0 ? '' : 'not observed'}`)
  installPhases.forEach(p => lines.push(`  ${p}`))
  lines.push(`conversar-blocked    : ${facts.blocked.length > 0 ? `${facts.blocked.length} occurrence(s)` : 'not observed'}`)
  facts.blocked.forEach(line => lines.push(`  ${line.trim()}`))
  lines.push(`voice errors         : ${facts.voiceErrors.length > 0 ? `${facts.voiceErrors.length} occurrence(s)` : 'not observed'}`)
  facts.voiceErrors.slice(0, 10).forEach(line => lines.push(`  ${line.trim()}`))
  lines.push(`clean shutdown       : ${facts.cleanShutdown}`)
  return lines.join('\n')
}

/** Renders voice-events.txt grouped by category. */
export function renderVoiceEvents(text) {
  const lines = text.split(/\r?\n/)
  const out = ['Lia QA - voice events (extracted from logs/lia-console.log)', '=============================================================']
  for (const category of EVENT_CATEGORIES) {
    const matches = lines.filter(category.test)
    out.push('', `--- ${category.name} (${matches.length}) ---`)
    matches.forEach(line => out.push(line.trimEnd()))
  }
  return out.join('\n')
}

/** Extracts stage lines (prefix stripped) when separable. */
export function extractStageLines(text) {
  const marker = ' lia-app.stage-log '
  const stageLines = []
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(marker)
    if (index >= 0)
      stageLines.push(line.slice(index + marker.length))
  }
  return stageLines
}

/** Full finalize for one run folder. Returns facts for the CLI to echo. */
export function finalizeRun({ runDir }) {
  const logFile = nodePath.join(runDir, 'logs', 'lia-console.log')
  const metricsDir = nodePath.join(runDir, 'metrics')
  mkdirSync(metricsDir, { recursive: true })
  const runId = nodePath.basename(runDir)

  const logFound = existsSync(logFile)
  // Buffer-level decode: on Windows the capture path can write UTF-16LE/BOM
  // (PowerShell default) - reading as utf-8 would hide every event.
  const text = logFound ? decodeLogBuffer(readFileSync(logFile)) : ''

  writeFileSync(nodePath.join(metricsDir, 'voice-events.txt'), logFound ? `${renderVoiceEvents(text)}\n` : 'log file not found - no events extracted.\n', 'utf-8')

  const facts = parseVoiceLog(text)
  writeFileSync(nodePath.join(metricsDir, 'voice-summary.txt'), `${renderVoiceSummary(facts, { logFound, runId })}\n`, 'utf-8')

  const stageFile = nodePath.join(runDir, 'logs', 'stage-console.log')
  if (logFound) {
    const stageLines = extractStageLines(text)
    if (stageLines.length > 0) {
      writeFileSync(stageFile, `${stageLines.join('\n')}\n`, 'utf-8')
    }
    else {
      writeFileSync(stageFile, 'No separately-prefixed stage lines were found in lia-console.log.\nThe stage output is part of the combined supervisor log (see lia-console.log).\n', 'utf-8')
    }
  }

  return { facts, logFound, runId }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const [, , command, ...args] = process.argv

function resolveLatest() {
  const { listRunIds, RUNS_DIR } = sharedRef
  const ids = listRunIds(RUNS_DIR)
  return ids.length > 0 ? nodePath.join(RUNS_DIR, ids[0]) : undefined
}

if (!isMain) {
  // Imported by tests - library only.
}
else if (command === 'finalize') {
  const runDir = args[0]
  if (!runDir) {
    console.error('usage: qa-voice-metrics.mjs finalize <runDir>')
    process.exit(2)
  }
  const { logFound, runId } = finalizeRun({ runDir: nodePath.resolve(runDir) })
  console.log(`metrics extracted for ${runId} (log ${logFound ? 'found' : 'NOT FOUND'})`)
}
else if (command === 'finalize-latest') {
  const runDir = resolveLatest()
  if (!runDir) {
    console.error('no test runs found')
    process.exit(1)
  }
  const { logFound, runId } = finalizeRun({ runDir })
  console.log(`metrics extracted for ${runId} (log ${logFound ? 'found' : 'NOT FOUND'})`)
}
else {
  console.error('usage: qa-voice-metrics.mjs <finalize <runDir>|finalize-latest>')
  process.exit(2)
}
