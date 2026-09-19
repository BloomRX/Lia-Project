import type { LiaSecretCipher } from '@lia/core/secrets/vault'

import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Shared fixtures for the launcher tests (Phase 7, architecture item 18).
 */

/** Identity cipher for deterministic vault tests (never production data). */
export const identityCipher: LiaSecretCipher = {
  available: () => true,
  decrypt: payload => payload.toString('utf8'),
  encrypt: value => Buffer.from(value, 'utf8'),
}

export interface LiaHomeFixture {
  appData: string
  installDir: string
  userData: string
  voicesRoot: string
}

/**
 * A product home on disk: `%APPDATA%\Lia` holding the canonical
 * `lia-product.json`, the voice library (`lia-voices/index.json`) and a
 * managed AllTalk install fixture under rundir/. This mirrors what a user's
 * machine already has - the launcher attaches to it, never creates a copy.
 */
export async function makeLiaHome(options: {
  customVoice?: boolean
  /**
   * The canonical profile id for the FIRST fixture voice, when a test needs
   * a syntactically real UUID (Phase 7.5: managed voice filenames require
   * one). Defaults keep `profile-N` so pre-7.5 fixture users don't churn.
   */
  firstVoiceId?: string
  /**
   * Phase 7.4 test E: write the registry but skip the profile FILES, so
   * `findMissingFiles` reports the imported voice as incomplete.
   */
  missingVoiceFiles?: boolean
  productConfig?: Record<string, unknown>
  voiceCount?: number
} = {}): Promise<LiaHomeFixture> {
  const root = await mkdtemp(join(tmpdir(), 'lia-app-test-'))
  const appData = join(root, 'AppData', 'Roaming')
  const userData = join(appData, 'Lia')
  const installDir = join(root, 'runtimes', 'lia-voice')

  const product = options.productConfig ?? {
    persona: { activeCardId: 'lia-default' },
    preferences: { language: 'pt-BR' },
    provider: {
      chat: {
        onboarded: true,
        preferred: { modelId: 'test-model', providerId: 'openrouter' },
      },
    },
    schemaVersion: 1,
    voice: options.customVoice
      ? {
          engine: { preferred: 'alltalk' },
          runtime: { installDir },
          tts: { preferred: { providerId: 'custom-local-voice', voiceId: options.firstVoiceId ?? 'profile-1' } },
        }
      : {
          tts: { preferred: { providerId: 'cloud-voice-provider', voiceId: 'nova' } },
        },
  }
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'lia-product.json'), `${JSON.stringify(product, null, 2)}\n`)

  const voicesRoot = join(userData, 'lia-voices')
  await mkdir(voicesRoot, { recursive: true })
  const profiles = Array.from({ length: options.voiceCount ?? 2 }, (_, i) => ({
    createdAt: '2026-09-01T12:00:00.000Z',
    // Legacy-era id: existing documents carrying it must stay readable.
    engine: 'alltalk',
    files: [{ bytes: 1234, filename: 'model.wav', role: 'referenceAudio' }],
    id: i === 0 ? options.firstVoiceId ?? 'profile-1' : `profile-${i + 1}`,
    name: `Voz ${i + 1}`,
  }))
  await writeFile(join(voicesRoot, 'index.json'), `${JSON.stringify({ profiles }, null, 2)}\n`)

  // The canonical COPIES (Phase 7.4 Part A): the library is self-contained,
  // so an entry the profile lists on disk must actually be there, exactly as
  // the import left it - unless the test deliberately asks for a broken one.
  if (!options.missingVoiceFiles) {
    for (const profile of profiles) {
      await mkdir(join(voicesRoot, profile.id), { recursive: true })
      await writeFile(join(voicesRoot, profile.id, 'model.wav'), Buffer.alloc(1234))
    }
  }

  // The managed runtime fixture (Phase 7.8C, engine-neutral): the home
  // exists on disk; the install PROOF is whatever the hosted modular engine
  // (Kokoro first) declares - asserted by tests via `inspectInstallImpl`,
  // never baked into the fixture itself.
  await mkdir(installDir, { recursive: true })

  return { appData, installDir, userData, voicesRoot }
}

/** Env pointing the host at the fixture home (never at the real machine). */
export function fixtureEnv(home: LiaHomeFixture): Record<string, string> {
  return {
    APPDATA: home.appData,
  }
}
