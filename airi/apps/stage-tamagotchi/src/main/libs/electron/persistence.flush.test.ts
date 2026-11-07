import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultPresence } from '../../../../../../../lia/core/src/presence'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture() {
  const files = new Map<string, string>()
  let disk = ''
  const mkdir = vi.fn(async () => {})
  const rename = vi.fn(async (from: string) => {
    disk = files.get(from)!
  })
  const writeFile = vi.fn(async (path: string, data: string) => {
    files.set(path, data)
  })
  const unlink = vi.fn(async (path: string) => {
    files.delete(path)
  })
  vi.doMock('electron', () => ({ app: { getPath: () => '/fixture' } }))
  vi.doMock('node:fs', () => ({ existsSync: () => disk !== '', readFileSync: () => disk }))
  vi.doMock('node:fs/promises', () => ({ mkdir, rename, writeFile, unlink, copyFile: vi.fn() }))
  const { createLiaProductConfig } = await import('../../configs/lia')
  const { createProductLanguage } = await import('../i18n/product-language')
  const config = createLiaProductConfig()
  return { config, restart: createLiaProductConfig, language: createProductLanguage(config), mkdir, rename, writeFile, unlink, files, disk: () => JSON.parse(disk) }
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('confirmed serialized product persistence', () => {
  it('flush commits a throttled voice update and does not permit a late stale write after language', async () => {
    const { config, language, disk, writeFile } = await fixture()
    config.update({ ...config.get()!, setup: { completed: true } })
    await config.flush()
    // This second legacy update is inside the real throttle window.
    config.update({ ...config.get()!, voice: { enabled: false } })
    await language.set('ja')
    expect(disk()).toMatchObject({ preferences: { language: 'ja' }, voice: { enabled: false }, setup: { completed: true } })
    const writes = writeFile.mock.calls.length
    await vi.runAllTimersAsync()
    await config.flush()
    expect(writeFile).toHaveBeenCalledTimes(writes)
    expect(disk().preferences.language).toBe('ja')
  })

  it('two mutators compose committed snapshots while mkdir and rename are pending and commits stay ordered', async () => {
    const { config, language, mkdir, rename, writeFile, disk } = await fixture()
    const mkdirEntered = deferred()
    const mkdirGate = deferred()
    const renameEntered = deferred()
    const renameGate = deferred()
    mkdir.mockImplementationOnce(async () => {
      mkdirEntered.resolve()
      await mkdirGate.promise
    })
    rename.mockImplementationOnce(async (path) => {
      renameEntered.resolve()
      await renameGate.promise
      // Delegate snapshot publication to the next successful write; this gate
      // measures ordering independently of the in-memory disk fixture.
      expect(path).toBe(writeFile.mock.calls[0][0])
    })
    let firstCommitted = false
    const first = language.set('en').then(() => {
      firstCommitted = true
    })
    await mkdirEntered.promise
    const second = config.updateAndSave(current => ({ ...current, voice: { ...current.voice, enabled: false } }))
    expect(config.get()).toMatchObject({ preferences: {}, voice: {} })
    expect(mkdir).toHaveBeenCalledTimes(1)
    expect(firstCommitted).toBe(false)
    mkdirGate.resolve()
    await renameEntered.promise
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(mkdir).toHaveBeenCalledTimes(1)
    expect(firstCommitted).toBe(false)
    renameGate.resolve()
    await Promise.all([first, second])
    expect(disk()).toMatchObject({ preferences: { language: 'en' }, voice: { enabled: false } })
    expect(writeFile.mock.calls.map(([, data]) => JSON.parse(data))).toMatchObject([
      { preferences: { language: 'en' }, voice: {} },
      { preferences: { language: 'en' }, voice: { enabled: false } },
    ])
    await vi.runAllTimersAsync()
    expect(writeFile).toHaveBeenCalledTimes(2)
  })

  it('failed commit rejects without publishing and a new transaction can retry without an unhandled rejection', async () => {
    const { config, language, rename, writeFile, unlink, files, disk } = await fixture()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await language.set('en')
    rename.mockRejectedValueOnce(new Error('rename denied'))
    await expect(language.set('ja')).rejects.toThrow('rename denied')
    expect(config.get()?.preferences.language).toBe('en')
    expect(disk().preferences.language).toBe('en')
    const failedTemp = writeFile.mock.calls.at(-1)![0]
    expect(unlink).toHaveBeenCalledWith(failedTemp)
    expect(files.has(failedTemp)).toBe(false)
    await language.set('ja')
    expect(disk().preferences.language).toBe('ja')
  })

  it('a later queued update recovers after an earlier commit fails without persisting rejected state', async () => {
    const { config, language, mkdir, disk } = await fixture()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mkdir.mockRejectedValueOnce(new Error('mkdir denied'))
    const first = expect(language.set('ja')).rejects.toThrow('mkdir denied')
    const second = config.updateAndSave(current => ({ ...current, voice: { enabled: false } }))
    await Promise.all([first, second])
    expect(disk()).toMatchObject({ preferences: {}, voice: { enabled: false } })
  })

  it('failed presence transaction cannot be resurrected by a successful language save or restart', async () => {
    const { config, language, rename, disk, restart } = await fixture()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await config.updateAndSave(current => ({ ...current, presence: { ...defaultPresence } }))
    rename.mockRejectedValueOnce(new Error('presence denied'))
    const rejectedPresence = expect(config.updateAndSave(current => ({
      ...current,
      presence: { ...current.presence!, paused: true },
    }))).rejects.toThrow('presence denied')
    const acceptedLanguage = language.set('ja')
    await Promise.all([rejectedPresence, acceptedLanguage])
    expect(config.get()?.presence?.paused).toBe(false)
    expect(disk()).toMatchObject({ preferences: { language: 'ja' }, presence: { paused: false } })
    expect(restart().get()).toMatchObject({ preferences: { language: 'ja' }, presence: { paused: false } })
  })
})
