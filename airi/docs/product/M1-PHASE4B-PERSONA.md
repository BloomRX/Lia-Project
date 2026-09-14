# M1 — Phase 4B: Lia as the product persona (Persona Lia v1.0)

Status: **implemented** (awaiting real-machine validation & approval).

Phase 4A delivered the Lia product-config foundation (`lia/product.json` schema with `persona → voice → provider → preferences`). Phase 4B turns **Lia into the actual default character** by making it the guaranteed/built-in character card of the existing AIRI character-card runtime — not a second, parallel persona system — and represents the **Persona Lia v1.0** as **structured, editable data**.

## Goal

- **id:** `lia`
- **name:** `Lia`
- **personality:** default preset **Tsundere** (functional, believable, not caricatural)
- **identity:** expressed as **data** in the character card (AGENTS §30–34), not as a translation/i18n string
- **structured for future editing:** a future "Gerenciar personalidade" screen edits one structured object; no such screen is built here
- **integration:** flows into the real runtime (character orchestrator, chat session, stage) exactly like any other card

## Persona vs. runtime-instruction separation

**Persona** (identity, personality, lore, social style) is kept cleanly separated from **runtime instructions** (emotions, ACT tokens, tools, technical protocols).

The old provisional 4B persona was free prose. **Persona Lia v1.0 replaces that** with a structured model — but the CCv3 field split is unchanged: the runtime still reads `description` / `personality` / `scenario`, and the technical protocol still lives alone in `systemPrompt`.

| Concern | Home |
| --- | --- |
| Runtime ACT/DELAY/CALL instructions + emotion vocabulary | `systemPrompt` — `LIA_RUNTIME_SYSTEM_PROMPT` (verbatim, untouched) |
| Structured, editable persona | `extensions.airi.persona` — `LiaPersona` (`LIA_DEFAULT_PERSONA`) |
| Persona prose the runtime reads | `description` / `personality` / `scenario` — **projections** of the structured persona |

### i18n is not persona source-of-truth

`airi-card.ts` does not import `useI18n` / `SystemPromptV2` / `base.prompt`. The persona is authored once as data in `lia-persona.ts`.

## Persona Lia v1.0 — data model

New file: `packages/stage-ui/src/constants/lia-persona.ts`

```ts
LiaPersona {
  schemaVersion: 1
  identity: { name: 'Lia', greetings: string[] }
  preset: 'tsundere'                    // Personality Preset (AGENTS §32)
  attributes: { confidence, affection, shyness, teasing,
                sarcasm, humor, curiosity, energy, kindness,
                proactivity }           // each 0..1 (AGENTS §33)
  demeanor: { notes: string[] }         // qualitative essence/tone (editable)
  priority: { order: ['utility','personality','humor'] }   // Lia priority rule
  intensity: {
    contexts: LiaIntensityRule[]        // emotional intensity by context
    defaultContextId: 'casual'
  }
  speechStyle: { notes: string[] }      // tone, length, emojis, swearing
  relationship: { kind, userName, trust, jealousy, summary, notes }
  limits: string[]
  customRules: string[]                 // free additional rules (editable)
  language: { character: 'pt-BR', supportedSecondary: ['en','ja'] } // ≠ UI (§98.13)
  mood: { notes: string[] }
  preferences: Record<string, unknown>  // reserved
  memory: { policy: 'recall-existing-only', notes: string[] }
}
```

Normative Lia content encoded in the data (spec-aligned v1.0):

- **Priority:** Utilidade > Personalidade > Humor.
- **Tsundere, não agressiva:** confiante, espontânea e levemente provocativa; nunca parece constantemente irritada; não transforma toda conversa em atuação tsundere.
- **Relação:** companheira/amiga virtual próxima (não subordinada fria); dirige-se ao usuário pelo nome (`userName: 'Lucas'`); confiança/carinho crescem com o tempo; ciúme só brincalhão, nunca possessivo.
- **Emotional intensity (tsundere/zoeira share) per context:**
  - `casual` (conversa normal): 30–40%
  - `playful` (brincadeira): 50–70%
  - `relaxed` (relaxada): mais expressiva
  - `praise` (elogio): pode subir (sem teto fixo)
  - `serious` (assunto sério): ~0% de zoeira
  - `helping` (usuário precisa de ajuda): ~0% de zoeira — foco e cuidado
