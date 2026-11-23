import type { LiaProductConfigRead } from '@lia/core/product/config'

import type { TransportSnapshot } from '../../../core/src/transports/contracts.ts'
import type { LiaMemoryResult } from '../../../core/src/memory/contracts.ts'
import type { createStageHistory } from './stage-history.ts'

import { createHash } from 'node:crypto'

import { brainRequirementForChatTurn, createProductionBrainAutomaticPolicy, createProductionBrainCatalog, decideBrainRouteFromProductState } from '@lia/core'

import { credentialForDestination } from '../../../core/src/credentials/destination.ts'
import { LIA_MEMORY_LIMITS } from '../../../core/src/memory/contracts.ts'
import { LIA_DEFAULT_PERSONA, renderLiaPersonaDescription, renderLiaPersonaPersonality, renderLiaPersonaScenario } from '../../../core/src/persona/default.ts'
import { findLiaAiProviderByStageProviderId, ProviderError, ProviderRegistry, ProviderRuntime } from '../../../core/src/providers/index.ts'
import { maxStageImageBytes } from '../shared/chat-image.ts'

interface StageChatDependencies {
  fetch?: typeof globalThis.fetch
  storage?: ReturnType<typeof createStageHistory>
  recallMemory?: (query: string) => Promise<LiaMemoryResult<string>>
  readCredential?: (providerId: string) => string | undefined
  readPersona?: (id: string) => Promise<string | undefined>
  readProduct: () => Promise<LiaProductConfigRead>
  readTransports: () => Promise<TransportSnapshot>
}

export type StageChatResult
  = | { ok: true, text: string, historyUnavailable?: true }
    | { ok: false, code: 'invalid' | 'image-invalid' | 'image-unavailable' | 'configuration' | 'persona-unavailable' | 'unavailable' | 'cancelled' | 'busy' | 'credentials' | 'timeout' | 'rate-limit' }

const historyTurns = 6
const brainCatalog = createProductionBrainCatalog()
const automaticPolicy = createProductionBrainAutomaticPolicy()
const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const defaultPersonaPrompt = [
  renderLiaPersonaDescription(LIA_DEFAULT_PERSONA),
  renderLiaPersonaPersonality(LIA_DEFAULT_PERSONA, { includeUserName: false }),
  renderLiaPersonaScenario(LIA_DEFAULT_PERSONA),
].join('\n\n')

function imageContent(input: unknown) {
  if (!(input instanceof Uint8Array) || input.byteLength < 8 || input.byteLength > maxStageImageBytes)
    return undefined
  const png = pngSignature.every((byte, index) => input[index] === byte)
  const jpeg = input[0] === 0xFF && input[1] === 0xD8 && input[2] === 0xFF
  if (!png && !jpeg)
    return undefined
  return `data:image/${png ? 'png' : 'jpeg'};base64,${Buffer.from(input).toString('base64')}`
}

interface Turn {
  user: string
  assistant: string
}

