import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { CUSTOM_VOICE_PROVIDER_ID } from '../../../shared/lia-voice'
import { buildInstallSteps, INSTALL_STEPS, mayAutostartRuntime, shouldAutostartRuntime } from './alltalk-runtime-install'
import { isLauncherManaged } from './lia-managed'

/**
 * The parts of the runtime service that carry a decision, tested without booting
 * Electron. The IPC handlers themselves are thin: they call these and hand the
 * result to the renderer.
 */

describe('isLauncherManaged (Phase 7.1, item 4)', () => {
  it('is true only for the exact launcher marker', () => {
    expect(isLauncherManaged({ ...process.env, LIA_MANAGED: '1' })).toBe(true)
    expect(isLauncherManaged({ ...process.env, LIA_MANAGED: '0' })).toBe(false)
    expect(isLauncherManaged({ ...process.env, LIA_MANAGED: 'true' })).toBe(false)
    expect(isLauncherManaged({ ...process.env, LIA_MANAGED: undefined })).toBe(false)
  })
})

describe('shouldAutostartRuntime', () => {
  it('autostarts only for a custom voice', () => {
    expect(shouldAutostartRuntime({ providerId: CUSTOM_VOICE_PROVIDER_ID })).toBe(true)
  })

  it('does not autostart for a built-in voice', () => {
    // Starting a 10 GB server for someone using a bundled voice would be a
    // minutes-long boot penalty for something they will never call.
    expect(shouldAutostartRuntime({ providerId: 'kokoro' })).toBe(false)
    expect(shouldAutostartRuntime({ providerId: 'ollama' })).toBe(false)
  })

  it('does not autostart when nothing is selected', () => {
    expect(shouldAutostartRuntime(undefined)).toBe(false)
    expect(shouldAutostartRuntime({})).toBe(false)
  })

  it('does not autostart on a provider id that merely looks similar', () => {
    // A prefix match would make 'custom-local-voice-v2' start the runtime too.
    expect(shouldAutostartRuntime({ providerId: 'custom-local-voice-v2' })).toBe(false)
    expect(shouldAutostartRuntime({ providerId: 'not-custom-local-voice' })).toBe(false)
  })
})

describe('mayAutostartRuntime', () => {
  it('autostarts a custom voice when nothing is installing', () => {
    expect(mayAutostartRuntime({ providerId: CUSTOM_VOICE_PROVIDER_ID })).toBe(true)
  })

  it('does not autostart while an install is in flight', () => {
    // The mutation this guards: starting a server whose files are still being
    // written reports a failure the user did nothing to cause, and the
    // bootstrap's own final step starts it anyway.
    expect(mayAutostartRuntime({ providerId: CUSTOM_VOICE_PROVIDER_ID }, { installing: true })).toBe(false)
  })

  it('does not autostart a built-in voice even when idle', () => {
    // A user who picked a ready-made voice should never pay for a server they
    // will not use, install or no install.
    expect(mayAutostartRuntime({ providerId: 'kokoro-local' })).toBe(false)
    expect(mayAutostartRuntime(undefined)).toBe(false)
  })

  it('treats an omitted option as not installing', () => {
    expect(mayAutostartRuntime({ providerId: CUSTOM_VOICE_PROVIDER_ID }, {})).toBe(true)
  })
})

describe('buildInstallSteps', () => {
  it('offers every documented step', () => {
    const steps = buildInstallSteps({ installDirConfigured: false, installed: false })

    expect(steps).toHaveLength(INSTALL_STEPS.length)
    // Each step needs an id the UI can track progress by, plus something to show.
    for (const step of steps) {
      expect(step.id).toBeTruthy()
      expect(step.title).toBeTruthy()
      expect(step.detail).toBeTruthy()
    }
  })

  it('leaves everything unchecked before the user has done anything', () => {
    const steps = buildInstallSteps({ installDirConfigured: false, installed: false })
    expect(steps.every(step => !step.done)).toBe(true)
  })

  it('marks only the final step done once a real install is pointed at', () => {
    const steps = buildInstallSteps({ installDirConfigured: true, installed: true })

    expect(steps.find(step => step.id === 'point-lia')?.done).toBe(true)
    // The prerequisites cannot be verified from inside the app, so claiming them
    // would be inventing progress the user did not make.
    expect(steps.filter(step => step.done)).toHaveLength(1)
  })

  it('does not count a chosen folder that is not actually an install', () => {
    // Pointing at an empty directory is a mistake, not progress.
    const steps = buildInstallSteps({ installDirConfigured: true, installed: false })
    expect(steps.find(step => step.id === 'point-lia')?.done).toBe(false)
  })

  it('mentions the constraints that make installs fail', () => {
    // These are the documented gotchas: a path with spaces or hyphens stops
    // AllTalk from starting at all, and the download needs ~24 GB.
    const download = INSTALL_STEPS.find(step => step.id === 'download')
    expect(download?.detail).toContain('spaces')
    expect(download?.detail).toContain('24 GB')

    const setup = INSTALL_STEPS.find(step => step.id === 'setup')
    expect(setup?.detail).toContain('Standalone Installation')
  })

  it('never returns a mutable reference to the shared step list', () => {
    // The UI may annotate steps; a shared reference would leak between calls.
    const steps = buildInstallSteps({ installDirConfigured: true, installed: true })
    steps[0].done = true

    expect(INSTALL_STEPS[0].done).toBe(false)
  })
})
