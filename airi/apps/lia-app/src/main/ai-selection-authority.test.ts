import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Autoridade única da seleção de IA (Etapa 2.1, 12/11/2026).
 *
 * A decisão aprovada no PROMPT-39 diz que o Launcher/Main é a autoridade da
 * seleção e que NÃO pode existir uma segunda seleção concorrente em `brain.*`.
 * O código só continua obedecendo isso se o teste cobrar:
 *
 *  - o serviço grava a seleção canônica em `provider.chat.preferred` e em
 *    nenhum outro lugar;
 *  - o serviço não conhece Electron, Brain nem Stage por import de execução;
 *  - o catálogo é a única fonte de identidade (definitionId -> stageProviderId
 *    -> engineId), sem igualdade de string presumida.
 *
 * O que este teste NÃO prova: que o Stage consome a seleção em runtime. Isso
 * é o gate Windows, e está registrado como NOT RUN.
 */

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf-8')
}

const SERVICE = source('./ai-connection-service.ts')
/** Value imports only: `import type` erases at runtime and is not coupling. */
const RUNTIME_SERVICE = SERVICE.replace(/^import type .*$/gm, '').replace(/^\s*import type \{[\s\S]*?\} from .*$/gm, '')

describe('AI selection authority', () => {
  it('writes the canonical selection through the injected writer only', () => {
    // The service never touches the product document or the vault file itself;
    // both arrive as dependencies owned by the host.
    expect(SERVICE).toContain('deps.saveSelection({ providerId: definition.stageProviderId')
    expect(SERVICE).toContain('deps.readSelection()')
    expect(SERVICE).not.toMatch(/writeLiaProductConfig|updateLiaProductConfig|readLiaProductConfig/)
    expect(RUNTIME_SERVICE).not.toMatch(/from '@lia\/core\//)
  })

  it('never creates a second selection under brain.*', () => {
    // `brain.engine.preferred` / `brain.model.preferred` are a DIFFERENT
    // authority. The AI Settings service must not write them.
    expect(SERVICE).not.toMatch(/brainSelectionUpdate|brainRoutingModeUpdate/)
    expect(SERVICE).not.toMatch(/brain\s*:\s*\{/)
    expect(SERVICE).not.toMatch(/engine\.preferred|model\.preferred/)
  })

  it('stays runtime-agnostic: no Electron, no Stage import at execution time', () => {
    expect(SERVICE).not.toMatch(/from 'electron'/)
    expect(SERVICE).not.toMatch(/from '.*stage-tamagotchi/)
    // The Brain mapping is referenced by the TEST (audited table), not by the
    // production service - the service talks to the canonical selection only.
    expect(SERVICE).not.toMatch(/LIA_BRAIN_ENGINE_PROVIDER_MAPPING/)
  })

  it('derives identity from the catalog instead of string equality', () => {
    // Every routed value comes from the definition object, never from the
    // user-supplied providerId being assumed equal to the engine id.
    expect(SERVICE).toContain('definition.stageProviderId')
    expect(SERVICE).toContain('definition.engineId')
    expect(SERVICE).toContain('definitionById(input.providerId)')
  })

  it('fails closed when the catalog cannot manage the provider', () => {
    expect(SERVICE).toContain("return { ok: false, code: 'provider-unavailable' }")
    expect(SERVICE).toMatch(/availability === 'ready'/)
    // A save that cannot verify configuration leaves the record disabled.
    expect(SERVICE).toContain('enabled: false')
    expect(SERVICE).toContain('configurationSafe = false')
  })
})
