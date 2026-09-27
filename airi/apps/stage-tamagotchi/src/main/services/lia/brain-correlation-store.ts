import type { LiaBrainRoutingDecision } from '@lia/core'

import type { LiaBrainExecutionObservationReport } from '../../../shared/eventa'

/**
 * Phase 8.0D-10B-4B1: the ephemeral main-side correlation store.
 *
 * It represents, per opaque logical send, the FACTS one diagnostic pass
 * eventually needs: the trusted Brain decision (at most one), the execution
 * attempts already reported (zero or more) and the terminal treatment of the
 * rounds already settled (one per round). It is a plain, explicitly bounded
 * in-memory structure - not Pinia, not renderer state, not localStorage, not
 * the filesystem, not product config, and not a global singleton: the future
 * lifecycle owner constructs it with `createLiaBrainCorrelationStore(...)`,
 * choosing the production bounds explicitly.
 *
 * What it is:
 *   bounded      never more than `maxEntries` live entries
 *   ephemeral    entries expire by TTL and are pruned lazily (no timers)
 *   deterministic same inputs, same callback order -> same observable state
 *   order-free   decision-then-execution and execution-then-decision converge
 *   diagnostic   it holds facts and interprets nothing
 *
 * What it is NOT (deliberately absent, and guarded by tests):
 *   authority    it never calls a Brain service, never asks for a decision,
 *                never selects or prefers a provider/model, never touches the
 *                automatic policy or product config, never emits IPC, never
 *                retries or falls back, never executes a tool, never grants a
 *                permission
 *   comparison   it knows that a decision and a set of executions share one
 *                opaque key. It never asks whether they AGREE: no match, no
 *                mismatch, no divergence, no score, no winner, no expected
 *                provider/model, no recommendation
 *
 * The two execution collections are deliberately separate factual streams:
 * `executions` records what was reported to have STARTED (duplicates preserved,
 * arrival order) while `executionTerminals` records how a round ENDED (first
 * factual outcome per round wins). A terminal may exist for a round whose start
 * was never reported; joining the two is a later, deliberate concern and
 * happens nowhere in this module.
 *
 * Data minimization: an entry stores the opaque key, the canonical decision,
 * the five-field execution reports, one two-field terminal record per settled
 * round and the timestamps expiry needs. No prompt,
 * message text, attachment, tool, credential, API key, baseURL, provider
 * config, chat payload or window object can enter it - the record APIs take
 * exactly those shapes and copy nothing else.
 *
 * Nothing in production wires this store yet: no handler records into it, the
 * lifecycle does not construct it, and no transport reaches it.
 */

export interface LiaBrainCorrelationStoreOptions {
  /** Hard upper bound on live entries. Required - there is no default. */
  maxEntries: number
  /** Lifetime of one entry in milliseconds, measured from its creation. Required - there is no default. */
  ttlMs: number
  /** Injected clock (defaults to `Date.now`); tests drive expiry deterministically. */
  now?: () => number
}

/**
 * The factual terminal treatment of ONE settled round, as stored per entry.
 *
 * It carries exactly two fields: the round key and the outcome the runtime
 * classified. The correlation id is deliberately NOT duplicated here - the
 * entry that holds the record is already keyed by it. No provider, model,
 * engine, conversation or turn identity exists on a terminal record: a
 * terminal may legitimately arrive with no start report to borrow one from,
 * and nothing is ever synthesized to fill that gap.
 */
export interface LiaBrainExecutionTerminalRecord {
  /** Round key of the round this terminal treatment belongs to. */
  roundId: string
  /** The factual terminal treatment, in the closed runtime vocabulary. */
  outcome:
    | 'succeeded'
    | 'failed'
    | 'abandoned'
}

/**
 * The factual state of ONE opaque logical send, as handed out by `get(...)`.
 *
 * `decision` is the canonical Brain routing decision of the trusted main side:
 * it is treated as immutable domain data, stored and returned by reference
 * (this phase deliberately builds no deep-cloning infrastructure for it).
 * `executions` is always a fresh array of fresh five-field copies, so a caller
 * can neither mutate the stored array nor the stored reports.
 * `executionTerminals` is always a fresh array of fresh two-field copies, one
 * record per round first reported as settled, in arrival order.
 */
