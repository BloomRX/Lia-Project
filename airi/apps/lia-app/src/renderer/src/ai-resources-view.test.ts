import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * PROMPT-39 static guarantees for the AI Settings page. The launcher test
 * runner is node-only by design, so the renderer contract is proven the same
 * way the shell is: source shape plus the boundaries the page must respect.
 *
 * The page is a VIEW. Main resolves providers, validates endpoints, stores the
 * key and writes the selection - the source must not duplicate any of that.
 */

function source(): string {
  return readFileSync(fileURLToPath(new URL('./views/AiResourcesView.vue', import.meta.url)), 'utf-8')
}

describe('AI Settings renderer (PROMPT-39)', () => {
  it('a: lists providers from the Main catalog instead of hardcoding a service', () => {
    const view = source()
    expect(view).toContain('props.api.aiProviders()')
    expect(view).toContain('provider.definitionId')
    expect(view).toContain('provider.availability')
    // No provider literal drives the page: the id must come from the catalog.
    expect(view).not.toMatch(/definitionId:\s*'groq'/)
    expect(view).not.toContain('api.groq.com')
  })

  it('b: keeps unavailable providers visible but not configurable', () => {
    const view = source()
    expect(view).toContain('provider.availability !== \'ready\'')
    expect(view).toContain(':disabled="provider.availability !== \'ready\' || !!busy"')
    expect(view).toContain('provider.unavailableReason')
    // The form only renders for a manageable provider.
    expect(view).toContain('v-if="activeProvider && manageable"')
  })

  it('c: every Main call carries the provider definition id - never an implicit provider', () => {
    const view = source()
    expect(view).toContain('props.api.aiConnectionGet(definitionId)')
    expect(view).toContain('props.api.aiConnectionModels(activeId.value)')
    expect(view).toContain('props.api.aiConnectionTest(activeId.value)')
    expect(view).toContain('providerId: activeId.value')
  })

  it('d: saves the model id verbatim and offers a manual id when discovery is incomplete', () => {
    const view = source()
    // Manual entry shares the same field the save sends; only surrounding
    // whitespace is trimmed, the id is never rewritten.
    expect(view).toContain('const modelId = form.modelId.trim()')
    expect(view).toContain('...(modelId ? { modelId } : {})')
    expect(view).toContain('id="ai-model"')
    expect(view).toContain('text.manualToggle')
    expect(view).toContain('text.manualHelp')
    // Discovery results never discard the already chosen model.
    expect(view).toContain('modelOptions')
  })

  it('e: never persists or logs a secret in the renderer', () => {
    const view = source()
    expect(view).not.toContain('localStorage')
    expect(view).not.toContain('sessionStorage')
    expect(view).not.toContain('console.log')
    expect(view).not.toContain('console.debug')
    // The draft key is cleared after the explicit save and on unmount.
    expect(view.match(/form\.apiKey = ''/g)?.length).toBeGreaterThanOrEqual(3)
    // The key is write-only: it is never read back from state.
    expect(view).not.toMatch(/state\.apiKey/)
  })

  it('f: surfaces the Main-typed failure codes, including the approved host rule', () => {
    const view = source()
    for (const code of ['credentials', 'unconfirmed-host', 'provider-unavailable', 'stage-running', 'protocol', 'timeout'])
      expect(view, code).toContain(`'${code}'`)
    // Changing the host requires the explicit confirmation checkbox.
    expect(view).toMatch(/\.\.\.\(hostChanged\.value && confirmHost\.value \? \{ confirmHostChange: true \} : \{\}\)/)
    expect(view).toContain('text.confirmHost')
  })

  it('g: shows the persisted selection after reopening the launcher', () => {
    const view = source()
    expect(view).toContain('selected.value = state.selected === true')
    expect(view).toContain('text.inUse')
    expect(view).toContain('text.current')
  })
})
