import { randomUUID } from 'node:crypto'
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises'

const maxTurns = 24
const maxText = 8_000

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
