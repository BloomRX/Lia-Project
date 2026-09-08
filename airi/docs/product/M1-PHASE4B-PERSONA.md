# M1 — Phase 4B: Lia as the product persona

Status: **implemented** (awaiting real-machine validation & approval).

Phase 4A delivered the Lia product-config foundation (`lia/product.json` schema with `persona → voice → provider → preferences`). Phase 4B turns **Lia into the actual default character** by making it the guaranteed/built-in character card of the existing AIRI character-card runtime — not a second, parallel persona system.

## Goal

Lia must be the product default character through the existing machinery:

- **id:** `lia`
- **name:** `Lia`
- **personality:** functional Tsundere (believable and restrained, not caricatural)
- **identity:** expressed as *data* in the character card, not as a translation/i18n string
- **integration:** flows into the real runtime (character orchestrator, chat session, stage) exactly like any other card

## Persona vs. runtime-instruction separation

A core 4B rule is that **persona** (identity, personality, lore, social style) stays cleanly separated from **runtime instructions** (emotions, ACT tokens, tools, technical protocols).

In the pre-4B AIRI build both were smeared together: the built-in `'default'` (ReLU) card's `description` was produced by `SystemPromptV2(t('base.prompt.prefix'), t('base.prompt.suffix'))` from the i18n `base.prompt` text. That single block interleaved the AIRI VTuber identity story **and** the Live2D ACT / DELAY / CALL / emotion-vocabulary protocol.

For Lia we decompose those into distinct CCv3 card fields (per the approved decision):

| Concern | Home |
| --- | --- |
| Runtime ACT/DELAY/CALL instructions + emotion vocabulary | `systemPrompt` field — `LIA_RUNTIME_SYSTEM_PROMPT` |
| Persona identity + social style | `description` |
| Functional Tsundere behaviour | `personality` |
| Default scene | `scenario` |
| Categorisation | `tags` |
| First greeting | `greetings[0]` |

`resolveSystemPrompt()` (the audited assembly: `systemPrompt` + `description` + `personality` + `scenario` + artistry `widgetInstruction`) continues to concatenate these fields, so the runtime still receives both the technical instructions and the persona. Nothing technical was deleted or rewritten "to make it more Lia"; the technical text is preserved verbatim and simply lives in its own field.

### i18n is no longer persona source-of-truth

`airi-card.ts` no longer imports `useI18n`, `SystemPromptV2`, or `t('base.prompt.prefix'/'base.prompt.suffix')`. The Lia persona is authored once as TS data in `lia-default-card.ts`. The i18n `base.prompt` keys and `system-v2.ts` remain in the tree but are no longer referenced by the card store (non-destructive: nothing else in the repo consumed them).

## Lia built-in card definition

New file: `packages/stage-ui/src/constants/lia-default-card.ts`

- `LIA_BUILT_IN_CARD_ID = 'lia'`
- `LIA_RUNTIME_SYSTEM_PROMPT` — runtime ACT/DELAY/CALL protocol + emotion vocabulary (derived from `EMOTION_VALUES`)
- `LIA_DEFAULT_CARD: Card` — the persona as CCv3-style data (`name: 'Lia'`, `description`, `personality`, `scenario`, `tags`, `greetings`, `systemPrompt: LIA_RUNTIME_SYSTEM_PROMPT`)

## Store behaviour (`airi-card.ts`)

The card map (`airi-cards`) and active-id key (`airi-card-active-id`) are reused — **no new storage keys, no second persona system**.

| Aspect | Before (ReLU) | After (Lia) |
| --- | --- | --- |
| Active-id storage default | `'default'` | `'lia'` |
| Built-in seeded on init | `'default'` / ReLU from i18n | `'lia'` / Lia from data constant |
| Undeletable guard | `id === 'default'` | `id === 'lia'` |
| Fallback after deleting active card | `activeCardId = 'default'` | `activeCardId = 'lia'` |
| Dangling active-id repair | → `'default'` | → `'lia'` |

### Fresh install vs. persisted legacy vs. imports

`initialize()` now distinguishes:

