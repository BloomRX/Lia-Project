/**
 * The Lia -> AIRI bridge contract (Phase 7, architecture items 5-6).
 *
 * AIRI is ONE managed Lia component: the stage/desktop companion. It never
 * installs, never chooses storage, never holds secrets - it consumes an
 * already-resolved Lia configuration. This file defines the smallest stable
 * contract the launcher can hand over through a shared document (the
 * canonical `lia-product.json`) plus launch-time facts (env / CLI args):
 *
 *   - `productConfigFile` - path of the canonical product document;
 *   - `identity/persona/language/llm/voice` - what the launcher resolved from
 *     it and from the canonical voice library at build time;
 *   - `runtime` - how to reach the managed speech runtime (no credentials;
 *     AllTalk on localhost takes none);
 *   - `hasSecret(providerId)` - only a BOOLEAN capability map. Secret VALUES
 *     never cross this bridge: AIRI asks the secret store at runtime for the
 *     single in-flight request, exactly as it does in-process today.
 *
 * There is deliberately no "inject": no monkey patches, no source rewriting,
 * no runtime code injection. AIRI keeps running as its own process with its
 * own stores; this contract is what the launcher guarantees AIRI will find.
 */

export interface LiaBridgeIdentity {
  /** Product display name shown in stage/detach contexts: "Lia". */
  productName: string
  /** Active persona card id, when the user completed persona onboarding. */
  personaCardId?: string
}

export interface LiaBridgeLlm {
  /** Preferred chat target, when provider onboarding is complete. */
  preferred?: { providerId: string, modelId?: string }
  /** Whether provider failover is enabled for the stage session. */
  fallbackEnabled?: boolean
}

export interface LiaBridgeVoice {
  /** Preferred TTS target - provider plus model/voice ids. */
  preferred?: { providerId: string, modelId?: string, voiceId?: string }
}

export interface LiaBridgeRuntime {
  /** Base URL of the managed AllTalk server, no trailing slash. */
  alltalkBaseUrl?: string
  /**
   * Whether the voice runtime is expected to be up for this launch.
   * The stage runs Lia-managed. Field name kept for bridge compatibility;
   * whichever modular voice engine is active keeps the same managed-mode
   * contract.
   */
  alltalkManaged: boolean
}

export interface LiaBridgeConfig {
  /** Version stamp so a future contract bump is detectable, never guessed. */
  bridgeVersion: 1
  identity: LiaBridgeIdentity
  /** Preferred product language ('' = inherit host detection). */
  language?: string
  llm: LiaBridgeLlm
  /** Absolute path of the canonical product document AIRI must read. */
  productConfigFile: string
  /** Canonical vault location (ciphertext only; never values). */
  secrets: {
    hasSecret: (providerId: string) => boolean
    vaultFile: string
  }
  runtime: LiaBridgeRuntime
  voice: LiaBridgeVoice
}

export interface BuildLiaBridgeConfigInput {
  hasSecret: (providerId: string) => boolean
  productConfigFile: string
  /** The tolerant snapshot produced by `readLiaProductConfig`. */
  snapshot: {
    persona?: { activeCardId?: string }
    preferences?: { language?: string }
    provider?: { chat?: { fallbackEnabled?: boolean, preferred?: { modelId?: string, providerId: string } } }
    voice?: {
      runtime?: { alltalk?: { baseUrl?: string, installDir?: string }, installDir?: string }
      tts?: { preferred?: { modelId?: string, providerId: string, voiceId?: string } }
    }
  }
  vaultFile: string
}

export function buildLiaBridgeConfig(input: BuildLiaBridgeConfigInput): LiaBridgeConfig {
  const chat = input.snapshot.provider?.chat
  const alltalk = input.snapshot.voice?.runtime?.alltalk
  const runtimeHome = input.snapshot.voice?.runtime?.installDir
  return {
    bridgeVersion: 1,
    identity: {
      personaCardId: input.snapshot.persona?.activeCardId,
      productName: 'Lia',
    },
    language: input.snapshot.preferences?.language === '' ? undefined : input.snapshot.preferences?.language,
    llm: {
      fallbackEnabled: chat?.fallbackEnabled,
      preferred: chat?.preferred
        ? { modelId: chat.preferred.modelId, providerId: chat.preferred.providerId }
        : undefined,
    },
    productConfigFile: input.productConfigFile,
    runtime: {
      alltalkBaseUrl: alltalk?.baseUrl,
      alltalkManaged: alltalk?.installDir !== undefined || runtimeHome !== undefined,
    },
    secrets: {
      hasSecret: input.hasSecret,
      vaultFile: input.vaultFile,
    },
    voice: {
      preferred: input.snapshot.voice?.tts?.preferred
        ? {
            modelId: input.snapshot.voice.tts.preferred.modelId,
            providerId: input.snapshot.voice.tts.preferred.providerId,
            voiceId: input.snapshot.voice.tts.preferred.voiceId,
          }
        : undefined,
    },
  }
}

/**
 * Launch-time facts the Lia App hands the stage child process (architecture
 * item 6, option 3): environment variables - simple, inspectable, and gone
 * when the process is gone. Nothing secret ever rides in them.
 */
export const LIA_STAGE_ENV = {
  /** "1" marks a Lia-managed stage session. */
  managed: 'LIA_MANAGED',
  /** Absolute path of the canonical product document. */
  productConfigFile: 'LIA_PRODUCT_CONFIG_FILE',
  /** Absolute path of the canonical vault ciphertext (never values). */
  vaultFile: 'LIA_VAULT_FILE',
} as const

export function stageEnvFor(bridge: LiaBridgeConfig): Record<string, string> {
  return {
    [LIA_STAGE_ENV.managed]: '1',
    [LIA_STAGE_ENV.productConfigFile]: bridge.productConfigFile,
    [LIA_STAGE_ENV.vaultFile]: bridge.secrets.vaultFile,
  }
}
