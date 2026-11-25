"""
Bounded workspace preflight for Lia rounds.

Why this exists
---------------
A real Windows run spent its whole 3600 s Python budget and then failed the
`lia-app` suite with eight files reporting "(0 test)". The cause was one
missing build artifact: `lia/runtime/dist/index.mjs`. Every one of
those eight files imports `@lia/core` through `src/main/lia-host.ts`, and that
package's `exports` map points only at a built file that is gitignored, so an
install whose postinstall did not complete leaves nothing to resolve.

Nothing in the round produced that artifact, so the failure could only surface
as an hour of Python followed by eight useless collection errors. Checking for
it takes milliseconds. A round that is going to fail on a missing artifact
should say so in seconds, name the artifact, and name the command that
produces it.

This module FAILS CLOSED. A missing requirement is a failure, never a warning
that lets the round continue to a misleading result.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

__all__ = [
    'REQUIREMENTS',
    'Finding',
    'Requirement',
    'check_workspace',
    'main',
    'render_findings',
]


@dataclass(frozen=True)
class Requirement:
    """One workspace artifact a declared test suite depends on."""

    id: str
    #: Path relative to the repository root, using forward slashes.
    rel_path: str
    #: 'file' or 'dir'.
    kind: str
    #: The command that produces it, for the operator.
    produced_by: str
    #: Which declared suite breaks without it.
    consumed_by: str


REQUIREMENTS: tuple[Requirement, ...] = (
    Requirement(
        id='airi-node-modules',
        rel_path='airi/node_modules',
        kind='dir',
        produced_by='pnpm install (dentro de airi/)',
        consumed_by='lia-app, stage-m30a, stage-devflow',
    ),
    Requirement(
        id='lia-core-dist',
        rel_path='lia/runtime/dist/index.mjs',
        kind='file',
        produced_by='pnpm run build:lia-core (dentro de airi/)',
        consumed_by='lia-app (via src/main/lia-host.ts, que importa @lia/core)',
    ),
    Requirement(
        id='vitest-bin',
        rel_path='airi/node_modules/vitest/vitest.mjs',
        kind='file',
        produced_by='pnpm install (dentro de airi/)',
        consumed_by='lia-app, stage-m30a, stage-devflow',
    ),
)


NATIVE_REQUIREMENTS: tuple[Requirement, ...] = (
    Requirement('lia-runtime', 'lia/runtime/dist/index.mjs', 'file',
                r'.\Lia.bat -PrepareOnly', 'Launcher e Stage'),
    Requirement('lia-launcher', 'lia/desktop/out/main/index.js', 'file',
                r'.\Lia.bat -PrepareOnly', 'Launcher'),
    Requirement('lia-stage', 'lia/stage/out/main/index.js', 'file',
                r'.\Lia.bat -PrepareOnly', 'Stage'),
    Requirement('lia-electron-windows', 'lia/stage/node_modules/electron/dist/electron.exe', 'file',
                r'.\Lia.bat -PrepareOnly', 'Launcher e Stage no Windows'),
)


@dataclass(frozen=True)
class Finding:
    requirement: Requirement
    present: bool

    @property
    def line(self) -> str:
        req = self.requirement
        if self.present:
            return f'[preflight] OK      {req.id} ({req.rel_path})'
        return (f'[preflight] AUSENTE {req.id} ({req.rel_path}) - '
                f'gerado por: {req.produced_by} - '
                f'necessário para: {req.consumed_by}')


def check_workspace(repo_root: str,
                    requirements: tuple[Requirement, ...] = REQUIREMENTS,
                    ) -> list[Finding]:
    """
    Report which required artifacts are present.

    Read-only: nothing is created, deleted or executed. Deliberately not a
    repair step - a round that silently built its own dependencies would no
    longer be testing what an operator would get.
    """
    findings: list[Finding] = []
    for requirement in requirements:
        target = os.path.join(repo_root, *requirement.rel_path.split('/'))
        present = (os.path.isdir(target) if requirement.kind == 'dir'
                   else os.path.isfile(target))
        findings.append(Finding(requirement=requirement, present=present))
    return findings


def render_findings(findings: list[Finding]) -> str:
    missing = [f for f in findings if not f.present]
    lines = [finding.line for finding in findings]
    if missing:
        names = ', '.join(f.requirement.id for f in missing)
        lines.append(f'[preflight] FALHA: {len(missing)} requisito(s) ausente(s): '
                     f'{names}. A rodada para aqui para não gastar o orçamento '
                     f'de testes em uma falha já conhecida.')
    else:
        lines.append(f'[preflight] OK: {len(findings)} requisito(s) presente(s).')
    return '\n'.join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Verifica os artefatos preparados da Lia.')
    parser.add_argument('repo_root', nargs='?', default=os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    parser.add_argument('--legacy-m30b', action='store_true', help='verifica a rodada histórica M3.0b')
    args = parser.parse_args(argv)
    requirements = REQUIREMENTS if args.legacy_m30b else NATIVE_REQUIREMENTS
    findings = check_workspace(args.repo_root, requirements)
    print(render_findings(findings))
    # Fail closed: exit 0 only when every required artifact is present.
    return 0 if all(f.present for f in findings) else 1


if __name__ == '__main__':
    sys.exit(main())
