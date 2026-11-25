"""Read-only checks for native Lia build artifacts and runtime dependencies."""

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


RUNTIME_ARTIFACT = Requirement(
    'lia-runtime', 'lia/runtime/dist/index.mjs', 'file',
    r'corepack pnpm --dir lia/runtime run build', 'Launcher e Stage',
)
RUNTIME_REQUIREMENTS: tuple[Requirement, ...] = (
    Requirement('lia-runtime-tsdown', 'lia/runtime/node_modules/tsdown/package.json',
                'file', 'corepack pnpm --dir lia/runtime install --frozen-lockfile --ignore-scripts',
                'build do runtime'),
    RUNTIME_ARTIFACT,
)
REQUIREMENTS: tuple[Requirement, ...] = (
    RUNTIME_ARTIFACT,
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
    parser.add_argument('--runtime-build', action='store_true', help='verifica dependências e artefato do runtime')
    args = parser.parse_args(argv)
    requirements = RUNTIME_REQUIREMENTS if args.runtime_build else REQUIREMENTS
    findings = check_workspace(args.repo_root, requirements)
    print(render_findings(findings))
    # Fail closed: exit 0 only when every required artifact is present.
    return 0 if all(f.present for f in findings) else 1


if __name__ == '__main__':
    sys.exit(main())
