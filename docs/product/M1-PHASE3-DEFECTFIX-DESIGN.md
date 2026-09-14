# M1 Phase 3 — Follow-up Defect Fix: Design (for approval)

Scope: the two product/UX defects surfaced during manual QA of the approved
Phase 3 (`8e88e14`). **No code is changed until this design is approved.** This
is still Phase 3 work; Phase 4 must not start.

Reference points in the current tree:

- `apps/stage-tamagotchi/src/renderer/pages/index.vue` — the Stage page.
- `apps/stage-tamagotchi/src/main/windows/main/window-sizing.ts` — per-mode sizing.
- `apps/stage-tamagotchi/src/main/windows/main/index.ts` — `lia` `main-window.json` config creation + `setMainWindowContext`.
- `apps/stage-tamagotchi/src/main/windows/settings/rpc/index.electron.ts` — settings-window eventa invokes.
- `apps/stage-tamagotchi/src/main/index.ts` — injeca wiring (settings + main window).
- `apps/stage-tamagotchi/src/renderer/pages/settings/system/window-shortcuts.vue` — template page for a renderer↔main-config settings UI.
- `packages/i18n/src/locales/en/tamagotchi/settings.yaml` — app-scoped settings keys.

---

## Defect 1 — Stage → Home must be an obvious, always-visible product action

**Current state.** A "Home" action exists but only inside `controls-island`
(committed in `8e88e14`). The island collapses/hides and is not a place a
layperson looks, so the affordance is effectively undiscoverable.

**Requirement (unchanged).** A clear, discreet, *always visible* product action
on the Stage page, obvious to a layperson, coherent with existing UI, in an
intuitive spot, that keeps the exact same two-step navigation
(`setMainWindowContext({ mode: 'home' })` then `router.push('/home')`) on the
same window/runtime. No second navigation framework. No `window-sizing.ts`
logic change for this item.

**Proposed design.**
- Add a dedicated always-visible control component (e.g.
  `controls/…` under the Stage page — actually a small `StageHomeAffordance`
  element rendered in `pages/index.vue`'s overlay layer, **sibling** to
  `ControlsIslandRoot`, not inside it). Reuse the existing `goHome()` sequence
  verbatim (extract it into a tiny shared helper or the component itself) so
  there is exactly one implementation of "go home".
- Visual: a compact pill — home icon (`i-solar:home-smile-outline`) + label
  "Home" / "← Home" — styled to match the existing island pills
  (`rounded-full`, translucent `backdrop-blur`, neutral/primary), positioned
  `fixed` near the **top-left** of the Stage window so it does not collide with
  the centered `ResourceStatusIsland` pill (top-center) nor the bottom-right
  controls dock. Always visible (not hover/focus gated) while on the Stage.
- It is clickable and non-drag; it intentionally sits above the drag area, same
  as existing interactive chrome.

**Open decision (Q3/Q4).** Exact corner and whether to *retire* the redundant
Home control currently inside `controls-island` so the always-visible one is the
single discoverable affordance (recommended — "single navigation system").

---

## Defect 2 — User-configurable initial window size (Home & Stage)

### 1. Where the configuration lives

**Reuse the existing per-mode size record already consumed at open/switch time.**
`window-sizing.ts` persists `home` and `stage` `{ width?, height? }` records in
the main-process `lia` config (`main-window.json`), and `resolveContextBounds`
already prefers a persisted record over the built-in preset. `captureUserBounds`
writes only the *active* mode on a manual resize. This is exactly the storage the
opening size is read from — so the new "configured size" writes **the same
field**, **no new persistence channel**, **no schema/migration change**, and
`window-sizing.ts` logic stays untouched.

Built-in defaults are preserved unchanged: Home preset `460×640`, Stage preset
`800×1000` (`HOME_WINDOW_PRESET` / `STAGE_WINDOW_PRESET`).

### 2. Data model

- Per-mode `home` / `stage` `{ width, height }` override — **existing**, reused.
- A Settings "Window" page surfaces the *effective opening size* per mode as a
  small set of choices (see Q2) plus a "Restore default" action.
- The setting is stored as the per-mode width/height override (dimensions only,
  never position), exactly like a manual resize would.
- New eventa invokes on the **settings-window** RPC context (a renderer in the
  Settings window can only invoke handlers registered in that window's context —
  this mirrors `electronSpotlightShortcutGet/Set`):
  - `electronMainWindowSizeGet` → returns current per-mode override + effective
    size + active mode.
  - `electronMainWindowSizeSet({ mode, size: {width,height} | null })` → writes
    the override (or clears it), and if the requested mode is the one currently
    shown, re-applies bounds live via the existing `setContext(mode)` so the user
    sees the change; otherwise it applies at the next switch/open of that mode.
  - A single settings RPC handler can also serve "Restore default" for both modes
    by clearing both records.
