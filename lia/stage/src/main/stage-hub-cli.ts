import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

const skillValidation = 'skill.validate'
const contextMaxBytes = 65_536
const envelopeMaxBytes = 524_288
const callTimeoutMs = 40_000
const tokenPattern = /^[A-Za-z0-9_-]{43}$/
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const taskIdPattern = /^[0-9a-f]{32}$/

const taskStates = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const
const taskErrors = ['grant-expired', 'execution-timeout', 'execution-failed', 'cancelled'] as const
const callErrors = ['invalid-request', 'unauthorized', 'forbidden', 'conflict', 'not-found', 'unavailable'] as const
const countKeys = ['error', 'warning', 'info', 'review'] as const

type TaskState = typeof taskStates[number]
type TaskError = typeof taskErrors[number]
type CallError = typeof callErrors[number]
export type HubCliResult<T> = { ok: true, value: T } | { ok: false, code: CallError }
export interface HubValidationTask {
  taskId: string
  state: TaskState
  progress: 0 | 100
  counts: Record<typeof countKeys[number], number> | null
  error: TaskError | null
}
export interface HubTaskEvent {
  sequence: number
  state: TaskState
  at: number
  code: TaskError | null
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function member<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function readCounts(value: unknown): HubValidationTask['counts'] {
  const counts = object(value) && object(value.counts) ? value.counts : null
  if (!counts || !countKeys.every(key => integer(counts[key], 0)))
    return null
  return {
    error: counts.error as number,
    warning: counts.warning as number,
    info: counts.info as number,
    review: counts.review as number,
  }
}

function readTask(value: unknown, match: { taskId?: string, requestId?: string }): HubValidationTask | undefined {
  if (!object(value) || typeof value.taskId !== 'string' || !taskIdPattern.test(value.taskId)
    || typeof value.requestId !== 'string' || !identifierPattern.test(value.requestId)
    || value.capability !== skillValidation || !member(taskStates, value.state)
    || (match.taskId !== undefined && value.taskId !== match.taskId)
    || (match.requestId !== undefined && value.requestId !== match.requestId))
    return
  const { taskId, state } = value
  if (state === 'queued' || state === 'running')
    return value.progress === 0 && value.result === null && value.error === null
      ? { taskId, state, progress: 0, counts: null, error: null }
      : undefined
  if (value.progress !== 100)
    return
  if (state === 'completed') {
    const counts = readCounts(value.result)
    return counts && value.error === null ? { taskId, state, progress: 100, counts, error: null } : undefined
  }
  const error = object(value.error) ? value.error.code : undefined
  if (value.result !== null || !member(taskErrors, error) || (state === 'cancelled') !== (error === 'cancelled'))
    return
  return { taskId, state, progress: 100, counts: null, error }
}

function readLedger(value: unknown, taskId: string): HubTaskEvent[] | undefined {
  if (!object(value) || value.taskId !== taskId || !Array.isArray(value.events)
    || !value.events.length || value.events.length > 256)
    return
  const events: HubTaskEvent[] = []
  for (const event of value.events) {
    if (!object(event) || !integer(event.sequence, 1) || event.sequence <= (events.at(-1)?.sequence ?? 0)
      || !integer(event.at, 1) || !member(taskStates, event.state)
      || (event.code !== null && !member(taskErrors, event.code)))
      return
    events.push({ sequence: event.sequence, state: event.state, at: event.at, code: event.code })
  }
  return events
}

function readDiscovery(value: unknown) {
  if (!object(value) || !Array.isArray(value.capabilities))
    return
  const requirement = value.capabilities.find(item => object(item) && item.id === skillValidation)
  if (!object(requirement) || requirement.revision !== 1 || requirement.permission !== skillValidation
    || requirement.grantRequired !== true || requirement.contextMaxBytes !== contextMaxBytes)
    return
  return { contextMaxBytes }
}

interface CliOptions {
  executable?: string
  home?: string
  token?: string
}

type CliRequest
  = | { action: 'discover' }
    | { action: 'submit', requestId: string, grantId: string, capability: typeof skillValidation, context: { text: string } }
    | { action: 'start' | 'status' | 'cancel' | 'events' | 'audit', taskId: string }

function configuredOptions(): CliOptions {
  return {
    executable: process.env.LIA_AGENTHUB_CLI,
    home: process.env.LIA_AGENTHUB_EXECUTION_HOME,
    token: process.env.LIA_AGENTHUB_CONSUMER_TOKEN,
  }
}

function childEnvironment() {
  const allowed = new Set(['systemroot', 'windir', 'systemdrive', 'temp', 'tmp', 'path', 'pathext'])
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())))
}

