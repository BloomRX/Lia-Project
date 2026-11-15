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


_SHORT_HOME: str | None = None


def _short_home() -> str:
    """
    The 8.3 short form of the home directory - Windows only, '' elsewhere.

    On a Windows runner `%TEMP%` is normally a short path
    (`C:\\Users\\RUNNER~1\\...`) while `Path.home()` is the long form, so matching
    only the long form leaves the short one - and the account name inside it -
    in the persisted text. Observed, not hypothetical: a real CI run leaked
    `C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\...` into the console.
    """
    global _SHORT_HOME
    if _SHORT_HOME is None:
        _SHORT_HOME = ''
        if os.name == 'nt':
            try:
                import ctypes
                home = str(Path.home())
                needed = ctypes.windll.kernel32.GetShortPathNameW(home, None, 0)
                if needed:
                    buf = ctypes.create_unicode_buffer(needed + 1)
                    if ctypes.windll.kernel32.GetShortPathNameW(home, buf,
                                                                needed + 1):
                        _SHORT_HOME = buf.value
            except Exception:  # noqa: BLE001 - nunca é motivo para vazar
                _SHORT_HOME = ''
    return _SHORT_HOME


def collapse_home(text: str) -> str:
    home = str(Path.home()).replace('\\', '/')
    if not home or home == '/':
        return text
    variants = {home, str(Path.home())}
    short = _short_home()
    if short:
        variants |= {short, short.replace('\\', '/')}
    for variant in variants:
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
#
# Lines are split into three priority tiers instead of one flat "is this a
# detail?" predicate, because a flat predicate cannot express "the test name
# matters more than the stack frame around it". The first real Windows run of
# M3.0b lost the failing test's identity twice over: the flat picker preferred
# source frames (loose `Error` token) over the vitest header, and the character
# budget then kept the TAIL of the joined text, deleting whatever had been
# placed first. Both are fixed by making priority explicit and by spending the
# budget in priority order.
_TIER_ROOT = 0
_TIER_IDENTITY = 1
_TIER_ASSERTION = 2
_TIER_CONTEXT = 3

#: The principal exception - the line that says WHY. `Error: Failed to resolve
#: entry for package "@lia/core"`, `TypeError: ...`, Python's `ValueError: ...`.
#: On the owner's real Windows run eight suites died at import and the report
#: kept eight `❯ file.test.ts (0 test)` headers plus eight `FAIL file.test.ts`
#: lines while the single exception explaining all of them was dropped. The
#: root cause outranks every header and every stack frame.
_ROOT_CAUSE_RE = re.compile(
    r'^\s*(?:[A-Za-z_$][\w$]*\.)*[A-Z][A-Za-z0-9_$]*(?:Error|Exception|Failure)\s*:\s*\S',
)
#: Resolution/load failures do not always carry an `Error:` prefix.
_RESOLVE_FAILURE_RE = re.compile(r'(?i)\bfailed to (?:resolve|load|fetch|import)\b')

#: Per-file evidence about a TEST FILE: `❯ src/main/x.test.ts (0 test)` and
#: `FAIL  src/main/x.test.ts [ ... ]`. Worth one line each; eight suites dying
#: at import produce sixteen near-identical lines that say only "this file
#: collected nothing", and together they buried the one exception explaining
#: all of them. Python's `FAIL: test_method (module.Class)` is deliberately NOT
#: matched - those name distinct failing tests and must never be collapsed.
_TEST_FILE_RE = r'\S+\.(?:test|spec)\.[cm]?[jt]sx?'
_FILE_HEADER_RE = re.compile(
    rf'^\s*[\u276f\u2713\u00d7\u2717]?\s*{_TEST_FILE_RE}'
    r'\s+\(\d+ tests?(?:\s*\|\s*\d+ skipped)?\)',
)
_FILE_FAIL_RE = re.compile(rf'^\s*FAIL\s+{_TEST_FILE_RE}\b')
#: How many of each survive before the rest collapse into one summary line.
_MAX_FILE_HEADERS = 2

