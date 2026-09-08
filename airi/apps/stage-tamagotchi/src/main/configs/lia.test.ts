import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The config module (and `createConfig`) imports `electron` / `es-toolkit` /
 * node fs at module load, so each test rebuilds the module graph with the same
 * mocking approach used by `../libs/electron/persistence.test.ts`.
 */

interface FsMocks {
  userData: string
  existsSync: () => boolean
  readFileSync: () => string
  copyFile?: ReturnType<typeof vi.fn>
  mkdir?: ReturnType<typeof vi.fn>
  rename?: ReturnType<typeof vi.fn>
  writeFile?: ReturnType<typeof vi.fn>
}

async function loadModules(fs: FsMocks) {
  const copyFile = fs.copyFile ?? vi.fn(async () => {})
  const mkdir = fs.mkdir ?? vi.fn(async () => {})
  const rename = fs.rename ?? vi.fn(async () => {})
  const writeFile = fs.writeFile ?? vi.fn(async () => {})

  vi.doMock('electron', () => ({
    app: { getPath: vi.fn(() => fs.userData) },
  }))
  // Unwrap the 250ms save throttle so updates flush synchronously in tests.
  vi.doMock('es-toolkit', () => ({
    throttle: (handler: (...args: unknown[]) => unknown) => handler,
  }))
  vi.doMock('node:fs', () => ({
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
  }))
  vi.doMock('node:fs/promises', () => ({
    copyFile,
    mkdir,
    rename,
    writeFile,
  }))

  const mod = await import('./lia')
  return { mod, fs: { copyFile, mkdir, rename, writeFile } }
}

function missingFileMocks(userData: string): FsMocks {
  return {
    userData,
    existsSync: () => false,
    readFileSync: () => '',
  }
}

function invalidFileMocks(userData: string, raw: string): FsMocks {
  return {
    userData,
    existsSync: () => true,
    readFileSync: () => raw,
  }
}

describe('lia product config', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('exposes the supported schema version and an explicit default shape', async () => {
    const { mod } = await loadModules(missingFileMocks('/tmp/u'))
    expect(mod.LIA_PRODUCT_SCHEMA_VERSION).toBe(1)
    expect(mod.defaultLiaProductConfig).toEqual({
      schemaVersion: 1,
      persona: {},
      provider: {},
      voice: {},
      preferences: {},
    })
  })

  it('fresh install: setup reports "missing" and get returns the default', async () => {
    const { mod } = await loadModules(missingFileMocks('/tmp/u'))
    const config = mod.createLiaProductConfig()
    expect(config.getDiagnostics()?.status).toBe('missing')
    expect(config.get()).toEqual(mod.defaultLiaProductConfig)
  })

  it('update then get returns the new value and persists to userData/lia-product.json', async () => {
    const { mod, fs } = await loadModules(missingFileMocks('/tmp/u'))
    const config = mod.createLiaProductConfig()

    config.update({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: {},
      preferences: { language: 'pt-BR' },
    })

    expect(config.get()?.persona?.activeCardId).toBe('lia')
    expect(config.get()?.preferences?.language).toBe('pt-BR')
    expect(config.get()?.schemaVersion).toBe(1)

    await vi.waitFor(() => {
      expect(fs.writeFile).toHaveBeenCalled()
    })
    const writtenPath = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(writtenPath).toMatch(/lia-product\.json/)
  })

  it('rejects/auto-heals an unsupported schemaVersion back to the default (keeping a .bak)', async () => {
    const { mod, fs } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 99,
      persona: { activeCardId: 'future' },
    })))

    const config = mod.createLiaProductConfig()
    // Non-supported version is not a valid v1 doc → auto-healed to the default.
    expect(config.get()?.schemaVersion).toBe(1)
    expect(config.get()?.persona?.activeCardId).toBeUndefined()
    // A backup of the invalid file must be attempted.
    await vi.waitFor(() => {
      expect(fs.copyFile).toHaveBeenCalled()
    })
  })

  it('accepts a valid versioned document and preserves its content', async () => {
    const { mod } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: {},
      preferences: {},
    })))
    const config = mod.createLiaProductConfig()
    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.persona?.activeCardId).toBe('lia')
  })

  it('persists to a distinct file from the main-window sizing config (lia-product.json vs lia-main-window.json)', async () => {
    const { mod } = await loadModules(missingFileMocks('/tmp/u'))
    const product = mod.createLiaProductConfig()

    // Diagnostics expose the on-disk path for the product config.
    const productPath = product.getDiagnostics()?.path
    expect(productPath).toMatch(/lia-product\.json$/)
    expect(productPath).not.toMatch(/lia-main-window\.json$/)

    // Window sizing is owned by a separate config instance + file in the main
    // window module (`windows/main/index.ts`), which this module never touches.
    const { createConfig } = await import('../libs/electron/persistence')
    const { liaMainWindowStateSchema } = await import('../windows/main/window-sizing')
    const windowConfig = createConfig('lia', 'main-window.json', liaMainWindowStateSchema, { default: {}, autoHeal: true })
    windowConfig.setup()

    // Product config file and window-state config are independent on disk.
    expect(windowConfig.getDiagnostics()?.path).toMatch(/lia-main-window\.json$/)
    expect(windowConfig.getDiagnostics()?.path).not.toBe(productPath)

    // Writing to the window-state config must not affect the product config.
    windowConfig.update({ home: { width: 460, height: 640 } })
    expect(product.get()?.persona).toEqual({})
    expect(product.get()?.schemaVersion).toBe(1)
  })
})
