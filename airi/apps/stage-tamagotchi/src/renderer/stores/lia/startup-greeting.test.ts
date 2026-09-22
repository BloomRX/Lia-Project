import type { IntentHandle } from '@proj-airi/pipelines-audio'

import type { LiaStartupGreetingLogEntry } from './startup-greeting'

import { describe, expect, it } from 'vitest'

import { LIA_STARTUP_GREETING_POOL, pickLiaStartupGreeting, scheduleLiaStartupGreeting } from './startup-greeting'

/**
 * Phase 7.9E, items 2/3 contract: ONE greeting, through the NORMAL pipeline
 * intent shape, waiting honestly for readiness, cancellable on shutdown.
 * The injected seams (status, claim, intent factory, clock) pin ORDER and
 * FACTS - no electron, no pinia, no real timers anywhere here.
 */

interface FakeIntent {
  calls: string[]
  literals: string[]
  cancelledWith?: string
}

function fakeIntent(record: FakeIntent): IntentHandle {
  return {
    intentId: 'intent-test',
    ownerId: 'lia-startup-greeting',
    priority: 0,
    stream: undefined as never,
    streamId: 'stream-test',
    turnId: undefined,
    cancel: (reason?: string) => {
      record.calls.push(`cancel:${reason ?? ''}`)
      record.cancelledWith = reason
    },
    end: () => {
      record.calls.push('end')
    },
    writeFlush: () => {
      record.calls.push('flush')
    },
    writeLiteral: (value: string) => {
      record.calls.push(`literal:${value}`)
      record.literals.push(value)
    },
    writeSpecial: () => {
      record.calls.push('special')
    },
  } as unknown as IntentHandle
}

interface World {
  claims: number
  diags: string[]
  intents: FakeIntent[]
  logs: LiaStartupGreetingLogEntry[]
  statusCalls: number
  statusScript: Array<{ state: string }>
  grant: boolean
  hostlessOf?: number
}

function greetingWorld(overrides: Partial<World> = {}) {
  const world: World = {
    claims: 0,
    diags: [],
    grant: true,
    intents: [],
    logs: [],
    statusCalls: 0,
    statusScript: [{ state: 'ready' }],
    ...overrides,
  }
  const clock = { t: 0 }
  const options = {
    claimGreeting: async () => {
      world.claims += 1
      return { granted: world.grant }
    },
    diag: (step: string, detail?: string) => {
      world.diags.push(detail !== undefined ? `${step} ${detail}` : step)
    },
    log: (entry: LiaStartupGreetingLogEntry) => {
      world.logs.push(entry)
    },
    managedLaunch: true,
    now: () => (clock.t += 500),
    openIntent: () => {
      if (world.hostlessOf !== undefined && world.intents.length < world.hostlessOf) {
        world.intents.push({ calls: [], literals: [] }) // hostless attempts: no handle
        return undefined
      }
      const record: FakeIntent = { calls: [], literals: [] }
      world.intents.push(record)
      return fakeIntent(record)
    },
    pollIntervalMs: 100,
    random: () => 0.5,
    sleep: async () => {
      clock.t += 100
    },
    voiceStatus: async () => world.statusScript[Math.min(world.statusCalls++, world.statusScript.length - 1)]!,
  }
  return { options, world }
}