#: Which test failed, and the suite's own verdict line.
_IDENTITY_PREFIXES = (
    'FAIL:', 'ERROR:', 'FAIL ', 'FAIL\t', 'FAILED', 'Ran ',
    '\u274c', '\u2716', '\u00d7', '\u274f', '\u276f', '\u203a',
    'Test Files ', 'Tests  ',
    # The collapse summary stands in for many omitted file lines, so it has to
    # outrank ordinary context or the budget drops exactly the line that
    # explains why so little is listed.
    '[resumo]',
    # Deliberately NOT extended to '[devflow-test]' or 'TimeoutExpired'.
    # Journal lines were briefly identity-tier and that was actively harmful:
    # on an ordinary failing run it filled the bounded detail with `pass 0..12`
    # noise and pushed out the FAIL line and the Ran/FAILED summary. The
    # timeout paths build their own body out of journal lines only, so every
    # line in it is already the same tier and a stable sort keeps the verdict
    # first without any help from here. Adding a prefix "just in case" would be
    # unproven config that only makes the next regression harder to see.
)
#: Why it failed.
_ASSERTION_PREFIXES = (
    'AssertionError', 'Expected', 'Received', 'Traceback (most recent call last)',
    'assert', 'raise ', 'Unhandled ', 'Serialized Error',
)
_ASSERTION_TOKENS = ('Error', 'Exception', 'failed', 'falhou', 'Falhou')

#: A vitest/vite source frame: `91|  throw new Error(...)`, or the blank
#: `   |` gutter beside it. Context, never identity: it matches the loose
#: `Error` token and would otherwise push the test name out of the budget.
_CODE_FRAME_RE = re.compile(r'^\s*\d*\s*\|')


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


def _classify(line: str) -> int:
    """Priority tier of one output line. Lower is more important."""
    stripped = line.strip()
    if not stripped:
        return _TIER_CONTEXT
    # A source frame is context even when it quotes an `Error`, so this check
    # comes before every heuristic that looks at the text.
    if _CODE_FRAME_RE.match(line):
        return _TIER_CONTEXT
    if _ROOT_CAUSE_RE.match(line) or _RESOLVE_FAILURE_RE.search(line):
        return _TIER_ROOT
    if stripped.startswith(_IDENTITY_PREFIXES):
        return _TIER_IDENTITY
    if stripped.startswith(_ASSERTION_PREFIXES):
        return _TIER_ASSERTION
    if any(token in stripped for token in _ASSERTION_TOKENS):
        return _TIER_ASSERTION
    return _TIER_CONTEXT


def _collapse_file_headers(lines: list[str]) -> list[str]:
    """
    Keeps the first few per-file status headers and summarises the rest.

    Eight suites failing at import produce eight near-identical headers. They
    all say the same thing - "this file collected no tests" - and together
    they consumed the budget that the one exception explaining all of them
    needed. Collapsing them is what lets the root cause fit.
    """
    replaced = list(lines)
    summary: list[str] = []

    def collapse(pattern: 're.Pattern[str]', label: str) -> None:
        matches = [line for line in replaced if pattern.match(line)]
        if len(matches) <= _MAX_FILE_HEADERS:
            return
        survivors = set(matches[:_MAX_FILE_HEADERS])
        replaced[:] = [line for line in replaced
                       if not (pattern.match(line) and line not in survivors)]
        summary.append(f'[resumo] {len(matches)} linhas {label}; '
                       f'{_MAX_FILE_HEADERS} listadas, '
                       f'{len(matches) - _MAX_FILE_HEADERS} omitidas')

    collapse(_FILE_HEADER_RE, 'de status de coleta de arquivo de teste')
    collapse(_FILE_FAIL_RE, 'FAIL de arquivo de teste')
    return [*replaced, *summary]


