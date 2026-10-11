#!/usr/bin/env python3
"""
Testes do DevFlow (Phase DEVFLOW-D1).

Executar:  python tools/test_lia_dev.py

Nada aqui precisa de Windows, de Electron nem de operador: git, spawn, prompt
e relógio são seams injetados. O que estes testes provam é o CONTRATO da
rodada - schema estrito, limpeza que falha fechado, gate de log ordenado, e o
fato de que um log nunca vira um PASS visual.
"""
from __future__ import annotations

import ast
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import time
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

from devflow import filesystem, processes, report, safe_paths  # noqa: E402
from devflow.report import (MAX_DETAIL_CHARS, MAX_DETAIL_LINES,  # noqa: E402
                            sanitize_test_output)
from devflow.runner import run_test_command  # noqa: E402
from devflow.markers import evaluate_markers  # noqa: E402
from devflow.report import is_keeper, sanitize_console, sanitize_line  # noqa: E402
from devflow.runner import RoundOutcome, RoundRunner, latest_run, pass_validity, render_report  # noqa: E402
from devflow.schema import (  # noqa: E402
    Round,
    RoundSchemaError,
    load_active_round,
    validate_round,
)

ACTIVE_ROUND = TOOLS / 'devflow' / 'rounds' / 'm3_0b.json'
CORE_DIST = 'airi/packages/core-agent/dist'


def _git(repo: Path, *args: str) -> str:
    probe = subprocess.run(['git', *args], cwd=repo, capture_output=True, text=True)
    return (probe.stdout or probe.stderr).strip()


def make_repo(base: Path) -> Path:
    """A throwaway repository shaped like the real one for cleanup purposes."""
    repo = base / 'repo'
    (repo / 'airi' / 'packages' / 'core-agent' / 'dist').mkdir(parents=True)
    (repo / 'airi' / 'packages' / 'core-agent' / 'src').mkdir(parents=True)
    (repo / 'airi' / 'packages' / 'core-agent' / 'dist' / 'index.mjs').write_text('export {}\n')
    (repo / 'airi' / 'packages' / 'core-agent' / 'src' / 'index.ts').write_text('export const a = 1\n')
    (repo / 'airi' / '.gitignore').write_text('dist\n')
    # Mirror the real root .gitignore: run artifacts are generated, never tracked.
    (repo / '.gitignore').write_text('Tests/runs/\n__pycache__/\n')
    (repo / 'Tests' / 'runs' / 'devflow').mkdir(parents=True)
    (repo / 'Lia.bat').write_text('@echo off\r\n')
    _git(repo, 'init', '-q', '-b', 'arena/01a10290-lia-project')
    _git(repo, 'config', 'user.email', 'devflow@test.local')
    _git(repo, 'config', 'user.name', 'DevFlow Test')
    _git(repo, 'add', '-A')
    _git(repo, 'commit', '-q', '-m', 'base')
    return repo


def base_manifest() -> dict:
    return json.loads(ACTIVE_ROUND.read_text(encoding='utf-8'))


class FakeHandle:
    def __init__(self, exit_code: int = 0, alive: bool = False, pid: int = 4242) -> None:
        self.exit_code = exit_code
        self.alive = alive
        self.pid = pid
        self.terminated = False
        self.terminate_calls = 0

    def wait(self, timeout: float) -> int | None:
        return None if self.alive else self.exit_code

    def terminate(self) -> None:
        self.terminated = True
        self.terminate_calls += 1


def fake_spawner(lines: list[str], exit_code: int = 0, alive: bool = False):
    """Emits the scripted console up front, then hands back a handle."""
    handles: list[FakeHandle] = []

    def spawn(command: list[str], cwd: Path, on_line) -> FakeHandle:
        for line in lines:
            on_line(line)
        handle = FakeHandle(exit_code, alive=alive)
        handles.append(handle)
        return handle

    spawn.handles = handles  # type: ignore[attr-defined]
    return spawn


class SteppingClock:
    """A clock that advances, so marker timeouts are reachable in tests."""

    def __init__(self, step_s: float = 1.0) -> None:
        self.calls = 0
        self.step_s = step_s

    def __call__(self):
        import datetime as _dt

        self.calls += 1
        return _dt.datetime(2026, 10, 11, 12, 0, 0) + _dt.timedelta(seconds=self.step_s * self.calls)


def fixed_git(branch: str, sha: str, calls: list[list[str]] | None = None,
              porcelain: str = ''):
    def run_git(args: list[str]) -> tuple[int, str]:
        if calls is not None:
            calls.append(list(args))
        if args[:1] == ['rev-parse'] and args[1:2] == ['--abbrev-ref']:
            return 0, branch
        if args[:1] == ['rev-parse']:
            return 0, sha
        if args[:1] == ['status']:
            return 0, porcelain
        return 0, ''
    return run_git


def runnable_manifest() -> dict:
    """Same round, but with ONE test that exists in any checkout, so the
    pass/fail/skip decision is driven by the injected invoker and not by
    whether node_modules happens to be installed."""
    data = base_manifest()
    data['tests'] = [{
        'id': 'unit', 'label': 'unitário', 'cwd': '.',
        'argv': ['python', 'tools/test_lia_dev.py'],
    }]
    return data


def skipping_manifest() -> dict:
    """A declared test whose script does not exist => status 'skipped'."""
    data = base_manifest()
    data['tests'] = [{
        'id': 'missing', 'label': 'ausente', 'cwd': '.',
        'argv': ['node', 'node_modules/definitely-not-here/vitest.mjs', 'run'],
    }]
    return data


MARKER_LINES = [
    '[lia] 2026-10-11T00:00:00.000Z lia-app.stage-log stage-prerequisite name=core-agent-build state=starting\n',
    '[lia] 2026-10-11T00:00:09.000Z lia-app.stage-log stage-prerequisite name=core-agent-build state=succeeded reason=build-succeeded\n',
    '[lia] 2026-10-11T00:00:10.000Z lia-app.stage-log spawn: node C:\\repo\\airi\\apps\\stage-tamagotchi\\node_modules\\electron-vite\\bin\\electron-vite.js dev (pid 1234)\n',
    '> ready in 512 ms\n',
]


# A disposable process tree made only of Python: the parent spawns a
# grandchild, prints its PID, then both sleep with time.sleep(). Nothing here
# depends on an external POSIX executable.
_PARENT_SCRIPT = (
    "import subprocess, sys, time\n"
    "kid = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(180)'])\n"
    "print(kid.pid, flush=True)\n"
    "time.sleep(180)\n"
)


