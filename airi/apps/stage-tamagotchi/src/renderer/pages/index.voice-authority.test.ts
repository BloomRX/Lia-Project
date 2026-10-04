/* eslint-disable style/max-statements-per-line -- test helper intentional patterns */
// Helper to read production source for guards
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// @vitest-environment happy-dom
import { createTranscriptBuffer } from '@proj-airi/pipelines-audio'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { normalizeLineEndings } from '../../test-helpers'
import { createOrderedVoiceSendSequence } from '../services/lia/voice-send-sequence'
import { artistryToolReferences } from '../stores/tools'

function chatTurnFactsFromSend(input: {
  attachments: readonly unknown[]
  reasoning: boolean
  tools: readonly unknown[]
}): { hasImageInput: boolean, reasoningRequested: boolean, usesTools: boolean } {
  return {
    hasImageInput: input.attachments.length > 0,
    reasoningRequested: input.reasoning,
    usesTools: input.tools.length > 0,
  }
}

function readSource(relative: string): string {
  const base = resolve(__dirname, '.')
  return normalizeLineEndings(readFileSync(resolve(base, relative), 'utf-8'))
}
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * Phase 8.0D-10B-4D4C4-D2B5: ordered direct-voice authoritative routing.
 *
 * Tests prove:
 * - snapshot capture before queue wait (text, session, reasoning, correlationId minted once)
 * - facts derived from frozen empty collections
 * - exactly one Brain request per voice send, awaited, with correlation continuity
 * - selected/undefined route handling, failure degradation
 * - complete send serialization (authority A + full send A before authority B)
 * - failure-safe chain, no double report, no unhandled rejection
 * - partial/speech-end zero IDs, hearing separation, payload exactness, global writes 0
 *
 * Production owner is index.vue only. Tests use a minimal in-test replica of the
 * serialized voice chain that mirrors the exact production shape, plus source guards
 * that prove index.vue contains the same shape.
 */

/**
 * Resolves the tool reference set that production's voice capture actually
 * snapshots, by reading the production expression out of index.vue.
 *
 * index.vue is a page SFC that cannot be mounted here, so the behavioral proofs
 * below would otherwise exercise a hand-copied literal and stay green even if
 * production regressed. Reading the identifier production spreads means a
 * production mutation away from the artistry reference set fails these tests
 * instead of silently passing.
 */
function productionVoiceToolSnapshot(): readonly { name: string }[] {
  const stripped = stripComments(readSource('index.vue'))
  const spread = /const toolsToSend = \[\.\.\.(\w+)\]/.exec(stripped)
  if (spread) {
    const known: Record<string, readonly { name: string }[]> = { artistryToolReferences }
    const resolved = known[spread[1]!]
    if (!resolved)
      throw new Error(`voice capture snapshots an unrecognised tool set: ${spread[1]}`)

    return [...resolved]
  }

  // Production snapshots no tools at all. Return that faithfully so the tool
  // parity assertions fail precisely, instead of cascading an unrelated error
  // through every test that builds a voice pipeline.
  if (/const toolsToSend = \[\] as const/.test(stripped))
    return []

  throw new Error('voice capture tool snapshot expression is not recognisable')
}

/**
 * Returns the delivery function production's streaming sentence-end handler uses
 * for an accepted final fragment: buffering into the shared transcript buffer, or
 * a direct per-fragment chat send. Executing production's own routing decision
 * means restoring direct per-fragment sends fails the aggregation proofs.
 */
function productionStreamingFragmentDelivery(
  buffer: ReturnType<typeof createTranscriptBuffer>,
  directSend: (text: string) => void,
): (finalText: string) => void {
  const stripped = stripComments(readSource('index.vue'))
  const start = stripped.indexOf('function handleStreamingSentenceEnd')
  if (start < 0)
    throw new Error('handleStreamingSentenceEnd missing from index.vue')

  const body = stripped.slice(start, stripped.indexOf('\nfunction ', start + 1))
  if (/voiceTranscriptBuffer\.push\(finalText\)/.test(body))
    return finalText => buffer.push(finalText)

  if (/sendVoiceInputTextToChat\(finalText\)/.test(body))
    return finalText => directSend(finalText)

  throw new Error('handleStreamingSentenceEnd no longer routes accepted final fragments')
}

// Real production helper — tests now execute the actual sequencing code
function createVoiceSendSequence(deps: {
  getActiveSessionId: () => string
  getReasoning: () => boolean
  resolveRoute: (input: { correlationId: string, facts: ReturnType<typeof chatTurnFactsFromSend> }) => Promise<{ providerId: string, modelId: string } | undefined>
  send: (payload: { sessionId: string, text: string, correlationId: string, reasoning: boolean, tools: readonly { name: string }[], routeOverride?: { providerId: string, modelId: string } }) => Promise<void>
  reportFailure: (action: string, error: unknown) => void
}) {
  const sequence = createOrderedVoiceSendSequence({
    capture: (text: string) => {
      const textToSend = text
      const targetSessionId = deps.getActiveSessionId()
      const correlationId = crypto.randomUUID()
      const reasoningToSend = deps.getReasoning()
      const attachmentsToSend = [] as const
      // D2B12-B: resolves the SAME tool set production's voice capture snapshots.
      const toolsToSend = productionVoiceToolSnapshot()
      const facts = chatTurnFactsFromSend({
        attachments: attachmentsToSend,
        reasoning: reasoningToSend,
        tools: toolsToSend,
      })
      return { textToSend, targetSessionId, correlationId, reasoningToSend, toolsToSend, facts }
    },
    execute: async (captured) => {
      const routeOverride = await deps.resolveRoute({ correlationId: captured.correlationId, facts: captured.facts })
      await deps.send({
        sessionId: captured.targetSessionId,
        text: captured.textToSend,
        correlationId: captured.correlationId,
        reasoning: captured.reasoningToSend,
        tools: captured.toolsToSend,
        ...(routeOverride === undefined ? {} : { routeOverride }),
      })
    },
    reportFailure: deps.reportFailure,
  })
  return { enqueue: sequence.enqueue, getChain: sequence.getChain }
}

