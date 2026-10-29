import type { InferenceServiceProvider } from '@proj-airi/stage-ui/libs/providers/types'

import type { LiaProviderConfigSource } from './provider-config-facade'

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { PiniaColada } from '@pinia/colada'
import { useProviderConfigStore } from '@proj-airi/stage-ui/stores/providers/config'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import {
  createLiaProviderConfigFacade,
  LIA_PROVIDER_CONFIG_REMOTE_EFFECTS,
  useLiaProviderConfigFacade,
} from './provider-config-facade'

/**
 * B0.7 — the Lia's provider-configuration facade.
 *
 * Three questions, one `describe` block each:
 *
 *  1. **Is it a facade?** Built over a recording double, every member must
 *     forward the exact arguments to the delegate and return its value
 *     unchanged. Nothing is computed here, so nothing can drift.
 *  2. **Does the shared store stay authoritative?** Against the real stores, a
 *     write through the facade must be visible exactly where the Stage runtime
 *     reads it — `useProviderConfigStore().configs`, the path
 *     `useProviderStore` uses to build instances. If that ever stops being true,
 *     "the Lia configured a provider" and "the runtime can build it" have
 *     diverged.
 *  3. **Which operations still reach the network?** `ensure` must not, and
 *     `updateConfig` must — replication is *not* disabled in this step, and a
 *     silent change in either direction has to fail a test rather than a review.
 *
 * Deterministic by construction: `fetch` is stubbed, no vault, no product file,
 * no credential — and no fake credential either, since nothing here is supposed
 * to carry one. The "no credential" test therefore asserts the payload keys are
 * exactly the ones the caller passed, rather than searching for a key it would
 * have to invent first.
 *
 * Reference: docs/architecture/LIA-PROVIDER-ADAPTER-DESIGN-2026-10-29.md §3 and
 * §6.1 (T1, T2, T3, T8).
 */

const observed = vi.hoisted(() => ({ requests: [] as string[] }))

function stubFetch(response: unknown = { data: [] }) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    observed.requests.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url)
    return new Response(JSON.stringify(response), { status: 200 })
  }))
}

/** Records every call and returns sentinel values, so delegation is observable. */
function createRecordingSource() {
  const record: InferenceServiceProvider = {
    id: 'groq',
    definitionId: 'groq',
    config: { baseUrl: 'https://recorded.invalid/v1' },
    status: 'configured',
    configuredBy: 'user',
  }
  const source = {
    configuredProviders: { groq: true, other: false } as Record<string, boolean>,
    getProvider: vi.fn((providerId: string) => (providerId === 'groq' ? record : undefined)),
    getProviderConfig: vi.fn((providerId: string) => (providerId === 'groq' ? record.config : undefined)),
    ensureProvider: vi.fn((providerId: string, definitionId: string, config?: Record<string, unknown>) => ({
      ...record,
      id: providerId,
      definitionId,
      config: config ?? {},
    })),
    updateProviderConfig: vi.fn(async (providerId: string, config: Record<string, unknown>, status: string) => ({
      ...record,
      id: providerId,
      config,
      status: status as InferenceServiceProvider['status'],
    })),
  } satisfies LiaProviderConfigSource
  return { source, record }
}

describe('lia provider config facade — it only delegates', () => {
  it('forwards each read to the delegate and returns its value unchanged', () => {
    const { source, record } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)

    expect(facade.get('groq')).toBe(record)
    expect(source.getProvider).toHaveBeenCalledExactlyOnceWith('groq')

    expect(facade.getConfig('groq')).toBe(record.config)
    expect(source.getProviderConfig).toHaveBeenCalledExactlyOnceWith('groq')

    expect(facade.get('absent')).toBeUndefined()
  })

  it('reads configuredProviders at call time instead of capturing it', () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)

    expect(facade.isConfigured('groq')).toBe(true)
    expect(facade.isConfigured('other')).toBe(false)
    expect(facade.isConfigured('absent')).toBe(false)

    // A captured copy would keep answering `true` here. The map is derived on
    // the shared store and must stay live for the caller.
    source.configuredProviders.groq = false
    expect(facade.isConfigured('groq')).toBe(false)
  })

  it('forwards ensure with the same arguments and does not copy the payload', () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)
    const payload = { baseUrl: 'https://example.invalid/v1' }

    facade.ensure('groq', 'groq', payload)

    expect(source.ensureProvider).toHaveBeenCalledExactlyOnceWith('groq', 'groq', payload)
    expect(source.ensureProvider.mock.calls[0][2]).toBe(payload)
  })

  it('defaults an omitted ensure payload to an empty object', () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)

    facade.ensure('groq', 'groq')

    expect(source.ensureProvider).toHaveBeenCalledExactlyOnceWith('groq', 'groq', {})
  })

  it('forwards updateConfig with payload and status, resolving to the delegate value', async () => {
    const { source } = createRecordingSource()
    const facade = createLiaProviderConfigFacade(source)
    const payload = { baseUrl: 'https://next.invalid/v1' }

    const result = await facade.updateConfig('groq', payload, 'unconfigured')

    expect(source.updateProviderConfig).toHaveBeenCalledExactlyOnceWith('groq', payload, 'unconfigured')
    expect(result).toMatchObject({ id: 'groq', status: 'unconfigured' })
  })
})