- **Fresh install / no prior state** — no `lia` present: seed the Lia built-in; active id defaults to `lia`. Runtime receives Lia.
- **Persisted legacy `'default'` (ReLU) card** — never overwritten, removed, or renamed. If it is the persisted *active* id and still valid, it stays the active selection (`has(activeCardId)` is true → honored as-is). Lia is still seeded alongside and remains the guaranteed fallback.
- **Dangling active id** (points at a card that no longer exists) — repaired to `lia`.
- **User/imported cards** (nanoid ids) — untouched; `addCard` allocates nanoids that can never collide with the reserved `lia`.
- **Two-ids note:** `'lia'` (the built-in) and `'default'` (legacy user data) may coexist in the map only because the latter is leftover user data. We never seed a second freshly-created built-in with a different id; there is exactly one guaranteed built-in, `lia`.

The legacy ReLU/`default` story is documented here rather than auto-migrated. A formal migration remains out of 4B scope.

## Product config (`stage-tamagotchi` main)

`defaultLiaProductConfig.persona` now defaults to `{ activeCardId: 'lia' }` (`lia.ts`). Per the approved "seed in config, no renderer seed" model, the main process records `'lia'` but does **not** push a persona to the renderer (no main → renderer persona bridge — that is phase 4E). The renderer's own fresh-install card state already resolves to `lia`.

## Settings UI (`stage-pages`)

`CardListItem.vue` delete-button gate changed from `id !== 'default'` to `id !== 'lia'`:
- the Lia built-in card cannot be deleted;
- a persisted legacy `'default'` card now shows a delete button (it is ordinary user data).

All other card UI (list, select, activate, edit, import, delete-confirm) is id-agnostic and keeps working unchanged.

## Runtime consumers

Non-card consumers key profiles/runtimes by `activeCard.name` (e.g. `Stage.vue`, `character/index.ts` `ownerId`) or by the valid active id. Once the built-in is id `'lia'` / name `Lia`, they re-key automatically. `characterId`/`session`/provider `'default'` values in session-store/data-store are unrelated session/provider concepts and were intentionally **not** renamed.

## Tests

### `airi-card.test.ts` (stage-ui)

- Removed the dead `Live2D ACT capabilities` test and its `useLive2DActCapabilitiesStore` import. That store and the literal `"Live2D ACT controls for the current model:"` text exist **only** in the test — nowhere in any package source (audited). It was an aspirational/dormant layer that would break test collection; it is replaced by Lia-focused coverage.
- Rebased built-in expectations `'default'`/ReLU → `'lia'`/Lia (fresh install, delete-active fallback, direct-delete guard, dangling repair).
- Added coverage: fresh install seeds Lia (name, tsundere personality, persona data present), persona/runtime field separation, and legacy `'default'` (ReLU) preservation/selectability alongside `lia`.

### `lia.test.ts` (stage-tamagotchi main)

Updated `defaultLiaProductConfig` expectations to `persona: { activeCardId: 'lia' }`, the auto-heal expectation to the new default, and the isolation assertion to the new default persona shape.

## What changed

| File | Change |
| --- | --- |
| `packages/stage-ui/src/constants/lia-default-card.ts` | **new** — Lia built-in id, runtime system prompt, persona data |
| `packages/stage-ui/src/stores/modules/airi-card.ts` | seed/fallback/guard/repair → `lia`; drop i18n persona source |
| `packages/stage-ui/src/stores/modules/airi-card.test.ts` | rebase + new Lia/legacy tests; remove dead ACT test |
| `packages/stage-pages/.../CardListItem.vue` | delete gate `'default'` → `'lia'` |
| `apps/stage-tamagotchi/src/main/configs/lia.ts` | default persona `activeCardId: 'lia'` |
| `apps/stage-tamagotchi/src/main/configs/lia.test.ts` | update default-shape expectations |
| `docs/product/M1-PHASE4B-PERSONA.md` | this document |

## Not in scope (later phases)

4C providers, API keys/`safeStorage`, TTS/STT, Voice Studio / RVC / AllTalk, full Settings UX, long-term memory, formal legacy migration, and the full main → renderer persona bridge (4E).

## Validation notes (real machine)

This sandbox cannot run `pnpm test` / `typecheck` / `build:web` (Node 22 vs engine-required Node 26, no workspace install). As with 4A, the test suite must be run on the real machine. Any failure caused solely by the external Live2D download/network step during `build:web` is a pre-existing baseline issue, documented separately from 4B regressions.
