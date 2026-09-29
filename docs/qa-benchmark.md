# Lia Windows Benchmark Harness (Phase 8.0D-10B-4D4C4-D2B8-B)

Automated, forensically strict Windows benchmark harness that produces a
**publishable, secret-free evidence bundle** on a dedicated orphan branch.

## Entry point

```
LiaBenchmark.bat            (thin CRLF wrapper, Windows)
Tests/tools/qa-benchmark.mjs   (Node orchestrator, no prod runtime change)
```

```
LiaBenchmark.bat [--no-push] [--report-only <runId>] [--with-smoke]
```

- `--no-push`      run everything locally, do not commit/push
- `--report-only`  regenerate REPORT.md from an existing local run only
- `--with-smoke`   include the optional runtime-smoke (off by default)

Both `--report-only` and `--no-push` are **local-only** (no commit/push, no
remote verification).

`LiaBenchmark.bat` does nothing but set console code page, verify Node exists,
and delegate to `Tests/tools/qa-benchmark.mjs`. No `git reset/clean/stash`,
no `npx`, no network install, no force.

## Preflight (abort before work if any fails)

- inside a git repository (`git rev-parse --show-toplevel`)
- not detached HEAD, worktree clean (`status --porcelain`), branch != main/master
- local HEAD equals `origin/<branch>` tip (`ls-remote` authority)
- development branch name follows the project's branch policy (`git rev-parse
  --verify refs/heads/<branch>`)

## Source freeze & race gates

The orchestrator records `sourceSha` (HEAD at start) and `remoteSourceSha`
(`origin/<branch>` at start). Three race checks abort publication:

1. Before commit/push: `origin/<branch>` must still equal `sourceSha`.
2. Before push to `qa/windows-benchmarks`: QA remote head `Q` still equals
   the fetched value.
3. After publication: source worktree HEAD still equals `sourceSha`.

On any race: local raw is preserved, publication is skipped with reason
`SOURCE_REMOTE_MOVED_DURING_BENCHMARK` or `QA_REMOTE_MOVED`.

## What is executed (fixed canonical order)

Executed via **`pnpm exec`** (never `npx`, never `pnpm install`):

1. `core-agent` `pnpm exec vitest run --project @proj-airi/core-agent` (cwd `airi`)
2. `lia-core` `pnpm test` (cwd `airi/packages/lia-core`) — canonical script, not a rephrased variant
3. `browser` `pnpm exec vitest run --project browser` (cwd `airi`)
4. `lint` `pnpm lint` (cwd `airi`)
5. `typecheck` `pnpm typecheck` (cwd `airi`)
6. `build` `pnpm run build:packages` (cwd `airi`) — missing Electron is environment-limited, not a mock
7. (optional) `runtime-smoke` `node Tests/tools/kokoro-smoke.mjs <out>` only when `--with-smoke`

The set above is the **static argv allowlist**; the harness never builds a
command from user input.

Tools that are not locally present (`node_modules/.bin/<tool>` missing) are
marked `ENVIRONMENT-LIMITED` without installing.

## Logs, metrics & classification

- Raw logs: `Tests/runs/<runId>/logs/raw/*.log` (local only, never published, reviewed via `git check-ignore`)
- Publishable logs: `.devkit-qa/benchmark-publish/<runId>/benchmarks/<runId>/logs/*.log` (redacted, bounded)
- Metrics: `metrics/tests.json`, `metrics/performance.json` (duration/ram/disk),
  `metrics/hardware.json`, `metrics/brain-routing.json` (honest `available:false` until runtime export exists)
- `environment.json`, `git.json`, `summary.json`, `REPORT.md`, `SHA256SUMS.txt` at `benchmarks/<runId>/`

Classification:

- `PASS` only when **every** executed command exited 0 and there are no environment limitations
- `FAIL` when any command failed (non-zero)
- `ENVIRONMENT-LIMITED` when tool missing / browser unavailable / perf incomplete etc.

## Hardware listing (Windows CIM, Linux fallback)

On Windows (`win32`) the harness queries:

```
Get-CimInstance Win32_OperatingSystem  (Caption, Version, BuildNumber, TotalVisibleMemorySize)
Get-CimInstance Win32_Processor        (Name, NumberOfCores, NumberOfLogicalProcessors)
Get-CimInstance Win32_VideoController  (Name, AdapterRAM)
```

Fallback is `node:os` (`platform`, `arch`, `cpus`, `totalmem`). No raw device
serials, no user paths, no env values are stored in the published bundle.

## Size limits (publishable bundle)

- Per log: soft `PUBLISH_PER_LOG_MAX = 2 MiB` (head + tail with marker), hard `PUBLISH_FILE_HARD_MAX = 5 MiB`, `fs.stat` verified
- Bundle total: `PUBLISH_TOTAL_HARD_MAX = 10 MiB`
- `summary.json` records `truncation.occurred` + per-log `{originalBytes, retainedBytes}`.

## Security (canonical policy, no duplication)

Policy source is `tools/project_cli.py` (the committed `redact`/`secret_in_text`/`PRIVATE_KEY_RE`/`sensitive_path` definitions).
`Tests/tools/qa-security-bridge.py` imports that file **by path** (no import-time `git commit` — guarded `if __name__ == \"__main__\"`).
No regex is duplicated.

- Every publishable file is scanned before commit; any secret → log replaced
  with `log omitted / residual sensitive pattern detected` and the local raw is retained.
- Commit/push is blocked if the bridge is unavailable or residual is detected.
- Staged content is exactly `benchmarks/<runId>/**` plus `index.json`/`README.md`; verified via
  `git status --porcelain` and `git diff --cached --name-only`.

## Publication branch `qa/windows-benchmarks`

- **Independent of `arena/*` development history**; never merged, never greppable
  by `git log --all --grep arena/`.
- First publish: `git switch --orphan qa/windows-benchmarks`, clean worktree except `.git`,
  write `README.md` + `index.json` + `benchmarks/<runId>/`, allowlist stage, commit:
  ```
  qa(windows): benchmark <runId> <status>

  Source-SHA: <sourceSha>
  Source-Branch: arena/01a09ddb-lia-project
  ```
- Subsequent publishes: fetch `Q`, create temp worktree at `Q`, verify worktree head == `Q`,
  copy new `benchmarks/<runId>/`, prepend to `index.json`, same allowlist stage, commit, push.
- Temp worktree lives in `os.tmpdir()/lia-qa-<runId>-*`; on failure it is **preserved** for forensics.

## Deterministic build

`SHA256SUMS.txt` is built from SHA-256 of each publishable file, lexically sorted:

```
<hex>  <rel/path>
```

Verified with `sha256sum -c`.

## Local verification

```
node Tests/tools/qa-benchmark.mjs --help
node --test Tests/tools/qa-benchmark.test.mjs
node --test Tests/tools/qa-security-bridge.test.mjs
```

`--no-push` in this environment validates the full local pipeline without creating the QA branch remotely.
