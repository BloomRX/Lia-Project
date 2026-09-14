# AllTalk v2 — Windows install audit (Phase 5, item B)

Audited 2026-09-14 against `erew123/alltalk_tts`, branch `alltalkbeta`,
by reading `atsetup.bat` (32,441 bytes) and the repository tree through the
GitHub API. Nothing here is from memory.

## ★ This corrects the Phase 4 conclusion

Phase 4 reported that automated install was not viable because "`atsetup.bat` is
interactive and has no documented silent mode." **That was wrong.**

`atsetup.bat` line 46:

```bat
:: Check for "-silent" install command-line argument
if "%1"=="-silent" goto InstallCustomStandalone
```

`-silent` jumps **directly** to the `:InstallCustomStandalone` label (line 343),
bypassing the interactive main menu and the "Standalone vs Text-generation-webui"
question entirely. The Phase 4 audit read the menu and stopped; it never checked
whether the script parsed arguments.

## What the silent path actually does (lines 343–830)

1. Checks `curl --version`; aborts with a message if absent. (`curl` ships with
   Windows 10 1803+, so this is satisfied on any supported machine.)
2. Refuses a path containing spaces; warns on other special characters.
3. Downloads **Miniconda** from a pinned URL:
   `https://repo.anaconda.com/miniconda/Miniconda3-py311_24.4.0-0-Windows-x86_64.exe`
4. Installs it with:
   `/InstallationType=JustMe /NoShortcuts=1 /AddToPath=0 /RegisterPython=0 /NoRegistry=1 /S /D=<dir>`
5. `conda create --prefix <env> python=3.11.9`
6. Installs PyTorch 2.2.1, Faiss (CPU), FFmpeg, Gradio, then the pinned
   requirements file.

## Dependency verdicts

| Dependency | Verdict | Evidence |
|---|---|---|
| **Git** | **NOT required** | The only `git` invocations are `git pull` inside the *update* menu options (lines 80, 119, 166, 815). The silent install path never calls git. |
| **Python (system)** | **NOT required** | Conda is downloaded and installed into the runtime folder; `python=3.11.9` is created inside it. `/AddToPath=0 /RegisterPython=0` means the user's Python is untouched. |
| **espeak-ng** | **NOT required** | Bundled in the repo at `system/espeak-ng`. |
| **FFmpeg** | **NOT required** | Bundled at `system/win_ffmpeg`, and conda installs its own. |
| **MS C++ Build Tools** | **Not referenced by the silent path** | No `msvc`, `vcredist` or Build Tools reference anywhere in `atsetup.bat`. Phase 4 took this from the wiki's general prerequisites page, not from the installer. |
| **curl** | Required, already present | Ships with Windows 10 1803+. |
| **CUDA** | Installed but **not needed on AMD/Intel** | Line 406 hardcodes `pytorch-cuda=12.1`. There is **no CPU-only branch** in the script — verified: no `--cpu`, `cpu-only` or CPU variant option exists. |

## UAC

**The install path needs no administrator rights.** Miniconda is installed with
`/InstallationType=JustMe` into a user-writable directory, with
`/NoRegistry=1 /RegisterPython=0 /AddToPath=0`. Nothing is written to
`Program Files`, `HKLM`, or the system `PATH`.

So the elevation UX in item G is not needed for this flow. It should still exist
as a path, because a future dependency may need it — but it must not be triggered
speculatively.

## Version pinning

- Branch `alltalkbeta` HEAD at audit time: `f16117e95b540e9bbbd8247b49ca6c6b1350b172`.
- Tags are all v1-era (`1.9`, `1.9c`, `1.8`, `deepspeed`, …). **There is no v2
  release tag**, so a tag cannot be used to pin v2.
- The GitHub archive endpoint for a pinned commit returns
  `HTTP 200`, `content-type: application/zip` — verified. So the source can be
  fetched by **commit SHA** without installing Git, which is both pinned and
  reproducible.

## Interactivity inside the silent path

The happy path has **no prompts**. But there are 6 `choice /C YN` calls, all in
**failure branches** (lines 425, 455, 486, 519, 548, 579): "Do you want to retry
the Pytorch installation?" and equivalents for Faiss, FFmpeg, Gradio and
DeepSpeed.

Consequence for the bootstrapper: if a step fails, the script blocks on a prompt.
Spawning it with an open stdin would hang forever. **The child must be spawned
with stdin closed/ignored**, so `choice` cannot block. This is not the
"pipe `1\n2\ny\n` into a menu" anti-pattern — it is the opposite: refuse to
participate in the interaction and let the failure surface as a non-zero exit.

## Supply chain

- **Miniconda**: pinned filename (version in the URL) over HTTPS from
  `repo.anaconda.com`. Anaconda publishes SHA256 for its installers, but the hash
  is on an HTML page rather than a sidecar file, so it cannot be fetched and
  compared mechanically without scraping. **Recorded as a limitation.**
- **AllTalk source**: `https://github.com/<owner>/<repo>/archive/<sha>.zip` —
  pinned by commit SHA over HTTPS. GitHub does **not** publish a checksum for
  archive endpoints, and the ZIP is generated on request, so its bytes are not
  guaranteed stable. **Recorded as a limitation.**
- Both downloads must go to a temp file and be moved atomically only after
  validation.

## What could NOT be verified from this environment

- `repo.anaconda.com` is **unreachable here** (`http=000`) while `github.com`
  returns 200 — so this is a sandbox TLS restriction, **not** evidence that the
  Miniconda URL is dead. The URL is taken verbatim from `atsetup.bat`.
- Whether Miniconda's published SHA256 matches, for the same reason.
- Any actual Windows behaviour: no Windows, no Electron binary, no display.

## Consequences for the design

1. Auto-install **is** implementable. Phase 5 should implement it.
2. The dependency list collapses to **one** item: `curl`, already present.
   Git, system Python, espeak-ng, FFmpeg and Build Tools are all eliminated as
   prerequisites — installing any of them would be installing something the
   runtime does not need.
3. Install with `atsetup.bat -silent`, stdin closed, bounded by a timeout.
4. On an AMD/Intel machine the script still downloads the CUDA PyTorch stack.
   There is no official CPU-only route, so either accept the download or replace
   the PyTorch step with a CPU wheel — a deviation from the official installer
   that must be declared, not hidden.
