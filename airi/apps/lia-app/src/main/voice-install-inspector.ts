/**
 * Phase 7.9E.2: the PRODUCTION install proof for the Conversar voice gate.
 *
 * The launcher bootstrap used to create the host WITHOUT `inspectInstallImpl`,
 * so the gate's default probe answered voice-runtime-not-installed on every
 * real machine - even with a production-smoke-validated Kokoro tree sitting
 * at `%LOCALAPPDATA%\Lia\runtimes\kokoro` (Windows QA blocker, 7.9E.2).
 *
 * Layout knowledge stays where it belongs: `resolveKokoroLayout` and
 * `inspectKokoroInstall` (lia-core) are the Kokoro ENGINE's single authority
 * for its own runtime tree. This module only composes that authority with
 * the one real `existsSync` and passes the EFFECTIVE runtime home straight
 * through, so the canonical default and any future
 * `voice.runtime.installDir` override is proven on the exact tree the user
 * actually has - no path is ever hand-composed here.
 *
 * The seam is intentionally tiny and isolated: when a second engine lands,
 * an engine registry replaces THIS factory and nothing else in the launcher.
 *
 * The proof is READ-ONLY: it checks bytes on disk. It never downloads, never
 * installs, and never creates, mutates or deletes anything.
 */

import { existsSync } from 'node:fs'

import { inspectKokoroInstall, resolveKokoroLayout } from '@lia/core/voice/engines/kokoro'

/** Matches `LiaHostDeps['inspectInstallImpl']` (see lia-host). */
export type LiaVoiceInstallInspector = (runtimeHome: string, platform?: string) => Promise<boolean>

/**
 * The production probe for the launcher's voice gate. Today the first real
 * engine is Kokoro; keep every engine-specific call inside this function.
 */
export function createLiaVoiceInstallInspector(): LiaVoiceInstallInspector {
  return async (runtimeHome, platform) => inspectKokoroInstall(
    resolveKokoroLayout({
      home: runtimeHome,
      ...(platform !== undefined ? { platform } : {}),
    }),
    { existsSync },
  ).installed
}
