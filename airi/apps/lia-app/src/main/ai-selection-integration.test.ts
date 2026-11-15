import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readLiaProductConfig, updateLiaProductConfig } from '@lia/core/product/config'
import { createLiaSecretVault } from '@lia/core/secrets/vault'
import { afterEach, describe, expect, it } from 'vitest'

import { decideSelectionWrite } from '../../../stage-tamagotchi/src/shared/lia/selection-write-policy'
import { createTransportRepository } from '../../../../../lia/core/src/transports/repository'
import { createAiConnectionService } from './ai-connection-service'

/**
 * AF-1 — autoridade única sobre `provider.chat.preferred` (12/11/2026).
 *
 * O teste junta as duas superfícies reais sobre o MESMO documento canônico:
 *
 *  - o serviço do Launcher (`createAiConnectionService`), com o writer real de
 *    `lia-product.json` e o repositório real de transportes;
 *  - a política que o bridge do Stage aplica antes de gravar.
 *
 * Ele não prova o wiring do IPC do Stage (isso é coberto no runner do Stage e,
 * em última instância, no runtime do Windows). Prova o que o bug exigia: as
 * duas superfícies não conseguem mais sobrescrever uma à outra, e nenhuma
 * converte provedor antigo em Groq.
 */

const GROQ = { providerId: 'groq', modelId: 'openai/gpt-oss-120b' }
const OLLAMA = { providerId: 'ollama', modelId: 'llama3' }
const LEGACY = { providerId: 'service', modelId: 'custom/Exact:Q4' }

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action()
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lia-selection-authority-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const productConfigFile = join(directory, 'lia-product.json')
  const repository = createTransportRepository(join(directory, 'transports.json'))
  let vaultData = '{}'
  const vault = createLiaSecretVault({
    filePath: join(directory, 'vault'),
    cipher: { available: () => true, encrypt: value => Buffer.from(value).reverse(), decrypt: value => Buffer.from(value).reverse().toString() },
    read: () => vaultData,
    write: async (_, value) => {
      vaultData = value
    },
  })

  const readSelection = async () => {
    const read = await readLiaProductConfig(productConfigFile)
    return read.status === 'ok' ? read.value.provider?.chat?.preferred : undefined
  }
  const saveSelection = async (target: { providerId: string, modelId?: string }) => {
    const written = await updateLiaProductConfig(productConfigFile, { provider: { chat: { preferred: target, strategy: 'manual', onboarded: true } } })
    if (written.status !== 'ok')
      throw new Error('configuration could not be saved')
  }
  const launcher = createAiConnectionService({ repository, vault, readSelection, saveSelection })

  /**
   * The Stage bridge, reduced to its decision + write. The mapping mirrors
   * `provider-config-service.ts`: known fields only, `expectedPreferred`
   * consulted and never persisted.
   */
  async function stageWrite(chat: { preferred?: { providerId: string, modelId?: string }, fallbackEnabled?: boolean, onboarded?: boolean, expectedPreferred?: { providerId: string, modelId?: string } | null }) {
    const read = await readLiaProductConfig(productConfigFile)
    const persisted = read.status === 'ok' ? read.value.provider?.chat?.preferred : undefined
    const decision = decideSelectionWrite({
      persisted,
      incoming: chat.preferred,
      ...(Object.hasOwn(chat, 'expectedPreferred') ? { expected: chat.expectedPreferred ?? null } : {}),
    })
    if (!decision.ok)
      return decision
    // `updateAndSave` in the Stage commits the WHOLE parsed document, so
    // omitting `preferred` clears it (the valibot schema keeps it optional).
    // Mirror that here instead of the merge-style `updateLiaProductConfig`,
    // whose partial updates cannot delete a key.
    const current = read.status === 'ok' ? read.value : { schemaVersion: 1 as const }
    const candidate = {
      ...current,
      provider: {
        ...current.provider,
        chat: {
          ...(chat.preferred ? { preferred: chat.preferred } : {}),
          fallback: [],
          ...(chat.fallbackEnabled !== undefined ? { fallbackEnabled: chat.fallbackEnabled } : {}),
          ...(chat.onboarded !== undefined ? { onboarded: chat.onboarded } : {}),
        },
      },
    }
    try {
      await writeFile(productConfigFile, `${JSON.stringify(candidate, null, 2)}\n`)
    }
    catch {
      return { ok: false as const, code: 'storage' as const }
    }
    return { ok: true as const }
  }

  return { launcher, stageWrite, productConfigFile, readSelection, vault, repository }
}

