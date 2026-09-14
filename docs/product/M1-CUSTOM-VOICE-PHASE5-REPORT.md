# M1 Custom Voice — Phase 5: Automatic Voice Runtime Bootstrapper

Base: `3808ac9`. Branch: `arena/01a07b6d-lia-project`. Commits: `c79c69e`…`67166d9` (11).

**Verdict up front: the Phase 4 conclusion was wrong, and this phase reverses it.**
Phase 4 reported that automated install was not viable. It is viable. The user now
clicks one button. What follows documents the evidence, the design that follows
from it, and — separately and explicitly — what is still unverified.

**Not declared as "one-click install PASS".** Nothing here has run on a real
Windows machine. See item 17.

---

## 1. Real dependencies found

Audited by reading `atsetup.bat` (32,441 bytes, branch `alltalkbeta`) and the
repository tree through the GitHub API. Full detail in
`M1-ALLTALK-INSTALL-AUDIT.md`.

The decisive line is `atsetup.bat:46`:

```bat
if "%1"=="-silent" goto InstallCustomStandalone
```

`-silent` jumps straight past the interactive menu to the standalone install path.
Phase 4 read the menu and concluded there was no silent mode; it never checked
whether the script parses arguments.

That one finding collapses the dependency list:

| Dependency | Verdict | Evidence |
|---|---|---|
| **curl** | Required — already present | `atsetup.bat:38` checks it. Ships with Windows 10 1803+. |
| Git | **Not required** | `git` appears only in the *update* menu (lines 80, 119, 166, 815), never on the install path. |
| System Python | **Not required** | Miniconda is fetched and installed into the runtime folder; `conda create … python=3.11.9` runs inside it. |
| espeak-ng | **Not required** | Bundled in the repo at `system/espeak-ng`. |
| FFmpeg | **Not required** | Bundled at `system/win_ffmpeg`; conda installs its own. |
| MS C++ Build Tools | **Not referenced by the installer** | No `msvc`, `vcredist` or Build Tools reference in `atsetup.bat`. Phase 4 took this from the wiki's general prerequisites page, not the script. |
| VC++ redistributable | Not separately required | Installed transitively by Miniconda, per-user. |
| CUDA | Downloaded but **not needed on AMD/Intel** | `atsetup.bat:406` hardcodes `pytorch-cuda=12.1`. No CPU-only branch exists — verified. |

## 2. What can be auto-installed

**Everything.** The install path is fully automatable:

1. Fetch the AllTalk source, pinned by commit SHA.
2. Run `atsetup.bat -silent`, which fetches its own Miniconda and creates its own
   Python environment.
3. Verify the resulting tree, then start and health-check.

No step needs the user to open a terminal, and no step needs a separate
dependency installed first.

## 3. What needs UAC

**Nothing.** Miniconda is installed with
`/InstallationType=JustMe /NoShortcuts=1 /AddToPath=0 /RegisterPython=0 /NoRegistry=1 /S`.
Per-user, no registry writes, no system PATH change, no `Program Files`. The
target directory is under `%LOCALAPPDATA%`, which the user owns.

The elevation UX in item G is therefore **not wired up**, because nothing triggers
it. Building an elevation flow with no caller would be untestable code that looks
like a guarantee. If a future dependency needs it, the failure surfaces as the
`cancelled` category, which already has its own wording and a "Try again" path.

## 4. What was eliminated as unnecessary

Git, system Python, espeak-ng, FFmpeg and the C++ Build Tools.

This is the substantive change from the brief. The original plan had five
prerequisite installers; four of them install something the runtime does not use.
`assessEnvironment()` returns `ok` when they are all missing, and a test asserts
that no install step mentions them:

```
it('never installs Git, Python or winget during a run')
```

Installing them anyway would have cost the user minutes and disk for nothing, and
would have made "the Lia installed Git on my machine" true when it need not be.

## 5. Python strategy

