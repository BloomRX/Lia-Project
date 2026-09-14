# Phase 5 Round 2 — run-setup path failure + install progress UI

Commits: **`dcff152`**, **`8a79785`**, **`e342cc2`** on `arena/01a09ddb-lia-project`,
on top of the merged round-1 work (`45857f9`).

**Not an installer PASS.** Round-3 Windows QA is required; the checklist is at
the bottom. This report answers the ten items of the brief in order.

---

## 1. The exact cause of the path failure

What is **known, from the QA log and from reading the pinned script** (commit
`f16117e9`, branch `-silent` → `:InstallCustomStandalone`):

1. The script downloaded `Miniconda3-py311_24.4.0-0-Windows-x86_64.exe` (81.72 MB —
   the number in the QA log matches `curl -Lk` inside the script byte for byte).
2. The next line runs `start /wait "" "…\miniconda_installer.exe" … /S /D=%CONDA_ROOT_PREFIX%`.
   **Its success is never checked by the script.**
3. The line after that is `call "%CONDA_ROOT_PREFIX%\_conda.exe" --version`.
   When the directory `alltalk_environment\conda` does not exist, this is precisely
   the line where cmd.exe prints `ERROR_PATH_NOT_FOUND` — **"O sistema não pode
   encontrar o caminho especificado."** — which is the line in the QA log.
4. The script's failure branch ends with `echo Miniconda not found.` → `goto end` →
   `:End` → more `echo`s → `exit /b`. **Every `echo` resets ERRORLEVEL to 0**, so
   `cmd /c atsetup.bat -silent` **returns exit code 0 for an install that gave up**.
5. Our `run-setup` trusted the exit code, marked itself done, and the failure only
   surfaced two steps later at `verify-install`.

What is **not** known, and is deliberately not guessed in this report: *why* the
Miniconda NSIS installer did not produce `alltalk_environment\conda` (silent NSIS
failure, AV interference, or `start /wait` misbehaving under a console-less spawn
are the candidates — none observable from this environment). The instrumentation
below exists so the next Windows run names it: the log now carries the cwd, the
arguments, the exit code, and the tail of **both** output streams of the setup.

## 2. The command that failed

Inside `atsetup.bat`:

```bat
start /wait "" "%INSTALL_DIR%\miniconda_installer.exe" /InstallationType=JustMe /NoShortcuts=1 /AddToPath=0 /RegisterPython=0 /NoRegistry=1 /S /D=%CONDA_ROOT_PREFIX%
```

followed by the unchecked verification line `call "%CONDA_ROOT_PREFIX%\_conda.exe" --version`,
which is what printed the error. Our spawn (`cmd /d /s /c atsetup.bat -silent`,
`shell: false`, stdin closed, cwd = the extracted tree root) is unchanged and was
confirmed correct — see item 3.

## 3. cwd before / after

The spawn already used the correct cwd: the extracted AllTalk root
(`<userData>/runtimes/alltalk/app`), which is what the script assumes (`cd /D "%~dp0"`,
then everything relative to it). **No cwd change was needed** — the extraction fix
from round 1 put the tree in the right place. What was missing was proof: the
`run-setup start` log line now records `cwd=<…> exe=<…> args=atsetup.bat -silent`
before the spawn, so a QA report shows the exact directory rather than a
reconstruction. A test pins spawn cwd and log agreement.

## 4. The missing path

