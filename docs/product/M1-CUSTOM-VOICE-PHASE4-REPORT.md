# M1 — Custom Voice, Phase 4: layperson UX + managed runtime

Base `f729a00` → head `a6e0500`. Branch `arena/01a07b6d-lia-project`.

Three commits, split by responsibility:

| SHA | What |
|---|---|
| `93d4c61` | Managed speech runtime lifecycle: detect, start, health, stop |
| `1ba3c50` | Runtime IPC bridge, autostart, guided install wizard |
| `a6e0500` | Voice tab opens on one question; technical detail behind advanced |

---

## 1. The new UX

The Voice tab used to open on a speech server address, a voices folder and a
connection status, then show "Provider de voz / Modelo / Voz" and a second
"Voz de reserva" block. It now opens on a single question:

**"Como a Lia vai falar?"**

1. **Voz pronta** — one of the voices that already comes with Lia.
2. **Minha própria voz** — a voice of the user's own; the file stays local.

Which of the two is active is *derived* from `voice.tts.preferred`, not stored in
component state. There is deliberately no "mode" ref: a mode the component
remembers could disagree with what is persisted, and the tab would then show a
choice Lia is not actually using. `voice.tts` remains the single source of truth
(item P14).

Under "Voz pronta" the user sees a friendly voice list and `[▶ Ouvir exemplo]`.
Nothing else. Under "Minha própria voz" they see their imported voices with
`Importar voz`, `Criar minha voz`, `Testar`, `Remover` — and an install card if
the runtime is missing.

## 2. What was hidden from the normal UI

Removed from the default path entirely (not merely restyled):

- the word **AllTalk**, and **XTTS**;
- the **server URL** field and the `7851` / `127.0.0.1` defaults;
- the **voices folder** picker and its path;
- the **install folder** path;
- the **fallback / "Voz de reserva"** picker;
- the **provider** and **model** selectors.

Each of these is asserted absent from the rendered HTML *before* the `<details>`
boundary, not just visually de-emphasised.

## 3. Advanced settings

Everything above still exists, inside a `<details>` element that is **closed by
default**. It holds: the voice provider, the model, the emergency voice
(renamed from "backup voice", moved in here per item J), and the local runtime
panel — address, both folder pickers, and manual start/stop.

Nothing was deleted. A developer or QA engineer still has the full surface; it is
only out of the default path. The `<details>` element gives real disclosure
semantics for free — the browser keeps it closed, and no component state has to
remember whether it was open.

## 4. Runtime manager strategy

`main/services/lia/alltalk-runtime.ts` owns the process. The Electron main
process — never the renderer — is what spawns it.

- **Detection** looks for install markers (`script.py`, `system/`, `voices/`) plus
  `start_alltalk.bat`. That last one matters: the setup script *generates* it as
  its final step, so a folder without it means the user extracted something but
  never finished installing. Detection distinguishes the two.
- **Spawn** uses an explicit argument array with `shell` left unset. On Windows a
  `.bat` still needs an interpreter, so `cmd.exe` is invoked *as the program* with
  `/d /s /c start_alltalk.bat` as separate arguments, and the install directory is
  passed as `cwd` — never interpolated into a command string. A path with spaces
  cannot break out, because it never enters a string that gets re-parsed.
  `windowsHide: true`, so no console flashes on the desktop.
- **Health** is polled (`/api/voices` through the existing client) before the voice
  is offered. A probe that throws is treated as "still booting", not as failure —
  a server that is starting refuses connections.
- **Restart** is deliberate: `start()` on an already-`ready` runtime re-probes, and
  only respawns if the port is actually dead.

`installDir` is config, written only by the main process's own `showOpenDialog`.
`normalizeAllTalkRuntimePayload` never reads `payload.installDir` — the same rule
that already applied to `voicesDir`.

## 5. Is AllTalk auto-install technically and license-wise viable?

**No.** Audited before writing any code, and the answer is recorded here rather
than papered over.

