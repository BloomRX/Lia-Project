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
  productConfig?: Record<string, unknown>
  voiceCount?: number
} = {}): Promise<LiaHomeFixture> {
  const root = await mkdtemp(join(tmpdir(), 'lia-app-test-'))
  const appData = join(root, 'AppData', 'Roaming')
  const userData = join(appData, 'Lia')
  const installDir = join(root, 'runtimes', 'alltalk')

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
          runtime: { alltalk: { baseUrl: 'http://127.0.0.1:7851', installDir } },
          tts: { preferred: { providerId: 'custom-local-voice', voiceId: 'profile-1' } },
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
    engine: 'alltalk',
    files: [{ bytes: 1234, filename: 'model.wav', role: 'model' }],
    id: `profile-${i + 1}`,
    name: `Voz ${i + 1}`,
  }))
  await writeFile(join(voicesRoot, 'index.json'), `${JSON.stringify({ profiles }, null, 2)}\n`)

  // The managed runtime fixture: every marker the runtime manager requires.
  await mkdir(join(installDir, 'system'), { recursive: true })
  await mkdir(join(installDir, 'voices'), { recursive: true })
  await mkdir(join(installDir, 'alltalk_environment', 'conda'), { recursive: true })
  await mkdir(join(installDir, 'alltalk_environment', 'env'), { recursive: true })
  await writeFile(join(installDir, 'script.py'), '# fixture\n')
  await writeFile(join(installDir, 'start_alltalk.bat'), '@echo off\n')

  return { appData, installDir, userData, voicesRoot }
}

/** Env pointing the host at the fixture home (never at the real machine). */
export function fixtureEnv(home: LiaHomeFixture): Record<string, string> {
  return {
    APPDATA: home.appData,
  }
}
