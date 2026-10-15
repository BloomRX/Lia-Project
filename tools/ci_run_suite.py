"""
Run one repository test suite in CI and surface a bounded failure excerpt.

Why this exists
---------------
A CI failure whose only detail lives in a downloadable log archive is useless
to anyone who cannot fetch that archive. This wrapper runs the suite exactly as
declared - same interpreter, same path, same exit code propagated unchanged -
and, only when it fails, appends a bounded excerpt of the unittest failure
section to the job summary, which is readable through the ordinary repository
API.

It never changes a result. The exit code is the child's own, verbatim: a
failure stays a failure and a timeout stays a timeout. Nothing here skips,
filters or reinterprets a test.

What it publishes is bounded on purpose. Only the unittest failure block is
excerpted, capped in both lines and characters, so the summary carries the
failing assertion rather than a raw log dump.
"""

from __future__ import annotations

import os
import subprocess
import sys

#: Bounds on what may reach the job summary. A single unittest failure block is
#: a few dozen lines; these caps keep a pathological run from turning the
#: summary into a log dump.
MAX_SUMMARY_LINES = 120
MAX_SUMMARY_CHARS = 8000


def _reconfigure(stream) -> None:
    if hasattr(stream, 'reconfigure'):
        stream.reconfigure(errors='replace')


def failure_excerpt(stderr: str) -> str:
    """
    The unittest failure section, bounded.

    unittest prints one `====` banner per failure or error, then the counts.
    Everything from the first banner to the end is the part worth reading; the
    per-test progress before it is noise once something has failed.
    """
    lines = stderr.splitlines()
    start = next((i for i, line in enumerate(lines)
                  if line.startswith('=' * 20)), None)
    if start is None:
        # No recognisable banner - the process died before unittest reported.
        # The tail is then the only evidence there is.
        selected = lines[-MAX_SUMMARY_LINES:]
    else:
        selected = lines[start:start + MAX_SUMMARY_LINES]
    text = '\n'.join(selected)
    if len(text) > MAX_SUMMARY_CHARS:
        text = text[:MAX_SUMMARY_CHARS] + '\n... [resumo truncado]'
    return text


def render(suite: str, code: int, stdout: str, stderr: str) -> str:
    counts = next((line for line in stderr.splitlines()
                   if line.startswith('Ran ')), '')
    verdict = next((line for line in stderr.splitlines()
                    if line.startswith(('OK', 'FAILED'))), '')
    parts = [
        f'### DevFlow CI - `{suite}` FALHOU',
        '',
        f'- plataforma: `{os.environ.get("RUNNER_OS", "?")}`',
        f'- exit code: `{code}`',
        f'- `{counts}`' if counts else '- contagem indisponível',
        f'- `{verdict}`' if verdict else '',
        '',
        '```',
        failure_excerpt(stderr or stdout),
        '```',
        '',
    ]
    return '\n'.join(part for part in parts if part is not None)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print('uso: ci_run_suite.py <caminho/da/suite.py>', file=sys.stderr)
        return 2
    suite = argv[0]

    proc = subprocess.run([sys.executable, suite], capture_output=True,
                          text=True, encoding='utf-8', errors='replace')
    _reconfigure(sys.stdout)
    _reconfigure(sys.stderr)
    # Re-emit everything so the ordinary job log stays complete and this
    # wrapper is never the reason a line went missing.
    if proc.stdout:
        sys.stdout.write(proc.stdout)
        sys.stdout.flush()
    if proc.stderr:
        sys.stderr.write(proc.stderr)
        sys.stderr.flush()

    if proc.returncode != 0:
        summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary_path:
            with open(summary_path, 'a', encoding='utf-8') as handle:
                handle.write(render(suite, proc.returncode,
                                    proc.stdout or '', proc.stderr or ''))
    # The child's own status, unmodified.
    return proc.returncode


if __name__ == '__main__':
    sys.exit(main())