- **There is no official binary distribution for v2.** The documented install is
  `git clone -b alltalkbeta` followed by `atsetup.bat`. The ZIP on the Releases
  page belongs to **v1**, whose own README warns "Everything on this page is for
  AllTalk v1".
- **`atsetup.bat` is interactive.** The official wiki instructs the user to
  "Select Standalone Installation and then Option 1". There is no documented
  silent mode.
- **Prerequisites are separate, administrator-level installs**: Git, Microsoft C++
  Build Tools with the Windows SDK, and espeak-ng.
- **No versioned, checksummed artifact exists**, so there is nothing to verify
  integrity against. A downloader would fetch something it cannot check.
- **~24 GB free during install, ~10 GB after**, and the path may contain no spaces
  or hyphens.
- **License is AGPL-3.0** (confirmed via the GitHub API). Strong copyleft —
  relevant if AllTalk is ever bundled or redistributed with Lia. It is not
  bundled, and this change does not bundle it.

## 6. So: implemented, or wizard?

**Wizard.** Per the instruction not to invent a fragile downloader, `[Instalar]`
opens a guided checklist of the documented minimum steps, and the Lia takes over
from "already installed": detect, start, health-check, stop.

The steps are **data, not code** (`INSTALL_STEPS` in
`alltalk-runtime-install.ts`). If a future release ships a portable archive with a
stable URL and a published checksum, that list is the first thing to replace —
the automation seam is already in place.

Only the final step ("show the Lia where it is") is verifiable from inside the
app, and it is marked done only when a folder is chosen *and* it actually looks
like an install. Pointing at an empty directory is a mistake, not progress. The
prerequisites stay unchecked rather than being guessed at.

**This is stated plainly: custom voice still requires a one-time manual
installation by the user. It is not automatic.**

## 7. Autostart

On launch, `autostartIfNeeded()` reads the persisted selection and starts the
runtime **only if** `preferred.providerId === 'custom-local-voice'`. A user on a
built-in voice never pays minutes of boot and gigabytes of RAM for a server they
will not call.

If the runtime is not installed, autostart returns `notInstalled` quietly — that
is not an error, it is the state that produces the install card.

The call site wraps it in `.catch(...)` and logs a warning. A failed autostart
cannot prevent the app from starting.

## 8. Lifecycle

- **Single instance.** `start()` assigns its in-flight promise *synchronously*,
  before any `await`. This was a real bug the tests caught: the original version
  assigned after several awaits, which left a window where two concurrent callers
  each spawned a child and left two servers fighting over port 7851.
- **Clean shutdown.** `app.on('before-quit')` stops the child and only then exits.
  SIGTERM first, then SIGKILL if the exit code is still null, bounded by a
  configurable grace period so app quit cannot hang.
- **No orphans.** The child handle is kept; stdout/stderr are piped and read.
- **Failure is a sentence, never a stack trace.** The startup message reads the
  exit code *before* calling `stop()` — another bug the tests caught, since
  `stop()` fills in the exit code and made a timeout look like a crash.

## 9. Offline / failure handling

- Runtime absent → install card replaces the import button, so the user is never
  offered an action that cannot work.
- Runtime fails to start → "Não foi possível iniciar o sistema de voz." plus
  `[Tentar novamente]`. The Voice tab still renders; the choice and the import
  path stay available.
- Main process unreachable → the store converts it to an `error` state instead of
  throwing into the component.
- Voice synthesis fails → `withSpeechTtsSegmentFallback` returns `null` once the
  chain is exhausted. Audio simply does not play; **the chat text is unaffected**,
  because text and audio are separate paths. The internal fallback (custom →
  reserve) still exists and is unchanged — it is just no longer something the user
  is asked to configure.

## 10. "Create my voice" / training

There is **no validated training notebook for Lia**. So the button says
"Treinamento em breve" with an explanation of the intended flow, and renders **no
link**. A test asserts `colab.research.google.com` does not appear, with a comment
marking it as the assertion to change — deliberately — once a real notebook is
published and verified.