The Lia does not touch Python at all. `atsetup.bat -silent` downloads Miniconda
into `<runtime>/alltalk_environment/conda` and creates `python=3.11.9` at
`<runtime>/alltalk_environment/env`. The installer passes `/AddToPath=0
/RegisterPython=0`, so the user's global Python is neither replaced nor shadowed.

Consequences: no version-compatibility question, no venv for the Lia to manage or
repair, and uninstalling is deleting a folder. An incompatible system Python is
therefore not a failure condition — a test asserts the install proceeds anyway.

## 6. AllTalk version pinning

`PINNED_ALLTALK_COMMIT = 'f16117e95b540e9bbbd8247b49ca6c6b1350b172'`.

Source is fetched as `https://github.com/erew123/alltalk_tts/archive/<sha>.zip`,
verified reachable (`HTTP 200`, `application/zip`).

Pinning by commit rather than branch is deliberate: `alltalkbeta` is a moving
branch, and the repository's tags are all v1-era (`1.9`, `1.9c`, `1.8`,
`deepspeed`, …) — **there is no v2 release tag**, so a tag cannot pin v2.
Installing a branch head would mean every user gets whatever landed that day, and
a bad upstream commit would break installs with no Lia change to explain it.
Bumping the constant is a reviewed decision.

Re-running does not re-download: the recorded commit is compared against the pin,
and a match with `atsetup.bat` present skips the step. A different commit is
treated as a deliberate upgrade.

## 7. Model strategy

**No model weights are downloaded, stored or referenced by this phase.**

XTTS-v2 is fetched by AllTalk itself on first use, and item K says to prefer that
when the runtime manages it. That is the right call here on licensing grounds too:
the weights are under the Coqui Public Model License, non-commercial, and Coqui
Inc closed in January 2024 — there is no longer anyone to license them from.
Keeping the weights entirely inside the upstream runtime means the Lia never
redistributes them.

`preparing-model` remains in the phase enum for future use but no step emits it.
The term "XTTS" appears nowhere in the normal UI.

## 8. State machine

```
not-installed · checking · installing-prerequisites · installing-runtime
· preparing-model · verifying · ready · repair-needed · failed · cancelled
```

Defined once in `shared/lia-voice.ts` and **aliased**, not redefined, in the
bootstrapper. Two definitions of the same phase list is how a UI ends up waiting
on a state the main process never emits.

Every run ends in a terminal phase. A test asserts no step is left `running`
after a failure, which is the "never leave the UI eternally installing" rule.

## 9. Install behaviour

Idempotent per step. Each step checks first and skips when already satisfied:

- `check-environment` — probes curl, disk, platform. Blocks before downloading.
- `fetch-source` — skipped when the pinned commit is already on disk.
- `run-setup` — skipped when `start_alltalk.bat` exists, since that file is the
  last thing `atsetup.bat` writes.
- `verify-install` — requires `script.py`, `start_alltalk.bat`,
  `alltalk_environment/conda` and `alltalk_environment/env`.
- `verify-health` — starts the server and waits for it to answer.

Two clicks share one promise, so a double-click cannot double-install.

## 10. Repair behaviour

Repair is the **same** walk with an intent flag. There is no separate repair code
path, which is what makes it safe to offer unconditionally: it re-checks what
exists and fixes only what is missing. A missing conda env is rebuilt by re-running
the installer; an absent runtime is restored; a healthy install costs a
verification and nothing else.

In the UI the primary button derives its label *and* its action from the same
state, so it cannot read "Repair" while running install.

## 11. Remove behaviour

`remove()` deletes `runtimeRootDir()` and nothing else. Tests assert the removal
list contains only that directory or a temporary archive, and never
`lia-voices`, `Git`, `Python`, `espeak` or `Program Files`.

The user's imported voices live in a separate `userData/lia-voices/` tree and are
untouched. Global tooling the Lia did not install is not its business to undo.