export interface LiaBrainCorrelationEntry {
  correlationId: string
  /** The FIRST trusted decision seen for this key (see `recordDecision`). */
  decision?: LiaBrainRoutingDecision
  /** Every accepted execution report, in arrival order, undeduplicated. */
  executions: LiaBrainExecutionObservationReport[]
  /** Every accepted terminal outcome, one per round, in arrival order. */
  executionTerminals: LiaBrainExecutionTerminalRecord[]
  /** Creation time of the entry itself (never refreshed by later reports). */
  createdAt: number
}

export interface LiaBrainCorrelationStore {
  /**
   * Records the trusted Brain decision for one logical send.
   *
   * FIRST trusted decision wins: a repeated call for a live key never
   * overwrites, merges or compares - colliding/repeated shadow requests cannot
   * corrupt the diagnostic state. An unusable key (non-string or empty) is
   * ignored, the same tolerant convention the bridge and the report handler
   * already use.
   */
  recordDecision: (correlationId: string, decision: LiaBrainRoutingDecision) => void
  /**
   * Appends one execution-attempt report, in arrival order.
   *
   * Several attempts of one logical send are expected: reports are never
   * deduplicated by key or by round, never sorted and never compared to the
   * decision. An unusable `report.correlationId` ignores the call.
   */
  recordExecution: (report: LiaBrainExecutionObservationReport) => void
  /**
   * Records the terminal treatment of one round of a logical send.
   *
   * FIRST terminal outcome per round wins: a repeated or conflicting report for
   * a round the entry already knows never overwrites, never merges and never
   * compares - the round keeps the factual outcome it was first seen with,
   * exactly like the decision. A terminal may be the FIRST thing ever seen for
   * a key, and it may describe a round whose start was never reported: no
   * execution record, no decision and no provider/model identity is ever
   * synthesized for it. An unusable key or an unusable `roundId` ignores the
   * call.
   */
  recordExecutionTerminal: (correlationId: string, terminal: LiaBrainExecutionTerminalRecord) => void
  /** Read-only snapshot of one entry, or `undefined` when absent or expired. */
  get: (correlationId: string) => LiaBrainCorrelationEntry | undefined
  /** Live entry count after lazy expiry pruning. */
  readonly size: number
}

/** A non-empty string key, or `undefined` - the single "usable key" convention. */
function readCorrelationId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Copies exactly the five reported identities into a fresh plain object. */
function copyExecutionReport(report: LiaBrainExecutionObservationReport): LiaBrainExecutionObservationReport {
  return {
    correlationId: report.correlationId,
    conversationId: report.conversationId,
    roundId: report.roundId,
    providerId: report.providerId,
    modelId: report.modelId,
  }
}

/** Copies exactly the two terminal fields into a fresh plain object. */
function copyExecutionTerminalRecord(terminal: LiaBrainExecutionTerminalRecord): LiaBrainExecutionTerminalRecord {
  return {
    roundId: terminal.roundId,
    outcome: terminal.outcome,
  }
}

/**
 * Creates one isolated correlation store. Bounds are mandatory and validated
 * here, deterministically, before any state exists - an invalid configuration
 * fails immediately instead of degrading at runtime.
 */
