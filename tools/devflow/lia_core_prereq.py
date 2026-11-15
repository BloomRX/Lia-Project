"""
Managed `@lia/core` build prerequisite for Lia rounds.

Why this exists
---------------
`@lia/core` declares `exports["."] = ./dist/index.mjs`. That `dist` directory
is gitignored and is produced only by the `airi` workspace postinstall. When an
install did not complete it, `src/main/lia-host.ts:16` cannot resolve the
import and every suite that transitively imports it fails collection with zero
tests - which on a real Windows run presented as eight `FAIL` files each
reporting "(0 test)", with no exception retained in the report.

The read-only preflight correctly failed closed on that, but failing closed
still left the owner to run a command by hand, which contradicts the product
contract: double-click `DevKit.bat` and let the round do the work. So the one
generated artifact the round needs is now built by the round.

Deliberately narrow. This module manages exactly one artifact, `lia-core/dist`,
with one documented command. It is not a repair tool: it does not install
dependencies, does not touch `core-agent/dist`, does not modify any tracked
product source, and it fails closed rather than guessing.

Everything it prints goes through the single bounded sanitizer at the
persistence boundary, so no raw build output can reach REPORT.txt or run.json.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Callable, Sequence

# Same bootstrap the suite itself uses: this module is invoked both as
# `python tools/devflow/lia_core_prereq.py` (from the round manifest) and as
# `devflow.lia_core_prereq` (from the tests), and relative imports only work
# in the second case.
_TOOLS = Path(__file__).resolve().parents[1]
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from devflow import preflight, processes  # noqa: E402
from devflow.report import sanitize_test_output  # noqa: E402

__all__ = [
    'BASE_REQUIREMENT_IDS',
    'BUILD_ARGV',
    'BUILD_TIMEOUT_S',
    'MARKER_PREFIX',
    'MANAGED_REQUIREMENT_ID',
    'PNPM_ENV',
    'PrereqOutcome',
    'build_argv',
    'ensure_lia_core',
    'main',
    'pnpm_invocation',
]

#: Absolute path to the pnpm executable, mirroring `LIA_DEVFLOW_GIT`. Needed
#: because on Windows `CreateProcess` only ever appends `.exe` and never
#: consults PATHEXT, so a `pnpm.cmd` shim is unreachable as a bare name.
PNPM_ENV = 'LIA_DEVFLOW_PNPM'

#: The documented build command, as argv. Never a shell string.
BUILD_ARGV: tuple[str, ...] = ('-F', '@lia/core', 'run', 'build')

#: Workspace the build runs in.
WORKSPACE_DIR = 'airi'

#: Bounded build budget. A tsdown build of one package is seconds; this leaves
#: generous headroom on a slow machine while still being far below the
#: multi-thousand-second test budgets it protects.
BUILD_TIMEOUT_S = 180.0

#: Safe marker prefix. Deliberately NOT `stage-prerequisite name=core-agent-build`:
#: that exact string is a FORBIDDEN terminal marker in the M3.0b runtime gate,
#: and a build failure here must not be misread as a runtime prerequisite
#: failure. `[lia]` is on the console sanitizer's allowlist, so these survive.
MARKER_PREFIX = '[lia] prereq-lia-core'

#: Requirements that must already exist. These are NOT managed here: installing
#: dependencies is a much larger, network-dependent action and stays manual.
BASE_REQUIREMENT_IDS = ('airi-node-modules', 'vitest-bin')

#: The one artifact this module manages.
MANAGED_REQUIREMENT_ID = 'lia-core-dist'


@dataclass(frozen=True)
class PrereqOutcome:
    """What the prerequisite actually did, and what it proved."""

    ok: bool
    #: 'present' | 'built' | 'base-missing' | 'pnpm-missing' | 'build-failed'
    #: | 'build-timeout' | 'artifact-missing'
    action: str
    detail: str
    exit_code: int


def _rel(requirement_id: str) -> str:
    for requirement in preflight.REQUIREMENTS:
        if requirement.id == requirement_id:
            return requirement.rel_path
    raise KeyError(f'requisito desconhecido: {requirement_id}')


def _present(repo_root: Path, requirement_id: str) -> bool:
    target = repo_root.joinpath(*_rel(requirement_id).split('/'))
    requirement = next(r for r in preflight.REQUIREMENTS if r.id == requirement_id)
    return (target.is_dir() if requirement.kind == 'dir' else target.is_file())


def pnpm_invocation(env: dict[str, str] | None = None) -> list[str] | None:
    """
    The argv PREFIX that reaches pnpm, or None when there is no way to.

    Resolved through `shutil.which`, which is the one lookup that DOES consult
    PATHEXT on Windows and so can return a `pnpm.cmd` shim; a bare 'pnpm' is
    not reachable from `subprocess(shell=False)` on that platform.

    Corepack is the documented fallback. A Node install very often ships
    corepack and no standalone pnpm shim - which is exactly the case in this
    sandbox - and on such a machine a prerequisite that only looks for `pnpm`
    would fail closed forever while `corepack pnpm` works fine.
    """
    source = os.environ if env is None else env
    configured = (source.get(PNPM_ENV) or '').strip()
    if configured:
        return [configured]
    found = shutil.which('pnpm')
    if found:
        return [found]
    corepack = shutil.which('corepack')
    if corepack:
        return [corepack, 'pnpm']
    return None


def build_argv(prefix: Sequence[str]) -> tuple[list[str], dict]:
    """
    argv + Popen kwargs for the build, via the audited platform seam.

    `processes.launch_argv` is the single place that decides how a command
    becomes argv, including routing a `.cmd` shim through `%COMSPEC% /d /s /c`.
    `shell=True` is never used and no string is ever interpolated into a
    command line.
    """
    return processes.launch_argv([*prefix, *BUILD_ARGV])


def ensure_lia_core(repo_root: Path,
                    *,
                    timeout_s: float = BUILD_TIMEOUT_S,
                    emit: Callable[[str], None] = print,
                    run_build: Callable[[list[str], dict, Path, float],
                                        tuple[int, str]] | None = None,
                    env: dict[str, str] | None = None) -> PrereqOutcome:
    """
    Make `@lia/core` resolvable, or fail closed explaining why it could not.

    `run_build` is injectable so the unit tests never need pnpm or a network.
    """
    # 1. Base dependencies are a hard stop. Without them nothing behind this
    #    point can work, and the expensive suites must not be started.
    missing_base = [rid for rid in BASE_REQUIREMENT_IDS
                    if not _present(repo_root, rid)]
    if missing_base:
        detail = (f'{MARKER_PREFIX} state=failed reason=base-dependencies-missing\n'
                  + '\n'.join(
                      f'dependência base ausente: {_rel(rid)} - gere com: '
                      f'{next(r for r in preflight.REQUIREMENTS if r.id == rid).produced_by}'
                      for rid in missing_base))
        emit(detail)
        return PrereqOutcome(ok=False, action='base-missing', detail=detail, exit_code=1)

    # 2. Already resolvable: do nothing. Rebuilding on every run would cost
    #    time for no evidence and would mask a stale-artifact regression.
    if _present(repo_root, MANAGED_REQUIREMENT_ID):
        detail = (f'{MARKER_PREFIX} state=skipped reason=already-present '
                  f'({_rel(MANAGED_REQUIREMENT_ID)})')
        emit(detail)
        return PrereqOutcome(ok=True, action='present', detail=detail, exit_code=0)

    # 3. Build it.
    prefix = pnpm_invocation(env)
    if not prefix:
        detail = (f'{MARKER_PREFIX} state=failed reason=pnpm-not-found\n'
                  f'pnpm não está no PATH e o corepack também não. Defina '
                  f'{PNPM_ENV} com o caminho absoluto do executável.')
        emit(detail)
        return PrereqOutcome(ok=False, action='pnpm-missing', detail=detail, exit_code=1)

    argv, popen_kwargs = build_argv(prefix)
    cwd = repo_root / WORKSPACE_DIR
    emit(f'{MARKER_PREFIX} state=starting cwd={WORKSPACE_DIR} '
         f'timeout={timeout_s:.0f}s')

    runner = run_build or _default_run_build
    try:
        code, raw = runner(argv, popen_kwargs, cwd, timeout_s)
        timed_out = False
    except subprocess.TimeoutExpired:
        code, raw, timed_out = 124, '', True

    # Sanitised HERE, at the persistence boundary - the same single bounded
    # sanitizer the rest of DevFlow uses, never a second weaker one.
    tail = sanitize_test_output('', raw) if raw else ''

    if timed_out:
        detail = (f'{MARKER_PREFIX} state=failed reason=build-timeout\n'
                  f'o build de @lia/core excedeu {timeout_s:.0f}s e foi '
                  f'encerrado. Causa NÃO diagnosticada.')
        if tail:
            detail = '\n'.join([detail, tail])
        emit(detail)
        return PrereqOutcome(ok=False, action='build-timeout', detail=detail,
                             exit_code=124)

    # 4. Exit status alone is NOT proof. A build can exit zero and still leave
    #    the expected entry point missing, which would hand the exact same
    #    eight-suite collection failure to the suites behind us.
    artifact_ok = _present(repo_root, MANAGED_REQUIREMENT_ID)
    if code != 0 or not artifact_ok:
        reason = 'build-failed' if code != 0 else 'artifact-missing'
        detail = (f'{MARKER_PREFIX} state=failed reason={reason} exit={code}\n'
                  f'artefato esperado: {_rel(MANAGED_REQUIREMENT_ID)} - '
                  f'{"presente" if artifact_ok else "AUSENTE após o build"}')
        if tail:
            detail = '\n'.join([detail, tail])
        emit(detail)
        return PrereqOutcome(ok=False, action=reason, detail=detail, exit_code=1)

    detail = (f'{MARKER_PREFIX} state=succeeded reason=build-succeeded '
              f'({_rel(MANAGED_REQUIREMENT_ID)} verificado)')
    emit(detail)
    return PrereqOutcome(ok=True, action='built', detail=detail, exit_code=0)


def _default_run_build(argv: Sequence[str], popen_kwargs: dict, cwd: Path,
                       timeout_s: float) -> tuple[int, str]:
    """The real build. argv execution only; `shell=True` is never used."""
    proc = subprocess.run(
        list(argv), cwd=cwd, capture_output=True, text=True,
        encoding='utf-8', errors='replace', timeout=timeout_s, **popen_kwargs)
    return proc.returncode, f'{proc.stdout or ""}\n{proc.stderr or ""}'


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    repo_root = Path(argv[0]) if argv else Path(
        __file__).resolve().parents[2]
    outcome = ensure_lia_core(repo_root)
    # Fail closed: the round must stop here rather than spend its test budgets
    # on suites that cannot collect a single test.
    return 0 if outcome.ok else (outcome.exit_code or 1)


if __name__ == '__main__':
    sys.exit(main())
