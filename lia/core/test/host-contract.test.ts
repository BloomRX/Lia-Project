import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  HOST_CAPABILITIES,
  HOST_COMMANDS,
  HOST_CONTRACT_VERSION,
  hostSatisfies,
  missingCapabilities,
  parseHostCommand,
  parseHostDescriptor,
} from '../src/host/contracts.ts'

import type { LiaHostDescriptor, LiaHostRequirement } from '../src/host/contracts.ts'

/**
 * Contrato de host (12/11/2026). O teste cobra duas coisas que a decisão de
 * arquitetura prometeu:
 *
 *  - o Core pergunta por CAPACIDADE, não por runtime - um host headless pode
 *    servir ferramentas sem janela, e um host Electron sem `tools` não serve;
 *  - mensagem inválida não derruba o receptor: todo `parse` é recusa tipada.
 */

const ELECTRON: LiaHostDescriptor = {
  id: 'lia-electron',
  kind: 'electron',
  version: '1.0.0',
  capabilities: ['windows', 'tray', 'audio', 'screen', 'power', 'shortcuts', 'notifications'],
}

const HEADLESS: LiaHostDescriptor = {
  id: 'lia-headless',
  kind: 'headless',
  version: '1.0.0',
  capabilities: ['tools'],
}

describe('host capability contract', () => {
  it('declares a closed, duplicate-free vocabulary', () => {
    assert.equal(new Set(HOST_CAPABILITIES).size, HOST_CAPABILITIES.length)
    assert.equal(new Set(HOST_COMMANDS).size, HOST_COMMANDS.length)
    assert.match(HOST_CONTRACT_VERSION, /^\d+\.\d+\.\d+$/)
    assert.ok(HOST_CAPABILITIES.includes('tools'))
    assert.ok(HOST_COMMANDS.includes('tool.execute'))
  })

  it('answers by capability, not by runtime identity', () => {
    const presence: LiaHostRequirement[] = [
      { capability: 'windows', reason: 'a presença precisa de uma janela' },
      { capability: 'screen', reason: 'a presença acompanha monitores' },
    ]
    assert.deepEqual(hostSatisfies(ELECTRON, presence), { ok: true })

    const refusal = hostSatisfies(HEADLESS, presence)
    assert.equal(refusal.ok, false)
    if (refusal.ok)
      throw new Error('unreachable')
    assert.deepEqual(refusal.missing, ['windows', 'screen'])
    assert.match(refusal.reason, /windows.*janela/)

    const tools: LiaHostRequirement[] = [{ capability: 'tools', reason: 'executar ferramenta local autorizada' }]
    assert.deepEqual(hostSatisfies(HEADLESS, tools), { ok: true })
    assert.equal(hostSatisfies(ELECTRON, tools).ok, false)
  })

  it('lists missing capabilities once, in requirement order', () => {
    const requirements: LiaHostRequirement[] = [
      { capability: 'audio', reason: 'voz' },
      { capability: 'audio', reason: 'voz de novo' },
      { capability: 'tray', reason: 'ícone' },
    ]
    assert.deepEqual(missingCapabilities(HEADLESS, requirements), ['audio', 'tray'])
    assert.deepEqual(missingCapabilities(ELECTRON, requirements), [])
    assert.deepEqual(missingCapabilities(HEADLESS, []), [])
  })

  it('rejects a malformed descriptor without throwing', () => {
    const rejected: unknown[] = [
      undefined,
      null,
      'electron',
      [],
      { id: 'x', kind: 'electron', version: '1', capabilities: ['windows'], extra: true },
      { id: '', kind: 'electron', version: '1', capabilities: [] },
      { id: 'x y', kind: 'electron', version: '1', capabilities: [] },
      { id: 'x', kind: 'qt', version: '1', capabilities: [] },
      { id: 'x', kind: 'electron', version: 1, capabilities: [] },
      { id: 'x', kind: 'electron', version: '1', capabilities: ['teleport'] },
      { id: 'x', kind: 'electron', version: '1', capabilities: ['windows', 'windows'] },
      { id: 'x', kind: 'electron', version: '1', capabilities: 'windows' },
    ]
    for (const value of rejected) {
      const result = parseHostDescriptor(value)
      assert.equal(result.ok, false, JSON.stringify(value))
    }
    const ok = parseHostDescriptor({ id: 'lia-electron', kind: 'electron', version: '43.4.1', capabilities: ['windows'] })
    assert.equal(ok.ok, true)
    if (ok.ok)
      assert.deepEqual(ok.descriptor.capabilities, ['windows'])
  })
})

describe('host command envelope', () => {
  it('accepts a well-formed command and keeps the payload opaque', () => {
    const result = parseHostCommand({ contract: '1.2.0', type: 'tool.execute', id: 'cmd-1', payload: { tool: 'x' } })
    assert.equal(result.ok, true)
    if (!result.ok)
      throw new Error('unreachable')
    assert.equal(result.command.type, 'tool.execute')
    assert.deepEqual(result.command.payload, { tool: 'x' })
    // Payload validation belongs to the handler: the envelope does not pretend
    // to know what a tool is.
    assert.equal(parseHostCommand({ contract: '1.0.0', type: 'tool.execute', id: 'cmd-1' }).ok, true)
  })

  it('refuses incompatible, malformed and unknown messages without throwing', () => {
    const rejected: unknown[] = [
      undefined,
      'cmd',
      {},
      { contract: '2.0.0', type: 'window.show', id: 'a' },
      { contract: '1.x.0', type: 'window.show', id: 'a' },
      { contract: '1.0.0', type: 'window.explode', id: 'a' },
      { contract: '1.0.0', type: 'window.show', id: '' },
      { contract: '1.0.0', type: 'window.show', id: 'a b' },
      { contract: '1.0.0', type: 'window.show', id: 'a', extra: 1 },
      { type: 'window.show', id: 'a' },
    ]
    for (const value of rejected) {
      const result = parseHostCommand(value)
      assert.equal(result.ok, false, JSON.stringify(value))
      if (!result.ok)
        assert.ok(result.reason.length > 0)
    }
  })

  it('keeps minor and patch compatible and major absolute', () => {
    assert.equal(parseHostCommand({ contract: '1.9.3', type: 'window.hide', id: 'a' }).ok, true)
    const major = parseHostCommand({ contract: '2.0.0', type: 'window.hide', id: 'a' })
    assert.equal(major.ok, false)
    if (!major.ok)
      assert.match(major.reason, /major/)
  })
})
