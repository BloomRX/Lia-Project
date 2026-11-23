import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'

const maxTurns = 24
const maxText = 8_000
const maxLegacyExport = 4 * 1024 * 1024

interface Turn {
  route: string
  user: string
  assistant: string
  reusable: boolean
}
interface History {
  version: 1
  enabled: boolean
  turns: Turn[]
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function legacyTurns(input: unknown, limit: number): Turn[] {
  if (typeof input !== 'string' || Buffer.byteLength(input) > maxLegacyExport)
    throw new Error('history-import')
  const payload: unknown = JSON.parse(input)
  if (!object(payload) || payload.format !== 'chat-sessions-index:v1' || !object(payload.sessions))
    throw new Error('history-import')
  let latest: { updatedAt: number, messages: unknown[] } | undefined
  for (const record of Object.values(payload.sessions)) {
    if (!object(record) || !object(record.meta) || typeof record.meta.updatedAt !== 'number'
      || !Number.isFinite(record.meta.updatedAt) || !Array.isArray(record.messages))
      continue
    if (!latest || record.meta.updatedAt > latest.updatedAt)
      latest = { updatedAt: record.meta.updatedAt, messages: record.messages }
  }
  const turns: Turn[] = []
  const messages = latest?.messages ?? []
  for (let i = messages.length - 1; i > 0 && turns.length < limit; i--) {
    const assistant = messages[i]
    const user = messages[i - 1]
    if (!object(assistant) || assistant.role !== 'assistant' || typeof assistant.content !== 'string' || !assistant.content.trim()
      || !object(user) || user.role !== 'user' || typeof user.content !== 'string' || !user.content.trim())
      continue
    turns.unshift({ route: '0'.repeat(64), user: user.content.slice(0, maxText), assistant: assistant.content.slice(0, maxText), reusable: false })
    i--
  }
  return turns
}

function validTurn(value: unknown): value is Turn {
  return !!value && typeof value === 'object' && 'route' in value && typeof value.route === 'string'
    && /^[a-f0-9]{64}$/.test(value.route) && 'reusable' in value && typeof value.reusable === 'boolean'
    && 'user' in value && typeof value.user === 'string' && value.user.length <= maxText
    && 'assistant' in value && typeof value.assistant === 'string' && value.assistant.length <= maxText
}

export function createStageHistory(path: string) {
  async function read(): Promise<History> {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        return undefined
      throw error
    })
    if (!stat)
      return { version: 1, enabled: false, turns: [] }
    if (!stat.isFile() || stat.size > 2_500_000)
      throw new Error('history-storage')
    const state = JSON.parse(await readFile(path, 'utf8'))
    if (state?.version !== 1 || typeof state.enabled !== 'boolean' || !Array.isArray(state.turns)
      || state.turns.length > maxTurns || !state.turns.every(validTurn) || (!state.enabled && state.turns.length))
      throw new Error('history-storage')
    return { version: 1, enabled: state.enabled, turns: state.turns }
  }
  async function write(state: History) {
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    }
    finally {
      await unlink(temporary).catch(() => {})
    }
  }
  return {
    async get() {
      const state = await read()
      return { enabled: state.enabled, turns: state.turns.map(({ user, assistant }) => ({ user, assistant })) }
    },
    async setEnabled(enabled: boolean) {
      const state = await read()
      if (state.enabled !== enabled)
        await write({ version: 1, enabled, turns: [] })
    },
    async clear() {
      const { enabled } = await read()
      await write({ version: 1, enabled, turns: [] })
    },
    async importLegacy(input: unknown) {
      const state = await read()
      const room = maxTurns - state.turns.length
      if (!state.enabled || room <= 0)
        return []
      const imported = legacyTurns(input, maxTurns).filter(turn =>
        !state.turns.some(previous => !previous.reusable && previous.user === turn.user && previous.assistant === turn.assistant))
        .slice(-room)
      if (imported.length > 0)
        await write({ ...state, turns: [...imported, ...state.turns] })
      return imported.map(({ user, assistant }) => ({ user, assistant }))
    },
    async recall(route: string) {
      const state = await read()
      return state.turns.filter(turn => turn.route === route && turn.reusable)
        .map(({ user, assistant }) => ({ user, assistant }))
    },
    async append(turn: Turn) {
      const state = await read()
      if (state.enabled && validTurn(turn))
        await write({ ...state, turns: [...state.turns, turn].slice(-maxTurns) })
    },
  }
}