- **Speech:** informal, respostas curtas/médias e diretas; emojis moderados; palavrões ocasionais/moderados; tsundere natural, sem "baka" repetido. *(v1.0 corrige a regra antiga "sem emojis".)*
- **Preset Tsundere** controlling the AGENTS §33 attributes.
- **Memory policy:** `recall-existing-only` — Lia só lembra do que realmente existe na memória; nunca inventa memórias. *(Não é implementação de memória nova.)*

A pure serializer (`renderLiaPersonaFields`) projects the object onto the runtime text fields; it is the single source. Values are initial v1.0 defaults (AGENTS §33: exact values are tuned during implementation/tests) and are all editable.

## Store behaviour (`airi-card.ts`)

The card map (`airi-cards`) and active-id key (`airi-card-active-id`) are reused — **no new storage keys, no second persona system**.

| Aspect | Value |
| --- | --- |
| Active-id storage default | `'lia'` |
| Built-in seeded on init | `'lia'` / Lia from `LIA_DEFAULT_PERSONA` |
| Undeletable guard | `id === 'lia'` |
| Fallback after deleting active card | `activeCardId = 'lia'` |
| Dangling active-id repair | → `'lia'` |

On fresh seed, `initialize()` builds the Lia card and attaches the structured persona at `extensions.airi.persona` (kept as a sibling of `modules`/`agents` under one `extensions.airi`). `resolveAiriExtension` carries a stored `persona` forward on updates, so editing runtime modules never erases it.

Legacy behavior preserved: a persisted `'default'` (ReLU) card and imported cards are never overwritten/renamed/deleted; imported/legacy cards without `extensions.airi.persona` keep working through their text fields.

## Where persona lives: card vs. `lia.product.json`

- **In the card** (`extensions.airi.persona`): the full structured persona — the thing the future editor edits and the runtime consumes. One persona system (the card), no duplicate.
- **In `lia.product.json`** (`persona.activeCardId = 'lia'`): only the *pointer* to the active card (main process). It is not bridged to the renderer until 4E; the renderer's own state already resolves to `lia`.

This keeps a single editable persona source and avoids a second persona system split across main + renderer.

## Tests

- **`lia-persona.test.ts`** (new): default shape (schemaVersion, name, preset, priority order, character language, memory policy, all §33 attributes within 0..1), the normative intensity-context values, and that prose projection is separated from runtime tokens.
- **`airi-card.test.ts`**: fresh install seeds Lia as built-in default; new structured-persona coverage on the built-in card (`preset`, `priority`, `language pt-BR`, `memory policy`, intensity rules, prose = projection); imported/legacy card without a structured persona keeps working via text fields; fallback/guard/legacy-preservation tests unchanged.
- **`lia.test.ts`** (main): unchanged default expectations `persona: { activeCardId: 'lia' }`.

## What changed (this revision — Persona v1.0 over the provisional 4B)

| File | Change |
| --- | --- |
| `packages/stage-ui/src/constants/lia-persona.ts` | **new** — structured `LiaPersona` schema, `LIA_DEFAULT_PERSONA` (v1.0), pure projection renderer |
| `packages/stage-ui/src/constants/lia-persona.test.ts` | **new** — data-model + projection tests |
| `packages/stage-ui/src/constants/lia-default-card.ts` | built-in card fields now projected from `LIA_DEFAULT_PERSONA` |
| `packages/stage-ui/src/stores/modules/airi-card.ts` | attach structured persona on seed; carry it through merges |
| `packages/stage-ui/src/types/airiCard.ts` | `AiriExtension.persona?: LiaPersona` |
| `packages/stage-ui/src/stores/modules/airi-card.test.ts` | structured-persona coverage |
| `docs/product/M1-PHASE4B-PERSONA.md` | this document |

(Underlying 4B commits `760aa9c`, `ca21413`, `231bca5` — Lia built-in, product default persona, docs — remain the base; this is a follow-up revision of the persona data.)

## Not in scope (later phases)

The "Gerenciar personalidade" screen, 4C providers, API keys/`safeStorage`, TTS/STT, Voice Studio / RVC / AllTalk, full Settings UX, long-term memory, formal legacy migration, and the full main → renderer persona bridge (4E).

## Validation notes (real machine)

This sandbox cannot run `pnpm test` / `typecheck` / `build:web` (Node 22 vs engine-required Node 26, no workspace install). As with 4A, tests must run on the real machine. Any failure caused solely by the external Live2D download/network step during `build:web` is a pre-existing baseline issue, documented separately from 4B regressions.
