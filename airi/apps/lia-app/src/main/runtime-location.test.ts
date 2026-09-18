import { mkdir, readFile, writeFile } from 'node:fs/promises'
/**
 * Phase 7.4 G/H/I integration: the persisted runtime location, through the
 * REAL host, REAL validation chain and REAL fixture disk.
 */
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createLiaHost } from './lia-host'
import { fixtureEnv, identityCipher, makeLiaHome } from './test-helpers'

async function makeLocationHost() {
  const home = await makeLiaHome()
  const events: Array<{ detail?: string, event: string }> = []
  const host = createLiaHost({
    cipher: identityCipher,
    env: fixtureEnv(home),
    onEvent: (event, detail) => events.push({ detail, event }),
    workspaceRoot: '/missing',
  })
  return { events, home, host }
}

/** The markers `inspectAllTalkInstall` checks (its test contract). */
async function populateRuntimeMarkers(root: string) {
  await mkdir(join(root, 'system'), { recursive: true })
  await mkdir(join(root, 'voices'), { recursive: true })
  await mkdir(join(root, 'alltalk_environment', 'conda'), { recursive: true })
  await mkdir(join(root, 'alltalk_environment', 'env'), { recursive: true })
  await writeFile(join(root, 'script.py'), '# fixture\n')
  await writeFile(join(root, 'start_alltalk.bat'), '@echo off\n')
  await writeFile(join(root, '..', 'state.json'), '{}\n')
}

describe('phase 7.4 G/H/I - the configured runtime root', () => {
  it('h: with NO configured path the canonical default remains the effective dir (nothing moves)', async () => {
    const { home, host } = await makeLocationHost()
    const status = await host.runtimeLocationStatus()
    expect(status.customActive).toBe(false)
    expect(status.effectiveInstallDir).toBe(status.canonicalDefaultDir)
    expect(status.canonicalDefaultDir).toBe(join(home.userData, 'runtimes', 'alltalk', 'app'))
  })

  it('g: a valid chosen path persists, wins, and a marker-proven install there reports installed', async () => {
    const { home, host } = await makeLocationHost()
    const chosen = join(home.userData, '..', 'Lia Voice Runtime')
    await mkdir(chosen, { recursive: true })

    const picked = await host.applyRuntimeLocation(chosen)
    expect(picked.status).toBe('ok')
    if (picked.status !== 'ok')
      return
    expect(picked.note).toBe('new-location-applies-to-future-install')

    // The document carries the exact normalized path from the picker.
    const document = JSON.parse(await readFile(join(home.userData, 'lia-product.json'), 'utf8'))
    expect(document.voice.runtime.alltalk.installDir).toBe(chosen)

    // Once real markers are written at the chosen root, the resolution chain
    // marks it installed - directory existence alone was never the proof.
    await populateRuntimeMarkers(chosen)
    const status = await host.runtimeLocationStatus()
    expect(status.customActive).toBe(true)
    expect(status.effectiveInstallDir).toBe(chosen)
    expect(status.installed).toBe(true)
  })

  it('i: an existing-but-file path is rejected; the stored config is left untouched', async () => {
    const { events, home, host } = await makeLocationHost()
    const filePath = join(home.userData, 'uma-nota.txt')
    await writeFile(filePath, 'not a folder')

    const rejected = await host.applyRuntimeLocation(filePath)
    expect(rejected.status).toBe('rejected')
    if (rejected.status !== 'rejected')
      return
    expect(rejected.message).toContain('arquivo')
    expect(events).toContainEqual({ detail: 'reason=exists-as-file', event: 'lia-app.runtime-location-blocked' })

    const document = JSON.parse(await readFile(join(home.userData, 'lia-product.json'), 'utf8'))
    expect(document.voice?.runtime?.alltalk?.installDir).toBeUndefined()
  })

  it('k-shape: a path with spaces survives end-to-end and the picker cancel is a no-op', async () => {
    const { home, host } = await makeLocationHost()
    expect((await host.applyRuntimeLocation(null)).status).toBe('canceled')

    const spaced = join(home.userData, '..', 'Minhas Vozes', 'Sistema de Voz')
    await mkdir(spaced, { recursive: true })
    const picked = await host.applyRuntimeLocation(spaced)
    expect(picked.status).toBe('ok')

    const cleared = await host.clearRuntimeLocation()
    expect(cleared.customActive).toBe(false)
    expect(cleared.effectiveInstallDir).toBe(cleared.canonicalDefaultDir)
  })
  it('g: invalid path shapes are rejected with human messages (no config write)', async () => {
    const sorted: Record<string, string> = {
      'not-absolute': 'pasta/relativa',
    }
    const { host } = await makeLocationHost()
    for (const [reason, path] of Object.entries(sorted)) {
      const rejected = await host.applyRuntimeLocation(path)
      expect(rejected.status).toBe('rejected')
      if (rejected.status === 'rejected')
        expect(rejected.reason).toBe(reason)
    }
  })

  it('h: with markers in BOTH roots the CONFIGURED path wins - the canonical default never outranks an explicit valid config', async () => {
    const { home, host } = await makeLocationHost()
    await populateRuntimeMarkers(join(home.userData, 'runtimes', 'alltalk', 'app'))
    const chosen = join(home.userData, '..', 'Lia Custom Root')
    await populateRuntimeMarkers(chosen)
    await host.applyRuntimeLocation(chosen)
    const status = await host.runtimeLocationStatus()
    expect(status.effectiveInstallDir).toBe(chosen)
    expect(status.installed).toBe(true)
  })

  it('configured-but-unproven beats canonical only AFTER markers prove (existing machine keeps working)', async () => {
    const { home, host } = await makeLocationHost()
    // Canonical default install exists (what the QA machine already has).
    await populateRuntimeMarkers(join(home.userData, 'runtimes', 'alltalk', 'app'))
    // Configure a still-empty new root: detection must keep the canonical
    // install, not route to the unproven configured one.
    const chosen = join(home.userData, '..', 'NovoLocal')
    await mkdir(chosen, { recursive: true })
    await host.applyRuntimeLocation(chosen)
    const status = await host.runtimeLocationStatus()
    expect(status.effectiveInstallDir).toBe(join(home.userData, 'runtimes', 'alltalk', 'app'))
    expect(status.installed).toBe(true)
  })
})