- Wiring: the handler must reach the `lia` sizing controller that lives inside
  `setupMainWindow`. Mirror the existing `getMainWindow: () => userFacingMainWindow`
  getter pattern in `apps/stage-tamagotchi/src/main/index.ts` with a lazily
  populated controller reference that `setupMainWindow` sets once `sizing` is
  built (invokes only fire at runtime, so lazy access is safe).

### 3. Precedence policy (the key question — Q1)

Two coherent policies; they differ in what happens after the user configures a
size and *then* drags the window by hand.

- **Model A — shared "last explicit action wins" (recommended).**
  One per-mode size field is shared by Settings and manual resize. Picking a
  preset in Settings writes the override (and applies live). A later manual drag
  updates the same field (current `captureUserBounds` behavior, unchanged).
  Opening/switch always uses the override if present, else the preset. Settings
  and manual resize never conflict because they edit the same value.
  *Trade-off:* after you drag the window, the Settings picker no longer "owns"
  the size — it reflects the last used size (Settings shows "custom" until it
  matches a preset again). Least invasive; fully preserves persistence & defaults.

- **Model B — configured default wins over incidental resize.**
  A separate `configuredInitial` per mode wins at open/switch over the
  auto-persisted last-used size. Manual resizes stay sticky within a session but
  a configured initial size makes the window open at that size again on every
  relaunch/switch. *Trade-off:* needs a second field + a precedence rule between
  the two, and requires touching `window-sizing.ts`/`captureUserBounds` semantics
  more than Model A (conflicts with the "don't alter window-sizing unless
  necessary" constraint).

**Recommendation: Model A** for v1 — predictable, zero new state, honors the
"reuse existing storage" and "keep persistence intact" constraints. Model B is
available if the user wants a strict "the configured size is always the opening
size regardless of later resizing."

### 4. How "Restore default" behaves

- Clears the chosen mode's override (or both modes from the page-level control),
  returning that mode to its built-in preset — Home `460×640`, Stage `800×1000`.
- If the target mode is currently shown, re-applies the preset bounds live;
  otherwise it applies at the next switch/open.
- Under Model A, "Restore default" and choosing the preset equal to the built-in
  default are the same outcome (both clear/neutralize to the preset) — acceptable
  and unambiguous.

### 5. UI granularity (Q2)

Recommended v1: per-mode **Pequena / Média / Grande** radio-style choices, where
**Média = the current built-in default** for that mode (so defaults are preserved
and nothing is selected-by-default that isn't the default). Proposed logical-CSS
presets (final px open for tweak; min floor 360×480 and work-area clamp still
apply):

| Mode  | Pequena   | Média (default) | Grande   |
|-------|-----------|-----------------|----------|
| Home  | 400×560   | **460×640**     | 560×780  |
| Stage | 640×820   | **800×1000**    | 1020×1260|

If the effective size doesn't match a preset (user hand-resized), the page shows
a subtle "custom size" state and still offers "Restore default".

The Settings UI goes under `/settings/system/window` (modeled on
`window-shortcuts.vue`), with a menu entry added to the app System settings list
and `tamagotchi.settings.*` i18n keys (en only, pt-BR falls back).

---

## Files expected to change (per implementation)

- New: `…/renderer/pages/settings/system/window.vue` (Settings Window page).
- New: a Stage always-visible Home affordance component + integration into `pages/index.vue`.
- Edit: `…/shared/eventa/index.ts` (declare new window-size invokes).
- Edit: `…/main/windows/settings/rpc/index.electron.ts` (handle new invokes via controller).
- Edit: `…/main/windows/main/index.ts` + `…/main/index.ts` (expose lazily populated sizing controller getter).
- Edit: `…/renderer/pages/settings/system/index.vue` (menu entry).
- Edit: `packages/i18n/…/en/tamagotchi/settings.yaml` (+ stage keys if the label moves).
- Possibly remove the redundant Home control in `controls-island` (see Q4).
- `window-sizing.ts`: **no logic change** under Model A.

## Verification after approval & implementation

`pnpm typecheck`, `pnpm build:web`, relevant unit tests, then full manual QA:
Home→Stage, Stage→Home (new affordance discoverable), Home/Stage independent
size persistence, window-size config applying, Restore default, manual-resize
interaction, Home↔Stage non-contamination.

---

## Open decisions (need user answer before implementing)

See the questionnaire that accompanies this doc (Q1 precedence, Q2 preset
granularity, Q3 affordance placement, Q4 keep/remove island Home button).
