import { describe, expect, it, vi } from 'vitest'

import { createLiaVoiceEngineService } from './voice-engine-service'

/**
 * Phase 7.9G: the launcher's Voice Engine surface/service. Proven with a
 * togglable install inspector, a spyable ENGINE-owned install seam, a
 * fixture config document and a recorded event rail - no Electron, no
 * disk, so the product rules (single-flight install, restart-safety by
 * delegation, honest selection semantics) are asserted exactly.
 */

type InstallImpl = (layout: { rootDir: string }, onStep: (step: string, detail?: string) => void) => Promise<void>

function makeDeps(overrides: {
  installError?: Error
  installImpl?: InstallImpl
  installed?: { value: boolean }
  preferredEngine?: string
  root?: string
} = {}) {
  const events: { detail?: string, event: string }[] = []
  const installed = overrides.installed ?? { value: false }
  const stepCalls: string[] = []
  const installImpl = overrides.installImpl ?? vi.fn(async (_layout, onStep) => {
    if (overrides.installError)
      throw overrides.installError
    onStep('deps')
  }) as unknown as InstallImpl
  const snapshot = overrides.preferredEngine
    ? { voice: { engine: { preferred: overrides.preferredEngine } } }
    : {}
  const deps = {
    effectiveHome: async () => overrides.root ?? '/tmp/lia-runtimes',
    inspector: async (_home: string, _platform?: string) => installed.value,
    installImpl: installImpl as never,
    onEvent: (event: string, detail?: string) => events.push({ detail, event }),
    snapshot: async () => snapshot as never,
  }
  return { deps, events, installed, installImpl: installImpl as unknown as ReturnType<typeof vi.fn>, stepCalls }
}

describe('createLiaVoiceEngineService (7.9G product Voice Engine surface)', () => {
  it('missing Kokoro: one engine row - not installed, not selectable, default-selected honestly', async () => {
    const { deps } = makeDeps()
    const service = createLiaVoiceEngineService(deps)
    const state = await service.state()
    expect(state.phase).toBe('idle')
    expect(state.selectedId).toBe('kokoro') // legacy/fresh default (7.9F)
    expect(state.engines).toHaveLength(1)
    expect(state.engines[0]).toMatchObject({
      id: 'kokoro',
      installed: false,
      selectable: false,
      selected: true,
    })
  })

  it('installed Kokoro with explicit selection: the row is installed/selectable/selected', async () => {
    const { deps } = makeDeps({ installed: { value: true }, preferredEngine: 'kokoro' })
    const state = await createLiaVoiceEngineService(deps).state()
    expect(state.engines[0]).toMatchObject({ installed: true, selectable: true, selected: true })
    expect(state.selectedId).toBe('kokoro')
  })

  it('unknown configured engine id: no rows, honest unavailable flag, no silent fallback', async () => {
    const { deps } = makeDeps({ preferredEngine: 'mister-voice-engine' })
    const state = await createLiaVoiceEngineService(deps).state()
    expect(state.engines).toHaveLength(0)
    expect(state.unknownConfiguredId).toBe('mister-voice-engine')
    expect(state.selectedId).toBeUndefined()
  })

  it('install: ONE action runs the ENGINE-owned installer on the ENGINE-declared layout, then state refreshes to ready', async () => {
    const { deps, events, installImpl, installed } = makeDeps({ root: '/tmp/lia-runtimes' })
    const service = createLiaVoiceEngineService(deps)

    const result = await service.install()
    expect(result).toEqual({ status: 'installed' })
    // The layout comes from the engine's own authority - the service never
    // hand-composes a path.
    expect(installImpl).toHaveBeenCalledTimes(1)
    expect(installImpl.mock.calls[0][0]).toMatchObject({ rootDir: '/tmp/lia-runtimes/kokoro' })
    expect(events).toContainEqual({ detail: 'phase=installing', event: 'lia-app.voice-install' })
    expect(events).toContainEqual({ detail: 'phase=installing step=deps', event: 'lia-app.voice-install' })
    expect(events).toContainEqual({ detail: 'result=ready', event: 'lia-app.voice-install' })

    // Success refreshes the truth: the real proof flips and the row is ready.
    installed.value = true
    const after = await service.state()
    expect(after.phase).toBe('idle')
    expect(after.engines[0]).toMatchObject({ installed: true, selectable: true })
  })

  it('install failure: honest, recoverable - a later click retries the engine installer', async () => {
    const { deps, events, installImpl } = makeDeps({ installError: new Error('network unreachable') })
    const service = createLiaVoiceEngineService(deps)
    expect(await service.install()).toEqual({ status: 'failed' })
    expect((await service.state()).phase).toBe('error')
    expect(events).toContainEqual({ detail: 'result=failed detail=network unreachable', event: 'lia-app.voice-install' })

    // Recovery: the engine installer completes on retry.
    installImpl.mockImplementation(async (_layout, onStep) => {
      onStep('deps')
    })
    expect(await service.install()).toEqual({ status: 'installed' })
    expect(installImpl).toHaveBeenCalledTimes(2)
  })

  it('single-flight install: a second click while installing never doubles', async () => {
    const { deps } = makeDeps()
    let resolveInstall!: () => void
    deps.installImpl = vi.fn(async (_layout, _onStep) => {
      await new Promise<void>((resolve) => {
        resolveInstall = resolve
      })
    }) as never
    const service = createLiaVoiceEngineService(deps)
    const first = service.install()
    expect((await service.state()).phase).toBe('installing')
    expect(await service.install()).toEqual({ status: 'running' })
    resolveInstall()
    expect(await first).toEqual({ status: 'installed' })
    expect(deps.installImpl).toHaveBeenCalledTimes(1)
  })

  it('inspect failure: honestly error, never a fabricated installed state', async () => {
    const { deps, events } = makeDeps()
    const service = createLiaVoiceEngineService({
      ...deps,
      inspector: async () => {
        throw new Error('probe exploded')
      },
    })
    const state = await service.state()
    expect(state.phase).toBe('error')
    expect(state.engines[0]).toMatchObject({ installed: false })
    expect(events.some(entry => entry.detail?.startsWith('reason=inspect-failed'))).toBe(true)
  })

  it('restart-safety contract: install ALWAYS delegates (the ENGINE markers own the skip)', async () => {
    const { deps, installImpl } = makeDeps({ installed: { value: true } })
    // Even with a proven install on disk the service keeps no own skip
    // heuristic - the engine installer's markers decide what is done.
    const service = createLiaVoiceEngineService(deps)
    await service.install()
    expect(installImpl).toHaveBeenCalledTimes(1)
  })
})