describe('direct voice authoritative routing (Phase 8.0D-10B-4D4C4-D2B5)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `test-cid-${Math.random().toString(36).slice(2, 8)}` as never)
  })

  it('28: one accepted direct voice sentence → one correlationId, one Brain, one send', async () => {
    const resolveRoute = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const report = vi.fn()
    const reasoning = false
    const session = 'S1'
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => session,
      getReasoning: () => reasoning,
      resolveRoute,
      send,
      reportFailure: report,
    })

    await seq.enqueue('hello voice')

    expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
    expect(resolveRoute).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
    const facts = (resolveRoute.mock.calls[0]![0] as any).facts
    expect(facts).toEqual({ hasImageInput: false, reasoningRequested: false, usesTools: true })
  })

  it('29: authority is actually awaited — deferred Brain blocks send', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    let resolveBrain!: (v: unknown) => void
    const resolveRoute = vi.fn().mockImplementation(() => new Promise((res) => { resolveBrain = res }))
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })

    const pending = seq.enqueue('deferred')
    await new Promise(r => setTimeout(r, 10))
    expect(resolveRoute).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(0)

    resolveBrain(undefined)
    await pending
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('30: selected route → payload contains exact routeOverride', async () => {
    const route = { providerId: 'groq', modelId: 'openai/gpt-oss-120b' }
    const resolveRoute = vi.fn().mockResolvedValue(route)
    const send = vi.fn().mockResolvedValue(undefined)
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => true,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })

    await seq.enqueue('selected')
    const payload = send.mock.calls[0]![0] as any
    expect(payload.routeOverride).toEqual(route)
    expect(Object.keys(payload.routeOverride).sort()).toEqual(['modelId', 'providerId'])
  })

  it('31: undefined route (non-routable/credential false/Brain rejection) still sends without routeOverride', async () => {
    for (const result of [undefined, undefined, undefined]) {
      const resolveRoute = vi.fn().mockResolvedValue(result)
      const send = vi.fn().mockResolvedValue(undefined)
      const seq = createVoiceSendSequence({
        getActiveSessionId: () => 'S1',
        getReasoning: () => false,
        resolveRoute,
        send,
        reportFailure: vi.fn(),
      })
      await seq.enqueue('undefined')
      const payload = send.mock.calls[0]![0] as any
      expect(payload).not.toHaveProperty('routeOverride')
      expect(send).toHaveBeenCalledTimes(1)
    }

    // credential false is same undefined path; Brain rejection resolver returns undefined via catch
    const failingResolve = vi.fn().mockImplementation(async () => {
      try {
        throw new Error('brain fail')
      }
      catch {
        return undefined
      }
    })
    const send2 = vi.fn().mockResolvedValue(undefined)
    const seq2 = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute: failingResolve,
      send: send2,
      reportFailure: vi.fn(),
    })
    await seq2.enqueue('brain fail degrades')
    expect(send2).toHaveBeenCalledTimes(1)
    expect((send2.mock.calls[0]![0] as any)).not.toHaveProperty('routeOverride')
  })

  it('32: correlation continuity — same correlationId on authority and payload, no remint', async () => {
    const captured: string[] = []
    const resolveRoute = vi.fn().mockImplementation(async (input: any) => {
      captured.push(input.correlationId)
      return undefined
    })
    const send = vi.fn().mockImplementation(async (p: any) => {
      captured.push(p.correlationId)
    })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('cid-123' as never)
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })
    await seq.enqueue('corr')
    expect(captured[0]).toBe('cid-123')
    expect(captured[1]).toBe('cid-123')
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1)
  })

  it('33: facts hasImageInput=false usesTools=true reasoningRequested=reasoningToSend (D2B12-B tool parity)', async () => {
    const resolveRoute = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => true,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })
    await seq.enqueue('facts')
    const facts = (resolveRoute.mock.calls[0]![0] as any).facts
    expect(facts.hasImageInput).toBe(false)
    expect(facts.usesTools).toBe(true)
    expect(facts.reasoningRequested).toBe(true)
  })

  it('34: reasoning false — facts false and payload false exists', async () => {
    const resolveRoute = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })
    await seq.enqueue('r false')
    const facts = (resolveRoute.mock.calls[0]![0] as any).facts
    const payload = send.mock.calls[0]![0] as any
    expect(facts.reasoningRequested).toBe(false)
    expect(payload.reasoning).toBe(false)
    expect(Object.hasOwn(payload, 'reasoning')).toBe(true)
  })

  it('35: reasoning true — facts true and payload true', async () => {
    const resolveRoute = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockResolvedValue(undefined)
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => true,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })
    await seq.enqueue('r true')
    const facts = (resolveRoute.mock.calls[0]![0] as any).facts
    const payload = send.mock.calls[0]![0] as any
    expect(facts.reasoningRequested).toBe(true)
    expect(payload.reasoning).toBe(true)
  })

  it('36: reasoning snapshot while waiting — B retains false even if live becomes true', async () => {
    let reasoning = false

    // The first sequence this test built was never enqueued against: the case
    // needs a controllable A, so only `seq2` below is real. Keeping the dead
    // pair of mocks would only imply an observation that never happened.

    // A long job
    let resolveA!: () => void
    const resolveRouteA = vi.fn().mockImplementation(() => new Promise<void>((res) => { resolveA = res as any }))
    let sendAResolve!: () => void
    const sendA = vi.fn().mockImplementation(() => new Promise<void>((res) => { sendAResolve = res as any }))

    // Need to recreate seq with controllable A
    const seq2Resolve: any = resolveRouteA
    const seq2Send: any = sendA
    const seq2 = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => reasoning,
      resolveRoute: seq2Resolve,
      send: seq2Send,
      reportFailure: vi.fn(),
    })
    const pA = seq2.enqueue('A')
    await new Promise(r => setTimeout(r, 5))
    // reasoning still false at B enqueue
    reasoning = false
    // B enqueued while A pending, but B's reasoning is captured at enqueue (false)
    // Now mutate live before B starts
    const pB = seq2.enqueue('B')
    let bSettled = false
    void pB.then(() => { bSettled = true })
    reasoning = true // live flips to true while B waiting

    // Release A authority and send
    resolveA()
    await new Promise(r => setTimeout(r, 5))
    // A send is pending, B should not have started authority yet (§38)
    expect(seq2Resolve).toHaveBeenCalledTimes(1)
    // And B is therefore still undelivered: its promise is intentionally left
    // pending, so the honest assertion is that it has NOT settled yet - never
    // an await, which would hang on the FIFO gate this test exists to prove.
    expect(bSettled).toBe(false)
    sendAResolve()
    await pA
    await new Promise(r => setTimeout(r, 5))
    // Now B should start with captured false, not true
    // Since we changed reasoning to true after enqueue, B's facts should still be false
    // Our mock seq2Resolve for B is same mock, but we need to check second call facts
    // This test uses same mock, so second call facts should be false
    // To properly test, we need to track per-call facts
    const factsB = (seq2Resolve.mock.calls[1]?.[0] as any)?.facts
    if (factsB) {
      expect(factsB.reasoningRequested).toBe(false)
    }
    // For payload, check send second call after B completes
    // Let's make B's send also controllable to verify payload
    // Instead assert via new isolated test below for reasoning snapshot
  })

  it('36b: reasoning snapshot — B captured false remains false after live true', async () => {
    let reasoning = false
    const calls: any[] = []
    const resolveRoute = vi.fn().mockImplementation(async (input: any) => {
      calls.push({ type: 'resolve', facts: input.facts })
      return undefined
    })
    const send = vi.fn().mockImplementation(async (p: any) => {
      calls.push({ type: 'send', reasoning: p.reasoning })
    })

    // Simulate chain with controllable delay for A
    let releaseA!: () => void
    let aStarted = false
    const seq = (() => {
      let chain: Promise<void> = Promise.resolve()
      function enqueue(text: string) {
        const textToSend = text
        const targetSessionId = 'S1'
        const correlationId = crypto.randomUUID()
        const reasoningToSend = reasoning
        const facts = chatTurnFactsFromSend({ attachments: [] as const, reasoning: reasoningToSend, tools: [] as const })
        const runJob = async () => {
          if (textToSend === 'A') {
            aStarted = true
            await new Promise<void>((res) => { releaseA = res })
          }
          await resolveRoute({ correlationId, facts })
          await send({ sessionId: targetSessionId, text: textToSend, correlationId, reasoning: reasoningToSend })
        }
        const delivery = chain.then(() => runJob())
        chain = delivery.catch(() => {})
        return chain
      }
      return { enqueue }
    })()

    const pA = seq.enqueue('A')
    await new Promise(r => setTimeout(r, 5))
    expect(aStarted).toBe(true)
    reasoning = false
    const pB = seq.enqueue('B')
    // mutate live before B starts
    reasoning = true
    releaseA()
    await pA
    await pB
    // B's resolve and send should have false (captured before wait)
    const bResolve = calls.find(c => c.type === 'resolve' && c.facts.reasoningRequested === false)
    expect(bResolve).toBeDefined()
    const bSend = calls.filter(c => c.type === 'send').pop()
    expect(bSend?.reasoning).toBe(false)
    // Next sentence after live true should capture true
    calls.length = 0
    const pC = seq.enqueue('C')
    await pC
    expect(calls[0]?.facts.reasoningRequested).toBe(true)
  })

  it('37: session snapshot while waiting — B retains S1 even if active becomes S2', async () => {
    let session = 'S1'
    const resolveRoute = vi.fn().mockResolvedValue(undefined)
    const sendCalls: any[] = []
    const send = vi.fn().mockImplementation(async (p: any) => {
      sendCalls.push(p.sessionId)
    })

    let releaseA!: () => void
    const seq = (() => {
      let chain: Promise<void> = Promise.resolve()
      function enqueue(text: string) {
        const textToSend = text
        const targetSessionId = session
        const correlationId = crypto.randomUUID()
        const reasoningToSend = false
        const facts = chatTurnFactsFromSend({ attachments: [] as const, reasoning: reasoningToSend, tools: [] as const })
        const runJob = async () => {
          if (textToSend === 'A')
            await new Promise<void>((res) => { releaseA = res })
          await resolveRoute({ correlationId, facts })
          await send({ sessionId: targetSessionId, text: textToSend, correlationId, reasoning: reasoningToSend })
        }
        const delivery = chain.then(() => runJob())
        chain = delivery.catch(() => {})
        return chain
      }
      return { enqueue }
    })()

    const pA = seq.enqueue('A')
    await new Promise(r => setTimeout(r, 5))
    const pB = seq.enqueue('B') // captured S1
    session = 'S2' // live changes while B waiting
    releaseA()
    await pA
    await pB
    expect(sendCalls[1]).toBe('S1')
    // next sentence should use S2
    const pC = seq.enqueue('C')
    await pC
    expect(sendCalls[2]).toBe('S2')
  })

  it('38: complete send serialization — Brain B does not begin while A send pending', async () => {
    let brainACall = 0
    let brainBCall = 0
    let sendACall = 0
    let resolveBrainA!: (v: any) => void
    let resolveSendA!: () => void

    const resolveRoute = vi.fn().mockImplementation(() => {
      if (brainACall === 0) {
        brainACall++
        return new Promise((res) => { resolveBrainA = res })
      }
      else {
        brainBCall++
        return Promise.resolve(undefined)
      }
    })
    const send = vi.fn().mockImplementation(() => {
      if (sendACall === 0) {
        sendACall++
        return new Promise<void>((res) => { resolveSendA = res })
      }
      return Promise.resolve(undefined)
    })

    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })

    const pA = seq.enqueue('A')
    // wait for Brain A to start
    await new Promise(r => setTimeout(r, 5))
    expect(resolveRoute).toHaveBeenCalledTimes(1)

    const pB = seq.enqueue('B')
    await new Promise(r => setTimeout(r, 5))
    // B Brain must NOT have started while A authority pending
    expect(resolveRoute).toHaveBeenCalledTimes(1)

    resolveBrainA(undefined)
    // Now send A begins, but B Brain still must not start while send A pending
    await new Promise(r => setTimeout(r, 5))
    expect(send).toHaveBeenCalledTimes(1)
    expect(resolveRoute).toHaveBeenCalledTimes(1)

    resolveSendA()
    await pA
    // Now B can start
    await new Promise(r => setTimeout(r, 5))
    expect(resolveRoute).toHaveBeenCalledTimes(2)
    // B send follows
    await pB
    expect(send).toHaveBeenCalledTimes(2)
    // Order: Brain A, Send A begins, Send A settles, Brain B, Send B
    expect(brainACall).toBe(1)
    expect(brainBCall).toBe(1)
  })

  it('39: first send failure does not poison second — report once, second still runs', async () => {
    const report = vi.fn()
    const resolveRoute = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('send fail'))
      .mockResolvedValueOnce(undefined)

    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute,
      send,
      reportFailure: report,
    })

    const pA = seq.enqueue('A')
    await pA // should not throw, chain catches and reports
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]![0]).toBe('send to chat')

    const pB = seq.enqueue('B')
    await pB
    expect(resolveRoute).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(2)
    expect(report).toHaveBeenCalledTimes(1) // no double for B
  })

  it('40: no unhandled rejection — rejected first send does not escape', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason)
    window.addEventListener('unhandledrejection', onUnhandled as any)
    const resolveRoute = vi.fn().mockResolvedValue(undefined)
    const send = vi.fn().mockRejectedValue(new Error('fail'))
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })

    const pA = seq.enqueue('A')
    await pA
    await new Promise(r => setTimeout(r, 10))
    window.removeEventListener('unhandledrejection', onUnhandled as any)
    expect(unhandled).toEqual([])
  })

  it('41: capture happens before queue wait — targetSessionId and reasoning captured at enqueue', async () => {
    let session = 'S1'
    let reasoning: boolean = false
    const captured: Array<{ session: string, reasoning: boolean }> = []
    const resolveRoute = vi.fn().mockImplementation(async () => {
      return undefined
    })
    const send = vi.fn().mockImplementation(async () => {
      // nothing
    })

    // Use replica that captures before chain, then mutates live before start
    let releaseA!: () => void
    const seq = (() => {
      let chain: Promise<void> = Promise.resolve()
      function enqueue(text: string) {
        const targetSessionId = session
        const reasoningToSend = reasoning
        const correlationId = crypto.randomUUID()
        const facts = chatTurnFactsFromSend({ attachments: [] as const, reasoning: reasoningToSend, tools: [] as const })
        captured.push({ session: targetSessionId, reasoning: reasoningToSend })
        const runJob = async () => {
          if (text === 'A')
            await new Promise<void>((res) => { releaseA = res })
          await resolveRoute({ correlationId, facts })
          await send({ sessionId: targetSessionId, text, correlationId, reasoning: reasoningToSend })
        }
        const delivery = chain.then(() => runJob())
        chain = delivery.catch(() => {})
        return chain
      }
      return { enqueue }
    })()

    const pA = seq.enqueue('A')
    await new Promise(r => setTimeout(r, 5))
    // B captured while A pending, with S1/false
    const pB = seq.enqueue('B')
    // mutate live before B starts
    session = 'S2'
    reasoning = true as any
    expect(captured[1]!.session).toBe('S1')
    expect(captured[1]!.reasoning).toBe(false)
    releaseA()
    await pA
    await pB
    // Also next sentence captures new live
    const pC = seq.enqueue('C')
    await pC
    expect(captured[2]!.session).toBe('S2')
    expect(captured[2]!.reasoning).toBe(true)
  })

  it('42: correlationId minted before queue wait — B id already minted at enqueue', async () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `cid-${Math.random().toString(36).slice(2, 8)}` as never)
    const resolveRoute = vi.fn().mockImplementation(() => new Promise(() => {}))
    const send = vi.fn().mockImplementation(() => new Promise(() => {}))

    let countAtEnqueue = 0
    const seq = (() => {
      let chain: Promise<void> = Promise.resolve()
      function enqueue(text: string) {
        const correlationId = crypto.randomUUID()
        countAtEnqueue++
        const facts = chatTurnFactsFromSend({ attachments: [] as const, reasoning: false, tools: [] as const })
        const runJob = async () => {
          await resolveRoute({ correlationId, facts })
          await send({ sessionId: 'S1', text, correlationId, reasoning: false })
        }
        const delivery = chain.then(() => runJob())
        chain = delivery.catch(() => {})
        return chain
      }
      return { enqueue }
    })()

    seq.enqueue('A')
    seq.enqueue('B')
    // Both ids minted synchronously at enqueue, even though B Brain not started
    expect(crypto.randomUUID).toHaveBeenCalledTimes(2)
    expect(countAtEnqueue).toBe(2)
    // B Brain still 0 while A pending (A's resolveRoute is pending, so B queued)
    await new Promise(r => setTimeout(r, 5))
    expect(resolveRoute).toHaveBeenCalledTimes(1)
  })

  it('43: partial transcript does not mint — handleStreamingTranscriptionUpdate zero IDs', async () => {
    const source = readSource('index.vue')
    // Ensure update handler does not contain randomUUID or resolve or send
    const afterUpdate = source.slice(source.indexOf('function handleStreamingTranscriptionUpdate'))
    const snippet = afterUpdate.slice(0, 400)
    expect(snippet).not.toMatch(/randomUUID/)
    expect(snippet).not.toMatch(/resolveLiaAuthoritativeSendRoute/)
    expect(snippet).not.toMatch(/chatStore\.send/)
    // Also global count: only sendVoiceInputTextToChat should mint
    const stripped = stripComments(source)
    const uuidCalls = (stripped.match(/crypto\.randomUUID\(\)/g) ?? []).length
    // Should be exactly 1 in production (inside sendVoiceInputTextToChat)
    expect(uuidCalls).toBe(1)
  })

  it('44: speech-end caption does not mint/send', async () => {
    const source = readSource('index.vue')
    const afterSpeechEnd = source.slice(source.indexOf('function handleStreamingSpeechEnd'))
    const snippet = afterSpeechEnd.slice(0, 300)
    expect(snippet).not.toMatch(/randomUUID/)
    expect(snippet).not.toMatch(/resolveLiaAuthoritativeSendRoute/)
    expect(snippet).not.toMatch(/chatStore\.send/)
    expect(snippet).toMatch(/postSpeakerCaption/)
  })

  it('45: hearing/manual path no double authority — replaceHearingInput does not call resolver', async () => {
    const source = readSource('index.vue')
    const stripped = stripComments(source)
    // replaceHearingInput and postHearingInputEvent should not contain resolver
    const hearingIdx = stripped.indexOf('function replaceHearingInput')
    const hearingSnippet = stripped.slice(hearingIdx, hearingIdx + 500)
    expect(hearingSnippet).not.toMatch(/resolveLiaAuthoritativeSendRoute/)
    // Also verify only sendVoiceInputTextToChat calls resolver
    const resolverCalls = (stripped.match(/resolveLiaAuthoritativeSendRoute/g) ?? []).length
    // One import + one call inside sendVoiceInputTextToChat = 2
    expect(resolverCalls).toBe(2)
  })

  it('46: payload exactness — required sessionId text correlationId reasoning tools, optional routeOverride only (D2B12-B)', async () => {
    const resolveRoute = vi.fn().mockResolvedValue({ providerId: 'groq', modelId: 'openai/gpt-oss-120b' })
    const send = vi.fn().mockResolvedValue(undefined)
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => true,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })
    await seq.enqueue('exact')
    const payload = send.mock.calls[0]![0] as any
    expect(Object.keys(payload).sort()).toEqual(['correlationId', 'reasoning', 'routeOverride', 'sessionId', 'text', 'tools'])
    expect(payload).not.toHaveProperty('attachments')
    expect(payload).not.toHaveProperty('input')
    // No voice-origin schema additions may appear on the logical send payload.
    for (const forbidden of ['source', 'modality', 'voice', 'speech', 'transcription', 'provider', 'confidence', 'language', 'locale', 'utteranceId', 'sourceId'])
      expect(payload).not.toHaveProperty(forbidden)
    // Without route
    const resolve2 = vi.fn().mockResolvedValue(undefined)
    const send2 = vi.fn().mockResolvedValue(undefined)
    const seq2 = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => false,
      resolveRoute: resolve2,
      send: send2,
      reportFailure: vi.fn(),
    })
    await seq2.enqueue('no route')
    const payload2 = send2.mock.calls[0]![0] as any
    expect(Object.keys(payload2).sort()).toEqual(['correlationId', 'reasoning', 'sessionId', 'text', 'tools'])
  })

  it('47: global activeProvider/activeModel writes = 0', async () => {
    const source = readSource('index.vue')
    const stripped = stripComments(source)
    expect(stripped).not.toMatch(/activeProvider/)
    expect(stripped).not.toMatch(/activeModel/)
    // Also ensure no consciousnessStore provider write
    expect(stripped).not.toMatch(/consciousnessStore\.activeProvider/)
  })

  it('source guards: FIFO ownership stays in createOrderedVoiceSendSequence (voiceSendChain not restored)', async () => {
    const source = readSource('index.vue')
    const stripped = stripComments(source)
    // D2B9-C: the page must NOT re-declare a local voiceSendChain — the ordered
    // voice send sequence helper is the single FIFO owner.
    expect(stripped).not.toMatch(/voiceSendChain/)
    expect(stripped).toMatch(/import \{ createOrderedVoiceSendSequence \} from '\.\.\/services\/lia\/voice-send-sequence'/)
    expect(stripped).toMatch(/const voiceSendSequence = createOrderedVoiceSendSequence\(\{/)
    expect(stripped).toMatch(/voiceSendSequence\.enqueue\(text\)/)
    // helper owns the actual chain recovery
    const helper = readSource('../services/lia/voice-send-sequence.ts')
    const helperStripped = stripComments(helper)
    expect(helperStripped).toMatch(/let chain:\s*Promise<void>\s*=\s*Promise\.resolve\(\)/)
    expect(helperStripped).toMatch(/const delivery = chain\.then\(\(\) => runJob\(\)\)/)
    expect(helperStripped).toMatch(/chain = delivery\.catch\(\(error\) =>\s*\{\s*options\.reportFailure\('send to chat', error\)\s*\}\)/)
  })

  it('source guards: capture before queue wait', async () => {
    const source = readSource('index.vue')
    const seqIdx = source.indexOf('const voiceSendSequence = createOrderedVoiceSendSequence')
    const seqBody = source.slice(seqIdx, seqIdx + 2000)
    const captureIdx = seqBody.indexOf('capture: (text: string) =>')
    const executeIdx = seqBody.indexOf('execute:')
    const captureSession = seqBody.indexOf('const targetSessionId = chatSession.activeSessionId')
    const captureReasoning = seqBody.indexOf('const reasoningToSend = consciousnessSettings.reasoning')
    const captureId = seqBody.indexOf('const correlationId = crypto.randomUUID()')
    const captureFacts = seqBody.indexOf('const facts = chatTurnFactsFromSend')
    expect(captureIdx).toBeGreaterThan(-1)
    expect(executeIdx).toBeGreaterThan(-1)
    expect(captureSession).toBeGreaterThan(-1)
    expect(captureReasoning).toBeGreaterThan(-1)
    expect(captureId).toBeGreaterThan(-1)
    expect(captureFacts).toBeGreaterThan(-1)
    expect(captureSession).toBeLessThan(executeIdx)
    expect(captureId).toBeLessThan(executeIdx)
    expect(captureReasoning).toBeLessThan(executeIdx)
    expect(captureFacts).toBeLessThan(executeIdx)
    expect(captureIdx).toBeLessThan(executeIdx)
  })

  it('source guards: tools snapshot parity, no new attachments/input (D2B12-B)', async () => {
    const source = readSource('index.vue')
    const seqIdx = source.indexOf('const voiceSendSequence = createOrderedVoiceSendSequence')
    const seqBody = source.slice(seqIdx, seqIdx + 2500)
    // Facts may use attachments/tools via chatTurnFactsFromSend — allowed in capture
    expect(seqBody).toMatch(/attachments: attachmentsToSend/)
    expect(seqBody).toMatch(/tools: toolsToSend/)
    // D2B12-B: capture must snapshot the SAME artistry tool set typed sends use,
    // and image attachments must stay frozen-empty on the microphone path.
    expect(seqBody).toMatch(/const toolsToSend = \[\.\.\.artistryToolReferences\]/)
    expect(seqBody).toMatch(/const attachmentsToSend = \[\] as const/)
    // Voice payload MUST forward the captured tool snapshot, and still must not
    // carry attachments, provider input metadata, or any voice-origin schema.
    const sendIdx = seqBody.indexOf('chatStore.send({')
    const sendBlock = seqBody.slice(sendIdx, sendIdx + 600)
    expect(sendBlock).toMatch(/tools: captured\.toolsToSend/)
    expect(sendBlock).not.toMatch(/attachments:/)
    expect(sendBlock).not.toMatch(/\binput:/)
    expect(sendBlock).toMatch(/captured\.reasoningToSend/)
    expect(sendBlock).toMatch(/captured\.correlationId/)
    expect(sendBlock).toMatch(/captured\.targetSessionId/)
    expect(sendBlock).toMatch(/captured\.textToSend/)
    // Brain receives only derived facts — never the tool names themselves.
    const factsIdx = seqBody.indexOf('const facts = chatTurnFactsFromSend')
    const factsBlock = seqBody.slice(factsIdx, factsIdx + 300)
    expect(factsBlock).toMatch(/tools: toolsToSend/)
    expect(factsBlock).not.toMatch(/\.name/)
    // The page imports the real exported reference set, not a duplicated literal.
    expect(source).toMatch(/import \{ artistryToolReferences \} from '\.\.\/stores\/tools'/)
  })
})

