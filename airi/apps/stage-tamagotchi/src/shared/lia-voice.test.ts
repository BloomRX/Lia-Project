import type { LiaBootstrapState, LiaVoiceRuntimePrimaryAction } from './lia-voice'

import { describe, expect, it } from 'vitest'

import { resolveVoiceRuntimePrimaryAction } from './lia-voice'

/**
 * The round-7 UI hotfix contract, at the source of truth.
 *
 * "A tela nunca fica sem ação quando o runtime não está pronto." Before this
 * function existed, the card derived its button from scattered computeds and
 * an unlucky combination rendered zero actions on a runtime that could not
 * work. Every row of this matrix is a phase the state machine can actually
 * publish, and none of them answers 'none' while the runtime is not ready.
 * Removing a branch (the partial/failed one is the brief's mutation target)
 * fails a row here before it can hide a button again.
 */

const steps = (...ids: string[]): LiaBootstrapState['steps'] => ids.map(id => ({ id, status: 'pending' }))

function expectAction(input: { bootstrap?: LiaBootstrapState, runtimeReady: boolean }, action: LiaVoiceRuntimePrimaryAction): void {
  expect(resolveVoiceRuntimePrimaryAction(input), JSON.stringify(input.bootstrap?.phase)).toBe(action)
}

describe('resolveVoiceRuntimePrimaryAction - the never-empty-handed rule', () => {
  it('every publishable phase maps to exactly one action while the runtime cannot work', () => {
    const publishable: LiaBootstrapState['phase'][] = [
      'checking',
      'installing-prerequisites',
      'installing-runtime',
      'preparing-model',
      'verifying',
      'ready',
      'repair-needed',
      'failed',
      'cancelled',
      'not-installed',
    ]
    for (const phase of publishable) {
      const action = resolveVoiceRuntimePrimaryAction({ bootstrap: { phase, steps: [] }, runtimeReady: false })
      expect(['install', 'installing', 'repair', 'retry'], `phase ${String(phase)}`).toContain(action)
    }
  })

  it('not-installed, unknown or unloaded state → install, while the runtime does not work', () => {
    expectAction({ bootstrap: { phase: 'not-installed', steps: [] }, runtimeReady: false }, 'install')
    expectAction({ runtimeReady: false }, 'install')
  })

  it('a runtime-state read failure leaves no bootstrap: still install, not nothing', () => {
    // The round-7 QA branch: the probe IPC rejected, the renderer kept no
    // bootstrap payload and the runtime did not work - yet the old template
    // could produce zero actions. 'none' here was the bug.
    expectAction({ bootstrap: undefined, runtimeReady: false }, 'install')
  })

  it('failed (the round-6/7 partial tree: valid Miniconda, unfinished env, no start script) → retry - the brief\'s fixture', () => {
    expectAction(
      {
        bootstrap: { failureCategory: 'setup', message: 'The voice system could not be installed.', phase: 'failed', steps: steps() },
        runtimeReady: false,
      },
      'retry',
    )
  })

  it('failed with a health cause leaves the files in place → repair', () => {
    expectAction(
      { bootstrap: { failureCategory: 'health', phase: 'failed', steps: steps() }, runtimeReady: false },
      'repair',
    )
  })

  it('repair-needed → repair', () => {
    expectAction({ bootstrap: { phase: 'repair-needed', steps: steps() }, runtimeReady: false }, 'repair')
    expectAction({ bootstrap: { phase: 'repair-needed', steps: steps() }, runtimeReady: true }, 'repair')
  })

  it('ready → repair (maintenance with the same idempotent walk)', () => {
    expectAction({ bootstrap: { phase: 'ready', steps: steps() }, runtimeReady: true }, 'repair')
    expectAction({ bootstrap: { phase: 'ready', steps: steps() }, runtimeReady: false }, 'repair')
  })

  it('any active phase → installing (the button stays visible, disabled)', () => {
    for (const phase of ['checking', 'installing-prerequisites', 'installing-runtime', 'preparing-model', 'verifying'] as const) {
      expectAction({ bootstrap: { phase, steps: steps() }, runtimeReady: false }, 'installing')
    }
  })

  it('cancelled → retry', () => {
    expectAction({ bootstrap: { phase: 'cancelled', steps: steps() }, runtimeReady: false }, 'retry')
  })

  it('\'none\' is only ever a healthy-runtime answer, never a not-ready one', () => {
    // The one legitimate `none`: the runtime works and the bootstrap is silent -
    // the voice panel owns the actions then. Combination forbidden by the
    // rule: any not-ready runtime must carry an action.
    expectAction({ runtimeReady: true }, 'none')
    expectAction({ bootstrap: { phase: 'not-installed', steps: [] }, runtimeReady: true }, 'none')
    expect(resolveVoiceRuntimePrimaryAction({ bootstrap: undefined, runtimeReady: false })).not.toBe('none')
  })
})
