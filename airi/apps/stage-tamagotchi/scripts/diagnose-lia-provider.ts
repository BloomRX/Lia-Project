import type { LiaProductSummary, RuntimeDiagnosisInput, RuntimeStateSummary } from './diagnose-lia-provider-core'

import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  classify,
  OFFICIAL_PROVIDER_ID,
  providerNeedsKey,
  scanLocalStorageValue,
  summarizeLiaProductConfig,
  summarizeVaultFile,
} from './diagnose-lia-provider-core'

/**
 * Read-only diagnosis of the Lia chat credential chain.
 *
 * Usage (from the repository's `airi` directory):
 *   .\DiagnoseLiaProvider.ps1
 * or directly:
 *   pnpm exec tsx apps/stage-tamagotchi/scripts/diagnose-lia-provider.ts
 *
 * Guarantees:
 *  - it never prints a secret, an Authorization value or a full header map;
 *  - it never writes to the persisted configuration, the vault or the provider
 *    store; every write it performs is a temporary report file it removes;
 *  - it sends no chat message and, in the runtime probe, no network request at
 *    all (the probe intercepts `globalThis.fetch`).
 *
 * Exit code is 0 when the chain is structurally sound and 1 when it is not, so
 * the output can simply be pasted back.
 */

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_DIR = resolve(APP_DIR, '../..')

function section(title: string) {
  console.info(`\n[${title}]`)
}

function line(key: string, value: unknown) {
  console.info(`${key}=${value}`)
}

function readTextOrNull(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  }
  catch {
    return null
  }
}

/** Candidate Electron userData roots, most specific first. */
function userDataCandidates(): string[] {
  const candidates: string[] = []
  const override = process.env.LIA_DIAG_USER_DATA?.trim()
  if (override)
    candidates.push(override)
  const fromApp = process.env.APP_USER_DATA_PATH?.trim()
  if (fromApp)
    candidates.push(fromApp)

  const appData = process.env.APPDATA
  if (appData) {
    for (const name of ['Lia', 'lia', '@proj-airi/stage-tamagotchi', 'stage-tamagotchi', 'Electron', 'airi'])
      candidates.push(join(appData, name))
  }

  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home) {
    candidates.push(join(home, 'Library', 'Application Support', 'Lia'))
    candidates.push(join(home, '.config', 'Lia'))
  }

  return [...new Set(candidates)]
}

function findUserData(): { dir: string | null, searched: string[] } {
  const searched = userDataCandidates()
  for (const dir of searched) {
    if (existsSync(join(dir, 'lia-product.json')) || existsSync(join(dir, 'lia-secrets.json')))
      return { dir, searched }
  }
  return { dir: null, searched }
}

/** Reads the renderer's leveldb localStorage as raw latin1 blobs (best effort). */
function readLocalStorageBlobs(userDataDir: string | null): string[] {
  if (!userDataDir)
    return []

  const dir = join(userDataDir, 'Local Storage', 'leveldb')
  if (!existsSync(dir))
    return []

  const blobs: string[] = []
  for (const entry of readdirSync(dir)) {
    if (!/\.(?:log|ldb)$/.test(entry))
      continue
    try {
      blobs.push(readFileSync(join(dir, entry), 'latin1'))
    }
    catch {
      // Unreadable chunk: the scan simply has less to look at.
    }
  }
  return blobs
}

function summarizeRuntimeState(userDataDir: string | null): RuntimeStateSummary {
  const blobs = readLocalStorageBlobs(userDataDir)
  const readable = blobs.length > 0

  const configuredRaw = scanLocalStorageValue(blobs, 'settings/providers/configured')
  const configuredProviderIds: string[] = []
  if (configuredRaw) {
    try {
      const parsed = JSON.parse(configuredRaw) as Record<string, { status?: string }>
      for (const [id, record] of Object.entries(parsed)) {
        if (record?.status === 'configured')
          configuredProviderIds.push(id)
      }
    }
    catch {
      // A truncated scan yields no list; reported as empty, never as a failure.
    }
  }

  return {
    readable,
    activeProvider: scanLocalStorageValue(blobs, 'settings/consciousness/active-provider'),
    activeModel: scanLocalStorageValue(blobs, 'settings/consciousness/active-model'),
    configuredProviderIds,
  }
}

/** Runs the runtime probe (sections 6-10) in its own vitest project. */
function runRuntimeProbe(product: LiaProductSummary, hasSecret: boolean): RuntimeDiagnosisInput | null {
  const outPath = join(tmpdir(), `lia-diag-runtime-${process.pid}.json`)
  const vitestEntry = join(REPO_DIR, 'node_modules', 'vitest', 'vitest.mjs')
  if (!existsSync(vitestEntry)) {
    console.info(`\nruntime probe skipped: vitest entry not found at ${vitestEntry}`)
    return null
  }

  try {
    rmSync(outPath, { force: true })
  }
  catch {
    // Nothing to clean up.
  }

  const result = spawnSync(process.execPath, [
    vitestEntry,
    'run',
    '--config',
    'vitest.diagnose.config.ts',
  ], {
    cwd: APP_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      LIA_DIAG_OUT: outPath,
      LIA_DIAG_PROVIDER_ID: product.preferredProvider ?? '',
      LIA_DIAG_MODEL_ID: product.preferredModel ?? '',
      // The probe always uses a fake credential; this only tells it whether the
      // real vault has an entry, so the resolver path matches production.
      LIA_DIAG_HAS_SECRET: hasSecret ? 'true' : 'false',
    },
    encoding: 'utf8',
  })

  const raw = readTextOrNull(outPath)
  try {
    rmSync(outPath, { force: true })
  }
  catch {
    // Temporary file; safe to leave behind.
  }

  if (!raw) {
    const tail = (result.stderr ?? result.stdout ?? '').split('\n').filter(Boolean).slice(-6).join('\n')
    console.info('\nruntime probe produced no result. Last output lines:')
    console.info(tail || '(none)')
    return null
  }

  try {
    return JSON.parse(raw) as RuntimeDiagnosisInput
  }
  catch {
    console.info('\nruntime probe result was not valid JSON')
    return null
  }
}