def process_alive(pid: int | None) -> bool:
    """
    Liveness by PID using only the standard library - no kill/tasklist/PowerShell.
    """
    if not pid:
        return False
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
        if not handle:
            return False
        try:
            code = wintypes.DWORD()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True  # unreadable => assume alive, so a kill claim must prove itself
            return code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _wait_gone(pid: int, timeout_s: float = 15.0) -> bool:
    """Bounded wait, because a signal is asynchronous on POSIX."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if not process_alive(pid):
            return True
        time.sleep(0.1)
    return not process_alive(pid)


def passing_tests(argv: list[str], cwd: Path) -> tuple[int, str]:
    return 0, 'ok'


def make_runner(repo: Path, manifest: Round, *, lines=None, ask=lambda q, o: 'S',
                branch='arena/01a10290-lia-project', sha='a' * 40, git_calls=None,
                invoke_test=passing_tests, porcelain: str = '', alive: bool = False,
                clock=None):
    emitted: list[str] = []
    asks: list[str] = []

    def counting_ask(question: str, options: tuple) -> str:
        asks.append(question)
        return ask(question, options)

    runner = RoundRunner(
        round_manifest=manifest,
        repo=repo,
        run_git=fixed_git(branch, sha, git_calls, porcelain=porcelain),
        spawn=fake_spawner(list(MARKER_LINES if lines is None else lines), alive=alive),
        ask=counting_ask,
        clock=clock or (lambda: __import__('datetime').datetime(2026, 10, 11, 12, 0, 0)),
        marker_timeout_s=5.0,
        emit=emitted.append,
        invoke_test=invoke_test,
    )
    return runner, emitted, asks


# ---------------------------------------------------------------------------
class SchemaTests(unittest.TestCase):
    def test_active_round_validates_and_carries_every_required_fact(self):
        manifest = load_active_round()
        self.assertEqual(manifest.id, 'M3.0b')
        self.assertTrue(manifest.title)
        self.assertEqual(manifest.expected_branch, 'arena/01a10290-lia-project')
        self.assertEqual([step.path for step in manifest.prepare], [CORE_DIST])
        self.assertIn(CORE_DIST, manifest.cleanup.allowlisted_generated)
        self.assertTrue(manifest.tests)
        self.assertEqual(manifest.launch.kind, 'managed-launcher')
        self.assertEqual([marker.id for marker in manifest.ordered_markers],
                         ['prerequisite-starting', 'prerequisite-succeeded', 'stage-spawn'])
        self.assertEqual([item.id for item in manifest.manual_assertions], ['character-visible'])
        self.assertFalse(manifest.ready_for_publish)
        self.assertIsNone(manifest.tested_sha)

    def test_schema_version_is_enforced(self):
        data = base_manifest()
        data['schema_version'] = 99
        with self.assertRaisesRegex(RoundSchemaError, 'schema_version'):
            validate_round(data)

    def test_missing_required_key_is_an_error(self):
        for key in ('round', 'git', 'prepare', 'cleanup_profile', 'tests',
                    'launch', 'diagnostics', 'manual_assertions', 'retention'):
            data = base_manifest()
            del data[key]
            with self.assertRaisesRegex(RoundSchemaError, key):
                validate_round(data)

    def test_unknown_key_is_refused(self):
        data = base_manifest()
        data['surpresa'] = 1
        with self.assertRaisesRegex(RoundSchemaError, 'surpresa'):
            validate_round(data)

    def test_round_without_manual_assertion_is_refused(self):
        # A round whose only evidence is a log could never prove a visual pass.
        data = base_manifest()
        data['manual_assertions'] = []
        with self.assertRaisesRegex(RoundSchemaError, 'manual_assertions'):
            validate_round(data)

    def test_prepare_path_outside_cleanup_profile_is_refused(self):
        data = base_manifest()
        data['prepare'][0]['path'] = 'airi/packages/stage-ui/dist'
        with self.assertRaisesRegex(RoundSchemaError, 'allowlisted_generated'):
            validate_round(data)

    def test_unknown_prepare_kind_is_refused(self):
        data = base_manifest()
        data['prepare'][0]['kind'] = 'git_clean'
        with self.assertRaisesRegex(RoundSchemaError, 'git_clean'):
            validate_round(data)

    def test_tested_sha_must_be_a_full_sha(self):
        data = base_manifest()
        data['round']['tested_sha'] = 'abc123'
        with self.assertRaisesRegex(RoundSchemaError, 'tested_sha'):
            validate_round(data)
        data['round']['tested_sha'] = 'b' * 40
        self.assertEqual(validate_round(data).tested_sha, 'b' * 40)

    def test_ready_for_publish_must_be_boolean(self):
        data = base_manifest()
        data['round']['ready_for_publish'] = 'sim'
        with self.assertRaisesRegex(RoundSchemaError, 'ready_for_publish'):
            validate_round(data)


# ---------------------------------------------------------------------------
class CleanupSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-cleanup-'))
        self.repo = make_repo(self.base)
        self.allow = [CORE_DIST]

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_m30b_cleanup_removes_exactly_the_generated_dist(self):
        target = self.repo / CORE_DIST
        self.assertTrue(target.is_dir())
        reports = safe_paths.prepare_generated(self.repo, [(CORE_DIST, self.allow)])
        self.assertTrue(reports[0].removed)
        self.assertFalse(target.exists())
        # The sibling source tree is untouched - only the generated artifact went.
        self.assertTrue((self.repo / 'airi' / 'packages' / 'core-agent' / 'src' / 'index.ts').exists())

    def test_absent_target_is_reported_as_nothing_to_remove(self):
        shutil.rmtree(self.repo / CORE_DIST)
        plan = safe_paths.plan_removal(self.repo, CORE_DIST, self.allow)
        self.assertFalse(plan.existed)
        report = safe_paths.execute_removal(plan)
        self.assertFalse(report.removed)
        self.assertIn('nada a remover', report.lines[0])

    def test_unknown_cleanup_target_is_refused(self):
        with self.assertRaisesRegex(safe_paths.PathSafetyError, 'não está no perfil'):
            safe_paths.plan_removal(self.repo, 'airi/packages/stage-ui/dist', self.allow)

    def test_empty_allowlist_refuses_everything(self):
        with self.assertRaisesRegex(safe_paths.PathSafetyError, 'nenhum'):
            safe_paths.plan_removal(self.repo, CORE_DIST, [])

    def test_path_traversal_is_refused(self):
        for bad in ('../outside', f'{CORE_DIST}/../../..', '/etc/passwd', 'C:\\Windows', 'airi//x', 'airi/.'):
            with self.subTest(path=bad):
                with self.assertRaises(safe_paths.PathSafetyError):
                    safe_paths.plan_removal(self.repo, bad, [*self.allow, bad])

    def test_symlink_escape_is_refused(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'precious.txt').write_text('não me apague\n')
        link = self.repo / CORE_DIST
        shutil.rmtree(link)
        try:
            link.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('este sistema de arquivos não permite symlink')
        with self.assertRaisesRegex(safe_paths.PathSafetyError, 'link/junction/reparse'):
            safe_paths.plan_removal(self.repo, CORE_DIST, self.allow)
        self.assertTrue((outside / 'precious.txt').exists())

    def test_symlinked_ancestor_is_refused(self):
        outside = self.base / 'elsewhere'
        outside.mkdir()
        victim = outside / 'dist'
        victim.mkdir()
        (victim / 'index.mjs').write_text('x\n')
        airi = self.repo / 'airi'
        shutil.rmtree(airi)
        try:
            airi.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('este sistema de arquivos não permite symlink')
        with self.assertRaisesRegex(safe_paths.PathSafetyError, 'link/junction/reparse'):
            safe_paths.plan_removal(self.repo, CORE_DIST, self.allow)

    def test_tracked_path_is_refused_even_when_allowlisted(self):
        # `Lia.bat` is versioned, so Git does NOT ignore it: removing it is
        # refused even if someone puts it on the allowlist.
        with self.assertRaisesRegex(safe_paths.PathSafetyError, 'NÃO é ignorado'):
            safe_paths.plan_removal(self.repo, 'Lia.bat', ['Lia.bat'])

    def test_repo_root_itself_is_refused(self):
        with self.assertRaises(safe_paths.PathSafetyError):
            safe_paths.plan_removal(self.repo, '.', ['.'])


# ---------------------------------------------------------------------------
class MarkerGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.ordered = validate_round(base_manifest()).ordered_markers

    def test_markers_in_order_pass(self):
        report = evaluate_markers(MARKER_LINES, self.ordered)
        self.assertTrue(report.ok)
        self.assertEqual([name for name, _ in report.matched],
                         ['prerequisite-starting', 'prerequisite-succeeded', 'stage-spawn'])

    def test_missing_marker_fails(self):
        lines = [MARKER_LINES[0], MARKER_LINES[2]]
        report = evaluate_markers(lines, self.ordered)
        self.assertFalse(report.ok)
        self.assertEqual(report.missing, 'prerequisite-succeeded')

    def test_out_of_order_marker_fails(self):
        # Spawn BEFORE the prerequisite succeeded is exactly the M3.0a bug:
        # the renderer would be served against a stale artifact.
        lines = [MARKER_LINES[2], MARKER_LINES[0], MARKER_LINES[1]]
        report = evaluate_markers(lines, self.ordered)
        self.assertFalse(report.ok)

    def test_reason_must_match_too(self):
        lines = [
            MARKER_LINES[0],
            'stage-prerequisite name=core-agent-build state=succeeded reason=build-succeeded\n',
            MARKER_LINES[2],
        ]
        self.assertTrue(evaluate_markers(lines, self.ordered).ok)
        wrong_reason = [
            MARKER_LINES[0],
            'stage-prerequisite name=core-agent-build state=succeeded reason=no-source-workspace\n',
            MARKER_LINES[2],
        ]
        self.assertFalse(evaluate_markers(wrong_reason, self.ordered).ok)

    def test_optional_marker_never_gates(self):
        report = evaluate_markers(MARKER_LINES, self.ordered, validate_round(base_manifest()).optional_markers)
        self.assertTrue(report.ok)
        self.assertIn('stage-ready', [name for name, _ in report.matched])


# ---------------------------------------------------------------------------
class RoundExecutionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-run-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(runnable_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_full_round_passes_and_writes_artifacts_tied_to_the_sha(self):
        sha = 'c' * 40
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, sha=sha)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'PASS')
        self.assertTrue(outcome.markers.ok)
        payload = json.loads(Path(outcome.artifacts['json']).read_text(encoding='utf-8'))
        self.assertEqual(payload['git']['head_sha'], sha)
        self.assertEqual(payload['git']['branch'], 'arena/01a10290-lia-project')
        self.assertEqual(payload['manual_assertions'], {'character-visible': 'S'})
        report = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        self.assertIn(sha, report)
        self.assertIn('PASS', report)
        # The generated dist really was rebuilt from scratch by the prepare step.
        self.assertFalse((self.repo / CORE_DIST).exists())

    def test_wrong_branch_is_refused_before_anything_runs(self):
        runner, emitted, _asks = make_runner(self.repo, self.manifest, branch='main')
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'REFUSED')
        self.assertIsNone(outcome.markers)
        # Nothing was cleaned: the generated artifact is still there.
        self.assertTrue((self.repo / CORE_DIST).exists())
        self.assertTrue(any('RECUSADO' in line for line in emitted))

    def test_missing_marker_fails_the_round(self):
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, lines=[MARKER_LINES[0]])
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertFalse(outcome.markers.ok)

    def test_out_of_order_marker_fails_the_round(self):
        runner, _emitted, _asks = make_runner(self.repo, self.manifest,
                                lines=[MARKER_LINES[2], MARKER_LINES[0], MARKER_LINES[1]])
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')

    def test_visual_pass_is_never_inferred_from_logs(self):
        # Every marker matched, the operator said NO: that is NOT PASS.
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, ask=lambda q, o: 'N')
        outcome = runner.execute()
        self.assertTrue(outcome.markers.ok)
        self.assertEqual(outcome.verdict, 'NOT_PASS')

    def test_unanswered_visual_assertion_is_not_a_pass(self):
        # EOF / empty answer must never be read as agreement.
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, ask=lambda q, o: '')
        self.assertEqual(runner.execute().verdict, 'NOT_PASS')

    def test_unknown_visual_answer_is_not_a_pass(self):
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, ask=lambda q, o: 'talvez')
        self.assertEqual(runner.execute().verdict, 'NOT_PASS')

    def test_interrupted_run_stays_honest(self):
        def boom(question, options):
            raise KeyboardInterrupt

        runner, _emitted, _asks = make_runner(self.repo, self.manifest, ask=boom)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'INTERRUPTED')
        # Artifacts still exist, so the interruption is on the record.
        payload = json.loads(Path(outcome.artifacts['json']).read_text(encoding='utf-8'))
        self.assertEqual(payload['verdict'], 'INTERRUPTED')
        self.assertTrue(any('Ctrl+C' in note for note in payload['notes']))

    def test_round_command_never_mutates_git(self):
        calls: list[list[str]] = []
        before = _git(self.repo, 'status', '--porcelain')
        head_before = _git(self.repo, 'rev-parse', 'HEAD')
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, git_calls=calls)
        runner.execute()
        # 1) only read-only verbs were ever issued
        allowed = {'rev-parse', 'status', 'check-ignore'}
        for argv in calls:
            self.assertIn(argv[0], allowed, f'chamada Git inesperada: {argv}')
        # 2) no commit, no index change, no HEAD movement. Run artifacts are
        # gitignored by design, so they are not a mutation.
        self.assertEqual(_git(self.repo, 'rev-parse', 'HEAD'), head_before)
        self.assertEqual(_git(self.repo, 'status', '--porcelain'), before)
        self.assertEqual(_git(self.repo, 'status', '--porcelain', '--untracked-files=no'), '')
        self.assertEqual(_git(self.repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
                         'arena/01a10290-lia-project')

    def test_report_is_sanitized(self):
        secret = 'gh' + 'p_' + 'z' * 36
        lines = [
            f'[lia] token {secret} nao deveria aparecer\n',
            *MARKER_LINES,
        ]
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, lines=lines)
        outcome = runner.execute()
        console = Path(outcome.artifacts['console']).read_text(encoding='utf-8')
        report = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        self.assertNotIn(secret, console)
        self.assertNotIn(secret, report)
        self.assertIn('[CREDENCIAL-OCULTA]', console)

    def test_unrelated_console_lines_are_withheld(self):
        lines = [
            'usuario escreveu: ola lia, meu segredo e 1234\n',
            *MARKER_LINES,
        ]
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, lines=lines)
        outcome = runner.execute()
        console = Path(outcome.artifacts['console']).read_text(encoding='utf-8')
        self.assertNotIn('meu segredo', console)
        self.assertGreaterEqual(outcome.console_withheld, 1)

    def test_run_json_records_every_section(self):
        runner, _emitted, _asks = make_runner(self.repo, self.manifest)
        outcome = runner.execute()
        payload = json.loads(Path(outcome.artifacts['json']).read_text(encoding='utf-8'))
        for key in ('schema_version', 'round', 'git', 'verdict', 'cleanup', 'tests',
                    'markers', 'manual_assertions', 'notes', 'console', 'finished_at'):
            self.assertIn(key, payload)


# ---------------------------------------------------------------------------
class ValidityTests(unittest.TestCase):
    def test_head_change_invalidates_a_prior_pass(self):
        self.assertEqual(pass_validity('a' * 40, 'a' * 40), 'current')
        self.assertEqual(pass_validity('a' * 40, 'b' * 40), 'stale')
        self.assertEqual(pass_validity('', 'b' * 40), 'unknown')

    def test_latest_run_reads_back_the_newest_artifact(self):
        base = Path(tempfile.mkdtemp(prefix='devflow-latest-'))
        try:
            repo = base / 'repo'
            (repo / 'Tests' / 'runs' / 'devflow' / '20260101T000000Z-M3.0b').mkdir(parents=True)
            (repo / 'Tests' / 'runs' / 'devflow' / '20260101T000000Z-M3.0b' / 'run.json').write_text(
                json.dumps({'verdict': 'FAIL', 'git': {'head_sha': 'a' * 40}}), encoding='utf-8')
            (repo / 'Tests' / 'runs' / 'devflow' / '20260201T000000Z-M3.0b').mkdir(parents=True)
            (repo / 'Tests' / 'runs' / 'devflow' / '20260201T000000Z-M3.0b' / 'run.json').write_text(
                json.dumps({'verdict': 'PASS', 'git': {'head_sha': 'b' * 40}}), encoding='utf-8')
            latest = latest_run(repo)
            self.assertEqual(latest['verdict'], 'PASS')
            self.assertEqual(pass_validity(latest['git']['head_sha'], 'c' * 40), 'stale')
        finally:
            shutil.rmtree(base, ignore_errors=True)


# ---------------------------------------------------------------------------
class SanitizationTests(unittest.TestCase):
    def test_secret_is_redacted(self):
        secret = 'gh' + 'p_' + 'q' * 36
        self.assertNotIn(secret, sanitize_line(f'token={secret}'))

    def test_home_path_is_collapsed(self):
        home = str(Path.home())
        self.assertIn('<HOME>', sanitize_line(f'spawn: node {home}/repo/electron-vite.js dev'))

    def test_only_launcher_shapes_are_kept(self):
        self.assertTrue(is_keeper('[lia] something'))
        self.assertTrue(is_keeper('spawn: node x'))
        self.assertFalse(is_keeper('usuario: conversa privada'))

    def test_console_is_bounded(self):
        result = sanitize_console(['[lia] linha\n'] * 1000, max_kept=10)
        self.assertEqual(len(result.kept), 10)
        self.assertGreater(result.withheld, 0)

    def test_report_render_is_deterministic(self):
        outcome = RoundOutcome(round_id='M3.0b', verdict='PASS', head_sha='d' * 40)
        text = render_report({'schema_version': 1,
                              'round': {'id': 'M3.0b', 'title': 't', 'phase': 'p',
                                        'ready_for_publish': False},
                              'git': {'branch': 'b', 'head_sha': outcome.head_sha,
                                      'uncommitted_changes': 0},
                              'verdict': 'PASS', 'cleanup': [], 'tests': [],
                              'markers': {'ok': True, 'matched': [], 'missing': None,
                                          'optional_seen': []},
                              'manual_assertions': {}, 'notes': [],
                              'console': {'kept_lines': 0, 'withheld_lines': 0},
                              'finished_at': 'x'})
        self.assertIn('d' * 40, text)


# ---------------------------------------------------------------------------
class InventoryTests(unittest.TestCase):
    """D1 inventories the historical scripts; it must not delete them."""

    def test_inventory_exists_and_classifies_every_listed_script(self):
        inventory = json.loads(
            (TOOLS / 'devflow' / 'script-inventory.json').read_text(encoding='utf-8'))
        allowed = {'KEEP', 'INTERNAL', 'CANDIDATE-MERGE', 'CANDIDATE-DELETE'}
        self.assertTrue(inventory['entries'])
        for entry in inventory['entries']:
            self.assertIn(entry['classification'], allowed, entry['path'])
            self.assertTrue(entry['reason'], entry['path'])
        # Every script the D1 brief named must be classified.
        named = {'DevKit.bat', 'Lia.bat', 'LiaTests.bat', 'LiaBenchmark.bat',
                 'airi/DevKit.bat', 'airi/QA.bat', 'airi/QA-Miniconda.bat',
                 'airi/DevTamagotchi.bat'}
        listed = {entry['path'] for entry in inventory['entries']}
        self.assertTrue(named.issubset(listed), sorted(named - listed))

    def test_d1_deleted_nothing(self):
        repo = TOOLS.parent
        for relative in ('DevKit.bat', 'Lia.bat', 'LiaTests.bat', 'LiaBenchmark.bat',
                         'airi/DevKit.bat', 'airi/QA.bat', 'airi/QA-Miniconda.bat',
                         'airi/DevTamagotchi.bat'):
            self.assertTrue((repo / relative).exists(), f'{relative} sumiu no D1')


# ---------------------------------------------------------------------------
class DevKitBatTests(unittest.TestCase):
    """DevKit.bat must stay a thin dispatcher and keep the universal path."""

    def test_bat_is_thin_and_routes_to_lia_dev(self):
        text = (TOOLS.parent / 'DevKit.bat').read_text(encoding='utf-8', errors='replace')
        self.assertIn('lia_dev.py', text)
        self.assertIn('project_cli.py', text)
        # No orchestration logic in batch syntax.
        self.assertNotIn('git clean', text.lower())
        self.assertNotIn('reset --hard', text.lower())
        self.assertLess(len(text.splitlines()), 90)

    def test_menu_offers_the_required_actions(self):
        source = (TOOLS / 'lia_dev.py').read_text(encoding='utf-8')
        for label in ('Executar rodada atual', 'Abrir Lia normalmente',
                      'Mostrar rodada / estado atual', 'Diagnóstico do ambiente', 'Sair'):
            self.assertIn(label, source)
        # Git consolidation is visibly marked as future work, not silently absent.
        self.assertIn('D2', source)

# ---------------------------------------------------------------------------
class RequiredTestsTests(unittest.TestCase):
    """D1.1 defect 1: a skipped test used to be invisible to the verdict."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-req-'))
        self.repo = make_repo(self.base)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_all_tests_passing_lets_the_launch_happen(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, asks = make_runner(
            self.repo, validate_round(runnable_manifest()), invoke_test=lambda a, c: (0, 'ok'))
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'PASS')
        self.assertEqual([t.status for t in outcome.tests], ['pass'])
        self.assertEqual(len(spawner.handles), 1)
        self.assertEqual(len(asks), 1)

    def test_one_skipped_test_prevents_pass_and_prevents_launch(self):
        spawner = fake_spawner(list(MARKER_LINES))
        data = runnable_manifest()
        # A declared test whose script is absent is SKIPPED, which is the case
        # that used to be invisible to the verdict.
        data['tests'].append({'id': 'unavailable', 'label': 'indisponível', 'cwd': '.',
                              'argv': ['node', 'node_modules/not-here/vitest.mjs', 'run']})
        runner, _, asks = make_runner(self.repo, validate_round(data), invoke_test=passing_tests)
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'REFUSED')
        self.assertEqual(len(spawner.handles), 0, 'o gate do Windows não pode ser lançado')
        self.assertEqual(len(asks), 0)

    def test_all_skipped_tests_prevent_pass_and_prevent_launch(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, emitted, asks = make_runner(
            self.repo, validate_round(skipping_manifest()), invoke_test=lambda a, c: (0, 'ok'))
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'REFUSED')
        self.assertEqual([t.status for t in outcome.tests], ['skipped'])
        self.assertEqual(len(spawner.handles), 0)
        self.assertEqual(len(asks), 0)
        self.assertTrue(any('PULADO' in line for line in emitted))

    def test_failed_test_prevents_launch(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, asks = make_runner(
            self.repo, validate_round(runnable_manifest()), invoke_test=lambda a, c: (1, 'falhou'))
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual([t.status for t in outcome.tests], ['fail'])
        self.assertEqual(len(spawner.handles), 0)
        self.assertEqual(len(asks), 0)

    def test_pass_cannot_be_reached_with_zero_executed_tests(self):
        data = runnable_manifest()
        data['tests'] = []
        # Schema requires nothing here, so prove the runner itself refuses to
        # call an unguarded launch a PASS.
        runner, _, _asks = make_runner(self.repo, validate_round(data))
        outcome = runner.execute()
        self.assertNotEqual(outcome.verdict, 'PASS')


# ---------------------------------------------------------------------------
class CleanWorktreeTests(unittest.TestCase):
    """D1.1 defect 2: a PASS must describe an exact checkout."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-clean-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(runnable_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_dirty_tracked_file_is_refused_before_cleanup(self):
        (self.repo / 'Lia.bat').write_text('@echo off\r\nrem editado\r\n')
        porcelain = _git(self.repo, 'status', '--porcelain')
        self.assertTrue(porcelain, 'a fixture precisa estar realmente suja')
        spawner = fake_spawner(list(MARKER_LINES))
        runner, emitted, asks = make_runner(self.repo, self.manifest, porcelain=porcelain)
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'REFUSED')
        self.assertTrue((self.repo / CORE_DIST).exists(), 'nada pode ser limpo antes do gate')
        self.assertEqual(len(spawner.handles), 0)
        self.assertEqual(len(asks), 0)
        self.assertTrue(any('não commitada' in line for line in emitted))

    def test_untracked_non_ignored_file_is_refused(self):
        (self.repo / 'notas-soltas.txt').write_text('rascunho\n')
        porcelain = _git(self.repo, 'status', '--porcelain')
        self.assertIn('notas-soltas.txt', porcelain)
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, asks = make_runner(self.repo, self.manifest, porcelain=porcelain)
        runner.spawn = spawner
        self.assertEqual(runner.execute().verdict, 'REFUSED')
        self.assertEqual(len(spawner.handles), 0)
        self.assertEqual(len(asks), 0)

    def test_ignored_run_artifacts_do_not_block(self):
        run = self.repo / 'Tests' / 'runs' / 'devflow' / '20260101T000000Z-M3.0b'
        run.mkdir(parents=True)
        (run / 'REPORT.txt').write_text('x\n')
        self.assertEqual(_git(self.repo, 'status', '--porcelain'), '')
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, _ = make_runner(self.repo, self.manifest)
        runner.spawn = spawner
        self.assertEqual(runner.execute().verdict, 'PASS')

    def test_ignored_generated_dist_does_not_block(self):
        # dist exists and is gitignored: porcelain must stay clean.
        self.assertTrue((self.repo / CORE_DIST / 'index.mjs').exists())
        self.assertEqual(_git(self.repo, 'status', '--porcelain'), '')
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, _ = make_runner(self.repo, self.manifest)
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'PASS')
        self.assertFalse((self.repo / CORE_DIST).exists())

    def test_reported_pass_records_dirty_zero(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, _ = make_runner(self.repo, self.manifest)
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'PASS')
        payload = json.loads(Path(outcome.artifacts['json']).read_text(encoding='utf-8'))
        self.assertEqual(payload['git']['uncommitted_changes'], 0)
        self.assertTrue(payload['git']['worktree_clean'])

    def test_filenames_are_not_printed_when_refusing(self):
        (self.repo / 'segredo-local.txt').write_text('x\n')
        porcelain = _git(self.repo, 'status', '--porcelain')
        spawner = fake_spawner(list(MARKER_LINES))
        runner, emitted, _ = make_runner(self.repo, self.manifest, porcelain=porcelain)
        runner.spawn = spawner
        runner.execute()
        self.assertFalse(any('segredo-local.txt' in line for line in emitted))


# ---------------------------------------------------------------------------
class ManualOrderingTests(unittest.TestCase):
    """D1.1 defect 4: the human question comes only after the automatic gate."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-order-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(runnable_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_all_markers_asks_exactly_once(self):
        runner, _, asks = make_runner(self.repo, self.manifest)
        outcome = runner.execute()
        self.assertEqual(len(asks), 1)
        self.assertEqual(asks[0], 'A personagem apareceu normalmente?')
        self.assertEqual(outcome.verdict, 'PASS')

    def test_marker_failure_asks_nothing(self):
        spawner = fake_spawner([MARKER_LINES[0]])
        runner, _, asks = make_runner(self.repo, self.manifest, lines=[MARKER_LINES[0]])
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(len(asks), 0)
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertTrue(spawner.handles[0].terminated)

    def test_out_of_order_markers_ask_nothing(self):
        runner, _, asks = make_runner(
            self.repo, self.manifest,
            lines=[MARKER_LINES[2], MARKER_LINES[0], MARKER_LINES[1]])
        outcome = runner.execute()
        self.assertEqual(len(asks), 0)
        self.assertEqual(outcome.verdict, 'FAIL')

    def test_timeout_asks_nothing_and_still_cleans_up(self):
        spawner = fake_spawner([], alive=True)
        runner, _, asks = make_runner(
            self.repo, self.manifest, lines=[], alive=True,
            clock=SteppingClock(step_s=3.0))
        runner.marker_timeout_s = 1.0
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(len(asks), 0)
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual(spawner.handles[0].terminate_calls, 1)

    def test_process_exit_before_markers_asks_nothing(self):
        spawner = fake_spawner([], exit_code=3)
        runner, _, asks = make_runner(self.repo, self.manifest, lines=[])
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(len(asks), 0)
        self.assertEqual(outcome.verdict, 'FAIL')


# ---------------------------------------------------------------------------
class ReparseSafetyTests(unittest.TestCase):
    """D1.1 defect 3: symlinks are not the same thing as Windows reparse points."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-reparse-'))
        self.repo = make_repo(self.base)

    def tearDown(self) -> None:
        # On Windows with Python < 3.12, `shutil.rmtree` does not recognise a
        # junction as a link and would descend into it. Detach every reparse
        # point first, using the same authority the production code uses.
        for entry in sorted(self.base.rglob('*'), key=lambda item: len(item.parts), reverse=True):
            try:
                if filesystem.is_redirection(entry) and not entry.is_symlink():
                    entry.rmdir()
            except OSError:
                pass
        shutil.rmtree(self.base, ignore_errors=True)

    def test_fixture_repo_is_a_temporary_directory_and_never_the_real_repo(self):
        """The junction test must not be able to touch a real checkout."""
        real_root = SUITE_PATH.parents[1]
        self.assertTrue(self.repo.is_relative_to(self.base))
        self.assertNotEqual(self.repo.resolve(), real_root.resolve())
        self.assertIn(tempfile.gettempdir(), str(self.base.resolve()))

    def test_attribute_table_matches_win32_semantics(self):
        R = filesystem.FILE_ATTRIBUTE_REPARSE_POINT
        self.assertTrue(filesystem.reparse_from_attributes(R, 0))
        self.assertTrue(filesystem.reparse_from_attributes(0x410, 0))   # dir + reparse
        self.assertFalse(filesystem.reparse_from_attributes(0x10, 0))   # plain dir
        self.assertFalse(filesystem.reparse_from_attributes(0x20, 0))   # archive
        # INVALID + FILE_NOT_FOUND / PATH_NOT_FOUND => nothing there
        self.assertFalse(filesystem.reparse_from_attributes(0xFFFFFFFF, 2))
        self.assertFalse(filesystem.reparse_from_attributes(0xFFFFFFFF, 3))
        # INVALID for any other reason => fail closed
        self.assertTrue(filesystem.reparse_from_attributes(0xFFFFFFFF, 5))
        self.assertTrue(filesystem.reparse_from_attributes(0xFFFFFFFF, 0))

    def test_plain_directory_is_allowed(self):
        plan = safe_paths.plan_removal(self.repo, CORE_DIST, [CORE_DIST])
        self.assertTrue(plan.existed)

    def test_windows_reparse_attribute_is_honoured_on_any_platform(self):
        # Simulates a Windows junction: POSIX says "not a symlink", the Win32
        # attribute probe says "reparse point". The helper must refuse.
        target = self.repo / CORE_DIST
        with patch.object(filesystem.os, 'name', 'nt'), \
                patch.object(filesystem, '_windows_reparse', lambda path: True):
            with self.assertRaisesRegex(filesystem.RedirectionError, 'junction/reparse'):
                filesystem.assert_no_redirection(self.repo, PurePosixPath(CORE_DIST).parts)
        # And the round cleanup refuses through the same shared helper.
        with patch.object(filesystem.os, 'name', 'nt'), \
                patch.object(filesystem, '_windows_reparse', lambda path: True):
            with self.assertRaises(safe_paths.PathSafetyError):
                safe_paths.plan_removal(self.repo, CORE_DIST, [CORE_DIST])
        self.assertTrue(target.exists(), 'nada pode ter sido removido')

    def test_windows_probe_failure_fails_closed(self):
        def explode(path):
            raise OSError('probe indisponível')

        with patch.object(filesystem, '_probe_attributes', explode):
            self.assertTrue(filesystem._windows_reparse(self.repo / CORE_DIST))
        with patch.object(filesystem.os, 'name', 'nt'), \
                patch.object(filesystem, '_probe_attributes', explode):
            self.assertTrue(filesystem.is_redirection(self.repo / CORE_DIST))

    def test_posix_symlink_target_refused(self):
        outside = self.base / 'outside'
        outside.mkdir()
        (outside / 'precious.txt').write_text('não apague\n')
        link = self.repo / CORE_DIST
        shutil.rmtree(link)
        try:
            link.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('filesystem sem symlink')
        with self.assertRaises(safe_paths.PathSafetyError):
            safe_paths.plan_removal(self.repo, CORE_DIST, [CORE_DIST])
        self.assertTrue((outside / 'precious.txt').exists())

    def test_symlink_ancestor_refused(self):
        outside = self.base / 'elsewhere'
        (outside / 'dist').mkdir(parents=True)
        (outside / 'dist' / 'index.mjs').write_text('x\n')
        airi = self.repo / 'airi'
        shutil.rmtree(airi)
        try:
            airi.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('filesystem sem symlink')
        with self.assertRaises(safe_paths.PathSafetyError):
            safe_paths.plan_removal(self.repo, CORE_DIST, [CORE_DIST])

    def test_real_windows_junction(self):
        if os.name != 'nt':
            self.skipTest(
                'GATE WINDOWS PENDENTE: junction real só pode ser provada no Windows; '
                'a lógica está coberta pelo teste de atributo acima')
        import subprocess as _sp

        real_root = SUITE_PATH.parents[1]
        outside = self.base / 'junction-target'          # temporary target only
        outside.mkdir()
        (outside / 'nao-apague.txt').write_text('fixture\n', encoding='utf-8')
        link = self.repo / CORE_DIST                     # temporary repo only
        self.assertTrue(link.is_relative_to(self.base))
        self.assertNotEqual(self.repo.resolve(), real_root.resolve())
        shutil.rmtree(link)
        probe = _sp.run(['cmd', '/c', 'mklink', '/J', str(link), str(outside)],
                        capture_output=True, text=True)
        if probe.returncode != 0:
            # An inability to CREATE a junction is never a pass.
            self.skipTest(f'mklink indisponível: {probe.stderr.strip()}')
        try:
            with self.assertRaises(safe_paths.PathSafetyError):
                safe_paths.plan_removal(self.repo, CORE_DIST, [CORE_DIST])
        finally:
            # Detach the junction itself, never the tree it points at.
            try:
                link.rmdir()
            except OSError:
                pass
        self.assertTrue((outside / 'nao-apague.txt').exists(),
                        'a limpeza do teste alcançou o alvo da junction')


# ---------------------------------------------------------------------------
class OwnedProcessTests(unittest.TestCase):
    """D1.1 defect 5: teardown must reach the tree, not just the wrapper."""

    def setUp(self) -> None:
        self._bystanders: list[subprocess.Popen] = []

    def tearDown(self) -> None:
        for proc in self._bystanders:
            try:
                proc.kill()
                proc.wait(timeout=10)
            except (OSError, subprocess.SubprocessError):
                pass


    def test_launch_argv_runs_a_bat_through_comspec_on_windows(self):
        with patch.object(processes.os, 'name', 'nt'), \
                patch.dict(processes.os.environ, {'COMSPEC': r'C:\Windows\system32\cmd.exe'}):
            argv, extra = processes.launch_argv(['Lia.bat'])
        self.assertEqual(argv, [r'C:\Windows\system32\cmd.exe', '/d', '/s', '/c', 'Lia.bat'])
        self.assertEqual(extra, {})

    def test_launch_argv_falls_back_to_cmd_exe_without_comspec(self):
        env = {k: v for k, v in processes.os.environ.items() if k != 'COMSPEC'}
        with patch.object(processes.os, 'name', 'nt'), patch.dict(processes.os.environ, env, clear=True):
            argv, _ = processes.launch_argv(['Lia.bat'])
        self.assertEqual(argv[:4], ['cmd.exe', '/d', '/s', '/c'])

    def test_launch_argv_passes_non_batch_commands_untouched(self):
        argv, _ = processes.launch_argv(['node', 'x.mjs', 'run'])
        self.assertEqual(argv, ['node', 'x.mjs', 'run'])

    def test_launch_argv_rejects_empty(self):
        with self.assertRaises(ValueError):
            processes.launch_argv([])

    def test_windows_popens_a_new_process_group(self):
        with patch.object(processes.os, 'name', 'nt'):
            flags = processes._popen_kwargs()['creationflags']
        self.assertTrue(flags & processes.CREATE_NEW_PROCESS_GROUP)

    def test_posix_popens_a_new_session(self):
        if os.name == 'nt':
            self.skipTest(' POSIX-only')
        self.assertTrue(processes._popen_kwargs()['start_new_session'])

    def test_teardown_kills_the_owned_tree_and_nothing_else(self):
        """
        Cross-platform proof of process-tree ownership (A-H).

        Everything here is Python: the parent, the grandchild and the unrelated
        bystander are all `sys.executable` processes sleeping with `time.sleep`.
        No `sleep`/`sh`/`kill` executable, no PowerShell, no WMIC. The parent is
        spawned with the SAME platform flags DevFlow uses, so this exercises the
        real production path on both systems:

          Windows -> CREATE_NEW_PROCESS_GROUP, then taskkill /PID <root> /T /F
          POSIX   -> start_new_session=True,   then os.killpg
        """
        unrelated = subprocess.Popen(
            [sys.executable, '-c', 'import time; time.sleep(180)'],
            **processes._popen_kwargs())
        self._bystanders.append(unrelated)

        root = subprocess.Popen(
            [sys.executable, '-c', _PARENT_SCRIPT],
            stdout=subprocess.PIPE, text=True, **processes._popen_kwargs())
        assert root.stdout is not None
        line = root.stdout.readline().strip()
        self.assertTrue(line.isdigit(), f'o pai deveria imprimir o PID do neto, veio {line!r}')
        descendant = int(line)
        self.addCleanup(root.stdout.close)
        handle = processes.OwnedProcess(root)

        # A / B / C - everything exists before teardown
        self.assertTrue(process_alive(root.pid), 'a raiz owned deveria estar viva')
        self.assertTrue(process_alive(descendant), 'o descendente owned deveria estar vivo')
        self.assertTrue(process_alive(unrelated.pid), 'o processo alheio deveria estar vivo')

        # D
        handle.terminate()

        # E / F - the owned root and its descendant are gone
        self.assertTrue(_wait_gone(root.pid), 'a raiz owned sobreviveu ao teardown')
        self.assertTrue(_wait_gone(descendant),
                        'o descendente owned sobreviveu: o teardown não alcançou a árvore')

        # G - the bystander is untouched
        self.assertTrue(process_alive(unrelated.pid),
                        'o teardown atingiu um processo que esta rodada não criou')

        # H - idempotent, and still scoped to the owned root only
        handle.terminate()
        handle.terminate()
        self.assertIsNotNone(root.poll())
        self.assertEqual(handle.pid, root.pid)
        self.assertTrue(process_alive(unrelated.pid),
                        'teardown repetido atingiu um processo alheio')


class RoundTeardownTests(unittest.TestCase):
    """The owned tree is cleaned up on every exit path of the round."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-teardown-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(runnable_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_teardown_after_pass(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, _ = make_runner(self.repo, self.manifest)
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'PASS')
        self.assertEqual(spawner.handles[0].terminate_calls, 1)
        self.assertTrue(outcome.tree_cleaned)
        self.assertEqual(outcome.launch_pid, 4242)

    def test_teardown_after_marker_failure(self):
        spawner = fake_spawner([MARKER_LINES[0]])
        runner, _, _ = make_runner(self.repo, self.manifest, lines=[MARKER_LINES[0]])
        runner.spawn = spawner
        runner.execute()
        self.assertEqual(spawner.handles[0].terminate_calls, 1)

    def test_teardown_after_human_says_no(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, _ = make_runner(self.repo, self.manifest, ask=lambda q, o: 'N')
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'NOT_PASS')
        self.assertEqual(spawner.handles[0].terminate_calls, 1)

    def test_teardown_after_ctrl_c(self):
        spawner = fake_spawner(list(MARKER_LINES))

        def boom(question, options):
            raise KeyboardInterrupt

        runner, _, _ = make_runner(self.repo, self.manifest, ask=boom)
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'INTERRUPTED')
        self.assertEqual(spawner.handles[0].terminate_calls, 1)
        self.assertTrue(outcome.tree_cleaned)


