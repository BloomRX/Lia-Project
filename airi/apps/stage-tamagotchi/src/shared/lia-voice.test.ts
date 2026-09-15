import type { LiaBootstrapState, LiaRuntimeInstallState, LiaVoiceRuntimePrimaryAction, LiaVoiceRuntimeRunState } from './lia-voice'

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

function expectAction(input: { bootstrap?: LiaBootstrapState, installState?: LiaRuntimeInstallState, runtimeReady: boolean, runtimeState?: LiaVoiceRuntimeRunState }, action: LiaVoiceRuntimePrimaryAction): void {
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

describe('install state outranks the session rows (Phase 6 hotfix, item H)', () => {
  // The QA evidence this guards: the files were all on disk, the server
  // refused to start, and the card offered [Instalar] over a real install.
  // The disk answer must come from the main process and must win over
  // whatever the last bootstrap run remembered.

  it('installed + merely stopped → no reinstall button, ever (H-4)', () => {
    expectAction({ installState: 'installed', runtimeReady: false, runtimeState: 'stopped' }, 'none')
    // Even with a stale failed record hanging around, the files being complete
    // forbids [Instalar] - the QA regression in one assertion.
    expectAction(
      { bootstrap: { phase: 'failed', steps: steps() }, installState: 'installed', runtimeReady: false, runtimeState: 'stopped' },
      'none',
    )
  })

  it('installed + starting → still no button: the launch is narrated, not offered', () => {
    expectAction({ installState: 'installed', runtimeReady: false, runtimeState: 'starting' }, 'none')
  })

  it('installed + failed server → retry-start, never repair and never install (H-5)', () => {
    expectAction({ installState: 'installed', runtimeReady: false, runtimeState: 'failed' }, 'retry-start')
  })

  it('an active walk keeps the disabled in-flight button even on an installed tree', () => {
    for (const phase of ['checking', 'installing-prerequisites', 'installing-runtime', 'preparing-model', 'verifying'] as const) {
      expectAction(
        { bootstrap: { phase, steps: steps() }, installState: 'installed', runtimeReady: false, runtimeState: 'stopped' },
        'installing',
      )
    }
  })

  it('not-installed keeps the install door open (H-6)', () => {
    expectAction({ installState: 'not-installed', runtimeReady: false, runtimeState: 'stopped' }, 'install')
    // A failed attempt on an incomplete tree: health cause → repair, otherwise retry.
    expectAction(
      { bootstrap: { failureCategory: 'setup', phase: 'failed', steps: steps() }, installState: 'not-installed', runtimeReady: false, runtimeState: 'stopped' },
      'retry',
    )
    expectAction(
      { bootstrap: { failureCategory: 'health', phase: 'failed', steps: steps() }, installState: 'not-installed', runtimeReady: false, runtimeState: 'stopped' },
      'repair',
    )
    expectAction(
      { bootstrap: { phase: 'cancelled', steps: steps() }, installState: 'not-installed', runtimeReady: false, runtimeState: 'stopped' },
      'retry',
    )
  })

  it('repair-needed → repair, whichever way the runtime stands', () => {
    expectAction({ installState: 'repair-needed', runtimeReady: false, runtimeState: 'stopped' }, 'repair')
    expectAction({ installState: 'repair-needed', runtimeReady: false, runtimeState: 'failed' }, 'repair')
  })

  it('mutation guard: an explicit install answer can never produce the bare legacy wrongs', () => {
    // If the 'installed' branch regressed to falling through the matrix, this
    // row would answer 'install' (bootstrap failed → retry/repair in the
    // legacy path, 'install' with no record) and the QA bug is back.
    const states: LiaRuntimeInstallState[] = ['installed', 'not-installed', 'repair-needed']
    for (const installState of states) {
      const action = resolveVoiceRuntimePrimaryAction({ installState, runtimeReady: false, runtimeState: 'stopped' })
      expect(['install', 'none', 'repair'], installState).toContain(action)
      if (installState === 'installed')
        expect(action).not.toBe('install')
      if (installState === 'not-installed')
        expect(action).toBe('install')
    }
  })
})