def _clean_lines(*streams: str) -> list[str]:
    """
    ANSI-stripped, conversation-filtered lines from EVERY stream given.

    Both stdout and stderr are inspected. Vitest can put the failing test's
    identity on stdout while a tested negative path prints unrelated
    diagnostics on stderr, so preferring one stream over the other can throw
    away the only line that says what failed. Duplicates are dropped so the
    same line printed to both streams does not spend the budget twice.
    """
    out: list[str] = []
    seen: set[str] = set()
    for stream in streams:
        for raw in (stream or '').splitlines():
            line = ANSI_RE.sub('', raw).rstrip()
            if not line.strip() or _is_conversation(line):
                continue
            if line in seen:
                continue
            seen.add(line)
            out.append(line)
    return out


def _fill(budget: int, tiers: list[list[str]]) -> tuple[list[str], bool]:
    """
    Spends a CHARACTER budget in priority order and returns the kept lines.

    Higher tiers are filled first and in full whenever they fit; whatever is
    left goes to the next tier. Truncation therefore always removes the
    LOWEST-priority content, and an identity line placed first can no longer be
    deleted by a wall of source frames behind it. The boolean reports whether
    anything had to be dropped, so the marker is only emitted when true.

    Lines arrive ALREADY SANITIZED and the budget is measured on that final
    form: `sanitize_line` clips long lines, so budgeting on the raw text would
    over-count and silently leave part of the budget unspent.
    """
    kept: list[str] = []
    used = 0
    truncated = False
    for tier in tiers:
        for line in tier:
            cost = len(line) + (1 if kept else 0)
            if used + cost > budget:
                # Not an early exit: a shorter line further down can still fit,
                # and dropping it would waste budget we already reserved.
                truncated = True
                continue
            kept.append(line)
            used += cost
    return kept, truncated


def sanitize_test_output(  # noqa: C901 - one bounded picker, deliberately
    stdout: str,
    stderr: str,
    *,
    max_chars: int = MAX_DETAIL_CHARS,
    max_lines: int = MAX_DETAIL_LINES,
) -> str:
    """
    Bounded, redacted, home-collapsed summary of a test command's output.

    Both streams are inspected and the result is assembled by priority: the
    ROOT CAUSE first (the exception type and its message), then the failing
    test's identity, then the assertion, then whatever context still fits.
    Both budgets - `max_lines` and `max_chars` - are spent in that order, so
    the explanation survives a long tail instead of being truncated away by
    it. Repeated per-file status headers are collapsed into one summary line
    before anything is ranked. Nothing raw is concatenated into the result:
    every kept line goes through `sanitize_line`, and conversation-shaped
    lines never get this far.
    """
    lines = _collapse_file_headers(_clean_lines(stdout, stderr))
    if not lines:
        return ''

    buckets: list[list[str]] = [[], [], [], []]
    for line in lines:
        buckets[_classify(line)].append(line)

    # Line budget, highest tier first; then sanitise, then spend the character
    # budget on what the lines will actually cost once persisted.
    room = max_lines
    selected: list[list[str]] = []
    for tier in buckets:
        selected.append([sanitize_line(line) for line in tier[:room]])
        room -= len(selected[-1])

    kept, truncated = _fill(max_chars, selected)
    if not kept:
        # Every candidate line was individually longer than the whole budget.
        # Keep the head of the most important one: a clipped test name still
        # beats an empty detail.
        first = next(bucket[0] for bucket in buckets if bucket)
        head = sanitize_line(first)[:max(0, max_chars - len(_TRUNCATION))]
        return head + _TRUNCATION if head else ''

    out = '\n'.join(kept)
    if truncated:
        room_left = max_chars - len(out) - len(_TRUNCATION) - 1
        if room_left > 0:
            out = f'{out}\n{_TRUNCATION}'
        else:
            out = out[:max(0, max_chars - len(_TRUNCATION))] + _TRUNCATION
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


