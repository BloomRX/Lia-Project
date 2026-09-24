import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { describe, it } from 'node:test'

import { REPO_ROOT } from './qa-shared.mjs'

/**
 * The real smoke (production runtime + model download) must NOT run in the
 * Agent sandbox, so these are static guarantees over the runner source:
 * the 7.9G-QA output-dir seam exists, and ordinary standalone behavior is
 * byte-for-byte the historical one.
 */
const SMOKE_SOURCE = readFileSync(nodePath.join(REPO_ROOT, 'tools', 'kokoro-smoke.mjs'), 'utf-8')

describe('kokoro-smoke.mjs: output-dir seam is tooling-only and backward compatible', () => {
  it('accepts an optional outDir argument (what LiaTests.bat passes)', () => {
    assert.match(SMOKE_SOURCE, /process\.argv\[2\]/)
    assert.match(SMOKE_SOURCE, /nodePath\.resolve\(REPO_ROOT, outDirArg\)/)
  })

  it('without the argument, the historical .devkit-qa destination stays the default', () => {
    assert.match(SMOKE_SOURCE, /'\.devkit-qa'/)
    assert.match(SMOKE_SOURCE, /'kokoro-smoke'/)
    // The default is chosen when no argument was given.
    assert.match(SMOKE_SOURCE, /outDirArg \? .* : nodePath\.join\(QA_DIR, 'kokoro-smoke'\)/)
  })

  it('still runs ONLY against the production runtime-home resolution', () => {
    assert.match(SMOKE_SOURCE, /resolveVoiceRuntimeHome/)
    assert.match(SMOKE_SOURCE, /voice runtime home \(production resolution\)/)
    // The seam touches the OUTPUT dir only - the runtime home line is not
    // derived from the argument.
    const runtimeHomeLine = SMOKE_SOURCE
      .split('\n')
      .find(line => line.includes('const runtimeHome'))
    assert.ok(runtimeHomeLine)
    assert.doesNotMatch(runtimeHomeLine, /outDirArg|argv/)
  })

  it('still wires the production engine modules from lia-core dist', () => {
    assert.match(SMOKE_SOURCE, /createKokoroVoiceEngine/)
    assert.match(SMOKE_SOURCE, /resolveKokoroLayout/)
    assert.match(SMOKE_SOURCE, /runKokoroSmoke/)
  })

  it('DevKit invocation passes no extra argument (checked over project_cli.py)', () => {
    const cli = readFileSync(nodePath.join(REPO_ROOT, 'tools', 'project_cli.py'), 'utf-8')
    assert.match(cli, /subprocess\.run\(\[node, str\(script\)\]/)
  })
})
