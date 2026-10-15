"""
Run one repository test suite in CI and surface a bounded failure excerpt.

Why this exists
---------------
A CI failure whose only detail lives in a downloadable log archive is useless to
anyone who cannot fetch that archive. This wrapper runs the suite exactly as
declared - same interpreter, same path, same exit code propagated unchanged -
and, only when it fails, publishes a bounded excerpt of the unittest failure
block as a workflow annotation, which is readable through the ordinary
repository API.

It never changes a result. The exit code is the child's own, verbatim: a failure
stays a failure and a timeout stays a timeout. Nothing here skips, filters or
reinterprets a test.

Two deliberate design points, both learned from a run that produced no
diagnostic at all:

  * Output is STREAMED, not buffered. `capture_output=True` holds the whole
    suite output in memory and defers every byte until the child exits; on a
    slow runner with a verbose suite that is a large allocation whose only
    purpose is a diagnostic. A bounded ring buffer of the most recent lines
    gives the same excerpt with none of the cost.
  * The diagnostic path cannot itself fail silently. The annotation is emitted
    the moment the child returns, before anything else happens, and the whole
    body is wrapped so that an internal error in this wrapper is also reported
    rather than appearing as a bare exit code.
"""

from __future__ import annotations

from collections import deque
import os
import subprocess
import sys
import traceback

#: Lines of child output retained for the failure excerpt. The unittest failure
#: block is at the end, so a tail window is what matters.
TAIL_LINES = 400

#: Bounds on what may reach an annotation.
#:
#: Measured, not guessed: a Windows run with 10 failures produced a 4097-char
#: excerpt that stopped BEFORE the last four failure blocks, because the 120
#: line cap was hit first (the char cap was never reached). The failures that
#: still needed diagnosing were exactly the ones amputated - so the bound that
#: was meant to keep the annotation small was the thing hiding the evidence.
#: The excerpt is deliberately generous because it is then CHUNKED, not cut:
#: measured on a real Windows run, an annotation message came back truncated at
#: exactly 4096 characters regardless of what was written, so one large
#: annotation silently loses its tail - and the tail is where the last failures
#: are. These bounds only matter together with `_chunks`.
MAX_SUMMARY_LINES = 400
MAX_SUMMARY_CHARS = 24000

#: Ceiling for ONE annotation, measured on the ENCODED form: the `%25`/`%0A`
#: escaping expands the payload, and it is the emitted command that is bounded.
ANNOTATION_CHUNK_CHARS = 3800


def _reconfigure(stream) -> None:
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(errors='replace')


def _encode(text: str) -> str:
    """Percent-encode for the workflow-command format."""
    return text.replace('%', '%25').replace('\r', '').replace('\n', '%0A')


def failure_excerpt(lines: list[str]) -> str:
    """
    The unittest failure section, bounded.

    unittest prints one `====` banner per failure or error, then the counts.
    Everything from the first banner to the end is the part worth reading; the
    per-test progress before it is noise once something has failed.
    """
    start = next((i for i, line in enumerate(lines)
                  if line.startswith('=' * 20)), None)
    selected = lines[-MAX_SUMMARY_LINES:] if start is None else lines[start:]
    selected = selected[:MAX_SUMMARY_LINES]
    text = '\n'.join(selected)
    if len(text) > MAX_SUMMARY_CHARS:
        text = text[:MAX_SUMMARY_CHARS] + '\n... [resumo truncado]'
    return text


def short_failure_lines(lines: list[str], limit: int = 40) -> str:
    """
    Only the failing test identities, the counts and the first assertion.

    This is the version that has to get through: a handful of short lines, no
    traceback, nothing that could trip a length or encoding limit.
    """
    kept: list[str] = []
    for line in lines:
        stripped = line.strip()
        if (stripped.startswith(('FAIL:', 'ERROR:', 'Ran ', 'OK', 'FAILED'))
                or stripped.startswith('AssertionError')
                or stripped.startswith('[devflow-test] blocked')
                or stripped.startswith('[devflow-test] timeout')):
            kept.append(stripped[:200])
        if len(kept) >= limit:
            break
    return '\n'.join(kept) or '(nenhuma linha de falha reconhecível)'