describe('lia provider config facade — the shared store stays the source of truth', () => {
  /**
   * Same plugin set the desktop renderer installs; without PiniaColada the
   * remote mutation fails before reaching the network and the test would
   * misreport "no replication".
   */
  function installStores() {
    observed.requests = []
    const app = createApp({})
    const pinia = createPinia()
    app.use(pinia)
    app.use(PiniaColada)
    setActivePinia(pinia)
    return { config: useProviderConfigStore(), facade: useLiaProviderConfigFacade() }
  }

  beforeEach(() => {
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('ensure writes locally, is visible to the runtime read path, and never reaches the network', () => {
    const { config, facade } = installStores()

    const created = facade.ensure('groq', 'groq', { baseUrl: 'https://example.invalid/v1' })

    expect(created).toMatchObject({ id: 'groq', status: 'unconfigured', configuredBy: 'user' })
    // Deep equality, not identity: the shared store hands back a reactive proxy
    // of the record it holds, so `toBe` compares a proxy against a raw object.
    // What matters is that the store has the record the facade returned.
    expect(config.getProvider('groq')).toStrictEqual(created)
    // `configs` is the exact path `useProviderStore` reads to build instances.
    expect(config.configs.groq).toEqual({ baseUrl: 'https://example.invalid/v1' })
    expect(observed.requests).toEqual([])
  })

  it('ensure on an existing record keeps it, does not overwrite it, and stays offline', () => {
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})
    config.providers.groq.config = { baseUrl: 'https://kept.invalid/v1' }

    const again = facade.ensure('groq', 'groq', { baseUrl: 'https://ignored.invalid/v1' })

    expect(again?.config).toEqual({ baseUrl: 'https://kept.invalid/v1' })
    expect(observed.requests).toEqual([])
  })

  it('updateConfig still replicates to the remote service — replication is not disabled here', async () => {
    stubFetch({
      id: 'groq',
      definitionId: 'groq',
      config: { baseUrl: 'https://next.invalid/v1' },
      status: 'configured',
      configuredBy: 'user',
    })
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})

    const updated = await facade.updateConfig('groq', { baseUrl: 'https://next.invalid/v1' }, 'configured')

    expect(updated).toBeDefined()
    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://next.invalid/v1' })
    expect(observed.requests.length).toBeGreaterThan(0)
  })

  it('updateConfig keeps the local payload when the remote call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('remote unavailable')
    }))
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})

    await expect(facade.updateConfig('groq', { baseUrl: 'https://kept.invalid/v1' }, 'unconfigured'))
      .resolves
      .toBeDefined()

    expect(config.getProviderConfig('groq')).toEqual({ baseUrl: 'https://kept.invalid/v1' })
  })

  it('treats an update to an unknown provider as a no-op, like the shared store', async () => {
    const { config, facade } = installStores()

    await expect(facade.updateConfig('ghost', { baseUrl: 'https://x.invalid' }, 'unconfigured'))
      .resolves
      .toBeUndefined()

    expect(config.getProvider('ghost')).toBeUndefined()
    expect(observed.requests).toEqual([])
  })

  it('reflects a status written elsewhere on the shared store', () => {
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', {})

    expect(facade.isConfigured('groq')).toBe(false)

    // Not through the facade: this is the Stage's own runtime path
    // (`forceProviderConfigured`), proving the facade reads shared state rather
    // than keeping an opinion of its own.
    config.setProviderStatus('groq', 'configured')

    expect(facade.isConfigured('groq')).toBe(true)
  })

  it('propagates the shared store refusal when ensure gets an unknown definition (T-E)', () => {
    const { config, facade } = installStores()

    // The shared store throws for a definition the registry does not know, and
    // the facade neither swallows nor rewrites that: a caller cannot end up
    // believing a record was created. This is pinned because a future Lia-owned
    // implementation would have to decide the same thing explicitly.
    expect(() => facade.ensure('ghost', 'no-such-definition', { baseUrl: 'https://ghost.invalid/v1' }))
      .toThrow(/no-such-definition/)

    expect(config.getProvider('ghost')).toBeUndefined()
    expect(config.configs.ghost).toBeUndefined()
    expect(observed.requests).toEqual([])
  })

  it('never adds a credential to the payload it writes', async () => {
    const { config, facade } = installStores()
    facade.ensure('groq', 'groq', { baseUrl: 'https://example.invalid/v1' })

    await facade.updateConfig('groq', { baseUrl: 'https://example.invalid/v1', model: 'm-1' }, 'unconfigured')

    const written = config.getProvider('groq')
    expect(Object.keys(written?.config ?? {}).sort()).toEqual(['baseUrl', 'model'])
    expect(JSON.stringify(written)).not.toContain('apiKey')
  })
})