export function createLiaBrainCorrelationStore(options: LiaBrainCorrelationStoreOptions): LiaBrainCorrelationStore {
  const { maxEntries, ttlMs } = options

  if (typeof maxEntries !== 'number' || !Number.isFinite(maxEntries) || !Number.isInteger(maxEntries) || maxEntries <= 0)
    throw new TypeError('Lia brain correlation store: maxEntries must be a positive finite integer')
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new TypeError('Lia brain correlation store: ttlMs must be a positive finite number')
  if (options.now !== undefined && typeof options.now !== 'function')
    throw new TypeError('Lia brain correlation store: now must be a function when provided')

  const now = options.now ?? Date.now

  // Insertion-ordered by construction: Map iteration order is creation order,
  // which is exactly the deterministic eviction order at capacity. The map
  // itself is never exported; `get` hands out snapshots only.
  interface StoredEntry {
    correlationId: string
    decision?: LiaBrainRoutingDecision
    executions: LiaBrainExecutionObservationReport[]
    executionTerminals: LiaBrainExecutionTerminalRecord[]
    createdAt: number
  }

  const entries = new Map<string, StoredEntry>()

  /** Lazy pruning: called before every public operation, never on a timer. */
  function pruneExpired(at: number): void {
    for (const [key, entry] of entries) {
      if (at - entry.createdAt >= ttlMs)
        entries.delete(key)
    }
  }

  /** Makes room for ONE new key by dropping the OLDEST live entry. */
  function evictOldestIfFull(): void {
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done)
        return
      entries.delete(oldest.value)
    }
  }

  /**
   * The ONE entry-creation path: capacity rule, empty collections and
   * `createdAt` live here, so every kind of report (decision, execution starts,
   * terminal outcomes) creates an entry exactly the same way.
   */
  function createEntry(key: string, at: number): StoredEntry {
    evictOldestIfFull()
    const entry: StoredEntry = {
      correlationId: key,
      executions: [],
      executionTerminals: [],
      createdAt: at,
    }
    entries.set(key, entry)
    return entry
  }

  function recordDecision(correlationId: string, decision: LiaBrainRoutingDecision): void {
    const key = readCorrelationId(correlationId)
    if (!key)
      return

    const at = now()
    pruneExpired(at)

    const existing = entries.get(key)
    if (existing) {
      // FIRST decision wins: never overwrite, never merge, never compare. The
      // entry is only filled when the key was first seen through an execution.
      if (existing.decision === undefined)
        existing.decision = decision
      return
    }

    createEntry(key, at).decision = decision
  }

  function recordExecution(report: LiaBrainExecutionObservationReport): void {
    const key = readCorrelationId(report?.correlationId)
    if (!key)
      return

    const at = now()
    pruneExpired(at)

    const existing = entries.get(key)
    if (existing) {
      existing.executions.push(copyExecutionReport(report))
      return
    }

    createEntry(key, at).executions.push(copyExecutionReport(report))
  }

  function recordExecutionTerminal(correlationId: string, terminal: LiaBrainExecutionTerminalRecord): void {
    const key = readCorrelationId(correlationId)
    if (!key)
      return

    // The round key follows the same "usable key" convention as the entry key.
    const roundId = readCorrelationId(terminal?.roundId)
    if (!roundId)
      return

    const at = now()
    pruneExpired(at)

    const entry = entries.get(key) ?? createEntry(key, at)

    // FIRST terminal outcome per round wins: a round already reported keeps its
    // factual outcome, so repeats and conflicts are ignored outright - never
    // compared, never logged, never retried, never used to rewrite history.
    if (entry.executionTerminals.some(record => record.roundId === roundId))
      return

    // Arrival order, no sorting. Storing a terminal outcome is a pure fact
    // append: no execution record, no decision, no identity is created beside
    // it, and nothing here reads the other collections.
    entry.executionTerminals.push(copyExecutionTerminalRecord(terminal))
  }

  function get(correlationId: string): LiaBrainCorrelationEntry | undefined {
    const at = now()
    pruneExpired(at)

    const key = readCorrelationId(correlationId)
    if (!key)
      return undefined

    const entry = entries.get(key)
    if (!entry)
      return undefined

    return {
      correlationId: entry.correlationId,
      ...(entry.decision === undefined ? {} : { decision: entry.decision }),
      executions: entry.executions.map(copyExecutionReport),
      executionTerminals: entry.executionTerminals.map(copyExecutionTerminalRecord),
      createdAt: entry.createdAt,
    }
  }

  return {
    recordDecision,
    recordExecution,
    recordExecutionTerminal,
    get,
    get size(): number {
      pruneExpired(now())
      return entries.size
    },
  }
}