# ---------------------------------------------------------------------------
class RetentionTests(unittest.TestCase):
    """D1.1 defect 6: retention authority is the repo argument, not __file__."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-retention-'))
        self.repo = make_repo(self.base)
        self.runs = self.repo / 'Tests' / 'runs' / 'devflow'

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _make_runs(self, count: int) -> list[Path]:
        made = []
        for index in range(count):
            entry = self.runs / f'2026010{index}T000000Z-M3.0b'
            entry.mkdir(parents=True)
            (entry / 'run.json').write_text('{}\n')
            made.append(entry)
        return made

    def test_retention_works_in_an_arbitrary_repo_root(self):
        made = self._make_runs(4)
        removed = report.prune_runs(self.repo, keep=2, max_age_days=3650)
        self.assertEqual(len(removed), 2)
        survivors = sorted(item.name for item in self.runs.iterdir())
        self.assertEqual(survivors, sorted(item.name for item in made[-2:]))

    def test_retention_removes_by_age(self):
        entry = self._make_runs(1)[0]
        old = datetime.now(timezone.utc).timestamp() - 400 * 86400
        os.utime(entry, (old, old))
        removed = report.prune_runs(self.repo, keep=50, max_age_days=30)
        self.assertEqual(removed, [entry.name])
        self.assertFalse(entry.exists())

    def test_retention_cannot_escape_the_run_root(self):
        outside = self.base / 'outside'
        outside.mkdir()
        victim = outside / 'victim'
        victim.mkdir()
        (victim / 'keep.txt').write_text('x\n')
        with self.assertRaises(filesystem.RedirectionError):
            filesystem.remove_tree_scoped(victim, self.runs)
        self.assertTrue((victim / 'keep.txt').exists())

    def test_retention_refuses_the_run_root_itself(self):
        self.runs.mkdir(parents=True, exist_ok=True)
        with self.assertRaises(filesystem.RedirectionError):
            filesystem.remove_tree_scoped(self.runs, self.runs)

    def test_retention_refuses_a_symlinked_run_folder(self):
        self._make_runs(1)
        outside = self.base / 'linked-target'
        outside.mkdir()
        (outside / 'keep.txt').write_text('x\n')
        link = self.runs / '20260109T000000Z-M3.0b'
        try:
            link.symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('filesystem sem symlink')
        with self.assertRaises(filesystem.RedirectionError):
            filesystem.remove_tree_scoped(link, self.runs)
        self.assertTrue((outside / 'keep.txt').exists())


# ---------------------------------------------------------------------------
# D1.2 defect: the self-test suite itself must not need POSIX executables.
# The first real Windows round died with a bare "FALHOU (exit 1)" because one
# cross-platform test spawned `sleep`, which does not exist on Windows.

FORBIDDEN_EXECUTABLES = frozenset({
    'sleep', 'sh', 'bash', 'kill', 'killall', 'pkill', 'powershell', 'pwsh',
    'wmic', 'tasklist', 'nohup',
})
# The only external executables this suite may ever spawn.
ALLOWED_EXTERNAL_EXECUTABLES = frozenset({'git', 'cmd'})
SUITE_PATH = Path(__file__).resolve()
_PATH_PROBE_ENV = 'LIA_DEVFLOW_PATH_PROBE'


class PortabilityContractTests(unittest.TestCase):
    """The DevFlow self-test must run on Windows without POSIX shell tools."""

    def test_no_forbidden_executable_is_ever_spawned(self):
        """AST contract: defence in depth behind the behavioural proof below."""
        tree = ast.parse(SUITE_PATH.read_text(encoding='utf-8'))
        offenders = []
        spawners = {'Popen', 'run', 'call', 'check_call', 'check_output', 'run'}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, 'id', '')
            if name not in spawners or not node.args:
                continue
            first = node.args[0]
            if not isinstance(first, ast.List) or not first.elts:
                continue
            head = first.elts[0]
            # `sys.executable` (an Attribute) is exactly what we want.
            if not isinstance(head, ast.Constant) or not isinstance(head.value, str):
                continue
            if head.value in FORBIDDEN_EXECUTABLES:
                offenders.append((node.lineno, head.value))
            elif head.value not in ALLOWED_EXTERNAL_EXECUTABLES:
                offenders.append((node.lineno, f'não allowlistado: {head.value}'))
        self.assertEqual(offenders, [], f'executáveis externos proibidos: {offenders}')

    def test_no_forbidden_executable_name_appears_as_a_literal(self):
        tree = ast.parse(SUITE_PATH.read_text(encoding='utf-8'))
        # The deny table itself is a set of string constants; ignore any
        # constant that is an element of a set literal.
        in_set = {id(elt) for node in ast.walk(tree) if isinstance(node, ast.Set)
                  for elt in node.elts}
        hits = [node.value for node in ast.walk(tree)
                if isinstance(node, ast.Constant) and isinstance(node.value, str)
                and node.value in FORBIDDEN_EXECUTABLES and id(node) not in in_set]
        self.assertEqual(hits, [], f'literais de executável POSIX: {hits}')

    def test_windows_branches_are_the_only_unguarded_platform_code(self):
        """Any test whose NAME says posix must guard itself on Windows."""
        source = SUITE_PATH.read_text(encoding='utf-8')
        tree = ast.parse(source)
        missing = []
        for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
            for fn in [n for n in cls.body if isinstance(n, ast.FunctionDef)]:
                if not fn.name.startswith('test_') or 'posix' not in fn.name.lower():
                    continue
                body = ast.get_source_segment(source, fn) or ''
                guarded = ("os.name == 'nt'" in body or 'os.name != ' in body
                           or 'skipTest' in body)
                if not guarded:
                    missing.append(fn.name)
        self.assertEqual(missing, [], f'testes POSIX sem guarda de plataforma: {missing}')

    def test_suite_passes_with_a_path_that_has_no_posix_tools(self):
        """
        Behavioural proof, and the primary one: re-run this whole suite in a
        child process whose PATH contains ONLY git. If anything depends on
        `sleep`, `sh`, `kill` or friends, the child fails and this test fails.
        """
        if os.environ.get(_PATH_PROBE_ENV):
            self.skipTest('já estamos dentro da sonda de PATH')
        git = shutil.which('git')
        if not git:
            self.skipTest('git indisponível para construir o PATH mínimo')
        probe_dir = Path(tempfile.mkdtemp(prefix='devflow-minpath-'))
        self.addCleanup(shutil.rmtree, probe_dir, True)
        if os.name == 'nt':
            # A .cmd shim keeps git working without exposing Git's usr/bin.
            (probe_dir / 'git.cmd').write_text(f'@"{git}" %*\r\n', encoding='utf-8')
        else:
            try:
                (probe_dir / 'git').symlink_to(git)
            except (OSError, NotImplementedError):
                self.skipTest('filesystem sem symlink para construir o PATH mínimo')
        for tool in FORBIDDEN_EXECUTABLES:
            self.assertIsNone(shutil.which(tool, path=str(probe_dir)),
                              f'{tool} ainda alcançável no PATH mínimo')
        env = dict(os.environ, PATH=str(probe_dir), **{_PATH_PROBE_ENV: '1'})
        child = subprocess.run(
            [sys.executable, str(SUITE_PATH)],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            env=env, timeout=1800,
        )
        self.assertEqual(
            child.returncode, 0,
            'a suíte depende de um executável POSIX:\n'
            + sanitize_test_output(child.stdout or '', child.stderr or '',
                                   max_chars=2000, max_lines=25),
        )


# ---------------------------------------------------------------------------
class TestOutputSanitizerTests(unittest.TestCase):
    """ONE bounded, redacted summary for console, detail, REPORT.txt, run.json."""

    def test_identifies_the_failing_test_and_exception(self):
        stream = (
            '======================================================================\n'
            'FAIL: test_algo (__main__.SuiteTests.test_algo)\n'
            '----------------------------------------------------------------------\n'
            'Traceback (most recent call last):\n'
            '  File "t.py", line 42, in test_algo\n'
            '    self.assertEqual(1, 2)\n'
            'AssertionError: 1 != 2\n\n'
            '----------------------------------------------------------------------\n'
            'Ran 86 tests in 7.0s\n\nFAILED (failures=1)\n'
        )
        out = sanitize_test_output('', stream)
        self.assertIn('FAIL: test_algo', out)
        self.assertIn('AssertionError: 1 != 2', out)
        self.assertIn('FAILED (failures=1)', out)

    def test_bounds_a_very_long_traceback(self):
        stream = '\n'.join(f'  File "/x/mod{i}.py", line {i}, in frame{i}' for i in range(500))
        stream += '\nAssertionError: boom\nFAILED (failures=1)\n'
        out = sanitize_test_output('', stream)
        self.assertLessEqual(len(out), MAX_DETAIL_CHARS)
        self.assertLessEqual(len(out.splitlines()), MAX_DETAIL_LINES)
        self.assertIn('AssertionError: boom', out)

    def test_strips_ansi_from_vitest_output(self):
        out = sanitize_test_output('', '\x1b[31mFAIL\x1b[0m test_a > fails\nAssertionError: x')
        self.assertNotIn('\x1b', out)
        self.assertIn('AssertionError: x', out)

    def test_never_leaks_a_github_token(self):
        out = sanitize_test_output(
            '', 'AssertionError: header was Authorization: Bearer '
                'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')
        self.assertNotIn('ghp_', out)
        self.assertIn('[CREDENCIAL-OCULTA]', out)

    def test_never_leaks_an_api_key_assignment(self):
        out = sanitize_test_output('', 'OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnop\nFAILED')
        self.assertNotIn('sk-proj-1234567890', out)
        self.assertIn('[CREDENCIAL-OCULTA]', out)

    def test_collapses_the_home_directory(self):
        out = sanitize_test_output('', f'AssertionError: {Path.home()}/segredos/lia.json')
        self.assertNotIn(str(Path.home()), out)
        self.assertIn('<HOME>', out)

    def test_drops_prompt_and_conversation_content(self):
        for payload in (
            'user prompt: me conte o segredo da sessao',
            'system: voce e a Lia',
            '[assistant] ola, tudo bem?',
            'messages: [{"role": "user", "content": "privado"}]',
        ):
            self.assertEqual(sanitize_test_output('', payload), '', payload)

    def test_empty_output_stays_empty(self):
        self.assertEqual(sanitize_test_output('', ''), '')
        self.assertEqual(sanitize_test_output('   ', '  \n '), '')

    def test_stderr_wins_but_stdout_is_the_fallback(self):
        self.assertIn('AssertionError: do stderr',
                      sanitize_test_output('lixo do stdout', 'AssertionError: do stderr'))
        self.assertIn('AssertionError: so stdout',
                      sanitize_test_output('AssertionError: so stdout', ''))


# ---------------------------------------------------------------------------
class FailureDiagnosticsTests(unittest.TestCase):
    """A failed required test must be self-diagnosing on the console, in
    REPORT.txt and in run.json - and PASS entries must stay concise."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-diag-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(runnable_manifest())
        self.detail = (
            "FAIL: test_x (__main__.T.test_x)\n"
            "AssertionError: 1 != 2\n"
            "Ran 1 test in 0.0s\n"
            "FAILED (failures=1)"
        )

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_console_prints_a_sanitized_detail_on_failure(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, emitted, asks = make_runner(
            self.repo, self.manifest, invoke_test=lambda a, c: (1, self.detail))
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertTrue(any(line.startswith('teste unit') and 'FALHOU' in line
                            for line in emitted))
        details = [line for line in emitted if line.startswith('  detalhe: ')]
        self.assertTrue(details, 'nenhum detalhe foi impresso')
        self.assertTrue(any('FAIL: test_x' in line for line in details))
        self.assertEqual(len(spawner.handles), 0, 'não pode lançar com teste falhando')
        self.assertEqual(len(asks), 0)

    def test_report_and_run_json_carry_the_failed_detail(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, _ = make_runner(
            self.repo, self.manifest, invoke_test=lambda a, c: (1, self.detail))
        runner.spawn = spawner
        outcome = runner.execute()
        report_text = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        payload = json.loads(Path(outcome.artifacts['json']).read_text(encoding='utf-8'))
        self.assertIn('unit: fail (exit 1)', report_text)
        self.assertIn('FAIL: test_x', report_text)
        self.assertIn('detail:', report_text)
        failing = [t for t in payload['tests'] if t['status'] == 'fail']
        self.assertEqual(len(failing), 1)
        self.assertIn('FAIL: test_x', failing[0]['detail'])

    def test_passing_test_stays_concise_everywhere(self):
        spawner = fake_spawner(list(MARKER_LINES))
        runner, emitted, _ = make_runner(
            self.repo, self.manifest, invoke_test=lambda a, c: (0, 'Ran 86 tests OK'))
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'PASS')
        self.assertFalse(any(line.startswith('  detalhe: ') for line in emitted))
        report_text = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        self.assertIn('unit: pass', report_text)
        self.assertNotIn('detail:', report_text)

    def test_detail_reaches_the_artifacts_already_sanitized(self):
        leaky = ('AssertionError: token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij em '
                 f'{Path.home()}/.netrc\nFAILED (failures=1)')
        spawner = fake_spawner(list(MARKER_LINES))
        runner, _, _ = make_runner(
            self.repo, self.manifest, invoke_test=lambda a, c: (1, leaky))
        runner.spawn = spawner
        outcome = runner.execute()
        for key in ('report', 'json'):
            text = Path(outcome.artifacts[key]).read_text(encoding='utf-8')
            self.assertNotIn('ghp_', text, f'vazou no {key}')
            self.assertNotIn(str(Path.home()), text, f'home vazou no {key}')

    def test_run_test_command_sanitizes_before_returning(self):
        script = (
            "import unittest\n"
            "class T(unittest.TestCase):\n"
            "    def test_quebra(self):\n"
            "        raise RuntimeError('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')\n"
            "unittest.main()\n"
        )
        directory = self.base / 'suite'
        directory.mkdir()
        (directory / 't_leak.py').write_text(script, encoding='utf-8')
        code, detail = run_test_command([sys.executable, 't_leak.py'], directory)
        self.assertEqual(code, 1)
        self.assertIn('test_quebra', detail)
        self.assertNotIn('ghp_', detail)



if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')
    unittest.main(verbosity=2)