describe('lia provider config facade — the remote-effect inventory', () => {
  it('declares updateConfig as the only operation with a remote effect', () => {
    const remote = Object.entries(LIA_PROVIDER_CONFIG_REMOTE_EFFECTS)
      .filter(([, effect]) => effect)
      .map(([member]) => member)

    expect(remote).toEqual(['updateConfig'])
  })

  it('declares exactly the members the facade exposes, so a new member cannot skip the inventory', () => {
    const { source } = createRecordingSource()
    const exposed = Object.keys(createLiaProviderConfigFacade(source)).sort()

    expect(Object.keys(LIA_PROVIDER_CONFIG_REMOTE_EFFECTS).sort()).toEqual(exposed)
  })
})

/**
 * Every production source under a directory, recursively.
 *
 * Only tests are excluded: they may import the store under test directly, and
 * scanning them would make the frontier check fire on its own fixtures.
 */
function collectProductionSources(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...collectProductionSources(path))
      continue
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.vue'))
      continue
    if (/\.test\.tsx?$/.test(entry.name))
      continue
    found.push(path)
  }
  return found
}

describe('lia provider config facade — the import frontier (B0.7.1, T-A)', () => {
  /**
   * The frontier is a property of the Lia's own store layer, so the scan root is
   * this directory and it is read **recursively**. The rest of `src/renderer` is
   * deliberately out of scope: `App.vue`, `main.ts`, `bridges/` and
   * `pages/onboarding.vue` are the Stage's own shell and legitimately import
   * `stores/auth` and `libs/analytics` — that is the remaining dependency work,
   * not a B0.7 regression.
   */
  const root = import.meta.dirname

  const scanned = collectProductionSources(root).map((path) => {
    const source = readFileSync(path, 'utf8')
    return {
      // Kept so the activation check below can look at member access, not just
      // at module specifiers, without reading every file a second time.
      source,
      path,
      relativePath: relative(root, path),
      imports: scanModuleImports(source).map(found => found.specifier),
    }
  })

  it('scanned the Lia store layer recursively, including every production module', () => {
    const files = scanned.map(file => file.relativePath).sort()

    // The scan must be non-empty and must include the modules that do the
    // writing, or "no violations" below would be vacuous.
    expect(files.length).toBeGreaterThanOrEqual(5)
    expect(files).toContain('provider-config-facade.ts')
    expect(files).toContain('provider.ts')
    expect(files).toContain('hearing.ts')
    // No test file leaks into the scanned set.
    expect(files.some(file => file.endsWith('.test.ts'))).toBe(false)
  })

  it('has exactly one module importing the shared provider-config store: the facade', () => {
    const offenders = scanned
      .filter(file => file.imports.some(specifier => specifier.endsWith('/stores/providers/config')))
      .map(file => file.relativePath)

    expect(offenders).toEqual(['provider-config-facade.ts'])
  })

  it('keeps the three dependencies B0.6 T11 forbids out of the whole Lia store layer', () => {
    // The families are matched by suffix so an alias, a barrel or a relative
    // path to the same module all count as the same violation.
    const forbidden = ['/stores/auth', '/composables/api', '/libs/analytics']
    const violations = scanned.flatMap(file => file.imports
      .filter(specifier => forbidden.some(family => specifier.endsWith(family)))
      .map(specifier => `${file.relativePath} -> ${specifier}`))

    expect(violations).toEqual([])
  })

  /**
   * T-H (B0.8-lite) — the activation operations.
   *
   * Scoped to operations, not to the module, and that is still the right shape
   * after E2: `provider.ts` keeps importing the shared store for
   * `validateProviderConfig`, which is E3's subject and not this step's. Banning
   * the module would ban that legitimate use; banning the operations is exact.
   *
   * The other half of the store (the instance lifecycle and the model reads) is
   * covered separately by T-I below.
   */
  const ACTIVATION_MEMBERS = ['initializeProvider', 'forceProviderConfigured']
  const ACTIVATION_MODULE = 'provider-activation.ts'

  it('t-h: the only module touching the activation operations is the port', () => {
    const offenders = scanned
      .filter(file => referencedMembers(file.source, ACTIVATION_MEMBERS).length > 0)
      .map(file => file.relativePath)

    expect(offenders).toEqual([ACTIVATION_MODULE])
  })

  it('t-h: the port is scanned and the call sites really moved off the store', () => {
    const port = scanned.find(file => file.relativePath === ACTIVATION_MODULE)
    expect(port, 'the activation port must be part of the scanned set').toBeDefined()
    // It imports the shared runtime store — that is its whole job.
    expect(port?.imports).toContain('@proj-airi/stage-ui/stores/providers/provider')

    // And `provider.ts` still uses the store for members that are not activation,
    // which proves this check is scoped rather than accidentally passing on a
    // module that stopped importing the store altogether.
    const providerStoreUsers = scanned
      .filter(file => file.imports.includes('@proj-airi/stage-ui/stores/providers/provider'))
      .map(file => file.relativePath)
      .sort()

    // E2 removed three of these. What remains is the two ports and the one
    // module that still reaches the store legitimately (for validation).
    expect(providerStoreUsers).toEqual([
      ACTIVATION_MODULE,
      'provider-runtime.ts',
      'provider.ts',
    ].sort())
  })

  it('t-h: self-test of the member detector — blind to prose, alive to code', () => {
    // Prose is masked: this is exactly the case the real `provider.ts` presents.
    expect(referencedMembers(`/** We used to call forceProviderConfigured here. */`, ACTIVATION_MEMBERS))
      .toEqual([])
    expect(referencedMembers(`// initializeProvider is not called any more`, ACTIVATION_MEMBERS))
      .toEqual([])
    expect(referencedMembers(`const note = 'forceProviderConfigured'`, ACTIVATION_MEMBERS))
      .toEqual([])

    // Code is caught, in every shape it can take.
    expect(referencedMembers(`await store.initializeProvider(id)`, ACTIVATION_MEMBERS))
      .toEqual(['initializeProvider'])
    expect(referencedMembers(`const { forceProviderConfigured } = useProviderStore()`, ACTIVATION_MEMBERS))
      .toEqual(['forceProviderConfigured'])
    expect(referencedMembers(`const mark = forceProviderConfigured`, ACTIVATION_MEMBERS))
      .toEqual(['forceProviderConfigured'])

    // A longer identifier that merely starts with the member name is not a hit.
    expect(referencedMembers(`initializeProviderRuntimeState(id)`, ACTIVATION_MEMBERS)).toEqual([])
  })

  /**
   * T-I (E2) — the four instance-lifecycle operations.
   *
   * Same detector, same masking, applied to the half of the store that still had
   * four direct call sites. `provider.ts` remains in the scanned set and remains
   * an importer of the shared store, which is what makes this check meaningful:
   * it proves the ban is on the operations, not on a module that happened to be
   * renamed.
   */
  const RUNTIME_MEMBERS = [
    'getProviderInstance',
    'disposeProviderInstance',
    'supportsModelListing',
    'getModelsForProvider',
  ]
  const RUNTIME_MODULE = 'provider-runtime.ts'

  it('t-i: the only module touching the runtime operations is the port', () => {
    const offenders = scanned
      .filter(file => referencedMembers(file.source, RUNTIME_MEMBERS).length > 0)
      .map(file => file.relativePath)

    expect(offenders).toEqual([RUNTIME_MODULE])
  })

  it('t-i: the port is scanned, owns all four operations, and the call sites moved off the store', () => {
    const port = scanned.find(file => file.relativePath === RUNTIME_MODULE)
    expect(port, 'the runtime port must be part of the scanned set').toBeDefined()
    // It imports the shared runtime store — that is its whole job.
    expect(port?.imports).toContain('@proj-airi/stage-ui/stores/providers/provider')
    // And it really names all four, so "one offender" above cannot be a port
    // that merely stopped mentioning them.
    expect(referencedMembers(port?.source ?? '', RUNTIME_MEMBERS).sort())
      .toEqual([...RUNTIME_MEMBERS].sort())

    // `provider.ts` is the only non-port module that still imports the store,
    // and it does so for validation only.
    const providerModule = scanned.find(file => file.relativePath === 'provider.ts')
    expect(providerModule?.imports).toContain('@proj-airi/stage-ui/stores/providers/provider')
    expect(referencedMembers(providerModule?.source ?? '', ['validateProviderConfig']))
      .toEqual(['validateProviderConfig'])
    expect(referencedMembers(providerModule?.source ?? '', RUNTIME_MEMBERS)).toEqual([])
  })

  it('t-i: self-test of the runtime member detector — blind to prose and to the port names', () => {
    // Prose naming an operation is not a call. Both `provider-activation.ts` and
    // `voice-editor.ts` carry comments that name these.
    expect(referencedMembers(`/** It no longer calls getProviderInstance. */`, RUNTIME_MEMBERS)).toEqual([])
    expect(referencedMembers(`// disposeProviderInstance is gone from here`, RUNTIME_MEMBERS)).toEqual([])
    expect(referencedMembers(`const note = 'supportsModelListing'`, RUNTIME_MEMBERS)).toEqual([])

    // A real access is caught, however it is spelled.
    expect(referencedMembers(`await store.getProviderInstance(id)`, RUNTIME_MEMBERS))
      .toEqual(['getProviderInstance'])
    expect(referencedMembers(`const { getModelsForProvider } = useProviderStore()`, RUNTIME_MEMBERS))
      .toEqual(['getModelsForProvider'])
    // The exact line that used to live in `hearing.ts`: reverting the migration
    // would re-introduce this shape, and this is the string it would have.
    expect(referencedMembers(`await providerStore.disposeProviderInstance(target.providerId)`, RUNTIME_MEMBERS))
      .toEqual(['disposeProviderInstance'])

    // The port's own names are deliberately distinct from the store's, so a
    // call through the port is not mistaken for a direct store access. If these
    // ever collided, this check could no longer tell the two apart.
    expect(referencedMembers(`runtime.canListModels(id)`, RUNTIME_MEMBERS)).toEqual([])
    expect(referencedMembers(`runtime.listModels(id)`, RUNTIME_MEMBERS)).toEqual([])
    expect(referencedMembers(`await runtime.getInstance(id)`, RUNTIME_MEMBERS)).toEqual([])
    expect(referencedMembers(`await runtime.dispose(id)`, RUNTIME_MEMBERS)).toEqual([])
  })

  it('does not reach the shared modules through the bare stage-ui barrel', () => {
    // A barrel import would defeat the suffix check above: it names no module
    // and could re-export the store. Nothing imports the bare barrel today, and
    // this keeps it that way instead of leaving a silent hole.
    const barrel = scanned
      .filter(file => file.imports.includes('@proj-airi/stage-ui'))
      .map(file => file.relativePath)

    expect(barrel).toEqual([])
  })
})
/**
 * B0.7.1, T-A — a scanner for the import formats the previous line-based check
 * could not see (multi-line specifiers, dynamic `import()`, re-exports), while
 * staying blind to prose.
 *
 * Written by hand instead of pulled from a parser because the app declares no
 * parser dependency of its own, and adding one would mean touching the lockfile
 * for a test. It is deliberately small: comments are dropped, string literals
 * become numbered placeholders (so the specifier survives masking while the
 * text of a doc comment can never match), whitespace is collapsed so a
 * multi-line import reads like a single line, and only then are the import
 * forms matched.
 *
 * Known and accepted limits: template literals are opaque, so an `import()`
 * built by interpolation is not resolved (it cannot be judged statically
 * anyway); `.vue` files are scanned as text, which is sound for imports because
 * they only occur inside `<script>`.
 */
