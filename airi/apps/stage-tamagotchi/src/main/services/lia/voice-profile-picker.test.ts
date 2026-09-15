import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  pickVoiceFiles,
  VOICE_IMPORT_LOG_PREFIX,
  windowForDialog,
} from './voice-profile-picker'

/**
 * Phase 6 hotfix, item Q/L — the main-process half of the picker, proven.
 *
 * QA on Windows clicked "Import voice" and got the friendly sentence, meaning
 * the click was alive but something between the handler and `showOpenDialog`
 * threw. These tests pin the three bridges between click and dialog: the
 * parent window is only ever an alive one (a destroyed handle is skipped,
 * never used), the log tells the whole story end to end, and a thrown dialog
 * reaches the caller with its technical reason already logged.
 */

const aliveWindow = { isDestroyed: () => false }
const deadWindow = {
  isDestroyed: () => {
    throw new Error('Object has been destroyed')
  },
}

let logs: string[]

beforeEach(() => {
  logs = []
})
const log = (line: string) => logs.push(line)

describe('windowForDialog', () => {
  it('prefers the focused window when it is alive', () => {
    const chosen = windowForDialog(() => aliveWindow, () => [])
    expect(chosen).toBe(aliveWindow)
  })

  it('skips a destroyed focused window rather than parenting to it', () => {
    const chosen = windowForDialog(() => deadWindow, () => [deadWindow, aliveWindow])
    expect(chosen).toBe(aliveWindow)
  })

  it('returns no parent when every window is gone', () => {
    const chosen = windowForDialog(() => null, () => [deadWindow])
    expect(chosen).toBeUndefined()
  })
})

describe('pickVoiceFiles', () => {
  const answered = { canceled: false, filePaths: ['C:\\audio\\voz.wav'] }

  function deps(overrides: Partial<Parameters<typeof pickVoiceFiles>[0]> = {}) {
    return {
      dialog: vi.fn(async () => answered),
      getAllWindows: () => [aliveWindow],
      getFocusedWindow: () => aliveWindow,
      log,
      ...overrides,
    }
  }

  it('opens over an alive window and returns the chosen paths', async () => {
    const fake = deps()
    const picked = await pickVoiceFiles(fake, { extensions: ['.wav'] })

    expect(picked).toEqual(['C:\\audio\\voz.wav'])
    expect(fake.dialog).toHaveBeenCalledTimes(1)
    // The window overload is the one that ran: a destroyed window would have
    // thrown instead of answering.
    expect(fake.dialog.mock.calls[0][0]).toBe(aliveWindow)
    expect(fake.dialog.mock.calls[0][1]).toMatchObject({ properties: ['openFile'] })
    const filters = (fake.dialog.mock.calls[0][1] as { filters: Array<{ extensions: string[] }> }).filters
    expect(filters[0].extensions).toEqual(['wav'])

    expect(logs).toEqual(['picker-main-received', 'picker-open-dialog parent=alive-window', 'picker-result cancelled=false count=1'])
  })

  it('opens parentless when there is no alive window, and still works', async () => {
    const fake = deps({ getAllWindows: () => [deadWindow], getFocusedWindow: () => deadWindow })
    const picked = await pickVoiceFiles(fake, { extensions: ['.wav'] })

    expect(picked).toEqual(['C:\\audio\\voz.wav'])
    expect(fake.dialog.mock.calls[0][0]).not.toHaveProperty('isDestroyed')
    expect(logs).toContain('picker-open-dialog parent=none')
  })

  it('a cancelled dialog resolves to null and changes nothing', async () => {
    const fake = deps({ dialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) })
    const picked = await pickVoiceFiles(fake, { extensions: ['.wav'] })

    expect(picked).toBeNull()
    expect(logs).toContain('picker-result cancelled=true count=0')
  })

  it('a thrown dialog logs the technical reason, rejects, and offers nothing', async () => {
    const boom = new Error('simulated native dialog failure')
    const fake = deps({
      dialog: vi.fn(async () => {
        throw boom
      }),
    })

    await expect(pickVoiceFiles(fake, { extensions: ['.wav'] })).rejects.toThrow('simulated native dialog failure')
    expect(logs).toContain('picker-failed simulated native dialog failure')
  })

  it('multi-select asks for multiSelections and lists without the dot', async () => {
    const fake = deps({ dialog: vi.fn(async () => ({ canceled: false, filePaths: ['a.wav', 'b.wav'] })) })
    const picked = await pickVoiceFiles(fake, { extensions: ['.wav', '.flac'], multiple: true })

    expect(picked).toHaveLength(2)
    const options = fake.dialog.mock.calls[0][1] as { filters: Array<{ extensions: string[] }>, properties: string[] }
    expect(options.properties).toContain('multiSelections')
    expect(options.filters[0].extensions).toEqual(['wav', 'flac'])
  })
})

describe('the log prefix', () => {
  it('is the documented one, so Windows QA can grep a single token', () => {
    expect(VOICE_IMPORT_LOG_PREFIX).toBe('[LIA-VOICE-IMPORT]')
  })
})