describe('single authority over the chat selection (AF-1)', () => {
  it('the Stage cannot replace a selection the Launcher saved', async () => {
    const f = await fixture()
    expect(await f.launcher.save({ providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'synthetic-key', modelId: GROQ.modelId, revision: 0 })).toMatchObject({ ok: true })
    expect(await f.readSelection()).toEqual(GROQ)

    const refused = await f.stageWrite({ preferred: OLLAMA, expectedPreferred: GROQ })
    expect(refused).toEqual({ ok: false, code: 'selection-owned-by-launcher' })

    // The document is untouched and the Launcher still owns the selection.
    expect(await f.readSelection()).toEqual(GROQ)
    const state = await f.launcher.read('groq')
    expect(state.selected).toBe(true)
    expect(state.modelId).toBe(GROQ.modelId)
  })

  it('the Stage cannot promote itself to a Launcher-managed provider', async () => {
    const f = await fixture()
    await f.stageWrite({ preferred: OLLAMA })
    expect(await f.readSelection()).toEqual(OLLAMA)

    const refused = await f.stageWrite({ preferred: GROQ, expectedPreferred: OLLAMA })
    expect(refused).toEqual({ ok: false, code: 'selection-owned-by-launcher' })
    expect(await f.readSelection()).toEqual(OLLAMA)
  })

  it('preserves providers outside the catalog and never converts them to Groq', async () => {
    const f = await fixture()
    expect(await f.stageWrite({ preferred: LEGACY })).toEqual({ ok: true })
    expect(await f.readSelection()).toEqual(LEGACY)

    // Opening the Launcher does not rewrite or adopt the legacy selection.
    const state = await f.launcher.read('groq')
    expect(state.selected).toBe(false)
    expect(await f.readSelection()).toEqual(LEGACY)

    // And the Stage keeps managing it.
    expect(await f.stageWrite({ preferred: { providerId: 'service', modelId: 'custom/Next:Q8' }, expectedPreferred: LEGACY })).toEqual({ ok: true })
    expect(await f.readSelection()).toEqual({ providerId: 'service', modelId: 'custom/Next:Q8' })
  })

  it('refuses a stale Stage write instead of clobbering a newer selection', async () => {
    const f = await fixture()
    await f.stageWrite({ preferred: OLLAMA })
    // Another window moves the legacy selection forward.
    await f.stageWrite({ preferred: { providerId: 'ollama', modelId: 'qwen2.5:7b' }, expectedPreferred: OLLAMA })

    // The first window still holds the old value in memory.
    const refused = await f.stageWrite({ preferred: { providerId: 'openai', modelId: 'gpt-4.1-mini' }, expectedPreferred: OLLAMA })
    expect(refused).toEqual({ ok: false, code: 'stale-selection' })
    expect(await f.readSelection()).toEqual({ providerId: 'ollama', modelId: 'qwen2.5:7b' })
  })

  it('keeps the escape hatch: clearing the managed selection releases it', async () => {
    const f = await fixture()
    await f.launcher.save({ providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'synthetic-key', modelId: GROQ.modelId, revision: 0 })
    expect(await f.stageWrite({ preferred: undefined, expectedPreferred: GROQ })).toEqual({ ok: true })
    expect(await f.readSelection()).toBeUndefined()

    // With nothing persisted, the Stage is free again — no conversion, no lock-in.
    expect(await f.stageWrite({ preferred: OLLAMA })).toEqual({ ok: true })
    expect(await f.readSelection()).toEqual(OLLAMA)
  })

  it('never persists the protocol-only expectedPreferred field', async () => {
    const f = await fixture()
    await f.stageWrite({ preferred: LEGACY, expectedPreferred: null })
    const document = await readFile(f.productConfigFile, 'utf8')
    expect(document).not.toContain('expectedPreferred')
  })

  it('keeps callers that predate the field working exactly as before', async () => {
    const f = await fixture()
    await f.stageWrite({ preferred: OLLAMA })
    // No `expectedPreferred`: the staleness check is skipped, not failed.
    expect(await f.stageWrite({ preferred: { providerId: 'openai', modelId: 'gpt-4.1-mini' } })).toEqual({ ok: true })
    expect(await f.readSelection()).toEqual({ providerId: 'openai', modelId: 'gpt-4.1-mini' })
  })
})