export interface ScannedImport {
  /** The module specifier, unmasked. */
  specifier: string
  /** Which syntax produced it. */
  kind: 'static' | 'side-effect' | 're-export' | 'dynamic' | 'require'
}

/**
 * Replaces comments with nothing and string literals with `__STR_<n>__`
 * placeholders, keeping the original values in order.
 *
 * Regex literals are skipped with the usual "what came before the slash"
 * heuristic so a quote inside `/['"]/` cannot desynchronise the scanner.
 */
function maskModuleSource(source: string): { masked: string, strings: string[] } {
  const strings: string[] = []
  let masked = ''
  let index = 0
  let previousSignificant = ''

  const readQuoted = (quote: string): void => {
    index += 1
    let value = ''
    while (index < source.length && source[index] !== quote) {
      if (source[index] === '\\') {
        value += source[index + 1] ?? ''
        index += 2
        continue
      }
      value += source[index]
      index += 1
    }
    index += 1
    strings.push(value)
    masked += `__STR_${strings.length - 1}__`
    previousSignificant = 'S'
  }

  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n')
        index += 1
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && (source[index] !== '*' || source[index + 1] !== '/'))
        index += 1
      index += 2
      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      readQuoted(char)
      continue
    }

    if (char === '/' && (previousSignificant === '' || '([{,;:=!&|?+*%<>~^'.includes(previousSignificant))) {
      // Regex literal: skip it whole. A newline before the closing slash means
      // it was not a regex after all, in which case nothing is skipped.
      let cursor = index + 1
      let inClass = false
      let closed = false
      while (cursor < source.length) {
        const current = source[cursor]
        if (current === '\\') {
          cursor += 2
          continue
        }
        if (current === '\n')
          break
        if (current === '[') {
          inClass = true
        }
        else if (current === ']') {
          inClass = false
        }
        else if (current === '/' && !inClass) {
          closed = true
          cursor += 1
          break
        }
        cursor += 1
      }
      if (closed) {
        index = cursor
        masked += '__REGEX__'
        previousSignificant = 'R'
        continue
      }
    }

    masked += char
    if (!/\s/.test(char))
      previousSignificant = char
    index += 1
  }

  return { masked, strings }
}

