# Lia QA Harness (Phase 7.9G-QA)

Reusable Windows QA harness for manual Lia product tests: isolated workspaces,
automatic log/metric collection, safe cleanup. Launch it from the repository
root:

```
LiaTests.bat
```

Requires Node.js on PATH (the same Node the product dev flow uses). The harness
never runs `pnpm install` by itself; if `airi\node_modules` is missing, install
once the normal way (`cd airi && pnpm install`).

## Menu

| # | Option | What happens |
|---|--------|--------------|
| 1 | Voice QA — existing runtime smoke | Runs the existing `tools\kokoro-smoke.mjs` against the **production** runtime home. Nothing is installed or moved. Console is captured into a timestamped run folder, and the smoke's WAV artifacts are written to `<run>\artifacts\smoke` (the runner accepts an optional output-dir argument; invoked normally, its `.devkit-qa` default is unchanged). |
| 2 | Voice QA — isolated clean install | Creates `Tests\runs\<timestamp>\`, backs up the product config, points Lia at the run's isolated runtime root, launches Lia via the supported `Lia.bat`, and leaves a restore marker. |
| 3 | Open latest test folder | Opens the newest `Tests\runs\<run>` in Explorer. |
| 4 | Restore normal Lia configuration | Reverts the single `voice.runtime.installDir` key to its saved original value and extracts the run's voice metrics. |
| 5 | Exit | — |
| 6 | Storage / cleanup | Usage, guarded run deletion, **non-destructive** legacy inventory, retention policy (dry-run default), log pruning. |

## Run folder layout

```
Tests\runs\<YYYYMMDD-HHMMSS>\
  runtime\             isolated runtime root (clean-install runs)
  logs\lia-console.log launcher + stage supervisor console (captured)
  logs\stage-console.log  derived stage lines (when separable)
  metrics\environment.txt branch/SHA/status/OS/env + effective QA runtime root
  metrics\voice-events.txt  highlighted voice/install/shutdown lines
  metrics\voice-summary.txt readable metrics ("not observed" when absent)
  artifacts\           every generated artifact of the run lives here
  artifacts\smoke\     smoke WAVs (menu 1 passes this dir to kokoro-smoke)
  snapshots\lia-product.before.json  full product-config backup (if it existed)
  snapshots\restore-instructions.txt what was saved and how it is restored
  snapshots\ACTIVE.txt               marker: this run is currently wired in
  QA-CHECKLIST.txt     what to confirm during the run
  USER-NOTES.txt       type observations directly here
  run-info.txt         id/kind/branch/SHA
```

Deleting a managed run removes its whole tree - runtime, logs, metrics,
artifacts and snapshots together (never the ACTIVE run, never anything
outside the managed roots).

## Isolation strategy (exact)

The harness uses ONLY the supported runtime-location seam:

- `voice.runtime.installDir` in the canonical `lia-product.json` is the key the
  launcher host (`effectiveRuntimeHome`) honors when set. The harness sets it to
  `<run>\runtime`; the engine-owned Kokoro installer then installs under
  `<run>\runtime\kokoro` through the engine's own layout resolver. No path
  convention is invented and no production tree is touched.
- `lia-product.json` is located with the SAME resolution order as lia-core
  (`LIA_USER_DATA` env → `APP_USER_DATA_PATH` env → first existing `%APPDATA%`
  candidate → `%APPDATA%\Lia`).
- The validated production runtime under `%LOCALAPPDATA%\Lia\runtimes` is never
  deleted, renamed, moved or overwritten by this harness.

## Backup / restore strategy (exact)

1. Before any mutation the full `lia-product.json` is copied to
   `snapshots\lia-product.before.json` (if the file existed), and the original
   `voice.runtime.installDir` value is recorded (`(absent)` when unset).
2. Only that one key is then written. No other setting is modified.
3. `snapshots\ACTIVE.txt` is written LAST — its presence means a restore is owed.
4. Restore (menu 4) reverts ONLY that key: back to the original value, or
   removed when it was absent. Settings changed during QA (voice selection,
   chat provider, etc.) are preserved. The marker is deleted afterwards.

Ctrl+C / abnormal exit is safe at every point: either nothing was changed yet,
or the backup + marker already exist and menu 4 restores from them. The
harness never deletes snapshot files.

## Log capture

Lia is launched through the supported `Lia.bat` entry point inside a visible
window; PowerShell `Tee-Object` mirrors the console into
`logs\lia-console.log`. The Stage process is supervised by the launcher and its
output is forwarded into that same console (prefixed `lia-app.stage-log`), so
`lia-console.log` is the combined supervisor log; the harness derives
`logs\stage-console.log` from those prefixed lines when present and documents
the combination otherwise.

`voice-summary.txt` reports (without fabricating anything): selected engine,
prewarm ok/fail + ms, per-synthesis generationMs/totalMs/audioDurationMs/RTF/
queueWaitMs, synthesis count, average warm RTF excluding the first synthesis
when there are at least two, install/conversar-blocked/error events, and clean
shutdown yes/no. Missing values read "not observed".

## Storage / cleanup safety

Deletion lives exclusively in the guarded helpers (`Tests\tools\qa-storage.mjs`):

- only paths strictly inside `Tests\runs`, `Tests\runtimes`, `Tests\logs` can
  ever be deleted;
- the ACTIVE run is never deleted or pruned;
- legacy/unknown artifacts are inventory-only in this phase;
- retention and log pruning default to dry-run.

The legacy inventory scans: `.devkit-qa`, `Tests\runs|runtimes|logs`,
`%LOCALAPPDATA%\Lia` (+ `\runtimes`), `%LOCALAPPDATA%\Lia-QA`,
`%APPDATA%\Lia`, `%APPDATA%\@proj-airi\stage-tamagotchi`,
`%APPDATA%\stage-tamagotchi`, `%APPDATA%\Electron`, `%TEMP%\lia*|kokoro*`, and
repo-root venv-like folders. Production locations are classified
`production-do-not-delete` regardless of size.

## Git behavior

Generated content is gitignored at the repository root:

```
Tests/runs/
Tests/runtimes/
Tests/logs/
Tests/inventory/
```

Only this README and `Tests/tools/` (the harness scripts and their tests) are
committed. Run `git check-ignore Tests/runs/x` to verify.

## Tests

```
node --test "Tests/tools/*.test.mjs"
```

covers the config backup/restore logic, run-folder lifecycle, voice log
parsing, storage guards/inventory, and a static validation of `LiaTests.bat`
plus the gitignore behavior.
