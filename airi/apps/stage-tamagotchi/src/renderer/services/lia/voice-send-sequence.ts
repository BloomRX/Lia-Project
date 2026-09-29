/**
 * Ordered voice send sequence — Phase 8.0D-10B-4D4C4-D2B5
 *
 * Generic ordering helper for the direct-voice logical-send path.
 * It owns ONLY the FIFO chain and the synchronous capture-before-queue
 * scheduling. It does NOT own:
 *  - Eventa channel creation
 *  - Brain policy / provider selection
 *  - Stage/Core hooks, persistence, retry, ASR lifecycle, captions
 *
 * The caller (index.vue) remains responsible for Lia-specific composition:
 *  - facts derivation via chatTurnFactsFromSend
 *  - authoritative route resolution
 *  - chatStore.send composition
 *
 * This keeps the helper testable with real production code while staying
 * renderer-local and narrowly dependency-injected.
 */
export interface OrderedVoiceSendSequence<Captured> {
  enqueue(text: string): Promise<void>
  getChain(): Promise<void>
}

export function createOrderedVoiceSendSequence<Captured>(options: {
  capture: (text: string) => Captured
  execute: (captured: Captured) => Promise<void>
  reportFailure: (action: string, error: unknown) => void
}): OrderedVoiceSendSequence<Captured> {
  let chain: Promise<void> = Promise.resolve()

  function enqueue(text: string): Promise<void> {
    const captured = options.capture(text)
    const runJob = (): Promise<void> => options.execute(captured)
    const delivery = chain.then(() => runJob())
    chain = delivery.catch((error) => {
      options.reportFailure('send to chat', error)
    })
    return chain
  }

  return {
    enqueue,
    getChain: () => chain,
  }
}