/**
 * Which of `members` a module's *code* touches (T-H).
 *
 * A bare identifier in the masked source, not a `.member` access, so the check
 * also catches destructuring (`const { forceProviderConfigured } = store`),
 * aliasing and a call made through an intermediate variable. Masking removes
 * comments and string literals first, so a doc comment that merely names the
 * member cannot trip it — which matters here, because `provider.ts` documents
 * the pair it used to call.
 *
 * `\b` keeps `initializeProvider` from matching `initializeProviderRuntimeState`.
 */
function referencedMembers(source: string, members: string[]): string[] {
  const { masked } = maskModuleSource(source)
  return members.filter(member => new RegExp(`\\b${member}\\b`).test(masked))
}

/**
 * Extracts every import/re-export specifier from one module's source.
 */
export function scanModuleImports(source: string): ScannedImport[] {
  const { masked, strings } = maskModuleSource(source)
  // Collapsing whitespace is what makes a specifier split across lines look
  // like the single-line form, without any regex having to model line breaks.
  const flat = masked.replace(/\s+/g, ' ')
  const found: ScannedImport[] = []

  // Each pattern captures only the placeholder's digits; the value itself stays
  // in the table, so the masked text never needs to carry the specifier.
  const specifierAt = (capture: string | undefined): string | undefined => {
    const index = Number.parseInt(capture ?? '', 10)
    return Number.isNaN(index) ? undefined : strings[index]
  }

  const collect = (pattern: RegExp, kind: ScannedImport['kind']): void => {
    for (const match of flat.matchAll(pattern)) {
      const specifier = specifierAt(match[1])
      if (specifier !== undefined)
        found.push({ kind, specifier })
    }
  }

  // `import x from 'm'`, `import { a, b } from 'm'`, `import type { T } from 'm'`.
  // The binding list is lazy and bounded by `;`, so one statement cannot swallow
  // the next.
  collect(/\bimport\b[^;]+?\bfrom __STR_(\d+)__/g, 'static')
  // `import 'm'`
  collect(/\bimport __STR_(\d+)__/g, 'side-effect')
  // `import('m')`
  collect(/\bimport\s*\(\s*__STR_(\d+)__\s*[,)]/g, 'dynamic')
  // `export { a } from 'm'`, `export * from 'm'`, `export type { T } from 'm'`
  collect(/\bexport\b[^;]+?\bfrom __STR_(\d+)__/g, 're-export')
  // `require('m')`
  collect(/\brequire\s*\(\s*__STR_(\d+)__\s*\)/g, 'require')

  return found
}

