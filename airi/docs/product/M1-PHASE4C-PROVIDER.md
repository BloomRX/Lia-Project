# M1 — Phase 4C: Provider/LLM da Lia (secure chat provider + failover)

Status: **implemented** (awaiting real-machine typecheck/build/QA).

Phase 4C lets the user configure the chat provider/model the **Lia** character talks
through, test the connection, and have a real conversation — reusing the real AIRI
provider catalog and the existing chat runtime, without a second/parallel LLM
architecture. Secrets are handled the secure way the M1 architecture approved: they
live in the Electron **main** process, encrypted with `safeStorage`, never in
renderer localStorage, `lia/product.json`, or logs.

## Goal / decisions

- **No new provider integrations.** Reuses the real AIRI 58-provider catalog
  (OpenAI-compatible, Groq, Cerebras, Ollama, LM Studio, OpenAI, Anthropic, xAI,
  Mistral, OpenRouter, …). Only catalog ids are surfaced in the UI.
- **`lia/product.json` holds references/metadata only** (`provider.chat.preferred`,
  ordered `fallback`, `strategy`, new additive `fallbackEnabled`). `schemaVersion`
  stays `1` (additive/optional only).
- **Secrets are Electron main-owned.** `services/lia/secrets.ts` stores ciphertext
  via `safeStorage` at `userData/lia-secrets.json`; refuses to persist when the OS
  keychain is unavailable; never falls back to plaintext. IPC is minimal
  (`encryption-available / has / set / get / delete`). The renderer reads a value
  on demand for one provider build and never persists it.
- **One additive, inert runtime hook in shared `stage-ui`** (approved): without it
  (web/pocket/other hosts) behaviour is identical; the Lia desktop opts in by
  registering a per-use credential resolver and a chat fallback resolver.
- **Failover** runs in the chat/execution layer: primary → fallback on recoverable
  errors, bounded by a hard attempt ceiling, disablable, preserves the same
  session/history/Persona Lia (rolls back only the failed turn — no duplicated
  messages), and logs sanitized failover (provider ids only; never the secret or
  the raw error).

## What was implemented

1. `services/lia/secrets.ts` (+ `secrets-service.ts`, + IPC in `shared/eventa`, +
   `services:lia-secrets` injeca wiring, + isolated unit tests) — secure vault.
2. `stores/chat/chat-provider-runtime.ts` (stage-ui) — optional registries for a
   per-use **provider credential resolver** and a **chat fallback resolver**.
   `provider.ts getProviderInstance` injects the vault key in memory; `chat.ts
   executeSend` performs the bounded, no-duplicate failover (single attempt when
   no policy is registered).
3. `configs/lia.ts` — additive optional `provider.chat.fallbackEnabled`.
4. `services/lia/provider-config-service.ts` (+ IPC get/set) — persists the Lia
   `provider.chat` references into `lia/product.json`.
5. `renderer/stores/lia/provider.ts` — Lia desktop store: chat-config get/save,
   per-use vault apiKey ops, `testConnection` (reuses AIRI `validateProviderConfig`),
   provider activation into the existing runtime, and registration of the runtime
   hooks.
6. `renderer/components/LiaProviderConfig.vue` + Home wiring + pt-BR/en i18n —
   minimal setup UI (select provider/model, optional endpoint, API key, Save /
   Test connection / Remove, fallback toggle).

## Architecture (flow)

1. User picks provider + model (+ optional endpoint for OpenAI-compatible/LM
   Studio/Ollama) and saves. The **API key** goes to the main safeStorage vault
   (scope = provider id, key = `apiKey`); only `providerId`/`modelId`/`fallback…`
   are written to `lia/product.json`. A keyless provider record is ensured in the
   existing provider-config store (metadata only).
2. `CONVERSAR` → `activatePreferred()` sets the existing runtime's active
   provider/model to the Lia preferred target.
