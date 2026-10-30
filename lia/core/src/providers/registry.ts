import type { ProviderCapabilities, ProviderDefinition } from './contracts.ts'

import { ProviderError } from './contracts.ts'

export interface RegisteredProvider extends ProviderDefinition {
  capabilities: ProviderCapabilities
}

/** Product-owned definitions, not an allowlist of model IDs. */
export class ProviderRegistry {
  #definitions = new Map<string, RegisteredProvider>()

  register(definition: ProviderDefinition): void {
    if (!definition.id?.trim() || definition.protocol !== 'chat-completions' || this.#definitions.has(definition.id))
      throw new ProviderError('configuration')
    this.#definitions.set(definition.id, Object.freeze({
      id: definition.id,
      protocol: definition.protocol,
      credentialRequired: definition.credentialRequired === true,
      capabilities: Object.freeze({ text: true, streaming: true, modelDiscovery: true, ...definition.capabilities }),
    }))
  }

  has(providerId: string): boolean {
    return this.#definitions.has(providerId)
  }

  get(providerId: string): RegisteredProvider {
    const definition = this.#definitions.get(providerId)
    if (!definition)
      throw new ProviderError('unknown-provider')
    return definition
  }

  list(): RegisteredProvider[] {
    return [...this.#definitions.values()]
  }
}
