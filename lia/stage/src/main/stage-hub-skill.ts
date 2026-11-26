import { randomUUID } from 'node:crypto'

import { createStageHubCli } from './stage-hub-cli.ts'

export function createStageHubSkill() {
  const cli = createStageHubCli()
  let grant = process.env.LIA_AGENTHUB_GRANT_ID
  delete process.env.LIA_AGENTHUB_GRANT_ID
  delete process.env.LIA_AGENTHUB_CONSUMER_TOKEN
  const unavailable = { ok: false, code: 'unavailable' } as const
  type Task = Extract<Awaited<ReturnType<typeof cli.status>>, { ok: true }>['value']
  let task: Task | undefined
  let pending: AbortController | undefined
  let lastCheck = 0
  let auditRequest: ReturnType<typeof cli.audit> | undefined
  let finalAudit: Awaited<ReturnType<typeof cli.audit>> | undefined
  let checking: Promise<void> | undefined
  let cancelling: ReturnType<typeof cli.cancel> | undefined

  function cancelTask(id: string) {
    cancelling ??= cli.cancel(id).finally(() => { cancelling = undefined })
    return cancelling
  }

  return {
    async run(input: unknown, confirm: (signal: AbortSignal, bytes: number) => Promise<boolean>) {
      if (typeof input !== 'string' || !input.trim() || Buffer.byteLength(input) > 65_536)
        return { ok: false, code: 'invalid-request' } as const
      if (pending)
        return { ok: false, code: 'busy' } as const
      if (!grant || !/^[0-9a-f]{32}$/.test(grant))
        return { ok: false, code: 'forbidden' } as const
      const controller = new AbortController()
      pending = controller
      task = undefined
      try {
        if (!await confirm(controller.signal, Buffer.byteLength(input)) || controller.signal.aborted)
          return { ok: false, code: 'declined' } as const
        const request = { requestId: randomUUID(), grantId: grant, text: input }
        grant = undefined
        let submitted = await cli.submit(request)
        if (!submitted.ok && submitted.code === 'unavailable')
          submitted = await cli.submit(request)
        if (!submitted.ok)
          return submitted
        task = submitted.value
        if (!controller.signal.aborted)
          return submitted
        const cancelled = await cancelTask(task.taskId)
        if (cancelled.ok)
          task = cancelled.value
        return cancelled
      }
      catch { return unavailable }
      finally { pending = undefined }
    },
    async start() {
      if (!task || pending)
        return unavailable
      if (task.state !== 'queued' && task.state !== 'running')
        return { ok: true, value: task } as const
      const controller = new AbortController()
      pending = controller
      try {
        const result = await cli.start(task.taskId)
        if (result.ok)
          task = result.value
        return result
      }
      finally { pending = undefined }
    },
    async status() {
      if (task && (task.state === 'queued' || task.state === 'running') && Date.now() - lastCheck >= 800) {
        lastCheck = Date.now()
        const observed = task
        checking ??= cli.status(observed.taskId).then((result) => {
          if (task === observed && result.ok)
            task = result.value
        }).finally(() => { checking = undefined })
        await checking
      }
      return { task: task ?? null, pending: Boolean(pending) }
    },
    async cancel() {
      pending?.abort()
      if (!task || (task.state !== 'queued' && task.state !== 'running'))
        return { ok: true } as const
      const result = await cancelTask(task.taskId)
      if (result.ok)
        task = result.value
      return result
    },
    audit() {
      if (!task)
        return Promise.resolve(unavailable)
      if (finalAudit)
        return Promise.resolve(finalAudit)
      const observed = task
      // Audit is available after settlement, when the ledger is immutable.
      if (observed.state === 'queued' || observed.state === 'running')
        return Promise.resolve(unavailable)
      auditRequest ??= cli.audit(observed.taskId).then((result) => {
        if (result.ok)
          finalAudit = result
        return result
      }).finally(() => { auditRequest = undefined })
      return auditRequest
    },
  }
}