describe('lia startup greeting (renderer orchestration, Phase 7.9E)', () => {
  it('unmanaged launch: no status probe, no claim, no intent - just the honest outcome', async () => {
    const { options, world } = greetingWorld()
    const handle = scheduleLiaStartupGreeting({ ...options, managedLaunch: false })
    await expect(handle.done).resolves.toBe('unmanaged')
    expect(world.statusCalls).toBe(0)
    expect(world.claims).toBe(0)
    expect(world.intents).toEqual([])
  })

  it('ready at first probe: exactly one intent, pool phrase, pipeline-shaped order literal->flush->end, then no extra intent', async () => {
    const { options, world } = greetingWorld()
    const handle = scheduleLiaStartupGreeting(options)
    await expect(handle.done).resolves.toBe('spoken')

    expect(world.intents).toHaveLength(1)
    const intent = world.intents[0]!
    expect(intent.literals).toHaveLength(1)
    expect(LIA_STARTUP_GREETING_POOL).toContain(intent.literals[0])
    expect(intent.calls).toEqual([`literal:${intent.literals[0]}`, 'flush', 'end'])
    expect(intent.cancelledWith).toBeUndefined()
    expect(world.claims).toBe(1)
  })

  it('the greeting WAITS for voice ready: unavailable answers are polled, the claim and the intent come only after ready', async () => {
    const { options, world } = greetingWorld({
      statusScript: [{ state: 'unavailable' }, { state: 'unavailable' }, { state: 'ready' }],
    })
    const handle = scheduleLiaStartupGreeting(options)
    await expect(handle.done).resolves.toBe('spoken')
    expect(world.statusCalls).toBe(3)
    expect(world.claims).toBe(1)
    expect(world.intents).toHaveLength(1)
  })

  it('voice never ready within the budget: skips honestly, never claims, never opens an intent, never throws', async () => {
    const { options, world } = greetingWorld({
      statusScript: [{ state: 'unavailable' }],
    })
    const handle = scheduleLiaStartupGreeting({ ...options, waitBudgetMs: 1_000 })
    await expect(handle.done).resolves.toBe('voice-unavailable')
    expect(world.claims).toBe(0)
    expect(world.intents).toEqual([])
  })

  it('claim denied (renderer already greeted this launch - e.g. HMR reload): intent cancelled, zero literals spoken', async () => {
    const { options, world } = greetingWorld({ grant: false })
    const handle = scheduleLiaStartupGreeting(options)
    await expect(handle.done).resolves.toBe('already-claimed')
    expect(world.intents).toHaveLength(1)
    expect(world.intents[0]!.literals).toEqual([])
    expect(world.intents[0]!.cancelledWith).toBe('already-claimed')
  })

  it('hostless speech pipeline: retries politely until the host exists, then speaks (never drops into the void)', async () => {
    const { options, world } = greetingWorld({ hostlessOf: 2 })
    const handle = scheduleLiaStartupGreeting(options)
    await expect(handle.done).resolves.toBe('spoken')
    expect(world.intents).toHaveLength(3) // 2 undefined-handle attempts + the real one
    expect(world.intents[2]!.literals).toHaveLength(1)
  })

  it('host never appears within the budget: claims nothing, outcome honest', async () => {
    const { options, world } = greetingWorld({ hostlessOf: Number.MAX_SAFE_INTEGER })
    const handle = scheduleLiaStartupGreeting({ ...options, waitBudgetMs: 800 })
    await expect(handle.done).resolves.toBe('no-speech-host')
    expect(world.claims).toBe(0)
  })

  it('shutdown while WAITING: pending greeting cancels, no intent is opened, no claim is consumed', async () => {
    const { options, world } = greetingWorld({ statusScript: [{ state: 'unavailable' }] })
    const handle = scheduleLiaStartupGreeting(options)
    handle.cancel('stage-shutdown')
    await expect(handle.done).resolves.toBe('cancelled')
    expect(world.claims).toBe(0)
    expect(world.intents).toEqual([])
  })

  it('shutdown AFTER the intent opened but BEFORE the claim answered: the intent is cancelled and nothing is spoken', async () => {
    const { options, world } = greetingWorld()
    let releaseClaim: () => void = () => undefined
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve
    })
    const handle = scheduleLiaStartupGreeting({
      ...options,
      claimGreeting: async () => {
        world.claims += 1
        await claimGate
        return { granted: true }
      },
    })
    // Wait until the intent exists and the flow sits on the claim.
    while (world.intents.length === 0)
      await Promise.resolve()
    handle.cancel('window-unload')
    releaseClaim()
    await expect(handle.done).resolves.toBe('cancelled')
    expect(world.intents[0]!.literals).toEqual([])
    expect(world.intents[0]!.cancelledWith).toBe('window-unload')
  })

  it('a claim IPC failure degrades to claim-failed (never a throw, never a greeting)', async () => {
    const { options, world } = greetingWorld()
    const handle = scheduleLiaStartupGreeting({
      ...options,
      claimGreeting: async () => {
        throw new Error('ipc gone')
      },
    })
    await expect(handle.done).resolves.toBe('claim-failed')
    expect(world.intents[0]!.literals).toEqual([])
    expect(world.intents[0]!.cancelledWith).toBe('claim-failed')
  })

  it('double-cancel is a no-op (idempotent shutdown contract)', async () => {
    const { options } = greetingWorld({ statusScript: [{ state: 'unavailable' }] })
    const handle = scheduleLiaStartupGreeting(options)
    handle.cancel('one')
    handle.cancel('two')
    await expect(handle.done).resolves.toBe('cancelled')
  })

  it('the pool is local spoken pt-BR text (no LLM, no audio asset), picked by injected random', () => {
    expect(LIA_STARTUP_GREETING_POOL.length).toBeGreaterThanOrEqual(4)
    for (const phrase of LIA_STARTUP_GREETING_POOL) {
      expect(phrase.length).toBeGreaterThanOrEqual(20)
      expect(/[.!?]$/.test(phrase)).toBe(true)
    }
    expect(pickLiaStartupGreeting(LIA_STARTUP_GREETING_POOL, () => 0).poolIndex).toBe(0)
    expect(pickLiaStartupGreeting(LIA_STARTUP_GREETING_POOL, () => 0.999).poolIndex).toBe(LIA_STARTUP_GREETING_POOL.length - 1)
    expect(pickLiaStartupGreeting(LIA_STARTUP_GREETING_POOL, () => 0.5).text).toBe(LIA_STARTUP_GREETING_POOL[2])
  })
})