`alltalk_environment\conda` (and therefore `env` and `start_alltalk.bat`) — exactly
what `verify-install` reported missing, and what the script itself failed to verify
after `start /wait`. `script.py`, `system/`, `voices/` were all present (the
extraction was fine, as round 1's fix intended).

## 5. Was it the space-in-path issue?

**No — ruled out, not assumed.** Two independent guards say so: (a) our
`check-environment` runs `assessInstallPath()` *before* the 97 MB download and it
passed; (b) the script's own space check (`findstr /C:" "`) would have printed its
own sentence and aborted before the download — the download completed. The path
rule itself is untouched: space still blocks early with a friendly sentence;
special characters still warn without blocking (mirroring the script). The round-2
brief suggested a managed no-space runtime path as an alternative; moving the
install silently is explicitly out — the current behaviour (clear early refusal)
is deliberate and tested.

## 6. Changes to the bootstrap

`voice-runtime-bootstrap.ts` (`dcff152`):

- **`run-setup` no longer trusts exit code 0.** The step now fails unless the
  installer wrote `start_alltalk.bat` — the artefact the script only produces as
  its final act — and logs `run-setup incomplete …, its output above names where
  it gave up`.
- **Layout gate before the spawn** (`SETUP_INPUTS`): `atsetup.bat` and the two
  `system\requirements\*.txt` the script pip-installs by relative path must exist,
  else the step fails with `layout-invalid` naming the missing files. A truncated
  extraction now fails at the boundary, not twenty minutes into the setup.
- **Instrumentation** (item D): pre-spawn `cwd/exe/args` line; the `finished` line
  now carries the tail of both stdout and stderr (`outputTail`, exported and
  tested directly). Paths stay in the log, never in the UI.
- The skip check uses `START_SCRIPT` instead of a second `'start_alltalk.bat'`
  literal (same one-fact-two-places class as round 1).

`verify-install` is **not** relaxed (item H): all four markers are still required;
the launcher-without-env case still fails there and has a test.

## 7. How progress reaches the UI

`8a79785` replaced two things that had each hidden progress:

- **Renderer**: `stores/lia/runtime` subscribes to `electronLiaBootstrapChanged`
  on the shared eventa context. Previously it only learned the state when the run
  invoke returned — i.e., at the end, which is exactly why clicking Install looked
  dead. The store keeps the published object **verbatim** (`shallowRef`; reference
  identity is pinned by test). Main remains the source of truth.
- **Main**: the service's 250 ms republication interval is gone. The bootstrapper
  now takes `onStateChange` and pushes **its own mutations**, deduplicated on the
  published content and silent while nothing changes (verified by a test that
  holds the setup step open and asserts zero notifications). No timer anywhere in
  the chain.

Concurrency (item B): the Install button disappears while running, the renderer
ignores a second `runBootstrap` while `isLiaBootstrapActivePhase` is true, and the
main process still collapses concurrent runs into one. All three layers tested.

## 8. States displayed

`e342cc2`. Header is always **"Sistema de voz"**. Under it, one of:

| State | Line | Action |
| --- | --- | --- |
| idle | "Sistema de voz necessário" + hint | Instalar |
| checking | "Preparando o sistema de voz…" + steps + spinner | Cancelar |
| downloading | step "Baixando o sistema de voz" running | Cancelar |
| extracting | + "Extraindo os arquivos…" (from the step's own detail) | Cancelar |
| installing / verifying | same pattern, ✓ behind, spinner ahead | Cancelar |
| ready | **"Sistema de voz pronto"** as an outcome banner, voice panel below | — |
| failed | "Não foi possível concluir a instalação." + main's sentence | Tentar novamente (ou Reparar para `health`) |
| cancelled | "Instalação cancelada." | Tentar novamente |

No Git/Python/Miniconda/AllTalk/CUDA/pip/paths in the normal UI (verified by the
existing invariant tests, now running with a `not-installed` default). No
percentage: there is no honest counter for these steps; the spinner is CSS motion,
not a number. New i18n keys (`failedTitle`, `cancelledTitle`, `extracting`) exist
in pt-BR and en; `RuntimeInstallCard.vue` joined `PANEL_SOURCES`, and the i18n
contract test now also asserts every `BOOTSTRAP_STEP_IDS` label resolves (the YAML
scanner learned hyphenated keys — it had been silently skipping every step label).

## 9. Tests and mutations

Suite: **103 files / 950 passed / 1 skipped** (was 921: +29). `vue-tsc`: exactly
the 3 pre-existing baseline errors. ESLint: 0 on every touched file (the i18n
YAMLs were never lint-clean — 206 double quotes predate this change; locales are
validated by the i18n contract test instead).

New coverage by brief item: 1–7 UI states (`VoiceUxInvariants`, +8), 8 no fake
progress (dedupe + silence-while-waiting tests), 9 no parallel renderer state
(reference identity), 10 spawn cwd (kept), 11 layout gate (+2), 12 space rule
(pre-existing, kept), 13 non-zero exit (kept), 14 verify-install mandatory (kept).

Mutations run by hand, all caught:

| Mutation | Result |
| --- | --- |
| drop the launcher check (`dcff152`) | 2 tests fail |
| drop the layout gate | 2 tests fail |
| ignore non-zero exit | 1 test fails |
| wrong spawn cwd | 11 tests fail |
| silence `onStateChange` (`8a79785`) | 3 tests fail |
| drop the publish dedupe | 1 test fails |
| drop the store's run guard | 1 test fails |
| clone the published payload in the store | 1 test fails |
| hardcode the extracting sub-state (`e342cc2`) | 1 test fails |
| spinner always on | 2 tests fail |
| drop the `downloading → extracting` flip | 1 test fails |
| drop the outcome banner mount | 1 test fails |

## 10. SHAs

- `dcff152` — run-setup detection + instrumentation
- `8a79785` — state propagation by subscription
- `e342cc2` — install card UI
- *(report commit follows)*

---

## Round-3 Windows QA checklist (item J)

1. Click **Instalar**.
2. Confirm the card shows live progress: ✓ "Verificando o computador", ✓
   "Baixando o sistema de voz" (then "Extraindo os arquivos…"), ● "Instalando o
   sistema de voz".
3. Confirm `fetch-source downloaded … extract-complete` in the log.
4. Confirm `run-setup finished exit=… stdout=… | stderr=…` — **this line is the
   diagnostic**: if the Miniconda step fails again, the tail of both streams will
   name it (look for the NSIS output or its absence).
5. Expected outcomes: `run-setup` done → `verify-install` done → card shows
   **"Sistema de voz pronto"**; or, on failure, the card names it with retry and
   the log pins the exact line.

Do **not** declare one-click PASS without the above on the real Windows machine.
