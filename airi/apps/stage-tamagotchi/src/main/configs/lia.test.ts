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
      persona: { activeCardId: 'lia' },
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
    // Non-supported version is not a valid v1 doc → auto-healed to the default,
    // whose persona points at the Lia built-in card.
    expect(config.get()?.schemaVersion).toBe(1)
    expect(config.get()?.persona?.activeCardId).toBe('lia')
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

  it('preserves a completed onboarding across a restart (chat target + onboarded marker)', async () => {
    // What "Concluir configuração" leaves on disk. On the next launch `setup()`
    // re-parses the file through the schema, so anything the schema dropped here
    // would silently send an onboarded user back to the first-run screen.
    const { mod } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {
        chat: {
          strategy: 'manual',
          preferred: { providerId: 'openai', modelId: 'gpt-5.5' },
          fallback: [{ providerId: 'groq', modelId: 'llama-3.3-70b-versatile' }],
          fallbackEnabled: true,
          onboarded: true,
        },
      },
      voice: {},
      preferences: {},
    })))
    const config = mod.createLiaProductConfig()
    const chat = config.get()?.provider?.chat

    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(chat?.onboarded).toBe(true)
    expect(chat?.preferred).toEqual({ providerId: 'openai', modelId: 'gpt-5.5' })
    expect(chat?.fallback).toEqual([{ providerId: 'groq', modelId: 'llama-3.3-70b-versatile' }])
  })

  it('round-trips voice.enabled across restart AND the Stage own writes (7.9H-B1)', async () => {
    // What a disabled-voice user leaves on disk (written by the launcher's
    // canonical writer). On the next launch setup() re-parses through the
    // schema - and every later Stage-side update() writes the parsed copy
    // back - so a field the schema dropped would silently re-enable voice.
    const { mod, fs } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: { enabled: false },
      preferences: {},
    })))
    const config = mod.createLiaProductConfig()
    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.voice?.enabled).toBe(false)

    // An unrelated Stage-side write must carry the switch back to disk.
    const current = config.get()!
    config.update({ ...current, preferences: { language: 'pt-BR' } })
    await vi.waitFor(() => {
      expect(fs.writeFile).toHaveBeenCalled()
    })
    const persisted = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string) as Record<string, unknown>
    expect((persisted.voice as Record<string, unknown>).enabled).toBe(false)
    expect(persisted.preferences).toEqual({ language: 'pt-BR' })
  })

  it('round-trips setup.completed across restart AND the Stage own writes (7.9H-B3)', async () => {
    // Same hazard class as voice.enabled: the launcher marks first-run
    // setup complete in the canonical document; the Stage re-parses it at
    // boot and persists its parsed copy on every update() - a field the
    // schema dropped would silently un-complete the setup.
    const { mod, fs } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      setup: { completed: true },
      voice: {},
      preferences: {},
    })))
    const config = mod.createLiaProductConfig()
    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.setup?.completed).toBe(true)

    const current = config.get()!
    config.update({ ...current, preferences: { language: 'pt-BR' } })
    await vi.waitFor(() => {
      expect(fs.writeFile).toHaveBeenCalled()
    })
    const persisted = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string) as Record<string, unknown>
    expect((persisted.setup as Record<string, unknown>).completed).toBe(true)
    expect(persisted.preferences).toEqual({ language: 'pt-BR' })
  })

  it('documents WITHOUT the setup marker stay valid and marker-less (backward compatible, 7.9H-B3)', async () => {
    const { mod } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: {},
      preferences: {},
    })))
    const config = mod.createLiaProductConfig()
    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.setup).toBeUndefined()
  })

  it('absent voice.enabled reads back absent - the product default stays implicit (7.9H-B1)', async () => {
    const { mod } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: {},
      preferences: {},
    })))
    const config = mod.createLiaProductConfig()
    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.voice?.enabled).toBeUndefined()
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
    expect(product.get()?.persona).toEqual({ activeCardId: 'lia' })
    expect(product.get()?.schemaVersion).toBe(1)
  })

  it('brain selection survives the Stage parse/write round-trip (8.0B-2)', async () => {
    // What the launcher's Brain preference leaves on disk. On the next Stage
    // launch `setup()` re-parses the file through the schema, and any later
    // Stage-side write persists the parsed copy - so a field the schema
    // dropped here would silently erase the user's Brain choice.
    const { mod, fs } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: {},
      preferences: {},
      brain: {
        engine: { preferred: 'engine-alpha' },
        model: { preferred: 'model-alpha' },
      },
    })))
    const config = mod.createLiaProductConfig()

    // Parse keeps both branches...
    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.brain?.engine?.preferred).toBe('engine-alpha')
    expect(config.get()?.brain?.model?.preferred).toBe('model-alpha')

    // ...and an unrelated Stage-side update rewrites the document WITH the
    // selection still inside it.
    config.update({
      ...config.get()!,
      preferences: { language: 'pt-BR' },
    })
    expect(config.get()?.brain?.engine?.preferred).toBe('engine-alpha')
    expect(config.get()?.brain?.model?.preferred).toBe('model-alpha')

    await vi.waitFor(() => {
      expect(fs.writeFile).toHaveBeenCalled()
    })
    const written = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string
    const persisted = JSON.parse(written) as Record<string, any>
    expect(persisted.brain).toEqual({
      engine: { preferred: 'engine-alpha' },
      model: { preferred: 'model-alpha' },
    })
    expect(persisted.preferences?.language).toBe('pt-BR')
  })

  it('brain routing mode survives the Stage parse/write round-trip (8.0C-3A)', async () => {
    // Same anti-stripping duty as voice.enabled / setup.completed: the mode
    // is the user's routing intent, and a Stage-side write must carry it.
    const { mod, fs } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: {},
      preferences: {},
      brain: {
        mode: 'manual',
        engine: { preferred: 'engine-alpha' },
        model: { preferred: 'model-alpha' },
      },
    })))
    const config = mod.createLiaProductConfig()

    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.brain?.mode).toBe('manual')
    expect(config.get()?.brain?.engine?.preferred).toBe('engine-alpha')

    // An unrelated update rewrites the document WITH mode + selections.
    config.update({
      ...config.get()!,
      preferences: { language: 'pt-BR' },
    })
    expect(config.get()?.brain?.mode).toBe('manual')

    await vi.waitFor(() => {
      expect(fs.writeFile).toHaveBeenCalled()
    })
    const persisted = JSON.parse((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string) as Record<string, any>
    expect(persisted.brain).toEqual({
      mode: 'manual',
      engine: { preferred: 'engine-alpha' },
      model: { preferred: 'model-alpha' },
    })
  })

  it('an invalid brain.mode never becomes canonical state - the doc auto-heals like any invalid v1 document (8.0C-3A)', async () => {
    // Stage validation is strict: a non-canonical mode makes the whole
    // document invalid, so it auto-heals back to the default (with a .bak
    // attempt) - the bogus mode can never round-trip as stored state.
    // (The launcher's own tolerant reader degrades gracefully instead -
    // proven in lia-core's product config suite.)
    const { mod, fs } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      brain: {
        mode: 'turbo',
        engine: { preferred: 'engine-alpha' },
      },
    })))
    const config = mod.createLiaProductConfig()
    expect(config.get()?.schemaVersion).toBe(1)
    expect(config.get()?.brain?.mode).toBeUndefined()
    await vi.waitFor(() => {
      expect(fs.copyFile).toHaveBeenCalled()
    })
  })

  it('documents without brain stay valid for the Stage (additive schema)', async () => {
    const { mod } = await loadModules(invalidFileMocks('/tmp/u', JSON.stringify({
      schemaVersion: 1,
      persona: { activeCardId: 'lia' },
      provider: {},
      voice: {},
      preferences: {},
    })))
    const config = mod.createLiaProductConfig()
    expect(config.getDiagnostics()?.status).toBe('ok')
    expect(config.get()?.brain).toBeUndefined()
  })
})
