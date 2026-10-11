"""
DevFlow: canonical path resolution and generated-artifact cleanup.

This module is the ONLY thing in DevFlow allowed to delete anything, and it
is deliberately paranoid. The rules, in the order they are enforced:

  1. the caller must name a path from the ACTIVE round's cleanup profile -
     an unknown path is refused, never "best effort";
  2. the path must be a plain relative POSIX path: no drive letter, no
     leading slash, no UNC, no `..`, no NUL;
  3. the resolved path must be strictly INSIDE the repository;
  4. no path component between the repository root and the target may be a
     symlink/reparse point, so a link cannot smuggle the deletion outside;
  5. Git must confirm the target is IGNORED - i.e. generated. A tracked path
     is refused even when it is on the allowlist.

There is deliberately no `git clean`, no `git reset --hard`, no force-push
and no wildcard recursion anywhere in DevFlow.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
import shutil
import subprocess


class PathSafetyError(RuntimeError):
    """Raised when a cleanup request is refused. Failing closed is the point."""


@dataclass(frozen=True)
class RemovalPlan:
    """Exactly what would be removed, resolved and proven - nothing more."""
    declared: str
    resolved: Path
    existed: bool
    kind: str  # 'dir' | 'file' | 'absent'
    entries: int = 0
    reason: str = ''

    def describe(self) -> list[str]:
        if not self.existed:
            return [f'{self.declared}: nada a remover (ausente)']
        return [
            f'{self.declared}: {self.kind} -> {self.resolved}',
            f'{self.declared}: {self.entries} entr(s) dentro do alvo',
        ]


@dataclass
class RemovalReport:
    plan: RemovalPlan
    removed: bool = False
    lines: list[str] = field(default_factory=list)


def repo_root(start: Path | None = None) -> Path:
    """The repository root, found by walking up for `.git`."""
    current = (start or Path(__file__).resolve()).resolve()
    for candidate in (current, *current.parents):
        if (candidate / '.git').exists():
            return candidate
    raise PathSafetyError('não encontrei a raiz do repositório (.git) acima de tools/devflow')


def _reject_unsafe_relative(relative: str) -> PurePosixPath:
    """Rule 2: a plain relative POSIX path, or nothing."""
    if not isinstance(relative, str) or not relative.strip():
        raise PathSafetyError('caminho vazio')
    if '\x00' in relative:
        raise PathSafetyError('caminho contém NUL')
    text = relative.strip()
    if '\\' in text:
        raise PathSafetyError('caminho com barra invertida não é aceito; use barras: airi/x/y')
    if text.startswith('/') or text.startswith('~'):
        raise PathSafetyError('caminho absoluto não é aceito; use relativo à raiz do repositório')
    # A Windows drive ("C:") or a UNC share ("//host/x") is absolute too.
    if len(text) >= 2 and text[1] == ':':
        raise PathSafetyError('caminho com letra de unidade não é aceito')
    parts = PurePosixPath(text).parts
    if not parts:
        raise PathSafetyError('caminho vazio')
    for part in parts:
        if part in {'', '.', '..'}:
            raise PathSafetyError('travessia de caminho não é aceita (.. ou segmento vazio)')
    return PurePosixPath(text)


def _assert_no_symlink_escape(root: Path, relative: PurePosixPath) -> None:
    """Rule 4: every component from the root down must be a real directory."""
    walk = root
    for part in relative.parts:
        walk = walk / part
        if walk.is_symlink():
            raise PathSafetyError(
                f'componente {part!r} é um link/reparse point; recuso para evitar fuga da raiz',
            )


def _assert_git_ignored(root: Path, relative: PurePosixPath) -> None:
    """Rule 5: Git must confirm the target is generated (ignored)."""
    posix = '/'.join(relative.parts)
    try:
        probe = subprocess.run(
            ['git', 'check-ignore', '--quiet', '--', posix],
            cwd=root, capture_output=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise PathSafetyError(f'não consegui provar que {posix} é gerado (git indisponível): {exc}') from exc
    # check-ignore exits 0 when ignored, 1 when not ignored, >1 on error.
    if probe.returncode != 0:
        raise PathSafetyError(
            f'{posix} NÃO é ignorado pelo Git; recuso remover algo que pode ser versionado',
        )


def plan_removal(
    root: Path,
    relative: str,
    allowlist: list[str],
) -> RemovalPlan:
    """
    Resolve and prove one cleanup target. Never deletes - see execute_removal.
    """
    wanted = _reject_unsafe_relative(relative)

    normalized_allow = {'/'.join(PurePosixPath(item).parts) for item in allowlist}
    declared = '/'.join(wanted.parts)
    if declared not in normalized_allow:
        raise PathSafetyError(
            f'{declared!r} não está no perfil de limpeza desta rodada '
            f'(permitidos: {sorted(normalized_allow) or "nenhum"})',
        )

    resolved_root = root.resolve()
    _assert_no_symlink_escape(resolved_root, wanted)

    target = resolved_root.joinpath(*wanted.parts)
    resolved = target.resolve()
    if resolved == resolved_root:
        raise PathSafetyError('o alvo resolve para a própria raiz do repositório')
    if not resolved.is_relative_to(resolved_root):
        raise PathSafetyError(f'{declared} resolve para fora do repositório: {resolved}')

    _assert_git_ignored(resolved_root, wanted)

    if not resolved.exists() and not resolved.is_symlink():
        return RemovalPlan(declared=declared, resolved=resolved, existed=False, kind='absent')
    if resolved.is_dir():
        entries = sum(1 for _ in _bounded_walk(resolved))
        return RemovalPlan(declared=declared, resolved=resolved, existed=True, kind='dir', entries=entries)
    return RemovalPlan(declared=declared, resolved=resolved, existed=True, kind='file')


def _bounded_walk(target: Path, limit: int = 20000):
    """Count entries without following links, with a sane ceiling."""
    seen = 0
    for directory, dirs, files in os.walk(target, followlinks=False):
        for name in (*dirs, *files):
            seen += 1
            if seen >= limit:
                return
            yield Path(directory) / name


def execute_removal(plan: RemovalPlan) -> RemovalReport:
    """
    Removes exactly the planned target. The plan is the authority: this never
    re-resolves a caller-supplied string, so a caller cannot widen it here.
    """
    report = RemovalReport(plan=plan, lines=list(plan.describe()))
    if not plan.existed:
        return report
    if plan.kind == 'dir':
        shutil.rmtree(plan.resolved, ignore_errors=False)
    else:
        plan.resolved.unlink()
    report.removed = True
    report.lines.append(f'{plan.declared}: removido')
    return report


def prepare_generated(root: Path, steps: list[tuple[str, list[str]]]) -> list[RemovalReport]:
    """Runs every `remove_generated` step of the active cleanup profile."""
    reports: list[RemovalReport] = []
    for relative, allowlist in steps:
        reports.append(execute_removal(plan_removal(root, relative, allowlist)))
    return reports
