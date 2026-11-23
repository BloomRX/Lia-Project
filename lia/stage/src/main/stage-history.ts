import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'

const maxTurns = 24
const maxText = 8_000
const maxLegacyExport = 4 * 1024 * 1024
const maxConversations = 12
const initialId = 'initial'

interface Turn {
  route: string
  user: string
  assistant: string
  reusable: boolean
}
interface Conversation {
  id: string
  enabled: boolean
  turns: Turn[]
}
interface History {
  version: 2
  activeId: string
  conversations: Conversation[]
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
  function conversation(id: string): Conversation {
    return { id, enabled: false, turns: [] }
  }

  function validConversation(value: unknown): value is Conversation {
    return object(value) && typeof value.id === 'string'
      && (value.id === initialId || /^[a-f0-9-]{36}$/.test(value.id))
      && typeof value.enabled === 'boolean' && Array.isArray(value.turns)
      && value.turns.length <= maxTurns && value.turns.every(validTurn)
      && (value.enabled || value.turns.length === 0)
  }

  async function read(): Promise<History> {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        return undefined
      throw error
    })
    if (!stat)
      return { version: 2, activeId: initialId, conversations: [conversation(initialId)] }
    if (!stat.isFile() || stat.size > maxConversations * 2_500_000)
      throw new Error('history-storage')
    const state: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!object(state))
      throw new Error('history-storage')
    if (state.version === 1) {
      const previous = { id: initialId, enabled: state.enabled, turns: state.turns }
      if (validConversation(previous))
        return { version: 2, activeId: initialId, conversations: [previous] }
    }
    const conversations: unknown[] = Array.isArray(state.conversations) ? state.conversations : []
    const { activeId } = state
    if (state.version !== 2 || typeof activeId !== 'string'
      || conversations.length > maxConversations || !conversations.every(validConversation)
      || new Set(conversations.map(item => item.id)).size !== conversations.length
      || !conversations.some(item => item.id === activeId))
      throw new Error('history-storage')
    return { version: 2, activeId, conversations }
  }
  function current(state: History): Conversation {
    return state.conversations.find(item => item.id === state.activeId)!
  }
  function view(state: History) {
    const { enabled, turns } = current(state)
    return {
      enabled,
      turns: turns.map(({ user, assistant }) => ({ user, assistant })),
      activeId: state.activeId,
      conversations: state.conversations.map(({ id, turns }) => ({
        id,
        title: turns[0]?.user.trim().slice(0, 50) ?? '',
      })),
    }
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
      return view(await read())
    },
    async changeConversation(action: 'create' | 'select' | 'delete', id?: string) {
      const state = await read()
      if (action === 'create') {
        if (state.conversations.length >= maxConversations)
          return undefined
        state.activeId = randomUUID()
        state.conversations.push(conversation(state.activeId))
      }
      else if (action === 'delete') {
        state.conversations = state.conversations.filter(item => item.id !== state.activeId)
        if (!state.conversations.length)
          state.conversations.push(conversation(randomUUID()))
        state.activeId = state.conversations[0]!.id
      }
      else {
        if (!id || !state.conversations.some(item => item.id === id))
          return undefined
        state.activeId = id
      }
      await write(state)
      return view(state)
    },
    async setEnabled(enabled: boolean) {
      const state = await read()
      const active = current(state)
      if (active.enabled !== enabled) {
        active.enabled = enabled
        active.turns = []
        await write(state)
      }
    },
    async clear() {
      const state = await read()
      current(state).turns = []
      await write(state)
    },
    async importLegacy(input: unknown) {
      const state = await read()
      const active = current(state)
      const room = maxTurns - active.turns.length
      if (!active.enabled || room <= 0)
        return []
      const imported = legacyTurns(input, maxTurns).filter(turn =>
        !active.turns.some(previous => !previous.reusable && previous.user === turn.user && previous.assistant === turn.assistant))
        .slice(-room)
      if (imported.length > 0) {
        active.turns = [...imported, ...active.turns]
        await write(state)
      }
      return imported.map(({ user, assistant }) => ({ user, assistant }))
    },
    async recall(route: string) {
      return current(await read()).turns.filter(turn => turn.route === route && turn.reusable)
        .map(({ user, assistant }) => ({ user, assistant }))
    },
    async append(turn: Turn) {
      const state = await read()
      const active = current(state)
      if (active.enabled && validTurn(turn)) {
        active.turns = [...active.turns, turn].slice(-maxTurns)
        await write(state)
      }
    },
  }
}
