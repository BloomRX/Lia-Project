import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Auditoria estática da superfície IPC do Launcher (Etapa 5, 12/11/2026).
 *
 * O Launcher é a fronteira de confiança do produto: ele fala com o renderer,
 * abre diálogos, grava o vault e supervisiona o Stage. Este teste congela a
 * LISTA de canais e as regras mínimas de cada um. Adicionar um canal passa a
 * exigir uma edição consciente aqui - não é burocracia: era exatamente o tipo
 * de canal esquecido que transformava uma superfície pequena em superfície
 * desconhecida.
 */

const SOURCE = readFileSync(fileURLToPath(new URL('./ipc.ts', import.meta.url)), 'utf-8')

const CHANNELS = [...SOURCE.matchAll(/ipcMain\.handle\('([^']+)'/g)].map(match => match[1])

/** Inventário revisado em 12/11/2026. Ordem alfabética, sem duplicatas. */
const EXPECTED_CHANNELS = [
  'lia:ai:connection:get',
  'lia:ai:connection:models',
  'lia:ai:connection:save',
  'lia:ai:connection:test',
  'lia:ai:providers',
  'lia:app:quit',
  'lia:bridge',
  'lia:config:update',
  'lia:home-status',
  'lia:product-config',
  'lia:runtime-location:clear',
  'lia:runtime-location:pick',
  'lia:runtime-location:status',
  'lia:runtime:state',
  'lia:secrets:presence',
  'lia:stage:start',
  'lia:stage:state',
  'lia:stage:stop',
  'lia:timings',
  'lia:voice-engine:install',
  'lia:voice-engine:state',
  'lia:voice-provisioning:retry',
  'lia:voice-provisioning:state',
  'lia:voices:import',
  'lia:voices:list',
  'lia:voices:pick',
]

describe('launcher IPC surface', () => {
  it('exposes exactly the reviewed channel inventory', () => {
    expect([...CHANNELS].sort()).toEqual(EXPECTED_CHANNELS)
  })

  it('namespaces every channel and never repeats one', () => {
    for (const channel of CHANNELS)
      expect(channel).toMatch(/^lia:[a-z0-9:-]+$/)
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length)
  })

  it('never reads a secret value into the renderer path', () => {
    // The process may ask whether a key EXISTS; it must never return the key.
    expect(SOURCE).not.toMatch(/\bgetSecret\s*\(/)
    expect(SOURCE).not.toMatch(/vault\s*\.\s*getSecret/)
    expect(SOURCE).not.toMatch(/console\.(log|debug|info)\(/)
  })

  it('gates the presence probe on a valid, non-owner credential reference', () => {
    const handler = SOURCE.slice(SOURCE.indexOf("ipcMain.handle('lia:secrets:presence'"))
    expect(handler.slice(0, 400)).toContain('isPublicCredentialReference(providerId, \'apiKey\')')
    expect(handler.slice(0, 400)).toContain('return false')
    expect(handler.slice(0, 400)).toContain('hasSecret(providerId, \'apiKey\')')
  })

  it('binds every AI Settings operation to an explicit provider id', () => {
    // get accepts an optional id (the catalog decides the default); models and
    // test REQUIRE one, and save carries `providerId` inside the envelope.
    expect(SOURCE).toContain("ipcMain.handle('lia:ai:connection:models', (_event, providerId: unknown) => host.aiConnection.discover(providerId))")
    expect(SOURCE).toContain("ipcMain.handle('lia:ai:connection:test', (_event, providerId: unknown) => host.aiConnection.probe(providerId))")
    expect(SOURCE).toContain("ipcMain.handle('lia:ai:connection:save', (_event, input: unknown) => host.aiConnection.save(input))")
    // The renderer never supplies a provider to `providers`: the catalog is fixed.
    expect(SOURCE).toContain("ipcMain.handle('lia:ai:providers', () => host.aiConnection.catalog())")
  })

  it('routes every config write through the sanitizer before the host', () => {
    expect(SOURCE).toContain('host.updateConfig(sanitizeConfigUpdate(payload))')
    // The sanitizer is a separate, Electron-free module with its own tests.
    expect(SOURCE).toContain("import { sanitizeConfigUpdate } from './config-update-sanitizer'")
  })

  it('keeps the file-picker allowlist for voice imports', () => {
    const handler = SOURCE.slice(SOURCE.indexOf("ipcMain.handle('lia:voices:import'"))
    expect(handler.slice(0, 400)).toContain('new Set(lastPickedVoicePaths)')
    expect(SOURCE).toContain('lastPickedVoicePaths = await extras.pickVoiceFiles()')
  })
})