export function createStageChat({ fetch, storage, recallMemory, readCredential, readPersona, readProduct, readTransports }: StageChatDependencies) {
  let history: { route: string, turns: Turn[] } | undefined

  function unavailableConfiguration(): StageChatResult {
    history = undefined
    return { ok: false, code: 'configuration' }
  }

  async function resolveRoute(hasImage: boolean) {
    const product = await readProduct()
    const activeCard = product.status === 'ok' ? product.value.persona?.activeCardId : undefined
    const customCard = activeCard && activeCard !== 'lia' && activeCard !== 'lia-default' ? activeCard : undefined
    if (customCard && !/^card-[a-f0-9]{64}$/.test(customCard))
      return 'persona-unavailable'
    const preferred = product.status === 'ok' ? product.value.provider?.chat?.preferred : undefined
    if (!preferred?.modelId)
      return 'configuration'
    const { providerId, modelId } = preferred
    const definition = findLiaAiProviderByStageProviderId(providerId)
    if (!definition || definition.availability !== 'ready')
      return 'configuration'
    if (customCard && !definition.localOnly)
      return 'persona-unavailable'
    let requestModel = modelId
    if (hasImage && product.status === 'ok') {
      const decision = decideBrainRouteFromProductState({
        ...brainCatalog,
        snapshot: product.value,
        requirement: brainRequirementForChatTurn({ hasImageInput: true }),
        automaticPolicy,
      })
      const route = decision.status === 'automatic' && decision.selection.status === 'selected'
        ? decision.selection.route
        : decision.status === 'manual' && decision.readiness.status === 'ready' && decision.resolution.status === 'resolvedModel'
          ? decision.resolution
          : undefined
      if (!route || route.engine.id !== definition.engineId)
        return 'image-unavailable'
      requestModel = route.model.id
    }

    const transports = await readTransports()
    const records = transports.records.filter(record => record.providerId === providerId)
    const [record] = records
    if (records.length !== 1 || !record?.enabled || transports.tombstones.includes(record.id)
      || record.definitionId !== definition.definitionId || record.credentialRef.scope !== providerId
      || record.credentialRef.key !== 'apiKey'
      || record.protocol !== 'chat-completions' || !record.modelIds.includes(modelId))
      return 'configuration'

    const destination = new URL(record.baseUrl)
    if (definition.localOnly) {
      if (!['127.0.0.1', '[::1]'].includes(destination.hostname)
        || record.adapterOptions.localOnly !== true || record.adapterOptions.allowUnauthenticated !== true)
        return 'configuration'
    }
    else if (!definition.requiresApiKey || destination.protocol !== 'https:') {
      return 'configuration'
    }
    return { providerId, modelId, requestModel, definition, transportId: record.id, destination, customCard }
  }

  async function send(input: unknown, signal: AbortSignal, image?: unknown): Promise<StageChatResult> {
    if (typeof input !== 'string' || input.length > 8_000 || !input.trim())
      return { ok: false, code: 'invalid' }
    const attachment = image === undefined ? undefined : imageContent(image)
    if (image !== undefined && !attachment)
      return { ok: false, code: 'image-invalid' }
    try {
      signal.throwIfAborted()
      const initial = await resolveRoute(Boolean(attachment))
      if (typeof initial === 'string')
        return initial === 'configuration' ? unavailableConfiguration() : { ok: false, code: initial }
      const { providerId, modelId, requestModel, definition, destination, customCard } = initial
      const prompt = customCard ? await readPersona?.(customCard) : defaultPersonaPrompt
      if (!prompt)
        return { ok: false, code: 'persona-unavailable' }
      const scope = [providerId, modelId, destination.href]
      if (customCard)
        scope.push(customCard)
      const route = createHash('sha256').update(JSON.stringify(scope)).digest('hex')
      if (history?.route !== route) {
        const saved = await storage?.recall(route).catch(() => [])
        history = { route, turns: saved?.slice(-historyTurns) ?? [] }
      }
      const current = history
      const text = input.trim()
      const memory = definition.localOnly ? await recallMemory?.(text.slice(0, LIA_MEMORY_LIMITS.query)) : undefined
      signal.throwIfAborted()
      // Preparation can yield while the Launcher edits the route. Ask the user to
      // retry a draft rather than silently sending it to another destination.
      const currentRoute = await resolveRoute(Boolean(attachment))
      signal.throwIfAborted()
      if (typeof currentRoute === 'string' || currentRoute.transportId !== initial.transportId
        || currentRoute.providerId !== providerId || currentRoute.modelId !== modelId
        || currentRoute.requestModel !== requestModel || currentRoute.destination.href !== destination.href
        || currentRoute.customCard !== customCard)
        return unavailableConfiguration()
      const credential = definition.localOnly ? undefined : credentialForDestination(readCredential?.(providerId), providerId, destination, 'chat')
      if (!definition.localOnly && !credential)
        return unavailableConfiguration()
      const context = memory?.ok ? memory.value : ''

      const registry = new ProviderRegistry()
      registry.register({ id: providerId, protocol: 'chat-completions', credentialRequired: definition.requiresApiKey })
      const runtime = new ProviderRuntime(registry, { fetch, resolveCredential: () => credential })
      const response = await runtime.chat({ providerId, baseUrl: destination.href }, {
        model: requestModel,
        messages: [
          { role: 'system', content: context ? `${prompt}\n\n${context}` : prompt },
          ...current.turns.flatMap(turn => [
            { role: 'user', content: turn.user },
            { role: 'assistant', content: turn.assistant },
          ]),
          { role: 'user', content: attachment ? [
            { type: 'text', text },
            { type: 'image_url', image_url: { url: attachment } },
          ] : text },
        ],
      }, { signal })
      signal.throwIfAborted()
      if (credential && response.text.includes(credential))
        return { ok: false, code: 'unavailable' }
      if (!context && !attachment)
        current.turns = [...current.turns, { user: text, assistant: response.text.slice(0, 8_000) }].slice(-historyTurns)
      const turn = { route, user: text, assistant: response.text.slice(0, 8_000), reusable: !context }
      if (storage && !attachment && (!credential || !text.includes(credential))) {
        try {
          await storage.append(turn)
        }
        catch {
          return { ok: true, text: response.text, historyUnavailable: true }
        }
      }
      return { ok: true, text: response.text }
    }
    catch (error) {
      if (signal.aborted)
        return { ok: false, code: 'cancelled' }
      if (error instanceof ProviderError) {
        if (error.code === 'credentials' || error.code === 'timeout')
          return { ok: false, code: error.code }
        if (error.code === 'http' && error.status === 429)
          return { ok: false, code: 'rate-limit' }
      }
      return { ok: false, code: 'unavailable' }
    }
  }
  return Object.assign(send, { clearContext() { history = undefined } })
}