3. When the shared chat builds the provider instance, the registered credential
   resolver fetches the vault key for that provider **in memory** and merges it into
   the config passed to `createProvider` (never written to localStorage/logs).
4. On a **recoverable** stream error, `executeSend` asks the fallback resolver for
   the next provider/model in the Lia chain, rolls the failed turn back, and
   retries — bounded, same session/history/persona. Non-recoverable errors surface
   as a friendly message (no stack trace); `fallbackEnabled:false` disables it.

## Files touched

- `apps/stage-tamagotchi/src/main/services/lia/{secrets.ts,secrets-service.ts,secrets.test.ts,provider-config-service.ts}`
- `apps/stage-tamagotchi/src/main/{configs/lia.ts,index.ts}`
- `apps/stage-tamagotchi/src/shared/eventa/index.ts`
- `apps/stage-tamagotchi/src/renderer/{stores/lia/provider.ts,components/LiaProviderConfig.vue,pages/home.vue}`
- `packages/stage-ui/src/stores/{chat.ts,chat/chat-provider-runtime.ts,providers/provider.ts}`
- `packages/i18n/src/locales/{en,pt-BR}/…/home.yaml`

## Notes / decisions

- The fallback is intentionally **Electron-desktop scoped**. Interactive chat sends
  originate in shared `stage-ui` `ChatArea`; the one approved additive+inert hook
  is the only point that can (a) inject the vault key into a provider instance the
  shared runtime builds and (b) fail over on interactive messages — with zero
  behaviour change for web/pocket (no registration).
- `baseUrl` for OpenAI-compatible-style providers is kept in the existing keyless
  provider-config store (metadata); `lia/product.json` stores the Lia refs. No
  secret/endpoint credential lives in the Lia product file.
- The persona **Lia (pt-BR)** is untouched; switching UI language does not change the
  character language.

## UX correction: first-run setup + clean launcher (product view)

The provider config is **not** a permanent technical panel on Home. It lives in the
main/launcher window, presented as product setup:

- **First run** (`/home`): the Home route reads the real persisted config
  (`provider.chat`) on mount. If it is not ready (no preferred provider+model, or
  not marked `onboarded`, or no stored key), it renders the single onboarding
  screen (provider, model, API key, automatic fallback + fallback provider/model,
  Test connection, Finish setup). There is **no `/setup` route** and no change to
  router/startup/window-context.
- **Ready check is not a blind boolean.** `provider.chat.onboarded` is an additive
  completion marker, but readiness always also requires the preferred provider +
  model to be present and a vault key to exist — so `onboarded=true` with an invalid
  config never reports the system as ready (falls back to onboarding).
- **Later runs** open the launcher directly: avatar, a small discrete LED row
  (IA / Voz / Avatar / Fallback), `CONVERSAR`, and a discreet "Configurar" action
  that reopens the **same** `LiaProviderConfig` editor in `manage` mode.
- If the persisted config becomes invalid/incomplete, Home returns to onboarding.
- Keys stay in the Electron/safeStorage vault (never localStorage,
  `lia-product.json`, or logs).
- The launcher was simplified to product-relevant actions (Configurar + Personagem).
  The AIRI Settings/dev-diagnostics windows remain reachable via the existing
  character settings entry and the Home log viewer (technical/advanced stays out of
  the primary launcher).
- The same `LiaProviderConfig` component is reused for onboarding and later edits
  (no duplicated provider/secrets logic).
- **Each provider owns its own vault secret.** When the fallback is a DIFFERENT
  provider that needs a credential (e.g. Groq → Cerebras), the onboarding shows a
  separate key field and stores it under that provider's scope — the primary key is
  never copied to the fallback. A same-provider fallback reuses the primary secret
  (no duplicate); key-less providers need none. The "Test connection" validates the
  primary and, when present, a distinct fallback individually. `isReadyToChat()`
  requires the primary credential; `isFallbackConfigured()` requires the credential
  the fallback actually needs. No secret ever touches `lia-product.json`,
  localStorage, or logs.
