/**
 * Phase 6 hotfix round 5, item C, the exact bug end to end:
 *
 *   previous Lia's runtime is already healthy on the port
 *   -> this launch's autostart classifies health=alltalk
 *   -> adopted-lia-managed-instance (round 6: adopt ONLY with ownership proof)
 *   -> the snapshot IS ready at that moment
 *   -> the publisher emits `status=ready trigger=runtime.adopted-lia-managed-instance`
 *   -> a real renderer subscriber receives { state: 'ready' }
 *
 * The QA evidence this locks down: the adopt happened, the round-4 publisher
 * re-read a snapshot that still said 'stopped' (emit-before-set inside the
 * manager), the dedupe swallowed the only ready there would ever be, and the
 * card vanished instead of saying "Sistema de voz pronto".
 *
 * The manager here is REAL: only the wire underneath it is faked (health
 * client, ports, ports ownership, Electron shell, install directory). Any
 * regression in set/emit ordering breaks the publish-line assertion.
 */
import type { LiaRuntimeState } from '../../../shared/eventa'

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defineInvoke } from '@moeru/eventa'
import { createContext as createMainContext } from '@moeru/eventa/adapters/electron/main'
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { electronLiaRuntimeChanged, electronLiaRuntimeStart } from '../../../shared/eventa'

/** A tree the manager's isInstalled accepts as complete. */
async function installedDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lia-adopt-publish-'))
  await Promise.all([
    writeFile(join(dir, 'script.py'), ''),
    mkdir(join(dir, 'system')),
    mkdir(join(dir, 'voices')),
    mkdir(join(dir, 'alltalk_environment', 'conda'), { recursive: true }),
    mkdir(join(dir, 'alltalk_environment', 'env'), { recursive: true }),
  ])
  return dir
}

const { installDirHolder } = vi.hoisted(() => ({
  installDirHolder: { current: '/tmp/lia-adopt-publish-unset' },
}))

vi.mock('electron', () => ({
  app: {
    getPath: (_name: string) => '/tmp/lia-adopt-publish',
    on: (_event: string, _listener: (...args: unknown[]) => void) => undefined,
  },
  BrowserWindow: class {},
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
}))

vi.mock('./voice-runtime-bootstrap-electron', async (importOriginal) => {
  const original = await importOriginal<typeof import('./voice-runtime-bootstrap-electron')>()
  return { ...original, runtimeAppDir: () => installDirHolder.current }
})

vi.mock('./alltalk-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./alltalk-client')>()
  return {
    ...original,
    // The previous Lia's server: healthy, AllTalk-shaped, from the first ask.
    // That is the whole fixture - classify must see health=alltalk.
    createAllTalkClient: () => ({ status: async () => ({ ok: true }) }),
  }
})

vi.mock('./alltalk-port-diagnostics', async (importOriginal) => {
  const original = await importOriginal<typeof import('./alltalk-port-diagnostics')>()
  return {
    ...original,
    // The QA round-6 tree: a python listener under the install root whose
    // parent is the supervised cmd.exe launcher of start_alltalk.bat.
    gatherPortOwners: async () => [{
      created: '20260915130000.000000+000',
      cmdline: 'python script.py',
      exe: `${installDirHolder.current}/venv/python.exe`,
      parentPid: 9001,
      pid: 9002,
    }],
    inspectProcessRecord: async (_deps: unknown, pid: number) => pid === 9001
      ? {
          created: '20260915130000.000000+000',
          cmdline: 'cmd.exe /d /s /c start_alltalk.bat',
          exe: 'C:\\Windows\\System32\\cmd.exe',
          parentPid: 555,
          pid: 9001,
        }
      : pid === 555
        ? { created: '20260915080000.000000+000', exe: 'C:\\Windows\\explorer.exe', pid: 555 }
        : undefined,
  }
})

vi.mock('./alltalk-port-listeners', () => ({
  loopbackHostFor: (baseUrl: string) => baseUrl,
  probeTcpListeners: async () => 'occupied' as const,
}))

type Listener = (...args: unknown[]) => void

/** One in-memory IPC pair, the same construction the bridge suites use. */
function makeTransport() {
  const mainListeners = new Map<string, Listener[]>()
  const rendererListeners = new Map<string, Listener[]>()
  const add = (map: Map<string, Listener[]>) => (channel: string, listener: Listener) => {
    map.set(channel, [...(map.get(channel) ?? []), listener])
  }
  const remove = (map: Map<string, Listener[]>) => (channel: string, listener: Listener) => {
    map.set(channel, (map.get(channel) ?? []).filter(l => l !== listener))
  }
  const deliver = (map: Map<string, Listener[]>) => (channel: string, ...args: unknown[]) => {
    for (const listener of map.get(channel) ?? [])
      listener({}, ...args)
  }
  const sender = { isDestroyed: () => false, send: deliver(rendererListeners) }
  return {
    ipcMain: { off: remove(mainListeners), on: add(mainListeners) },
    ipcRenderer: {
      on: add(rendererListeners),
      removeListener: remove(rendererListeners),
      send: (channel: string, ...args: unknown[]) => {
        for (const listener of mainListeners.get(channel) ?? [])
          listener(sender, ...args)
      },
    },
    window: { isDestroyed: () => false, webContents: { id: 1, send: deliver(rendererListeners) } },
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++)
    await new Promise(resolve => setTimeout(resolve, 0))
}

describe('the adopt boot, round-5 item C: ready must reach the renderer when the instance was already there', () => {
  let dir = ''
  beforeEach(async () => {
    vi.restoreAllMocks()
    dir = await installedDir()
    installDirHolder.current = dir
  })
  afterEach(() => {
    installDirHolder.current = '/tmp/lia-adopt-publish-unset'
  })

  it('start-request -> classified health=alltalk -> adopted -> PUBLISHED ready -> renderer ready', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const { registerLiaRuntimeBridge } = await import('./alltalk-runtime-service')
    const transport = makeTransport()
    const { context: mainContext } = createMainContext(transport.ipcMain as never, transport.window as never)
    registerLiaRuntimeBridge({
      context: mainContext,
      liaProductConfig: { get: () => undefined, update: () => undefined },
    })

    const { context: rendererContext } = createRendererContext(transport.ipcRenderer as never)
    const received: LiaRuntimeState[] = []
    rendererContext.on(electronLiaRuntimeChanged, (event) => {
      if (event.body)
        received.push(event.body)
    })

    const startVoice = defineInvoke(rendererContext, electronLiaRuntimeStart)
    const answer = await startVoice()
    await flush()

    // 1-5: the manager half of the chain, in the log's own words.
    expect(answer?.state).toBe('ready')
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-RUNTIME]', expect.any(String), 'runtime.classified', 'health=alltalk occupancy=skipped')
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-RUNTIME]', expect.any(String), 'runtime.adopted-lia-managed-instance', 'classification=lia-managed rootPid=9001')
    // THE round-5 line: the ready announcement, carrying the adopt trigger,
    // with the snapshot already saying ready at emit time. Emit-before-set
    // regression -> this line reads status=stopped (or never exists) and the
    // renderer assertion below dies with it.
    expect(consoleInfo).toHaveBeenCalledWith('[LIA-VOICE-RUNTIME] runtime.state-published', 'status=ready', 'trigger=runtime.adopted-lia-managed-instance')

    // 6: the renderer heard it.
    expect(received).toContainEqual({ state: 'ready' })
    expect(received[received.length - 1]).toEqual({ state: 'ready' })
  })
})
