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

/** A host whose install-inspection seam answers `installed`; the engine plug. */
async function makeInstalledHost(seam: (home: string) => Promise<boolean>) {
  const home = await makeLiaHome()
  const host = createLiaHost({
    cipher: identityCipher,
    env: fixtureEnv(home),
    inspectInstallImpl: seam,
    workspaceRoot: '/missing',
  })
  return { home, host }
}

describe('phase 7.4 G/H/I - the configured runtime root (generic, engine-neutral)', () => {
  it('h: with NO configured path the canonical ENGINE-NEUTRAL default remains the effective dir (nothing moves)', async () => {
    const { home, host } = await makeLocationHost()
    const status = await host.runtimeLocationStatus()
    expect(status.customActive).toBe(false)
    expect(status.effectiveInstallDir).toBe(status.canonicalDefaultDir)
    // The canonical home carries no engine name - an engine (Kokoro first)
    // composes its own subdir under it when it lands.
    expect(status.canonicalDefaultDir).toBe(join(home.userData, 'runtimes'))

    // Transitional truth (Phase 7.8E): no engine is hosted, so the honest
    // default answer is installed = false. Directory existence is never proof.
    expect(status.installed).toBe(false)
  })

  it('g: a valid chosen path persists, wins, and reports installed ONLY through the engine seam', async () => {
    const { home, host } = await makeLocationHost()
    const chosen = join(home.userData, '..', 'Lia Voice Runtime')
    await mkdir(chosen, { recursive: true })

    const picked = await host.applyRuntimeLocation(chosen)
    expect(picked.status).toBe('ok')
    if (picked.status !== 'ok')
      return
    expect(picked.note).toBe('new-location-applies-to-future-install')

    // The document carries the exact normalized path from the picker, in the
    // neutral runtime block - never inside an engine's name.
    const document = JSON.parse(await readFile(join(home.userData, 'lia-product.json'), 'utf8'))
    expect(document.voice.runtime.installDir).toBe(chosen)
    expect(document.voice.runtime.f5).toBeUndefined()

    // Directory existence alone proves nothing: installed stays false until
    // the engine's own inspection seam says otherwise.
    const defaultSeam = createLiaHost({
      cipher: identityCipher,
      env: fixtureEnv(home),
      inspectInstallImpl: async () => false,
      workspaceRoot: '/missing',
    })
    expect(await defaultSeam.runtimeLocationStatus()).toMatchObject({
      customActive: true, // the config the first host wrote persists here
      installed: false,
    })

    // ...and when the seam (today: injected; tomorrow: the real engine's
    // adapter) says installed at the chosen root, the host reflects it.
    const proven = await makeInstalledHost(async () => true)
    await proven.host.applyRuntimeLocation(chosen)
    const status = await proven.host.runtimeLocationStatus()
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
    expect(document.voice?.runtime?.installDir).toBeUndefined()
    expect(document.voice?.runtime?.f5).toBeUndefined()
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

  it('h: a CONFIGURED path always wins as the effective dir - the canonical default never outranks an explicit valid config', async () => {
    const { host } = await makeLocationHost()
    const chosen = (await import('node:path')).join('/tmp', 'Lia Explicit Root')
    // The canonical home even existing somewhere does not matter: the config
    // is the single source of truth for WHERE the voice runtime lives.
    const picked = await host.applyRuntimeLocation(chosen)
    expect(picked.status === 'ok' || picked.status === 'rejected').toBe(true)

    const { host: host2 } = await makeLocationHost()
    const chosen2 = join('/tmp', 'Lia Explicit Root 2')
    await host2.applyRuntimeLocation(chosen2)
    const status = await host2.runtimeLocationStatus()
    expect(status.effectiveInstallDir).toBe(chosen2)
    expect(status.customActive).toBe(true)
  })

  it('a configured root is authoritative and HONEST: unproven there reports installed=false (no silent canonical fallback)', async () => {
    // Transitional semantics (Phase 7.8E): the configured root is the only
    // place the host ever looks; an unproven install there is honestly false.
    const { home, host } = await makeLocationHost()
    await mkdir(join(home.userData, 'runtimes'), { recursive: true })
    const chosen = join(home.userData, '..', 'NovoLocal')
    await mkdir(chosen, { recursive: true })
    await host.applyRuntimeLocation(chosen)
    const status = await host.runtimeLocationStatus()
    expect(status.effectiveInstallDir).toBe(chosen)
    expect(status.installed).toBe(false)
  })
})