The UI takes two clicks: the first replaces the button with the scope and a
differently-worded confirm. `window.confirm` was not used — the lint config
forbids it, and a native modal cannot show what is about to be deleted.

## 12. Supply-chain protections

- **HTTPS enforced.** `createRuntimeDownload` rejects any non-`https://` URL.
- **Pinned source.** Commit SHA, not a branch.
- **Streamed and hashed.** SHA-256 is computed while streaming, so a large archive
  is never held in memory, and `pipeline` propagates a failure from any stage — a
  truncated transfer rejects rather than leaving a short file that looks complete.
- **Temp file, then extract.** A failed download is deleted; nothing is recorded as
  installed.
- **Plausibility check.** An archive under 1 KB is rejected rather than extracted.
- **Zip-slip guard.** Entries are joined and re-checked against the destination.
- **`state.json` via temp + rename**, so a crash mid-write cannot leave a
  half-written record that later reads as a valid install.

**Two limitations, stated rather than papered over:**

1. **No checksum verification.** Neither the GitHub archive endpoint nor
   `repo.anaconda.com` publishes a fetchable sidecar hash, and the GitHub ZIP is
   generated on request so its bytes are not guaranteed stable. The SHA-256 is
   *recorded* in `state.json` for auditability, but there is no authoritative value
   to compare it against.
2. **The CUDA stack is downloaded even on AMD/Intel.** The target machine is a
   Ryzen 5 5500 with an RX 580 and no CUDA. `atsetup.bat` has no CPU-only branch,
   so the install will pull `pytorch-cuda=12.1` regardless. Avoiding it would mean
   reimplementing the installer's PyTorch step — a deviation from the official
   path, and not one to make silently.

## 13. Failure recovery

Categories: `cancelled · disk · download · health · network · setup · unsupported`,
each with a short sentence and no stack trace.

| Situation | Behaviour |
|---|---|
| No internet | `network`, nothing downloaded |
| No disk space | `disk`, blocked **before** downloading |
| UAC declined | `cancelled`, distinct wording |
| Download interrupted | temp file deleted, nothing recorded |
| Installer exits non-zero | `failed` at `run-setup`, health never attempted |
| Installer exits 0 but leaves an incomplete tree | caught by `verify-install` |
| Health never comes up | `health` → UI offers **Repair** |
| Second click during install | same promise, one run |
| App closed mid-install | state resumes; next run re-verifies from the filesystem |

## 14. Tests

**861 passed, 1 skipped, 100 files** (`vitest.node.config.ts`).

New this phase:
- `voice-runtime-bootstrap.test.ts` — 41
- `voice-runtime-install-exec.test.ts` — 5 (spawn contract)
- `alltalk-runtime-service.test.ts` — +4 (`mayAutostartRuntime`)
- `VoiceUxInvariants.test.ts` — rewritten for one-click

Three bugs were found by tests rather than by reading:

1. **The runtime manager and the bootstrapper could disagree about the install
   directory.** The manager read a configured folder with no default while the
   bootstrapper installs into `<userData>/runtimes/alltalk/app`. A finished
   install would keep reporting "not installed" and offer to reinstall.
2. **The primary button could read "Repair" while calling the install path.** An
   unused `onRepair` was the tell.
3. **"Ready" could render with no button at all** when the bootstrap and the
   runtime disagreed — a dead end. It now requires agreement and falls back to the
   install prompt, which is safe because the bootstrap is idempotent.

## 15. Mutations

| # | Mutation | Result |
|---|---|---|
| W1 | Remove the "already installed" skip | 1 failed |
| W2 | Allow two concurrent bootstraps | 2 failed |
| W3 | `shell: true` | 1 failed |
| W3b | Open stdin (`pipe` instead of `ignore`) | 1 failed |
| W4 | Concatenate the path into the command string | 12 failed |
| W5 | Ignore the installer's exit code | 1 failed * |
| W6 | Mark ready without a health check | 1 failed |
| W7 | Remove the wrong directory | 2 failed |
| W8 | Autostart during an install | 1 failed |
| W9 | Ignore a cancelled elevation | 2 failed |
| W10 | Branch-fluctuating source instead of a pinned commit | 1 failed |
| W11 | Remove the disk-space check | 2 failed |