describe('lia provider config facade — the import scanner itself (B0.7.1, T-A)', () => {
  it('detects the four import forms a line-based check would miss', () => {
    expect(scanModuleImports(`import { a } from '@scope/pkg/one'`))
      .toEqual([{ kind: 'static', specifier: '@scope/pkg/one' }])

    expect(scanModuleImports(`import {\n  a,\n  b,\n} from '@scope/pkg/two'`))
      .toEqual([{ kind: 'static', specifier: '@scope/pkg/two' }])

    expect(scanModuleImports(`const mod = await import('@scope/pkg/three')`))
      .toEqual([{ kind: 'dynamic', specifier: '@scope/pkg/three' }])

    expect(scanModuleImports(`export { a } from '@scope/pkg/four'`))
      .toEqual([{ kind: 're-export', specifier: '@scope/pkg/four' }])

    expect(scanModuleImports(`import '@scope/pkg/five'`))
      .toEqual([{ kind: 'side-effect', specifier: '@scope/pkg/five' }])
  })

  it('ignores imports that only appear in comments or prose', () => {
    expect(scanModuleImports(`// import { a } from '@scope/pkg/commented'`)).toEqual([])
    expect(scanModuleImports(`/* import { a } from '@scope/pkg/block' */`)).toEqual([])
    expect(scanModuleImports(`/**\n * It never imports '@scope/pkg/doc' from here.\n */\nconst x = 1`))
      .toEqual([])
    expect(scanModuleImports(`const message = "import { a } from '@scope/pkg/string'"`)).toEqual([])
  })

  it('survives a regex literal containing quotes and a comment marker', () => {
    const source = `const quotes = /['"]/\nimport { a } from '@scope/pkg/real'`

    expect(scanModuleImports(source)).toEqual([{ kind: 'static', specifier: '@scope/pkg/real' }])
  })

  it('reads a multi-line import whose path sits on the from-line, the audit case', () => {
    const source = `import {\n  alpha,\n  beta,\n}\n  from '@proj-airi/stage-ui/stores/providers/config'`

    expect(scanModuleImports(source)).toEqual([
      { kind: 'static', specifier: '@proj-airi/stage-ui/stores/providers/config' },
    ])
  })

  it('does not report one import twice', () => {
    const found = scanModuleImports(`import { a } from '@scope/pkg/x'\nimport type { B } from '@scope/pkg/x'`)

    expect(found).toHaveLength(2)
    expect(found.every(entry => entry.specifier === '@scope/pkg/x')).toBe(true)
  })

  it('walks nested directories and filters by kind, the property the audit found missing', () => {
    // A throwaway tree, so the recursion is proven on files that really exist
    // instead of only on the flat directory the project happens to have today.
    const root = mkdtempSync(join(tmpdir(), 'lia-frontier-'))
    try {
      mkdirSync(join(root, 'nested', 'deeper'), { recursive: true })
      writeFileSync(join(root, 'top.ts'), 'export const a = 1')
      writeFileSync(join(root, 'top.test.ts'), 'export const b = 2')
      writeFileSync(join(root, 'nested', 'deep.ts'), 'export const c = 3')
      writeFileSync(join(root, 'nested', 'deeper', 'page.vue'), '<script setup lang="ts"></script>')
      writeFileSync(join(root, 'nested', 'notes.md'), 'not source')

      const found = collectProductionSources(root)
        .map(path => relative(root, path).replace(/\\/g, '/'))
        .sort()

      expect(found).toEqual(['nested/deep.ts', 'nested/deeper/page.vue', 'top.ts'])
    }
    finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
