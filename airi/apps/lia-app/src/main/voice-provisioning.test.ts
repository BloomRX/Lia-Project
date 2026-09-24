import type { LiaVoiceInstallOutcome, LiaVoiceProvisioningDeps, LiaVoiceProvisioningStatus } from './voice-provisioning'

import { describe, expect, it } from 'vitest'

import { createLiaVoiceProvisioning } from './voice-provisioning'

/**
 * Phase 7.9H: automatic first-run voice provisioning, exercised against
 * injected seams - no real Kokoro download, no real disk. The install
 * outcome is a controllable promise; install events are emitted through
 * the same listener rail the production wiring uses.
 */

interface Listener {
  (event: string, detail?: string): void
}

interface TestWorld {
  counter: { installCalls: number }
  deps: LiaVoiceProvisioningDeps
  emit: (event: string, detail?: string) => void
  inspectedHomes: string[]
  resolveInstall: (outcome: LiaVoiceInstallOutcome) => void
  /** Pushes an already-settled outcome for the NEXT install attempt. */
  stageOutcome: (outcome: LiaVoiceInstallOutcome) => void
  statuses: LiaVoiceProvisioningStatus[]
}

function makeWorld(options: {
  enabled?: boolean
  home?: string
  installed?: boolean
  outcome?: LiaVoiceInstallOutcome
  preferred?: string
} = {}): TestWorld {
  const listeners = new Set<Listener>()
  const statuses: LiaVoiceProvisioningStatus[] = []
  const inspectedHomes: string[] = []
  const counter = { installCalls: 0 }
  // Disk facts: a successful installer writes its markers, so later checks
  // see "installed" - the same truth the engine guarantees on real disks.
  const facts = { installed: options.installed ?? false }
  const outcomeQueue: Promise<LiaVoiceInstallOutcome>[] = []
  let resolver: ((outcome: LiaVoiceInstallOutcome) => void) | undefined
  const deferredOutcome = new Promise<LiaVoiceInstallOutcome>((resolve) => {
    resolver = resolve
  })
  const home = options.home ?? 'C:/Users/qa/AppData/Local/Lia/runtimes'

  const voice: Record<string, unknown> = {}
  if (options.enabled === false)
    voice.enabled = false
  if (options.preferred)
    voice.engine = { preferred: options.preferred }

  const deps: LiaVoiceProvisioningDeps = {
    effectiveHome: async () => home,
    install: async () => {
      counter.installCalls += 1
      const pending = outcomeQueue.shift() ?? (options.outcome ? Promise.resolve(options.outcome) : deferredOutcome)
      const outcome = await pending
      if (outcome.status === 'installed')
        facts.installed = true
      return outcome
    },
    installEvents: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    isInstalled: async (runtimeHome) => {
      inspectedHomes.push(runtimeHome)
      return facts.installed
    },
    onStatus: status => statuses.push({ ...status }),
    snapshot: async () => ({ voice }),
  }

  return {
    counter,
    deps,
    emit: (event, detail) => {
      for (const listener of [...listeners])
        listener(event, detail)
    },
    inspectedHomes,
    resolveInstall: outcome => resolver?.(outcome),
    stageOutcome: outcome => outcomeQueue.push(Promise.resolve(outcome)),
    statuses,
  }
}

// Accessors read through the world object so counters stay live.
function installCalls(world: TestWorld): number {
  return world.counter.installCalls
}

async function untilState(provisioning: { status: () => { state: string } }, state: string): Promise<void> {
  for (let attempt = 0; attempt < 200 && provisioning.status().state !== state; attempt++)
    await new Promise(resolve => setTimeout(resolve, 1))
}