- Next to each provider's API-key field there is a subtle **"Get API key ↗"** link
  that opens that provider's official API-key page in the system browser. Provider
  URLs are defined centrally in `LIA_CHAT_PROVIDER_OPTIONS.apiKeyUrl` (never
  hardcoded in the component); providers without a configured page simply show no
  link. The launcher window already routes `target="_blank"` links to the system
  browser — no iframe, no in-app embedding.

### UX-specific file notes
- `configs/lia.ts` + `shared/eventa`: additive `provider.chat.onboarded`.
- `stores/lia/provider.ts`: `isReadyToChat()`, `markOnboarded()`, and the curated
  per-provider model catalog (`LIA_MODEL_CATALOG` + `curatedModelsFor` /
  `recommendedModelFor` / `isModelInCatalog`).
- `components/LiaProviderConfig.vue`: now a reusable editor (`mode: onboarding |
  manage`) with fallback provider/model + Test connection + Finish setup.
- `pages/home.vue`: first-run gate within the Home route + clean launcher + LEDs.

### Final UX correction: model dropdown (no free "model id" field)
- The model input is a **dropdown**, not a free-text "ID do modelo" field. Options
  come from `LIA_MODEL_CATALOG` keyed by the selected provider; the UI shows only
  the friendly label and persists only the technical id (the option's value).
- Picking a provider auto-selects its `recommended` model. Switching provider
  refreshes the list and keeps the current model only while it is still offered;
  otherwise it auto-selects a valid one (a persisted/deprecated model never leaves
  the user stuck or asks them to type an id).
- The same logic is applied to the **fallback** provider/model selector.
- Source note: AIRI ships no static model catalog for OpenAI/Groq/Cerebras/xAI/
  Mistral/OpenRouter (their models are fetched live once a key exists), and the
  Lia API key lives only in the main-process vault — never in the provider-config
  store that AIRI's live fetcher reads — so a live cloud fetch is not reachable
  from this screen. Therefore the curated list of real ids is the operative
  dropdown source (Anthropic's entries are copied verbatim from AIRI's own
  catalog); the "Test connection" step validates the chosen id and the user can
  switch to another option. Local providers (Ollama/LM Studio/OpenAI-compatible)
  get a small set of common known models instead of a free field.
- The persistent "✓ connection OK" indicator stays visible (and "Concluir
  configuração" stays enabled) until the user edits the provider/model/key or
  clicks Concluir; running "Testar conexão" never clears the chosen
  provider/model/API key.

### Runtime fix: `liaProductConfig.get is not a function`
- The eager-build invoke at boot called `.get()` on the **outer handle** returned
  by `injeca.provide('configs:lia-product', …)`. That handle is only valid as a
  `dependsOn` reference; the resolved config instance exists only as the
  `deps.liaProductConfig` argument to the invoke callback (as every sibling invoke
  already did). Calling `.get()` on the handle threw
  `liaProductConfig.get is not a function` immediately after the Artistry bridge
  logged its init, at startup. Fixed by consuming the resolved instance via the
  callback's `deps` argument — no optional chaining, no guard, no change to the
  Artistry bridge or the 4A Lia config shape. Startup no longer throws it.

## Real-machine QA checklist (not run in this sandbox)

- `typecheck`, `build:web`, `dev:tamagotchi` pass.
- Home opens; provider panel opens in pt-BR; picker/model/endpoint/key fields work.
- Save stores the key; `lia-product.json` and localStorage contain **no** key/plaintext.
- "Testar conexão" succeeds/fails with a friendly message (no stack trace, no secret).
- `CONVERSAR` → Lia replies through the configured provider with the Persona Lia.
- Kill/turn off primary → conversation fails over to the configured fallback
  (bounded, no loop, same history), logs show only provider ids.
- `fallbackEnabled:false` disables failover.
- Changing the UI language does not change the persona language.
- Web/pocket chat behaviour is unchanged (hooks unregistered there).