function main() {
  console.info('Lia provider runtime diagnosis (read-only, no secrets printed)')

  section('1 Git / build')
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_DIR, encoding: 'utf8' })
  const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_DIR, encoding: 'utf8' })
  line('branch', (branch.stdout ?? '').trim() || 'unknown')
  line('HEAD', (head.stdout ?? '').trim() || 'unknown')

  section('2 Lia product config')
  const { dir: userDataDir, searched } = findUserData()
  line('userDataDir', userDataDir ?? 'NOT FOUND')
  if (!userDataDir) {
    console.info('searched:')
    for (const candidate of searched)
      console.info(`  - ${candidate}`)
  }

  const productPath = userDataDir ? join(userDataDir, 'lia-product.json') : null
  const product = summarizeLiaProductConfig(productPath ? readTextOrNull(productPath) : null, productPath)
  line('onboarded', product.onboarded)
  line('preferredProvider', product.preferredProvider ?? '')
  line('preferredModel', product.preferredModel ?? '')
  line('fallbackEnabled', product.fallbackEnabled)
  line('fallbackProvider', product.fallbackProvider ?? '')
  line('fallbackModel', product.fallbackModel ?? '')
  line('productConfigMentionsApiKey', product.documentMentionsApiKey)
  if (product.parseError)
    line('parseError', product.parseError)

  section('3 Vault')
  const vaultPath = userDataDir ? join(userDataDir, 'lia-secrets.json') : null
  const vault = summarizeVaultFile(
    vaultPath ? readTextOrNull(vaultPath) : null,
    vaultPath,
    product.preferredProvider,
    product.fallbackProvider,
  )
  line('vaultFileFound', vault.found)
  line('entryCount', vault.entryCount)
  line('scopes', vault.scopes.join(',') || '')
  line('primarySecretExists', vault.primarySecretExists)
  line('fallbackSecretExists', vault.fallbackSecretExists)
  for (const [scope, length] of Object.entries(vault.ciphertextLengths))
    line(`ciphertextLength[${scope}]`, length)
  if (vault.parseError)
    line('parseError', vault.parseError)

  section('4 Runtime consciousness')
  const runtimeState = summarizeRuntimeState(userDataDir)
  line('localStorageReadable', runtimeState.readable)
  line('activeProvider', runtimeState.activeProvider ?? 'unknown')
  line('activeModel', runtimeState.activeModel ?? 'unknown')

  section('5 Provider registry')
  const preferred = product.preferredProvider ?? ''
  const configured = runtimeState.configuredProviderIds.includes(preferred)
  line('providerId', preferred || '')
  line('providerStatus', configured ? 'configured' : 'unconfigured-or-unknown')
  line('configuredProviderIds', runtimeState.configuredProviderIds.join(',') || '')
  line('providerNeedsKey', preferred ? providerNeedsKey(preferred) : '')
  line('usesAiriNativeProvider', preferred === OFFICIAL_PROVIDER_ID)

  section('6-10 Runtime credential chain (fake credential, no network)')
  const runtime = runRuntimeProbe(product, vault.primarySecretExists)
  if (runtime) {
    line('resolverRegistered', runtime.resolverRegistered)
    line('resolverCalledForChat', runtime.credentialReachedChat)
    line('resolverCalledForModelListing', runtime.credentialReachedListModels)
    line('credentialReachedChat', runtime.credentialReachedChat)
    line('credentialReachedListModels', runtime.credentialReachedListModels)
    line('resolvedCredentialAvailable', runtime.resolvedCredentialAvailable)
    line('providerExists', runtime.providerExists)
    line('providerStatus', runtime.providerStatus ?? '')
    line('providerConfigExists', runtime.providerConfigExists)
    line('instanceCreated', runtime.instanceCreated)
    line('instanceProvider', runtime.instanceProvider ?? '')
    line('instanceModel', runtime.instanceModel ?? '')
    line('createProviderGotCredential', runtime.factorySawCredential)
    line('listModelsCalled', runtime.listModelsCalled)
    line('getChatProviderInstanceCalled', runtime.getChatProviderInstanceCalled)
    line('interceptedRequests', runtime.requests.length)
    for (const request of runtime.requests) {
      line('  endpoint', `${request.method} ${request.endpoint}`)
      line('  hasAuthorizationHeader', request.hasAuthorizationHeader)
      line('  authorizationHeaderLength', request.authorizationHeaderLength)
    }
    for (const note of runtime.notes)
      line('note', note)
  }

  const verdict = classify({ product, vault, runtimeState, runtime })

  console.info('')
  line('DIAG_STATUS', verdict.status)
  if (verdict.firstFailure)
    line('FIRST_FAILURE', verdict.firstFailure)
  if (verdict.hypothesis)
    line('HYPOTHESIS', verdict.hypothesis)
  line('REASON', verdict.reason)

  process.exitCode = verdict.status === 'PASS' ? 0 : 1
}

main()