No training code was written, and no Colab contract was invented. The future
shape (recordings → notebook → training → package → download → Importar) fits the
existing import path, which already accepts a voice file and registers it.

## 11. Tests and mutations

New and updated test files:

| File | Tests |
|---|---|
| `alltalk-runtime.test.ts` | 20 |
| `alltalk-runtime-service.test.ts` | 10 |
| `VoiceRuntimeAdvanced.test.ts` | 13 |
| `VoiceUxInvariants.test.ts` | 15 |
| `VoiceSection.test.ts` | 10 |
| `CustomVoicePanel.test.ts` | 4 |

Full tamagotchi suite: **98 files, 809 passed, 1 skipped**.

`vue-tsc`: tamagotchi **3 errors — the exact pre-existing baseline**
(`provider-config-service.ts` TS2322, `home.vue` TS6133, `lia-persona.ts` TS6133);
stage-ui **0**. ESLint clean on all 21 touched files.

Tests that covered the moved UI were **moved, not deleted** — the server status,
error-as-sentence and voices-folder assertions now live in
`VoiceRuntimeAdvanced.test.ts` with their assertions unchanged.

**Mutations: 6/6 detected.** Two initially *survived* and were fixed rather than
accepted:

- *Advanced open by default* survived because the test's `indexOf('<details')`
  landed on the element named inside the component's own HTML comment — which
  `renderToString` preserves. Fixed by matching a real tag (`/<details\s[^>]*>/`);
  requiring whitespace also stops `[^>]*` from matching the empty string.
- *No SIGKILL escalation* initially "survived" only because the mutation never
  applied (wrong indentation). Verified the replacement landed, then re-ran.

The other four: ready-made picker visible during a custom voice (7 failures),
install card never shown (3), single-instance guard removed (1), autostart for
any provider (3).

## 12. SHA

`a6e0500` (branch `arena/01a07b6d-lia-project`, pushed).

---

## Mistakes worth recording

- **Two i18n helpers in one component broke the locale-coverage scanner.** Its
  prefix regex uses `[^.]+`, which matches newlines and backticks, so with `tt`
  and `ct` defined in the same file it spanned both lines and attributed every
  `tt(...)` call to the wrong prefix. Fixed by keeping one helper per file and
  nesting the new keys under the existing namespace — cheaper than teaching the
  scanner about multiple helpers.
- **A blunt `str.replace(..., 1)` corrupted two YAML files.** Re-indenting a block
  by matching `\n        hint:` hit `reserve.hint` — the first occurrence in the
  file — and produced unparseable YAML. Reverted both files to HEAD (after
  backing them up) and redid the insertion as a single whole-block write. Lesson:
  when editing structured text by string replacement, anchor on something unique.
- **A test asserting on sliced HTML can pass for the wrong reason.** Slicing
  forward from a `data-testid` missed a `disabled` attribute rendered *before* it,
  reporting a disabled button as enabled. Extract the whole tag instead.
- **An invented import path.** `shared/lia-voice` did not exist when it was first
  imported; `CUSTOM_VOICE_PROVIDER_ID` lived in the renderer, which the main
  process cannot import. Created the shared module and had the renderer re-export
  it — one definition, two consumers. Note that `export { X } from '...'` does not
  bring `X` into local scope, so a file that both uses and re-exports needs both
  an `import` and an `export`.

## What still needs QA on Windows

There is no Electron binary or display in this environment, so nothing here was
exercised against a real AllTalk install. Specifically unverified:

1. `start_alltalk.bat` actually launches and reaches health on a real install.
2. `windowsHide: true` genuinely suppresses the console window.
3. `before-quit` stops the server before the process exits — no orphaned
   `python.exe` after closing Lia.
4. The autostart path on a cold launch with a custom voice selected.
5. The `<details>` disclosure renders and behaves as expected in the real window.
6. The install card reads correctly to a non-technical user — the wording is the
   product, and it has not been shown to one.
7. pt-BR strings render without layout breakage at real panel width.
