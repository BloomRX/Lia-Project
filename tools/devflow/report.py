"""
DevFlow: sanitization and run artifacts.

Nothing written to `Tests/runs/devflow/...` may carry a credential, a vault
value, an image, a prompt or conversation content. Two layers enforce that:

  1. every stored line goes through the UNIVERSAL redactor in
     `tools/project_cli.py` (reused, not reimplemented), plus the operator's
     home directory is collapsed to `<HOME>`;
  2. only lines whose shape DevFlow recognises as launcher diagnostics are
     kept at all - anything else is counted as withheld and dropped. The
     withheld count is reported, so the omission is visible rather than
     silent.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path


RUN_ROOT_NAME = ('Tests', 'runs', 'devflow')
MAX_KEPT_LINES = 400

# Recognised launcher diagnostic shapes. Anything else is withheld.
SAFE_LINE_PREFIXES = (
    '[lia]',
    '[Lia]',
    'stage-prerequisite ',
    'spawn: ',
    'exit: ',
    'ready ',
    'event=',
    '> ',
    'VITE ',
    'lia-app.',
)

_MAX_LINE_CHARS = 400


def _load_universal_redactor():
    """Reuse the DevKit redactor instead of shipping a second, weaker one."""
    candidate = Path(__file__).resolve().parents[1] / 'project_cli.py'
    spec = importlib.util.spec_from_file_location('devflow_project_cli', candidate)
    if spec is None or spec.loader is None:
        raise RuntimeError(f'não consegui carregar o redator universal em {candidate}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.redact


REDACT = _load_universal_redactor()


def collapse_home(text: str) -> str:
    home = str(Path.home()).replace('\\', '/')
    if not home or home == '/':
        return text
    for variant in {home, str(Path.home())}:
        if variant and variant in text:
            text = text.replace(variant, '<HOME>')
    return text


def sanitize_line(line: str) -> str:
    text = line.rstrip('\r\n')
    if len(text) > _MAX_LINE_CHARS:
        text = text[:_MAX_LINE_CHARS] + '…[truncado]'
    return REDACT(collapse_home(text))


def is_keeper(line: str) -> bool:
    stripped = line.lstrip()
    return stripped.startswith(SAFE_LINE_PREFIXES)


@dataclass
class SanitizedLog:
    kept: list[str] = field(default_factory=list)
    withheld: int = 0


def sanitize_console(lines: list[str], max_kept: int = MAX_KEPT_LINES) -> SanitizedLog:
    kept: list[str] = []
    withheld = 0
    for line in lines:
        if not is_keeper(line):
            withheld += 1
            continue
        kept.append(sanitize_line(line))
        if len(kept) >= max_kept:
            withheld += 1
            break
    return SanitizedLog(kept=kept, withheld=withheld)


def run_dir(repo: Path, stamp: str, round_id: str) -> Path:
    safe_round = ''.join(char if char.isalnum() or char in '-_.' else '-' for char in round_id)
    return repo.joinpath(*RUN_ROOT_NAME, f'{stamp}-{safe_round}')


def utc_stamp(moment: datetime | None = None) -> str:
    return (moment or datetime.now(timezone.utc)).strftime('%Y%m%dT%H%M%SZ')


def write_run(
    directory: Path,
    *,
    payload: dict,
    console: SanitizedLog,
    report_text: str,
) -> dict[str, Path]:
    """Writes REPORT.txt, run.json and the sanitized console log. Bounded."""
    directory.mkdir(parents=True, exist_ok=True)
    paths = {
        'report': directory / 'REPORT.txt',
        'json': directory / 'run.json',
        'console': directory / 'console.sanitized.log',
    }
    paths['report'].write_text(report_text, encoding='utf-8')
    paths['json'].write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    paths['console'].write_text('\n'.join([*console.kept, '']) if console.kept else '', encoding='utf-8')
    return paths


def prune_runs(repo: Path, *, keep: int, max_age_days: int) -> list[str]:
    """
    Bounded retention: keep the newest `keep` runs and drop anything older
    than `max_age_days`. Only ever touches `Tests/runs/devflow`.
    """
    root = repo.joinpath(*RUN_ROOT_NAME)
    if not root.is_dir():
        return []
    entries = sorted(
        (item for item in root.iterdir() if item.is_dir()),
        key=lambda item: item.name,
        reverse=True,
    )
    removed: list[str] = []
    cutoff = datetime.now(timezone.utc).timestamp() - max_age_days * 86400
    for index, entry in enumerate(entries):
        too_many = index >= keep
        too_old = entry.stat().st_mtime < cutoff
        if too_many or too_old:
            _remove_tree(entry)
            removed.append(entry.name)
    return removed


def _remove_tree(target: Path) -> None:
    import shutil

    root = Path(__file__).resolve().parents[2].joinpath(*RUN_ROOT_NAME).resolve()
    resolved = target.resolve()
    # Belt and braces: retention must never reach outside the run root.
    if resolved == root or not resolved.is_relative_to(root):
        raise RuntimeError(f'retention recusou remover {resolved} (fora de {root})')
    if os.path.islink(resolved):
        raise RuntimeError(f'retention recusou remover o link {resolved}')
    shutil.rmtree(resolved, ignore_errors=True)