describe('7.9E.3 TEMP diagnostics - every QA boundary fires, metadata-only', () => {
  it('happy path emits the exact boundary sequence in order (scheduler -> status -> host -> claim -> write)', async () => {
    const { options, world } = greetingWorld()
    const handle = scheduleLiaStartupGreeting(options)
    await expect(handle.done).resolves.toBe('spoken')

    const steps = world.diags.map(line => line.split(' ')[0])
    expect(steps).toEqual([
      'scheduler-started',
      'voice-status-invoke-start',
      'voice-status-invoke-end',
      'speech-host-wait-start',
      'speech-host-found',
      'claim-invoke-start',
      'claim-invoke-end',
      'intent-write-start',
    ])
    // Managed fact resolved at scheduler start; claim answers granted only.
    expect(world.diags[0]).toContain('managed=true')
    expect(world.diags.find(line => line.startsWith('claim-invoke-end'))).toContain('granted=true')
  })

  it('voice-status detail carries STATE ONLY - never payload notes (paths must not cross)', async () => {
    const { options, world } = greetingWorld({
      statusScript: [{ note: 'C:\\Users\\secret\\runtimes\\kokoro', state: 'unavailable' } as never, { state: 'ready' }],
    })
    const handle = scheduleLiaStartupGreeting(options)
    await expect(handle.done).resolves.toBe('spoken')
    expect(world.diags.find(line => line.startsWith('voice-status-invoke-end'))).toContain('state=unavailable')
    expect(world.diags.join('\n')).not.toContain('secret')
  })

  it('a rejecting voiceStatus invoke is traced as invoke-error (the unbounded-await QA case)', async () => {
    const { options, world } = greetingWorld()
    options.voiceStatus = async () => {
      throw new Error('ipc down')
    }
    const handle = scheduleLiaStartupGreeting({ ...options, waitBudgetMs: 1_000 })
    await expect(handle.done).resolves.toBe('voice-unavailable')
    expect(world.diags.find(line => line.startsWith('voice-status-invoke-end'))).toContain('invoke-error')
  })

  it('diag is optional: omitting it changes no greeting behavior', async () => {
    const { options, world } = greetingWorld()
    const { diag: _omitted, ...without } = options
    const handle = scheduleLiaStartupGreeting(without)
    await expect(handle.done).resolves.toBe('spoken')
    expect(world.diags).toEqual([])
    expect(world.claims).toBe(1)
    expect(world.intents).toHaveLength(1)
  })
})