def _chunks(message: str, ceiling: int = ANNOTATION_CHUNK_CHARS) -> list[str]:
    """
    Split on line boundaries so the encoded form of each part fits.

    Measured bound, not a guess: a real run returned a message cut at exactly
    4096 characters, in the middle of `Ran 425 tests in 21`. Cutting is what
    loses evidence, so anything over the ceiling is published as several
    annotations instead of one truncated one.
    """
    parts: list[str] = []
    current: list[str] = []
    for line in message.split('\n'):
        candidate = current + [line]
        if current and len(_encode('\n'.join(candidate))) > ceiling:
            parts.append('\n'.join(current))
            current = [line]
        else:
            current = candidate
    if current:
        parts.append('\n'.join(current))
    return parts or ['']


def suite_counts(lines: list[str]) -> str:
    """
    The unittest tally, published as its own annotation.

    A green run published nothing, and both channels that could have carried
    the numbers are unreadable from outside the runner: the job log lives on a
    blob host that is not reachable here, and `check-runs.output.summary` comes
    back empty. So "how many tests ran and how many were skipped" - the exact
    figures that prove no test was quietly dropped or newly skipped - could only
    be inferred from an earlier failing run. Publishing them on success removes
    the inference.
    """
    kept = [line.strip() for line in lines
            if line.strip().startswith(('Ran ', 'OK', 'FAILED'))]
    return '\n'.join(kept[-3:]) or '(resumo da suite nao encontrado)'


def emit_annotation(title: str, message: str, level: str = 'error') -> None:
    """
    Publish a workflow annotation, in as many parts as the ceiling requires.

    Written on its own line, because a workflow command that does not start a
    line is silently ignored - the child's output is not guaranteed to end in
    a newline, so the leading one is not decoration.
    """
    parts = _chunks(message)
    total = len(parts)
    for index, part in enumerate(parts, start=1):
        suffix = '' if total == 1 else f' [{index}/{total}]'
        sys.stdout.write(
            f'\n::{level} title={title}{suffix}::{_encode(part)}\n')
    sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print('uso: ci_run_suite.py <caminho/da/suite.py>', file=sys.stderr)
        return 2
    suite = argv[0]
    _reconfigure(sys.stdout)
    _reconfigure(sys.stderr)

    tail: deque[str] = deque(maxlen=TAIL_LINES)
    code = 1
    try:
        # stderr is merged into stdout so one stream can be both forwarded and
        # tailed; the unittest failure block survives the merge intact.
        proc = subprocess.Popen(
            [sys.executable, suite], stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding='utf-8',
            errors='replace', bufsize=1)
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            tail.append(line.rstrip('\n'))
        sys.stdout.flush()
        code = proc.wait()
    except BaseException as exc:  # noqa: BLE001 - the diagnostic must not vanish
        # Traceback AND the child output seen so far, because the exception
        # type alone did not identify the cause: an earlier run reported a bare
        # "KeyboardInterrupt:" on Windows, which says a console control event
        # reached this process but not which line received it or what the
        # suite was doing at the time.
        snapshot = list(tail)
        detail = '\n'.join([
            f'{type(exc).__name__}: {exc}',
            '--- traceback do wrapper ---',
            traceback.format_exc().strip(),
            f'--- últimas {min(len(snapshot), 25)} linhas da suíte ---',
            *snapshot[-25:],
        ])
        emit_annotation(f'{suite} - erro interno do wrapper', detail)
        raise

    if code != 0:
        snapshot = list(tail)
        # Short one first: it is the version most likely to survive.
        emit_annotation(f'{suite} exit {code}', short_failure_lines(snapshot))
        emit_annotation(f'{suite} exit {code} (detalhe)',
                        failure_excerpt(snapshot))
        summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary_path:
            with open(summary_path, 'a', encoding='utf-8') as handle:
                handle.write(f'### `{suite}` FALHOU (exit {code})\n\n```\n'
                             f'{failure_excerpt(snapshot)}\n```\n')
    else:
        emit_annotation(f'{suite} - resumo', suite_counts(list(tail)),
                        level='notice')
    # The child's own status, unmodified.
    return code


if __name__ == '__main__':
    sys.exit(main())
