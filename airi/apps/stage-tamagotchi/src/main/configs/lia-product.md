# Lia Product Config (M1 Phase 4A — Config Foundation)

> Status: Phase 4A complete. Later subphases — 4B (persona), 4C (provider +
> secrets), 4D (voice), 4E (settings UX), 4F (short-term memory, only if it
> still makes sense) — build on this foundation. This note documents **only**
> what 4A owns.

## What this is

A persistent, schema-validated, **product-level** configuration for the Lia
layer. It records what the user chose and the policies Lia orchestrates
(persona, chat provider, voice, preferences) as **data**.

It deliberately does **not** duplicate the existing `createConfig` persistence,
does not create new storage, and does not introduce a new config framework. It
also does **not** move existing data into the new file yet — it first
establishes the correct, stable foundation that later subphases extend.

## Reuse, not reinvention

- Persistence = existing `createConfig` from
  `libs/electron/persistence.ts` (namespace `lia`, file `product.json`).
- On-disk path is composed by `createConfig` as `<namespace>-<filename>` →
  `userData/lia-product.json`.
- Lifecycle mirrors its siblings `configs/global.ts` and `configs/artistry.ts`,
  injeca-provided and materialized eagerly at boot.

## Ownership & field table

| Domain | Purpose (4A) | Owned by | Filled by |
| --- | --- | --- | --- |
| `schemaVersion` | Declares/validates the supported schema version (`1`). | Lia config | — (fixed) |
| `persona` | Currently `activeCardId?: string`. v1 = single card **"Lia"**. | Lia persona | 4B |
| `provider` | Chat strategy / preferred / ordered fallback targets. | Lia provider + secrets | 4C |
| `voice` | TTS / STT preferred + ordered fallback targets. | Lia voice | 4D |
| `preferences` | e.g. `language?: string` ('' = inherit AIRI language detection). | Lia product | 4E |

Every sub-object except `schemaVersion` is **optional and defaults to `{}`**, so
the schema is forward/extension shaped — later subphases add optional fields
additively without bumping the version.

### Rules encoded (decisions fixed in Phase 4)

1. Persona identity is **DATA**, never an i18n string. i18n is only
   presentation/localization.
2. Persona v1 = a single **"Lia"** card, default personality **Tsundere**,
   reusing the existing AIRI card / CCC system. No parallel persona system.
3. **Fallback is AUTOMATIC** with a clear user notification — never silent.
4. Voice architecture supports a **primary + fallback**; 4A already models
   `preferred` / ordered `fallback` targets.
5. `schemaVersion` is declared and validated now; **no generic migration
   engine** until a real second schema version exists.
6. Secrets: only the actually-used provider's secret is stored, never in clear
   in the renderer, via `safeStorage` in main. Not part of 4A code.
7. No new memory system / vector DB / embeddings in Phase 4.

## On-disk format (`lia/product.json`)

```json
{
  "schemaVersion": 1,
  "persona":       {},
  "provider":      {},
  "voice":         {},
  "preferences":   {}
}
```

Realistic, forward-looking (sub-objects will be extended by later subphases):

```json
{
  "schemaVersion": 1,
  "persona": { "activeCardId": "lia" },
  "provider": {
    "chat": {
      "strategy": "auto",
      "preferred": { "providerId": "…", "modelId": "…" },
      "fallback": []
    }
  },
  "voice": {
    "tts": {
      "preferred": { "providerId": "…", "modelId": "…", "voiceId": "…" },
      "fallback": []
    }
  },
  "preferences": { "language": "pt-BR" }
}
```

Default (`defaultLiaProductConfig`) = `schemaVersion: 1` with `{}` for every
domain. `createLiaProductConfig()` returns the `createConfig` instance with
`default` + `autoHeal: true` and calls `setup()` so the file is validated at
boot.

## Read / write strategy

- Built **eagerly at boot**: injeca `configs:lia-product` provider, forced via a
  dedicated `injeca.invoke` in `main/index.ts` (same pattern as the desktop
  overlay) so `schemaVersion` is validated and defaults are in memory before any
  subphase consumes it.
- All reads/writes go through main-process `createConfig` (throttled write to a
  temp file + atomic `rename`). No direct renderer writes.
- No consumer yet in 4A; it is wired so a later subphase can depend on
  `configs:lia-product`.

## schemaVersion & compatibility

- The schema pins `schemaVersion` to the literal `1`. A file carrying an unknown
  version (e.g. written by a future build) **fails validation** and, because
  `autoHeal` is enabled and a default is present, is **backed up to `*.bak`**
  and healed to the default. This satisfies "declare/validate the version now"
  with no migration engine.
- **Purely additive, optional-field** schema changes do **not** bump
  `schemaVersion`. A bump (and an explicit migration) is required only when a
  real breaking change exists — a second schema version and a real migration
  strategy are introduced at that point.

## What stays OUTSIDE this config (unchanged in 4A)

- **Window sizing** → `userData/lia-main-window.json`
  (`createConfig('lia','main-window.json', …)` in `windows/main/index.ts`).
  Independent config instance + file; untouched, no regression.
- Generic AIRI technical / window state → its own stores and `createConfig`
  files (e.g. `app`/`config.json`), and renderer `localStorage`/IndexedDB keys.
  **No current preferences are migrated into `product.json` in this subphase.**
- **Provider secrets** → not in this file; handled later in main via
  `safeStorage`.
- **Persona cards / CCC content** → existing AIRI card system (4B).
- **Session / history / notebook / memory** → preserved as-is; architecture
  decisions documented separately (4F, deferred).

## Evolution path

| Subphase | Will add |
| --- | --- |
| 4B Persona | the actual "Lia" card / Tsundere data (additive optional fields) |
| 4C Provider + secrets | concrete chat targets; secrets via `safeStorage` (main only) |
| 4D Voice | concrete TTS/STT targets + fallback |
| 4E Settings UX | renderer reads/writes these preferences over IPC (never clear secrets) |
| 4F Short-term memory | only if still sensible; architecture decisions documented |

## Tests — `configs/lia.test.ts`

Covers (mirrors the mock strategy of `libs/electron/persistence.test.ts`):
schema version + explicit defaults, fresh-install (`missing`) setup,
`update` → `get` round-trip + persistence path, unsupported `schemaVersion`
auto-heal (with `.bak`), valid versioned document accepted + preserved, and
coexistence with the independent `lia-main-window.json` (distinct on-disk
files, no cross-writes).