function callCli(executable: string, home: string, input: Buffer): Promise<{ exitCode: number, output: Buffer } | undefined> {
  return new Promise((resolve) => {
    const child = spawn(executable, ['--home', home, 'execution', 'call'], {
      shell: false, windowsHide: true, stdio: 'pipe', env: childEnvironment(),
    })
    const chunks: Buffer[] = []
    let size = 0
    let invalid = false
    const stop = () => {
      invalid = true
      clearTimeout(timeout)
      child.kill()
      child.stdin.destroy()
      child.stdout.destroy()
      child.stderr.destroy()
      resolve(undefined)
    }
    const timeout = setTimeout(stop, callTimeoutMs)
    const receive = (chunk: Buffer, stdout: boolean) => {
      if (invalid)
        return
      size += chunk.byteLength
      if (size > envelopeMaxBytes) {
        stop()
        return
      }
      if (stdout)
        chunks.push(chunk)
    }
    child.stdout.on('data', chunk => receive(chunk, true))
    child.stderr.on('data', chunk => receive(chunk, false))
    child.on('error', () => { invalid = true })
    child.stdin.on('error', () => { invalid = true })
    child.on('close', (exitCode) => {
      clearTimeout(timeout)
      resolve(invalid || exitCode === null ? undefined : { exitCode, output: Buffer.concat(chunks) })
    })
    child.stdin.end(input)
  })
}

/** Reads the operator-provisioned consumer credential exclusively in Main. */
export function createStageHubCli({ executable, home, token }: CliOptions = configuredOptions(), invoke = callCli) {
  async function call<T>(request: CliRequest, read: (value: unknown) => T | undefined): Promise<HubCliResult<T>> {
    if (!executable || !isAbsolute(executable) || (process.platform === 'win32' && !/\.exe$/i.test(executable))
      || !home || !isAbsolute(home) || !token || !tokenPattern.test(token))
      return { ok: false, code: 'unavailable' }
    if (request.action === 'submit' && (request.context.text.includes(token) || request.context.text.includes(request.grantId)))
      return { ok: false, code: 'invalid-request' }
    try {
      const input = Buffer.from(JSON.stringify({ schemaVersion: 1, token, ...request }))
      if (input.byteLength > envelopeMaxBytes)
        return { ok: false, code: 'invalid-request' }
      const response = await invoke(executable, home, input)
      if (response) {
        const envelope: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.output))
        if (object(envelope) && envelope.schemaVersion === 1) {
          if (response.exitCode === 0 && envelope.ok === true) {
            const value = read(envelope.result)
            if (value !== undefined)
              return { ok: true, value }
          }
          if (response.exitCode === 1 && envelope.ok === false && object(envelope.error) && member(callErrors, envelope.error.code))
            return { ok: false, code: envelope.error.code }
        }
      }
    }
    catch { /* No raw process diagnostics or child output cross this boundary. */ }
    return { ok: false, code: 'unavailable' }
  }

  function task(action: 'start' | 'status' | 'cancel', taskId: string): Promise<HubCliResult<HubValidationTask>> {
    return typeof taskId === 'string' && taskIdPattern.test(taskId)
      ? call({ action, taskId }, value => readTask(value, { taskId }))
      : Promise.resolve({ ok: false, code: 'invalid-request' })
  }

  function ledger(action: 'events' | 'audit', taskId: string): Promise<HubCliResult<HubTaskEvent[]>> {
    return typeof taskId === 'string' && taskIdPattern.test(taskId)
      ? call({ action, taskId }, value => readLedger(value, taskId))
      : Promise.resolve({ ok: false, code: 'invalid-request' })
  }

  return {
    discover: () => call({ action: 'discover' }, readDiscovery),
    submit({ requestId, grantId, text }: { requestId: string, grantId: string, text: string }): Promise<HubCliResult<HubValidationTask>> {
      if (typeof requestId !== 'string' || !identifierPattern.test(requestId)
        || typeof grantId !== 'string' || !identifierPattern.test(grantId)
        || typeof text !== 'string' || !text.length || Buffer.byteLength(text) > contextMaxBytes)
        return Promise.resolve({ ok: false, code: 'invalid-request' })
      return call({ action: 'submit', requestId, grantId, capability: skillValidation, context: { text } },
        value => readTask(value, { requestId }))
    },
    start: (taskId: string) => task('start', taskId),
    status: (taskId: string) => task('status', taskId),
    cancel: (taskId: string) => task('cancel', taskId),
    events: (taskId: string) => ledger('events', taskId),
    audit: (taskId: string) => ledger('audit', taskId),
  }
}
