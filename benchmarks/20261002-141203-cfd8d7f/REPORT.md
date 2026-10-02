# Lia Windows Benchmark — 20261002-141203-cfd8d7f

**Status:** PASS
**Source:** cfd8d7f on arena/01a09ddb-lia-project (remote cfd8d7f)
**Started:** 2026-10-02T17:12:04.784Z
**Duration:** 665.2s

## Environment
- OS: win32 10.0.26200 x64
- Node: v26.8.1  pnpm: 11.24.0  Git: 2.52.0.windows.1  Python: 3.14.7

## Hardware
- CPU: AMD Ryzen 5 5500                                (12 logical)
- RAM: 15.9 GB
- GPU: Parsec Virtual Display Adapter, AMD Radeon RX 580 2048SP

## Validation matrix
| id | label | status | duration | exit |
|---|---|---|---|---|
| core-agent | Core Agent | passed | 3777ms | 0 |
| lia-core | Lia Core | passed | 3820ms | 0 |
| browser | Browser Stage | passed | 20051ms | 0 |
| lint | Lint | passed | 19705ms | 0 |
| typecheck | Typecheck | passed | 149805ms | 0 |
| build-packages | Build packages | passed | 5146ms | 0 |
| stage-vitest | Stage full | passed | 271418ms | 0 |
| stage-ui | Stage UI | passed | 187078ms | 0 |

## Failures
None

## Environment limitations
None

## Redaction
- Policy source: tools/project_cli.py
- Applied: true
- Residual: false

## Truncation
- Occurred: false

## Publication
- Branch: qa/windows-benchmarks
- Requested: true
- IntendedPush: true
- Reason: —

## Reproduction
`LiaBenchmark.bat --report-only 20261002-141203-cfd8d7f`