describe('createLiaVoiceProvisioning (7.9H automatic first-run provisioning)', () => {
  it('a: enabled + Kokoro + missing -> auto provisioning starts on reconcile', async () => {
    const world = makeWorld()
    world.resolveInstall({ status: 'installed' })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    await provisioning.reconcile('boot')
    await untilState(provisioning, 'ready')

    expect(installCalls(world)).toBe(1)
    expect(world.statuses.map(s => s.state)).toContain('preparing')
  })

  it('b: enabled + Kokoro + already ready -> no install is started', async () => {
    const world = makeWorld({ installed: true })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    const status = await provisioning.reconcile('boot')

    expect(status.state).toBe('ready')
    expect(installCalls(world)).toBe(0)
  })

  it('c: voice disabled -> no install, honest "disabled" state', async () => {
    const world = makeWorld({ enabled: false })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    const status = await provisioning.reconcile('boot')

    expect(status.state).toBe('disabled')
    expect(installCalls(world)).toBe(0)
  })

  it('d: a selected engine this build cannot construct is reported honestly, never swapped', async () => {
    const world = makeWorld({ preferred: 'some-future-engine' })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    const status = await provisioning.reconcile('boot')

    expect(status.state).toBe('error')
    expect(status.retryable).toBe(false)
    expect(status.engineId).toBe('some-future-engine')
    expect(installCalls(world)).toBe(0)
    // And retry refuses to install Kokoro in its place.
    await provisioning.retry()
    expect(installCalls(world)).toBe(0)
  })

  it('e: duplicate readiness checks join one in-flight attempt', async () => {
    const world = makeWorld()
    const provisioning = createLiaVoiceProvisioning(world.deps)

    const first = provisioning.reconcile('boot')
    const second = provisioning.reconcile('config-update')
    const third = provisioning.reconcile('mount')
    world.resolveInstall({ status: 'installed' })

    await Promise.all([first, second, third])
    await untilState(provisioning, 'ready')
    expect(installCalls(world)).toBe(1)
  })

  it('f: joining an attempt owned elsewhere settles on its result event', async () => {
    const world = makeWorld({ outcome: { status: 'running' } })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    const pending = provisioning.reconcile('boot')
    await untilState(provisioning, 'preparing')
    world.emit('lia-app.voice-install', 'phase=installing step=model')
    expect(provisioning.status().step).toBe('model')
    world.emit('lia-app.voice-install', 'result=ready')

    await pending
    await untilState(provisioning, 'ready')
    expect(provisioning.status().state).toBe('ready')
  })

  it('g: install failure becomes a stable retryable error state', async () => {
    const world = makeWorld({ outcome: { status: 'failed' } })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    await provisioning.reconcile('boot')
    await untilState(provisioning, 'error')

    expect(provisioning.status().retryable).toBe(true)
  })

  it('h: retry after error starts exactly ONE new attempt (concurrent retries join it)', async () => {
    const world = makeWorld()
    world.stageOutcome({ status: 'failed' }) // first attempt fails fast
    const provisioning = createLiaVoiceProvisioning(world.deps)

    await provisioning.reconcile('boot')
    await untilState(provisioning, 'error')
    expect(installCalls(world)).toBe(1)

    // The retry attempt stays in flight (deferred default outcome), so the
    // concurrent second retry provably JOINS instead of starting attempt #3.
    const firstRetry = provisioning.retry()
    const secondRetry = provisioning.retry()
    await Promise.all([firstRetry, secondRetry])
    world.resolveInstall({ status: 'failed' })
    await untilState(provisioning, 'error')
    // Failed once, retried once - the concurrent second retry JOINED.
    expect(installCalls(world)).toBe(2)
  })

  it('h2: retry from ready/disabled is a no-op', async () => {
    const ready = makeWorld({ installed: true })
    const readyProvisioning = createLiaVoiceProvisioning(ready.deps)
    await readyProvisioning.reconcile('boot')
    await readyProvisioning.retry()
    expect(installCalls(ready)).toBe(0)

    const disabled = makeWorld({ enabled: false })
    const disabledProvisioning = createLiaVoiceProvisioning(disabled.deps)
    await disabledProvisioning.reconcile('boot')
    await disabledProvisioning.retry()
    expect(installCalls(disabled)).toBe(0)
  })

  it('j: the QA runtime override keeps being the inspected/provisioned home', async () => {
    const isolated = 'J:/Lia-Project/Tests/runs/20260924-120000/runtime'
    const world = makeWorld({ home: isolated })
    world.resolveInstall({ status: 'installed' })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    await provisioning.reconcile('boot')
    expect(world.inspectedHomes).toEqual([isolated])
  })

  it('step progress rides the status sink, metadata only', async () => {
    const world = makeWorld({ outcome: { status: 'running' } })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    const pending = provisioning.reconcile('boot')
    await untilState(provisioning, 'preparing')
    world.emit('lia-app.voice-install', 'phase=installing step=python')
    world.emit('lia-app.voice-install', 'phase=installing step=model')
    world.emit('lia-app.voice-install', 'result=ready')
    await pending
    await untilState(provisioning, 'ready')

    const steps = world.statuses.filter(s => s.step).map(s => s.step)
    expect(steps).toEqual(['python', 'model'])
    expect(world.statuses.every(s => !JSON.stringify(s).includes('pip '))).toBe(true)
  })

  it('disabling during an in-flight attempt: the attempt finishes quietly, re-enable sees ready', async () => {
    const world = makeWorld({ outcome: { status: 'running' } })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    const pending = provisioning.reconcile('boot')
    await untilState(provisioning, 'preparing')
    expect(provisioning.status().state).toBe('preparing')

    // User disables voice mid-flight: the installer has no safe cancel, so
    // it runs to completion - but the product state is honestly disabled.
    let enabled = true
    world.deps.snapshot = async () => ({ voice: enabled ? {} : { enabled: false } })
    enabled = false
    await provisioning.reconcile('config-update')
    expect(provisioning.status().state).toBe('disabled')

    world.emit('lia-app.voice-install', 'result=ready')
    await pending
    expect(provisioning.status().state).toBe('disabled')

    // Re-enable: disk facts say ready -> no new install.
    enabled = true
    world.deps.isInstalled = async () => true
    const status = await provisioning.reconcile('config-update')
    expect(status.state).toBe('ready')
    expect(installCalls(world)).toBe(1)
  })

  it('inspector failure is honest: treated as not-installed, install decides', async () => {
    const world = makeWorld()
    world.deps.isInstalled = async () => {
      throw new Error('locked file')
    }
    world.resolveInstall({ status: 'installed' })
    const provisioning = createLiaVoiceProvisioning(world.deps)

    await provisioning.reconcile('boot')
    await untilState(provisioning, 'ready')
    expect(installCalls(world)).toBe(1)
  })
})
