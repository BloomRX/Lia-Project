# Phase 5 Round 3 — Miniconda silent install: audit, repair layer, evidence

Commits on `arena/01a09ddb-lia-project`: repair layer + tests (see SHA below),
`QA-Miniconda.bat`, this report. **Not an installer PASS** — round-4 Windows QA
decides. Answers to the eleven items of the brief:

## 1. The exact upstream command (pin `f16117e9`, `:InstallCustomStandalone`, read from the file)

```bat
start /wait "" "%INSTALL_DIR%\miniconda_installer.exe" /InstallationType=JustMe /NoShortcuts=1 /AddToPath=0 /RegisterPython=0 /NoRegistry=1 /S /D=%CONDA_ROOT_PREFIX%
echo Miniconda version:
call "%CONDA_ROOT_PREFIX%\_conda.exe" --version || ( echo. && echo Miniconda not found. && goto end )
```
The outcome of `start /wait` is **never checked** anywhere in the script.
`MINICONDA_DOWNLOAD_URL=https://repo.anaconda.com/miniconda/Miniconda3-py311_24.4.0-0-Windows-x86_64.exe`
(the 81.72 MB of the QA log).

## 2/3. Real paths on the QA machine

- `CONDA_ROOT_PREFIX` = `C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\runtimes\alltalk\app\alltalk_environment\conda`
- installer = `…\alltalk\app\alltalk_environment\miniconda_installer.exe`

## 4. Did the installer exist? **Yes.**

The script curls it with `|| ( … goto end )` on the download itself; the QA log
shows the 81.72 MB complete, so the file was there when `start /wait` ran.

## 5. Exact cause — proved parts and the one remaining measurement

**Proved by the QA log + file evidence:**
1. `start /wait` launched *something* (no error between the download and the
   version check), and no `alltalk_environment\conda` appeared.
2. `call "%CONDA_ROOT_PREFIX%\_conda.exe"` with the directory missing is the
   line that printed *"O sistema não pode encontrar o caminho especificado."*
   (ERROR_PATH_NOT_FOUND), echoed between `Miniconda version:` and
   `Miniconda not found.` — byte-for-byte the QA tail.
3. `:End` resets ERRORLEVEL with echoes → exit 0 for an abandoned install. Our
   round-2 guard correctly rejected the run.

**Still unmeasured by that log:** what the NSIS process itself returned. It is
now measured: the bootstrapper runs the same installer directly and logs
`miniconda-install-finished exit=N` with the real code, plus the before/after
facts (item B). That single line separates Case 1 from Case 2.

## 6. Was `start /wait` wrong? **No — and yes.**

The line itself is syntactically and semantically the vendor-recommended form
(`""` is the window title, the quoted path is the command, `/D=` last and
unquoted; the `""` "first quoted string becomes the title" trap does not apply
here because the title is present). NSIS references confirm `start /wait` is the
standard way to wait on NSIS installers. What is wrong is everything *around*
it: the script never verifies the outcome, so any silent NSIS no-op becomes
invisible. The quoting/`%~dp0`/expansion concerns of item C were audited line by
line and are sound; spaces were already ruled out (the script's own space check
would abort *before* the download, and ours passed too).

## 7. Does the direct install work? → round 4 answers it, instrumented

Two identical answers will exist after the next Windows run:
- app-side: `miniconda-install-start/finished/verify` log lines (real exit
  code, then prefix + `_conda.exe` artefact checks — item G);
- manual: `airi/QA-Miniconda.bat` runs only the downloaded installer with the
  pinned arguments and prints CASE 1 / CASE 2 (item D).

## 8. Can atsetup resume afterwards? **No — proven from the file.**

When `_conda.exe --version` succeeds the script does `goto RunScript`, and
**`:RunScript` does not exist anywhere in the pinned file** (all five chunks
read; `:PrintBigMessage` is likewise called but undefined). A `goto` to a
missing label aborts the batch with errorlevel 1. So at this pin the `-silent`
flow is one-shot: only a *fresh* run — where the in-run NSIS actually works —
ever creates the env and the start scripts. The repair layer therefore treats
the resume as a *verified attempt*: it costs nothing, downloads nothing, the
artefact check (`start_alltalk.bat`) decides, and if a future pin can resume it
simply starts passing. Editing the upstream script and reimplementing the
remaining setup were both excluded by the brief; this is the remaining
compliant path, and it makes the next decision (pin policy) evidence-driven.

## 9. Final strategy (items E–H)

`run-setup`: facts log → (fresh atsetup unless Miniconda already verified) →
on abandonment: **direct installer run** — argument array, `shell: false`,
closed stdin, 20 min ceiling, cwd = extracted root, the pinned arguments with
`/D=` last (item F: JustMe / AddToPath=0 / RegisterPython=0 / NoRegistry=1) →
pass only on exit 0 **and** prefix **and** `_conda.exe` (item G) → resume
attempt through upstream → final artefact check, unchanged. Retry reuses the
97 MB source and the 81 MB installer: with a verified Miniconda the step skips
straight to resume, so nothing is re-downloaded and nothing is reinstalled
(item H); profile/voices are never touched. The UI shows only the normalised
failure sentence; "Miniconda" appears in the log, never on screen (item J).

## 10. Tests and mutations

Suite: **103 files / 957 passed / 1 skipped** (+7 new vs round 2's 950);
ESLint 0 on all touched files; vue-tsc 0 errors. New tests pin: exact argument
array with `/D=` last, command carries no concatenated string, installer-missing
fails without inventing one, real non-zero exit fails with the code in the log
and a generic message on screen, exit-0-without-artefacts fails *before* any
resume, a verified Miniconda is never reinstalled, retry downloads nothing,
`@proj-airi`-style special characters go through verbatim.

Mutations (all detected): trust exit 0 only → 1 test; `shell: true` in the exec
primitive → 1; concatenated command string → 4; reinstall even when verified →
1; accept the resume without artefact → 1; continue silently when the installer
is missing → 1.

## 11. SHA

Repair layer + tests: *this commit*; QA bat and report: their own commits.
Earlier commits of this round's chain: `dcff152`, `8a79785`, `e342cc2`,
`d862165`.

## Round-4 Windows QA checklist

1. Update, click **Instalar** (state: source + installer already on disk → no
   re-downloads).
2. Read the log: `miniconda-recovery-facts` → `miniconda-install-finished
   exit=N` → `miniconda-install-verify …` → resume outcome.
3. Optionally run `airi\QA-Miniconda.bat` for the independent manual answer.
4. Outcomes: `exit=0` + artefacts → Case 1 confirmed (upstream `start /wait` is
   the broken part; the pin-resume question becomes the next decision);
   `exit!=0` → Case 2 with the first real NSIS exit code ever captured.
