import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultLiaProductConfig } from '../../../main/configs/lia'
import { normalizeLiaVoiceTts } from './voice'

/**
 * Pins the root cause found while investigating why the Voice tab of
 * "Configurar Lia" showed every field as "Não definido" on a real machine.
 *
 * The chain itself loses nothing:
 *
 *   lia-product.json -> IPC electronLiaVoiceConfigGet -> refreshConfig()
 *   -> applyTtsState() -> VoiceSection.vue
 *
 * There is simply no `voice.tts` to hydrate. The product default carries
 * `voice: {}`, the schema declares `tts` as optional with no default, and no
 * runtime code path writes it - so the bridge correctly answers `{ tts: {} }`
 * and the tab correctly reports an unconfigured voice.
 *
 * These assertions exist so that finding stays executable instead of turning
 * back into folklore, and so the day something starts writing `voice.tts` the
 * "nothing writes it" test fails loudly and gets revisited on purpose.
 */

const ipc = vi.hoisted(() => ({
  getVoiceConfig: vi.fn(async (): Promise<unknown> => ({ tts: {} })),
  saveVoiceConfig: vi.fn(async () => {}),
}))

vi.mock('@proj-airi/electron-vueuse', () => ({
  useElectronEventaInvoke: (invoke: { receiveEvent?: { id?: string } }) => {
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:get-receive')
      return ipc.getVoiceConfig
    if (invoke?.receiveEvent?.id === 'eventa:invoke:lia:voice:config:set-receive')
      return ipc.saveVoiceConfig

    throw new Error(`Unexpected eventa invoke: ${JSON.stringify(invoke)}`)
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: { value: 'pt-BR' }, t: (key: string) => key }),
}))

// `main/configs/lia` pulls the Electron persistence helper at module load. Only
// the exported default document is needed here, and `app.getPath` is all that
// helper touches on import - the same edge `main/services/lia/voice-config.test.ts`
// stubs. Nothing is read from or written to disk.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/lia-voice-hydration-test' },
}))

/** What `registerLiaVoiceConfigBridge`'s Get handler returns for a document. */
function getHandlerAnswer(config: typeof defaultLiaProductConfig | undefined) {
  return { tts: config?.voice?.tts ?? {} }
}

/** A `lia-product.json` document that really does carry a persisted voice. */
const PERSISTED_DOC = {
  ...defaultLiaProductConfig,
  voice: {
    tts: {
      preferred: {
        providerId: 'openai-compatible-audio-speech',
        modelId: 'tts-1',
        voiceId: 'alloy',
      },
      fallback: [
        { providerId: 'kokoro-local', modelId: 'kokoro-82m', voiceId: 'af_heart' },
      ],
    },
  },
}

describe('lia voice hydration chain (4E-1 investigation)', () => {
  beforeEach(() => {
    ipc.getVoiceConfig.mockReset()
    ipc.getVoiceConfig.mockResolvedValue({ tts: {} })
    ipc.saveVoiceConfig.mockReset()
  })

  it('the shipped product default carries no voice.tts at all', () => {
    // A fresh install therefore has nothing to hydrate, and the tab saying
    // "Não definido" is the truthful rendering rather than a lost value.
    expect(defaultLiaProductConfig.voice).toEqual({})
    expect('tts' in (defaultLiaProductConfig.voice ?? {})).toBe(false)
  })

  it('the bridge answer for that default normalizes to an unconfigured state', () => {
    const answer = getHandlerAnswer(defaultLiaProductConfig)
    expect(answer).toEqual({ tts: {} })

    const state = normalizeLiaVoiceTts(answer.tts)
    expect(state.preferred).toBeUndefined()
    expect(state.fallback).toEqual([])
  })

  it('a persisted voice survives the whole chain untouched', () => {
    // Positive control: the same code path keeps every reference field when a
    // voice really is persisted, so the empty case above is about the data and
    // not about normalization dropping it.
    const state = normalizeLiaVoiceTts(getHandlerAnswer(PERSISTED_DOC).tts)

    expect(state.preferred).toEqual({
      providerId: 'openai-compatible-audio-speech',
      modelId: 'tts-1',
      voiceId: 'alloy',
    })
    expect(state.fallback).toEqual([
      { providerId: 'kokoro-local', modelId: 'kokoro-82m', voiceId: 'af_heart' },
    ])
  })

  it('voice.tts has exactly one writer: the lia voice store', () => {
    // 4E-2 turned `voice.ts` into the single legitimate writer. This used to
    // assert "nobody writes voice.tts"; asserting that again would only mean
    // the feature was rolled back. What has to stay true is that no *second*
    // writer appears, so the source of truth cannot drift out of sync with the
    // card projection.
    // Paths come back relative to this folder's parent (stores/).
    const renderer = join(__dirname, '..')
    // Call sites, not mentions: a comment explaining why a file must NOT call
    // the writer is exactly what this test wants to keep around.
    const writers = [/\bpersistTtsConfig\s*\(/, /\bupdateTtsConfig\s*\(/]
    const hits: string[] = []

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(?:ts|vue)$/.test(entry) || /\.test\.ts$/.test(entry))
          continue

        const text = readFileSync(full, 'utf8')
        if (writers.some(writer => writer.test(text)))
          hits.push(full.slice(renderer.length + 1).split('\\').join('/'))
      }
    }
    walk(renderer)

    expect(hits).toEqual(['lia/voice.ts'])
  })
})
