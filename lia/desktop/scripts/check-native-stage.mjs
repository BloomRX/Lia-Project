import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { _electron } from 'playwright'

import { createRuntimeRegistry, invokeRuntimeControl } from '../../core/src/runtime/index.ts'

async function waitForRecord(registry) {
  const deadline = Date.now() + 10_000
  do {
    const entry = await registry.read()
    if (entry.ok)
      return entry.record
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error('O Stage próprio não publicou seu registro.')
}

async function run() {
  assert.equal(process.platform, 'win32', 'Este gate usa o Electron para Windows.')
  const liaRoot = fileURLToPath(new URL('../../', import.meta.url))
  const airiDirectoryAbsent = !existsSync(join(liaRoot, '..', 'airi'))
  if (process.argv.includes('--require-independent'))
    assert.ok(airiDirectoryAbsent, 'Execute o gate em uma árvore que contém apenas lia/.')

  const root = await mkdtemp(join(tmpdir(), 'lia-native-stage-'))
  const profile = join(root, 'appdata')
  await mkdir(profile)
  const providerId = 'local-chat'
  const modelId = 'local-gate'
  await writeFile(join(root, 'lia-product.json'), JSON.stringify({
    setup: { completed: true },
    provider: { chat: { preferred: { providerId, modelId } } },
  }))
  await writeFile(join(root, 'lia-transports.json'), JSON.stringify({
    schemaVersion: 1,
    revision: 1,
    records: [{
      id: providerId,
      providerId,
      definitionId: providerId,
      type: 'http',
      protocol: 'chat-completions',
      baseUrl: 'http://127.0.0.1:1234/v1',
      modelIds: [modelId],
      adapterOptions: { localOnly: true, allowUnauthenticated: true },
      enabled: true,
      metadata: {},
      credentialRef: { scope: providerId, key: 'apiKey' },
    }],
    tombstones: [],
    migration: { version: 1, imported: [] },
  }))
  const registry = createRuntimeRegistry(join(root, 'runtime', 'native-preview'))
  const packaged = process.argv.includes('--packaged')
  const executablePath = packaged
    ? join(liaRoot, 'desktop', 'dist', 'windows-native-preview', 'win-unpacked', 'Lia.exe')
    : join(liaRoot, 'stage', 'node_modules', 'electron', 'dist', 'electron.exe')
  const app = await _electron.launch({
    executablePath,
    args: packaged ? [] : [join(liaRoot, 'desktop', 'out', 'main', 'index.js')],
    env: { ...process.env, APPDATA: profile, LIA_USER_DATA: root, LIA_NATIVE_STAGE_PREVIEW: packaged ? '0' : '1' },
  })
  let target
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: 'Conversar com Lia', exact: true }).click({ timeout: 10_000 })
    target = await waitForRecord(registry)
    const state = await invokeRuntimeControl(target, 'runtime.status')
    assert.equal(state.windows, 1)
    await page.getByRole('button', { name: 'Encerrar conversa', exact: true }).click({ timeout: 10_000 })
    await page.getByText('Conversa encerrada.', { exact: true }).waitFor({ timeout: 20_000 })
    assert.deepEqual(await registry.read(), { ok: false, problem: 'missing' })
    console.log(JSON.stringify({ airiDirectoryAbsent, packaged, nativeWindows: state.windows, registryRemoved: true }))
  }
  finally {
    try {
      const remaining = await registry.read()
      if (remaining.ok && (!target || remaining.record.instanceId === target.instanceId))
        await invokeRuntimeControl(remaining.record, 'runtime.shutdown').catch(() => {})
    }
    finally {
      await app.close()
    }
  }
}

await run()