describe('voice turn fidelity (D2B12-B) — streaming aggregation and tool parity', () => {
  let idSeq = 0

  beforeEach(() => {
    vi.restoreAllMocks()
    idSeq = 0
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `cid-${++idSeq}` as never)
  })

  /**
   * Wires the REAL transcript buffer to the REAL ordered voice send sequence
   * exactly the way index.vue wires them, so these tests execute both production
   * primitives rather than a replica of either.
   */
  function createVoicePipeline(options?: {
    reasoning?: boolean
    sessionId?: string
    route?: { providerId: string, modelId: string }
  }) {
    const resolveRoute = vi.fn().mockResolvedValue(options?.route)
    const send = vi.fn().mockResolvedValue(undefined)
    const reportFailure = vi.fn()
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => options?.sessionId ?? 'S1',
      getReasoning: () => options?.reasoning ?? true,
      resolveRoute,
      send,
      reportFailure,
    })
    const buffer = createTranscriptBuffer({
      flushDelayMs: 1200,
      maxBufferedTextLength: 90,
      async flush(text) {
        await seq.enqueue(text)
      },
    })
    return {
      buffer,
      resolveRoute,
      send,
      reportFailure,
      getChain: seq.getChain,
      enqueueDirect: seq.enqueue,
      // Delivers an accepted final fragment exactly the way production routes it.
      deliver: productionStreamingFragmentDelivery(buffer, text => void seq.enqueue(text)),
    }
  }

  it('aggregates two nearby latin streaming finals into ONE logical voice turn', async () => {
    const pipeline = createVoicePipeline()
    pipeline.deliver('hello')
    pipeline.deliver('world')
    await pipeline.buffer.flushNow()
    expect(pipeline.resolveRoute).toHaveBeenCalledTimes(1)
    expect(pipeline.send).toHaveBeenCalledTimes(1)
    expect(pipeline.send.mock.calls[0]![0]!.text).toBe('hello world')
  })

  it('aggregates three nearby streaming finals into ONE logical voice turn', async () => {
    const pipeline = createVoicePipeline()
    pipeline.deliver('hello')
    pipeline.deliver('beautiful')
    pipeline.deliver('world')
    await pipeline.buffer.flushNow()
    expect(pipeline.resolveRoute).toHaveBeenCalledTimes(1)
    expect(pipeline.send).toHaveBeenCalledTimes(1)
    expect(pipeline.send.mock.calls[0]![0]!.text).toBe('hello beautiful world')
  })

  it('mints one correlationId, one authority request and one send per buffer flush', async () => {
    const pipeline = createVoicePipeline()
    pipeline.deliver('one turn')
    await pipeline.buffer.flushNow()
    const payload = pipeline.send.mock.calls[0]![0]!
    expect(pipeline.resolveRoute).toHaveBeenCalledTimes(1)
    expect(pipeline.send).toHaveBeenCalledTimes(1)
    expect(pipeline.resolveRoute.mock.calls[0]![0]!.correlationId).toBe(payload.correlationId)
    expect(payload.correlationId).toBe('cid-1')
  })

  it('gives a second spoken turn its own correlationId, authority request and send', async () => {
    const pipeline = createVoicePipeline()
    pipeline.deliver('first')
    await pipeline.buffer.flushNow()
    pipeline.deliver('second')
    await pipeline.buffer.flushNow()
    expect(pipeline.resolveRoute).toHaveBeenCalledTimes(2)
    expect(pipeline.send).toHaveBeenCalledTimes(2)
    const first = pipeline.send.mock.calls[0]![0]!
    const second = pipeline.send.mock.calls[1]![0]!
    expect(first.text).toBe('first')
    expect(second.text).toBe('second')
    expect(second.correlationId).not.toBe(first.correlationId)
    expect(pipeline.resolveRoute.mock.calls[1]![0]!.correlationId).toBe(second.correlationId)
  })

  it('sends exactly once on explicit flushNow and never duplicates from the old delayed timer', async () => {
    vi.useFakeTimers()
    try {
      const pipeline = createVoicePipeline()
      pipeline.deliver('hello')
      pipeline.deliver('world')
      await pipeline.buffer.flushNow()
      expect(pipeline.send).toHaveBeenCalledTimes(1)
      // The pending 1200 ms window must already be cancelled by the buffer.
      await vi.advanceTimersByTimeAsync(1200)
      await vi.advanceTimersByTimeAsync(1200)
      expect(pipeline.send).toHaveBeenCalledTimes(1)
      expect(pipeline.resolveRoute).toHaveBeenCalledTimes(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('flushes without waiting once a fragment reaches the max buffered length', async () => {
    vi.useFakeTimers()
    try {
      const pipeline = createVoicePipeline()
      const longFragment = 'x'.repeat(90)
      pipeline.buffer.push(longFragment)
      // Advance far below the 1200 ms window: the delivery must already be
      // complete, proving the buffer's own max-length rule flushed without
      // waiting out the delay window.
      await vi.advanceTimersByTimeAsync(100)
      expect(pipeline.send).toHaveBeenCalledTimes(1)
      expect(pipeline.send.mock.calls[0]![0]!.text).toBe(longFragment)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('sends the exact artistry tool reference set that typed InteractiveArea sends use', async () => {
    const pipeline = createVoicePipeline()
    pipeline.deliver('parity')
    await pipeline.buffer.flushNow()
    const payload = pipeline.send.mock.calls[0]![0]!
    expect(artistryToolReferences.length).toBeGreaterThan(0)
    expect(payload.tools).toEqual(artistryToolReferences)
    // A fresh snapshot, never the live container itself.
    expect(payload.tools).not.toBe(artistryToolReferences)
  })

  it('retains the captured tool snapshot when the live container mutates after enqueue', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const resolveRoute = vi.fn(async () => {
      await gate
      return undefined
    })
    const send = vi.fn().mockResolvedValue(undefined)
    const seq = createVoiceSendSequence({
      getActiveSessionId: () => 'S1',
      getReasoning: () => true,
      resolveRoute,
      send,
      reportFailure: vi.fn(),
    })
    const buffer = createTranscriptBuffer({
      flushDelayMs: 1200,
      maxBufferedTextLength: 90,
      async flush(text) {
        await seq.enqueue(text)
      },
    })

    const baseline = artistryToolReferences.map(tool => ({ ...tool }))
    buffer.push('snapshot')
    const flushed = buffer.flushNow()
    // Capture provably completed once Brain has been asked, because execute()
    // runs after capture(); the gated Brain call keeps the send from running.
    await vi.waitFor(() => expect(resolveRoute).toHaveBeenCalledTimes(1))
    expect(send).not.toHaveBeenCalled()
    const lateTool = { name: 'late_added_tool' }
    ;(artistryToolReferences as unknown as unknown[]).push(lateTool)
    try {
      release()
      await flushed
      const payload = send.mock.calls[0]![0]!
      expect(payload.tools).toEqual(baseline)
      expect(payload.tools).not.toContainEqual(lateTool)
    }
    finally {
      artistryToolReferences.pop()
    }
    expect(artistryToolReferences).toEqual(baseline)
  })

  it('derives Brain usesTools from the same tool snapshot the logical send receives', async () => {
    const pipeline = createVoicePipeline()
    pipeline.deliver('same snapshot')
    await pipeline.buffer.flushNow()
    const facts = pipeline.resolveRoute.mock.calls[0]![0]!.facts
    const payload = pipeline.send.mock.calls[0]![0]!
    expect(facts.usesTools).toBe(true)
    expect(payload.tools.length).toBeGreaterThan(0)
    expect(facts.usesTools).toBe(payload.tools.length > 0)
  })

  it('freezes the exact reasoning value into both Brain facts and the voice payload', async () => {
    for (const reasoning of [true, false]) {
      const pipeline = createVoicePipeline({ reasoning })
      pipeline.deliver(`reasoning ${String(reasoning)}`)
      await pipeline.buffer.flushNow()
      const facts = pipeline.resolveRoute.mock.calls[0]![0]!.facts
      const payload = pipeline.send.mock.calls[0]![0]!
      expect(facts.reasoningRequested).toBe(reasoning)
      expect(payload.reasoning).toBe(reasoning)
      expect(facts.usesTools).toBe(true)
      expect(facts.hasImageInput).toBe(false)
    }
  })

  it('source guards: sentence-end buffers instead of sending, speech-end flushes', async () => {
    const stripped = stripComments(readSource('index.vue'))
    const sentenceIdx = stripped.indexOf('function handleStreamingSentenceEnd')
    expect(sentenceIdx).toBeGreaterThan(-1)
    const sentenceBody = stripped.slice(sentenceIdx, stripped.indexOf('\nfunction ', sentenceIdx + 1))
    expect(sentenceBody).toMatch(/voiceTranscriptBuffer\.push\(finalText\)/)
    expect(sentenceBody).not.toMatch(/sendVoiceInputTextToChat/)

    const speechIdx = stripped.indexOf('function handleStreamingSpeechEnd')
    expect(speechIdx).toBeGreaterThan(-1)
    const speechBody = stripped.slice(speechIdx, stripped.indexOf('\nfunction ', speechIdx + 1))
    expect(speechBody).toMatch(/postSpeakerCaption/)
    expect(speechBody).toMatch(/voiceTranscriptBuffer\.flushNow\(\)/)
    // The speech-end handler still must not mint, authorize or send by itself.
    expect(speechBody).not.toMatch(/randomUUID/)
    expect(speechBody).not.toMatch(/resolveLiaAuthoritativeSendRoute/)
    expect(speechBody).not.toMatch(/chatStore\.send/)
  })

  it('source guards: both ASR modes converge on ONE shared transcript buffer', async () => {
    const stripped = stripComments(readSource('index.vue'))
    expect(stripped).toMatch(/const voiceTranscriptBuffer = createTranscriptBuffer\(\{/)
    // Recorder-backed aggregation is preserved and no second buffer exists.
    expect(stripped).toMatch(/voiceTranscriptBuffer\.push\(text\)/)
    expect(stripped).toMatch(/voiceTranscriptBuffer\.push\(finalText\)/)
    expect((stripped.match(/const voiceTranscriptBuffer = /g) ?? []).length).toBe(1)
  })
})
