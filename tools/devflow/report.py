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
from pathlib import Path
import re

from . import filesystem

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


# ---------------------------------------------------------------------------
# ONE bounded, redacted summary of a failing automated test.
#
# Every consumer of test output goes through `sanitize_test_output` - the human
# console summary, `TestResult.detail`, REPORT.txt and run.json. There is
# deliberately no second, weaker path: no raw subprocess output may reach a
# persisted artifact.
# ---------------------------------------------------------------------------

ANSI_RE = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')
MAX_DETAIL_CHARS = 1200
MAX_DETAIL_LINES = 14
_TRUNCATION = '…[truncado]'

# Enough to identify WHICH test failed and WHICH exception it raised, without
# dumping thousands of lines.
_DETAIL_PREFIXES = (
    'FAIL:', 'ERROR:', 'FAILED', 'Ran ', 'Traceback (most recent call last)',
    'AssertionError', 'AssertionError:', 'assert', 'raise ',
)
# Lines that carry a vitest/unittest failure IDENTITY. The first real Windows
# run of M3.0b lost the name of the failing test entirely: `_DETAIL_PREFIXES`
# knew about Python's `FAIL:` but not about vitest's `FAIL ` / `x` / `>` markers,
# while the loose `Error` token happily kept the source frames around it. The
# budget filled up with `91|  throw new Error(...)` and the one line that says
# WHAT failed never made it into the report - which made the failure
# undiagnosable, the worst possible outcome for a gate.
_DETAIL_PREFIXES = _DETAIL_PREFIXES + (
    'FAIL ', 'FAIL\t', '❌', '✖', '×', '❏', '❯', '›',
    'Test Files ', 'Tests  ', 'Unhandled ', 'Serialized Error',
    'Expected', 'Received', '→ ',
)

#: A vitest/vite source frame: `91|  throw new Error(...)`, or the blank
#: `   |` gutter beside it. Useful context, but never more important than the
#: line that names the failing test, so it is kept only as tail filler.
_CODE_FRAME_RE = re.compile(r'^\s*\d*\s*\|')

_DETAIL_TOKENS = ('Error', 'Exception', 'failed', 'falhou', 'Falhou')


# Conversation-shaped lines carry no diagnostic value and may carry session
# content, so they are dropped before anything is echoed or persisted. This is
# pattern-based best effort; the hard guarantee for secrets is the universal
# redactor applied by `sanitize_line`.
_CONVERSATION_RE = re.compile(
    r"(?i)^\s*(?:\[\s*)?(?:system|user|assistant|developer|human|tool)\s*(?:\]|:)\s*\S",
)
_PAYLOAD_RE = re.compile(
    r"(?i)\b(?:prompt|messages|conversation|transcript|system_message)\s*[:=]\s*\S",
)


def _is_conversation(line: str) -> bool:
    return bool(_CONVERSATION_RE.match(line) or _PAYLOAD_RE.search(line))


def _is_detail_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    # A source frame is context, not identity: `91|  throw new Error(...)`
    # matches the `Error` token and would otherwise push the test name out of
    # the budget. Demote it so it only survives as tail filler.
    if _CODE_FRAME_RE.match(line):
        return False
    if stripped.startswith(_DETAIL_PREFIXES):
        return True
    return any(token in stripped for token in _DETAIL_TOKENS)


def sanitize_test_output(
    stdout: str,
    stderr: str,
    *,
    max_chars: int = MAX_DETAIL_CHARS,
    max_lines: int = MAX_DETAIL_LINES,
) -> str:
    """
    Bounded, redacted, home-collapsed summary of a test command's output.

    unittest and vitest write their failure report to stderr, so stderr wins
    when it carries anything; stdout is the fallback, never both concatenated,
    so the useful stream is not diluted or pushed out of the budget.
    """
    stream = (stderr or '').strip() or (stdout or '').strip()
    if not stream:
        return ''
    lines = [line for line in
             (ANSI_RE.sub('', raw).rstrip() for raw in stream.splitlines())
             if line.strip() and not _is_conversation(line)]
    picked = [line for line in lines if _is_detail_line(line)]
    if len(picked) < max_lines:
        # Keep the tail as context so a bare "exit 1" is still explainable.
        extra = [line for line in lines if line not in picked]
        picked = picked + extra[-(max_lines - len(picked)):]
    out = '\n'.join(sanitize_line(line) for line in picked[:max_lines])
    if len(out) > max_chars:
        out = _TRUNCATION + out[-(max_chars - len(_TRUNCATION)):]
    return out


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
            # The allowed root comes from the REPO ARGUMENT, not from this
            # file's location, so retention behaves identically in worktrees,
            # temp repos and CI checkouts.
            filesystem.remove_tree_scoped(entry, root)
            removed.append(entry.name)
    return removed