\* **W5 initially survived, and the reason is worth recording.** The harness only
created post-setup artifacts when the installer exited 0, so `verify-install`
caught the failure and masked the missing exit-code check. A passing suite that
cannot see the bug it guards is not coverage. A case was added where the installer
reports failure *and* leaves a complete tree behind, so only reading the exit code
can catch it.

Two mutations from the brief do not apply, and inventing code to mutate would have
been worse than saying so:

- *"Reuse an incompatible Python"* — the design never touches system Python.
  Conda creates its own, so there is no reuse decision to get wrong. A test asserts
  an incompatible system Python does not block the install.
- *"Use `shell: true`"* on the bootstrapper — its `exec` dependency takes an
  argument array and has no shell option, so the type system forbids it. The
  mutation was applied one level down, where the real `spawn` call lives (W3).

## 16. Commits

```
67166d9 make autostart decline while an install is in flight
38923ac move the spawn primitives out of the Electron module
d8ea261 repair and remove in advanced settings
3287105 one-click voice install UI, replacing the manual checklist
8274238 register the bootstrap bridge and keep autostart off its path
aa57501 bootstrap IPC bridge and shared lifecycle types
4ccf004 Electron bindings for the voice-runtime bootstrapper
acd362a isolate the installer exit-code check
5b65c75 drop an unused helper from the bootstrapper tests
74768cc idempotent voice-runtime bootstrapper and environment probe
c79c69e AllTalk install audit - corrects the Phase 4 verdict
```

22 files changed, all inside the voice feature. Nothing touched in persona,
memory, Groq, auth, Home alignment, Kokoro, Colab, training, the dubladora dataset
or VRM.

## 17. Still requires QA on real Windows

None of this has executed on Windows. The sandbox has no Windows, no Electron
binary and no display. What is verified here is the decision logic, tested against
injected fakes — which is real coverage of the branches, and no coverage at all of
whether the real installer behaves as the script says it does.

In rough order of risk:

1. **`atsetup.bat -silent` on a clean Windows 10/11 machine.** The load-bearing
   assumption. Confirm it completes without prompting when stdin is closed.
2. **The six `choice /C YN` prompts.** They sit in failure branches (lines 425,
   455, 486, 519, 548, 579). Confirm a closed stdin makes them fail rather than
   hang, and that the exit code is non-zero.
3. **The CUDA download on the RX 580.** Confirm the ~10 GB PyTorch CUDA install
   completes, and decide whether the CPU-only deviation is worth taking.
4. **`repo.anaconda.com` reachability and the Miniconda URL.** Unreachable from
   this sandbox (`http=000` while `github.com` returns 200), so this is a sandbox
   TLS restriction rather than evidence the URL is dead — but it is unverified
   either way.
5. **Path handling.** `atsetup.bat` refuses a path with spaces and warns on special
   characters. `%LOCALAPPDATA%` is usually clean, but a username with a space is
   common — confirm the chosen root never contains one.
6. **Disk-space reading.** `freeBytesFor` shells out to `wmic`, which is
   deprecated on recent Windows 11. It degrades to `undefined`, which does not
   block, so the failure mode is benign — but the check may silently not happen.
7. **Resume after closing the app mid-install.** Verify a partial install is
   detected and repaired rather than mistaken for complete.
8. **Autostart on the next launch** after a successful install.
9. **Remove**, then confirm the app still runs and Git/Python/voices survive.
10. **Port 7851 already in use.** Not specifically handled this phase; it surfaces
    as a `health` failure offering Repair.
