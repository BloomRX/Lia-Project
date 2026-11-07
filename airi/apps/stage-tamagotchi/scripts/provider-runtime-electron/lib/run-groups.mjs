/**
 * The 16 verification groups, and an accounting that cannot flatter itself.
 *
 * The old report had a `checks` array that the gate appended to as it went. It
 * could not distinguish "group 12 ran and passed" from "groups 1–6 passed and
 * the process died in group 7": both produced a shorter array, and the only way
 * to tell them apart was to know the order by heart.
 *
 * The contract here is narrower and checkable:
 *
 *   - `begin(n)` is called **immediately before** the first statement of group n;
 *   - `pass(n)` is called after the group's last assertion;
 *   - anything begun and never passed is `failed` if it was the last group
 *     begun, and `aborted` for everything after it (they never ran);
 *   - a group whose code exists but whose `begin` was never reached is
 *     `not-run`, and this module refuses to count it as executed.
 *
 * The gate's execution stays linear — the mission forbids fragmenting it into
 * subtests that could be skipped — but the accounting becomes explicit.
 */

/** The 16 groups, in execution order. Ids are stable and appear in reports. */
export const GATE_GROUPS = [
  { id: 1, title: 'Leituras cruas negadas e rede do renderer desabilitada' },
  { id: 2, title: 'SafeStorage real e ausência de leituras antecipadas' },
  { id: 3, title: 'Decoders legados e migração idempotente' },
  { id: 4, title: 'JSON, SSE, descoberta, modelo customizado e credenciais separadas' },
  { id: 5, title: 'Duas janelas, autoridade no Main e escrita concorrente rejeitada' },
  { id: 6, title: 'Dez provedores curados, credencial própria e endpoint próprio' },
  { id: 7, title: 'Execuções concorrentes isoladas' },
  { id: 8, title: 'Resposta inválida com classe de erro sanitizada' },
  { id: 9, title: 'Cancelamento que fecha a resposta HTTP real' },
  { id: 10, title: 'Porta descartada que recusa envio' },
  { id: 11, title: 'Disable/remove bloqueando execução e tombstone sem ressurreição' },
  { id: 12, title: 'Erros vazios, HTTP e SSE seguros e terminais' },
  { id: 13, title: 'Cancelamento chegando à UI terminal' },
  { id: 14, title: 'Timeout de produção chegando à UI e fechando HTTP' },
  { id: 15, title: 'Reinício real restaurando modelo e decifrando chave' },
  { id: 16, title: 'Crash do renderer liberando request, encerrando processos e sem segredos em logs' },
]

/**
 * Create the recorder.
 *
 * `now` is injected so a test can produce a deterministic timeline.
 */
export function createGroupRecorder({ now = () => new Date().toISOString() } = {}) {
  /** @type {Map<number, { id: number, title: string, status: string, beganAt: string, endedAt?: string, detail?: string }>} */
  const entries = new Map()
  let current

  function requireGroup(id) {
    const group = GATE_GROUPS.find(candidate => candidate.id === id)
    if (!group)
      throw new RangeError(`group ${id} is not one of the ${GATE_GROUPS.length} declared groups`)
    return group
  }

  return {
    /** Mark group `id` as started. Throws on an unknown id — a typo must not silently drop a group. */
    begin(id) {
      const group = requireGroup(id)
      if (entries.has(id))
        throw new Error(`group ${id} was begun twice`)
      entries.set(id, { id, title: group.title, status: 'running', beganAt: now() })
      current = id
      return id
    },
    /** Mark group `id` as passed. It must be the running one. */
    pass(id, detail) {
      const entry = entries.get(id)
      if (!entry)
        throw new Error(`group ${id} was marked passed without being begun`)
      if (entry.status !== 'running')
        throw new Error(`group ${id} was already ${entry.status}`)
      entry.status = 'passed'
      entry.endedAt = now()
      if (typeof detail === 'string' && detail.length > 0)
        entry.detail = detail
      if (current === id)
        current = undefined
      return id
    },
    /** Mark group `id` as failed with a diagnostic. Called from the catch path. */
    fail(id, reason) {
      const entry = entries.get(id)
      if (!entry || entry.status !== 'running')
        return
      entry.status = 'failed'
      entry.endedAt = now()
      entry.detail = typeof reason === 'string' && reason.length > 0 ? reason : 'no reason recorded'
    },
    /**
     * The final accounting.
     *
     * A group with no entry is `not-run`. That is the state that makes "the code
     * is present" distinguishable from "the code executed" — the exact confusion
     * the mission calls out.
     */
    summary() {
      const groups = GATE_GROUPS.map((group) => {
        const entry = entries.get(group.id)
        if (!entry)
          return { id: group.id, title: group.title, status: 'not-run' }
        return { ...entry }
      })
      const count = status => groups.filter(group => group.status === status).length
      return {
        groups,
        total: groups.length,
        executed: groups.length - count('not-run'),
        passed: count('passed'),
        failed: count('failed'),
        aborted: groups.filter(group => group.status === 'running').length,
        notRun: count('not-run'),
        // What a reader must not be able to miss.
        complete: count('passed') === groups.length,
        interruptedAt: groups.find(group => group.status === 'running')?.id ?? (count('failed') > 0 ? groups.find(group => group.status === 'failed')?.id : undefined),
      }
    },
  }
}

/**
 * The verdict line for a report.
 *
 * Deliberately not "PASS": the gate can only ever speak about what it ran.
 */
export function describeGroups(summary) {
  if (summary.complete)
    return `all ${summary.total} groups executed and passed`
  if (summary.failed > 0)
    return `${summary.passed}/${summary.total} groups passed; group ${summary.interruptedAt} failed; ${summary.notRun} never ran`
  return `${summary.passed}/${summary.total} groups passed; execution stopped inside group ${summary.interruptedAt}; ${summary.notRun} never ran`
}
