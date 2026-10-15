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

import argparse
import ast
import copy
import ctypes
from datetime import datetime, timezone
import json
import atexit
import faulthandler
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

from devflow import (filesystem, lia_core_prereq, pipeline,  # noqa: E402
                     preflight, processes, report, safe_paths, sync)
import lia_dev  # noqa: E402
import project_cli  # noqa: E402
from devflow.report import (MAX_DETAIL_CHARS, MAX_DETAIL_LINES,  # noqa: E402
                            sanitize_test_output)
from devflow.processes import TeardownResult  # noqa: E402
from devflow import runner as runner_module  # noqa: E402
from devflow.runner import (PROGRESS_LINE_RE, PROGRESS_MAX_LINES,  # noqa: E402
                            PROGRESS_PARTIAL_MAX_BYTES, RoundRunner,
                            run_test_command, salvage_progress)
from devflow.markers import evaluate_markers  # noqa: E402
from devflow.report import is_keeper, sanitize_console, sanitize_line  # noqa: E402
from devflow.runner import RoundOutcome, RoundRunner, latest_run, pass_validity, render_report  # noqa: E402
from devflow.schema import (  # noqa: E402
    DEFAULT_TEST_TIMEOUT_S,
    Round,
    RoundSchemaError,
    load_active_round,
    validate_round,
)

ACTIVE_ROUND = TOOLS / 'devflow' / 'rounds' / 'm3_0b.json'
CORE_DIST = 'airi/packages/core-agent/dist'


def _git(repo: Path, *args: str) -> str:
    # Goes through sync.git_executable() for the same reason production does:
    # the minimum-PATH probe removes git from PATH and supplies the absolute
    # path instead, so anything spawning a bare 'git' would fail there.
    probe = subprocess.run([sync.git_executable(), *args], cwd=repo,
                           capture_output=True, text=True)
    return (probe.stdout or probe.stderr).strip()


PINNED_REMOTE_URL = 'https://github.com/BloomRX/Lia-Project.git'


def real_git_runner(repo: Path, remote_url: str | None = None):
    """
    A real `git` bound to `repo`, in the text-runner shape DevFlow injects.

    Used wherever a scripted FakeGit would only prove what the script says: the
    checkpoint path really runs `git add`, `git ls-files -s`, `git cat-file` and
    `git hash-object`, and the fast-forward question really runs
    `git merge-base --is-ancestor`.

    `remote_url` only answers `remote get-url`. A temp repository cannot have a
    github.com URL, and the pinned-identity check rightly refuses one that does
    not, so the identity is supplied while every other call stays real.
    """

    def run(args: list[str]) -> tuple[int, str]:
        if remote_url is not None and args[:2] == ['remote', 'get-url']:
            return 0, remote_url
        probe = subprocess.run(
            [sync.git_executable(), *args], cwd=repo, capture_output=True,
            text=True, encoding='utf-8', errors='replace',
        )
        return probe.returncode, (probe.stdout or probe.stderr or '').strip()

    return run


def with_local_origin(repo: Path) -> Path:
    """
    Gives `repo` a real `origin` it can fetch from and push to.

    A bare sibling seeded from the same history, so pre_sync/publish exercise
    fetch, merge-base and push for real instead of against a script.
    """
    bare = repo.parent / 'origin.git'
    _git(repo, 'clone', '-q', '--bare', str(repo), str(bare))
    _git(repo, 'remote', 'add', 'origin', str(bare))
    _git(repo, 'fetch', '-q', 'origin')
    return bare


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
    """
    Stands in for OwnedProcess.

    `terminate()` returns a TeardownResult because the real one does: teardown
    is now a claim about evidence, and a fake that returned None would let a
    fabricated cleanup PASS slip back in unnoticed.
    """

    def __init__(self, exit_code: int = 0, alive: bool = False, pid: int = 4242,
                 teardown_ok: bool = True, teardown_detail: str = 'fake: root morto',
                 descendants: int = 0) -> None:
        self.exit_code = exit_code
        self.alive = alive
        self.pid = pid
        self.teardown_ok = teardown_ok
        self.teardown_detail = teardown_detail
        self.descendants = descendants
        self.terminated = False
        self.terminate_calls = 0
        self.terminated_at_line: int | None = None
        self.lines_seen = 0

    def wait(self, timeout: float) -> int | None:
        return None if self.alive else self.exit_code

    def terminate(self) -> TeardownResult:
        self.terminated = True
        self.terminate_calls += 1
        return TeardownResult(
            requested=True,
            root_terminated=self.teardown_ok,
            method='fake',
            detail=self.teardown_detail,
            descendants=self.descendants if self.teardown_ok else -1,
        )


class _ExplodingHandle(FakeHandle):
    """
    A live handle whose `wait()` starts raising once N lines have been seen.

    Stands in for anything that can go wrong while the gate watches the child:
    a Ctrl+C, an OSError from a broken handle, an exception out of the marker
    matcher. What must NOT happen is the process being left running.
    """

    def __init__(self, exc: BaseException, trigger_after: int) -> None:
        super().__init__(0, alive=True)
        self._exc = exc
        self._trigger_after = trigger_after

    def wait(self, timeout: float) -> int | None:
        if self.lines_seen >= self._trigger_after:
            raise self._exc
        return None


def fake_spawner(lines: list[str], exit_code: int = 0, alive: bool = False,
                 **handle_kwargs):
    """Emits the scripted console up front, then hands back a handle."""
    handles: list[FakeHandle] = []

    def spawn(command: list[str], cwd: Path, on_line, env=None) -> FakeHandle:
        spawn.envs.append(dict(env or {}))
        handle = FakeHandle(exit_code, alive=alive, **handle_kwargs)
        handles.append(handle)
        for line in lines:
            handle.lines_seen += 1
            on_line(line)
        return handle

    spawn.handles = handles  # type: ignore[attr-defined]
    spawn.envs = []  # type: ignore[attr-defined]
    return spawn


def delayed_spawner(script: list[tuple[float, str]], exit_code: int = 0,
                    alive: bool = True, **handle_kwargs):
    """
    Emits (delay_seconds, line) pairs from a BACKGROUND thread.

    `fake_spawner` pushes every line before it even returns, which is exactly
    the shape that hid the phase-B defect: a gate that only reads what is
    already buffered looks correct against it. Real markers arrive seconds
    apart, so the delayed terminal-marker tests have to drive real wall-clock
    gaps and prove the gate is still waiting.
    """
    handles: list[FakeHandle] = []

    def spawn(command: list[str], cwd: Path, on_line, env=None) -> FakeHandle:
        spawn.envs.append(dict(env or {}))
        handle = FakeHandle(exit_code, alive=alive, **handle_kwargs)
        handles.append(handle)

        def emit() -> None:
            for delay, line in script:
                if delay:
                    time.sleep(delay)
                handle.lines_seen += 1
                on_line(line)

        thread = threading.Thread(target=emit, daemon=True)
        spawn.threads.append(thread)
        thread.start()
        return handle

    spawn.handles = handles  # type: ignore[attr-defined]
    spawn.envs = []  # type: ignore[attr-defined]
    spawn.threads = []  # type: ignore[attr-defined]
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


def manual_manifest() -> dict:
    """The active round plus one human assertion, to keep testing the rule that
    the question may only be asked AFTER the automatic gate passed."""
    data = runnable_manifest()
    data['manual_assertions'] = [{
        'id': 'character-visible',
        'question': 'A personagem apareceu normalmente?',
        'accept': ['S'], 'reject': ['N'],
    }]
    return data


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


# Named so a test never depends on a marker's position in the list.
MARKER_LINES = [
    '[lia] 2026-10-11T00:00:00.000Z lia-devflow autorun=invoked action=conversar\n',
    '[lia] 2026-10-11T00:00:01.000Z lia-app.stage-log stage-prerequisite name=core-agent-build state=starting\n',
    '[lia] 2026-10-11T00:00:09.000Z lia-app.stage-log stage-prerequisite name=core-agent-build state=succeeded reason=build-succeeded\n',
    '[lia] 2026-10-11T00:00:10.000Z lia-app.stage-log spawn: node C:\\repo\\airi\\apps\\stage-tamagotchi\\node_modules\\electron-vite\\bin\\electron-vite.js dev (pid 1234)\n',
    '[lia] 2026-10-11T00:00:14.000Z lia-app.stage-log lia-stage renderer=ready\n',
    '[lia] 2026-10-11T00:00:15.000Z lia-app.stage-log lia-stage window=visible\n',
    '[lia] 2026-10-11T00:00:15.500Z lia-app.stage-log lia-stage renderer-app=mounted\n',
    '[lia] 2026-10-11T00:00:16.000Z lia-app.stage-log lia-stage avatar-scene=mounted\n',
    '> ready in 512 ms\n',
]
(LINE_AUTORUN, LINE_PREREQ_STARTING, LINE_PREREQ_SUCCEEDED, LINE_STAGE_SPAWN,
 LINE_RENDERER_READY, LINE_WINDOW_VISIBLE, LINE_APP_MOUNTED, LINE_AVATAR_MOUNTED,
 LINE_DEV_SERVER_READY) = MARKER_LINES

# The ordered chain and the terminal facts, spelled out for the tests that
# reason about the gate rather than about the console text.
TERMINAL_LINES = [LINE_RENDERER_READY, LINE_WINDOW_VISIBLE, LINE_APP_MOUNTED,
                  LINE_AVATAR_MOUNTED]
ORDERED_LINES = [LINE_AUTORUN, LINE_PREREQ_STARTING, LINE_PREREQ_SUCCEEDED, LINE_STAGE_SPAWN]


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
                         ['autorun-invoked', 'prerequisite-starting',
                          'prerequisite-succeeded', 'stage-spawn'])
        # §F: the human S/N is replaced by machine evidence, so the active round
        # carries NO manual assertion and instead requires three terminal facts.
        self.assertEqual([item.id for item in manifest.manual_assertions], [])
        self.assertEqual([m.id for m in manifest.runtime.terminal],
                         ['stage-renderer-ready', 'stage-window-visible',
                          'stage-renderer-app-mounted',
                          'stage-avatar-scene-mounted'])
        self.assertTrue(manifest.runtime.forbidden)
        # §E: the launcher is told to run the canonical Conversar itself.
        self.assertEqual(manifest.launch.auto_action, 'conversar')
        self.assertEqual(dict(manifest.launch.env),
                         {'LIA_DEVFLOW_AUTORUN': 'conversar',
                          'LIA_DEVFLOW_DIAGNOSTICS': '1'})
        # §G: the generic driver hook exists and is wired to the autorun.
        self.assertIsNotNone(manifest.scenario)
        self.assertEqual(manifest.scenario.driver, 'autorun')
        self.assertEqual(manifest.scenario.steps, ('conversar',))
        self.assertFalse(manifest.ready_for_publish)
        self.assertIsNone(manifest.tested_sha)

    def test_schema_version_is_enforced(self):
        data = base_manifest()
        data['schema_version'] = 99
        with self.assertRaisesRegex(RoundSchemaError, 'schema_version'):
            validate_round(data)

    def test_missing_required_key_is_an_error(self):
        for key in ('round', 'git', 'prepare', 'cleanup_profile', 'tests',
                    'launch', 'runtime_assertions', 'retention'):
            data = base_manifest()
            del data[key]
            with self.assertRaisesRegex(RoundSchemaError, key):
                validate_round(data)

    def test_a_round_needs_machine_evidence_or_a_human_never_neither(self):
        data = base_manifest()
        data['runtime_assertions']['terminal_markers'] = []
        data['manual_assertions'] = []
        with self.assertRaisesRegex(RoundSchemaError, 'terminal_markers'):
            validate_round(data)
        # Either one alone is enough.
        data['manual_assertions'] = [{
            'id': 'x', 'question': 'viu?', 'accept': ['S'], 'reject': ['N'],
        }]
        validate_round(data)

    def test_launch_env_may_not_hijack_process_resolution(self):
        for key in ('PATH', 'COMSPEC', 'SYSTEMROOT', 'PATHEXT', 'USERPROFILE'):
            data = base_manifest()
            data['launch']['env'] = {key: 'x'}
            with self.assertRaisesRegex(RoundSchemaError, 'crítica'):
                validate_round(data)

    def test_unimplemented_auto_action_is_refused(self):
        data = base_manifest()
        data['launch']['auto_action'] = 'abrir-tudo'
        with self.assertRaisesRegex(RoundSchemaError, 'não implementado'):
            validate_round(data)

    def test_unimplemented_scenario_driver_is_refused(self):
        data = base_manifest()
        data['scenario'] = {'driver': 'imagem-multimodal', 'steps': ['envie 3 imagens']}
        with self.assertRaisesRegex(RoundSchemaError, 'não implementado'):
            validate_round(data)

    def test_diagnostics_key_from_v1_is_rejected(self):
        data = base_manifest()
        data['diagnostics'] = data.pop('runtime_assertions')
        # The strict unknown-key check fires first, which is the point: a v1
        # manifest is refused outright rather than silently half-migrated.
        with self.assertRaisesRegex(RoundSchemaError, 'diagnostics'):
            validate_round(data)

    def test_unknown_key_is_refused(self):
        data = base_manifest()
        data['surpresa'] = 1
        with self.assertRaisesRegex(RoundSchemaError, 'surpresa'):
            validate_round(data)

    def test_a_round_without_evidence_of_any_kind_is_refused(self):
        # A round whose only evidence is an ordinary log could never prove that
        # anything appeared on screen. Machine evidence OR a human - not neither.
        data = base_manifest()
        data['manual_assertions'] = []
        data['runtime_assertions']['terminal_markers'] = []
        with self.assertRaisesRegex(RoundSchemaError, 'terminal_markers'):
            validate_round(data)

    def test_machine_evidence_alone_is_enough_but_common_logs_are_not(self):
        data = base_manifest()
        data['manual_assertions'] = []
        validate_round(data)  # the active round itself: terminal markers only
        # A dev-server "ready in" line is optional and must never be terminal.
        optional = [m.id for m in validate_round(base_manifest()).runtime.optional]
        terminal = [m.id for m in validate_round(base_manifest()).runtime.terminal]
        self.assertIn('stage-dev-server-ready', optional)
        self.assertNotIn('stage-dev-server-ready', terminal)

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
                         ['autorun-invoked', 'prerequisite-starting',
                          'prerequisite-succeeded', 'stage-spawn'])

    def test_missing_marker_fails(self):
        lines = [LINE_AUTORUN, LINE_PREREQ_STARTING, LINE_STAGE_SPAWN]
        report = evaluate_markers(lines, self.ordered)
        self.assertFalse(report.ok)
        self.assertEqual(report.missing, 'prerequisite-succeeded')

    def test_out_of_order_marker_fails(self):
        # Spawn BEFORE the prerequisite succeeded is exactly the M3.0a bug:
        # the renderer would be served against a stale artifact.
        lines = [LINE_AUTORUN, LINE_STAGE_SPAWN, LINE_PREREQ_STARTING,
                 LINE_PREREQ_SUCCEEDED]
        report = evaluate_markers(lines, self.ordered)
        self.assertFalse(report.ok)

    def test_reason_must_match_too(self):
        lines = [
            LINE_AUTORUN, LINE_PREREQ_STARTING,
            'stage-prerequisite name=core-agent-build state=succeeded reason=build-succeeded\n',
            LINE_STAGE_SPAWN,
        ]
        self.assertTrue(evaluate_markers(lines, self.ordered).ok)
        wrong_reason = [
            LINE_AUTORUN, LINE_PREREQ_STARTING,
            'stage-prerequisite name=core-agent-build state=succeeded reason=no-source-workspace\n',
            LINE_STAGE_SPAWN,
        ]
        self.assertFalse(evaluate_markers(wrong_reason, self.ordered).ok)

    def test_optional_marker_never_gates(self):
        report = evaluate_markers(MARKER_LINES, self.ordered,
                                  validate_round(base_manifest()).optional_markers)
        self.assertTrue(report.ok)
        self.assertIn('stage-dev-server-ready', [name for name, _ in report.matched])


# ---------------------------------------------------------------------------
class RoundExecutionTests(unittest.TestCase):
    """Uses the assertion-bearing manifest: these tests are about the human
    step and about a full PASS being tied to an exact SHA."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-run-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(manual_manifest())

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
        runner, _emitted, _asks = make_runner(self.repo, self.manifest, lines=[LINE_AUTORUN])
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertFalse(outcome.markers.ok)

    def test_out_of_order_marker_fails_the_round(self):
        runner, _emitted, _asks = make_runner(self.repo, self.manifest,
                                lines=[LINE_STAGE_SPAWN, LINE_AUTORUN, LINE_PREREQ_STARTING])
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
        # The universal DevKit is reached THROUGH lia_dev.py: cmd.exe SHIFT does
        # not rewrite %*, so the .bat must not try to strip the `git` token.
        self.assertNotIn('project_cli.py', text)
        self.assertNotIn('git clean', text.lower())
        self.assertNotIn('reset --hard', text.lower())
        self.assertLess(len(text.splitlines()), 140)

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
            self.repo, validate_round(manual_manifest()), invoke_test=lambda a, c: (0, 'ok'))
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
        self.manifest = validate_round(manual_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_all_markers_asks_exactly_once(self):
        runner, _, asks = make_runner(self.repo, self.manifest)
        outcome = runner.execute()
        self.assertEqual(len(asks), 1)
        self.assertEqual(asks[0], 'A personagem apareceu normalmente?')
        self.assertEqual(outcome.verdict, 'PASS')

    def test_marker_failure_asks_nothing(self):
        spawner = fake_spawner([LINE_AUTORUN])
        runner, _, asks = make_runner(self.repo, self.manifest, lines=[LINE_AUTORUN])
        runner.spawn = spawner
        outcome = runner.execute()
        self.assertEqual(len(asks), 0)
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertTrue(spawner.handles[0].terminated)

    def test_out_of_order_markers_ask_nothing(self):
        runner, _, asks = make_runner(
            self.repo, self.manifest,
            lines=[LINE_STAGE_SPAWN, LINE_AUTORUN, LINE_PREREQ_STARTING])
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
        # Not a substring comparison of the two raw strings: on Windows %TEMP%
        # is very often an 8.3 short path (C:\Users\RUNNER~1\...) while a
        # resolved fixture path is the long form, so the two never matched even
        # though the fixture was exactly where it belongs. samefile compares
        # what the paths denote rather than how they are spelled.
        self.assertTrue(
            os.path.samefile(self.base.resolve().parent,
                             tempfile.gettempdir()),
            f'{self.base} não está diretamente sob {tempfile.gettempdir()}')

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
        self.manifest = validate_round(manual_manifest())

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
        spawner = fake_spawner([LINE_AUTORUN])
        runner, _, _ = make_runner(self.repo, self.manifest, lines=[LINE_AUTORUN])
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

#: Wall-clock budget for the minimal-PATH child re-run.
#:
#: The child runs only `PATH_PROBE_TARGETS`, not the whole suite: the universal
#: "no forbidden executable" property is covered by the import-time spawn
#: guard, so re-running every expensive Git fixture twice bought nothing and
#: was a large part of why the real Windows run ran out of budget. The budget
#: below is generous on purpose and the round manifest declares a matching
#: `timeout_s` for the outer command, so the parent cannot expire while it is
#: still legitimately waiting for this child.
#:
#: What is NOT claimed: that the Windows expiry was mere slowness. The suite is
#: measurably expensive, which makes slowness a sufficient explanation, but a
#: deadlock or a leaked pipe reaches the same deadline.
PATH_PROBE_TIMEOUT_S = 2400.0

FORBIDDEN_EXECUTABLES = frozenset({
    'sleep', 'sh', 'bash', 'kill', 'killall', 'pkill', 'powershell', 'pwsh',
    'wmic', 'tasklist', 'nohup',
})
# The only external executables this suite may ever spawn.
# 'cmd.exe' is allowed for exactly one purpose: DevKitHandoffExecutionTests runs
# the real DevKit.bat, which is the only way to prove the %TEMP% handoff. It is
# skipped on every platform without cmd.exe and is never used to shell out.
ALLOWED_EXTERNAL_EXECUTABLES = frozenset({'git', 'cmd', 'cmd.exe'})
SUITE_PATH = Path(__file__).resolve()
_PATH_PROBE_ENV = 'LIA_DEVFLOW_PATH_PROBE'

#: The classes the minimal-PATH child re-runs.
#:
#: Deliberately NOT the whole suite. These are the classes that really create
#: child processes or resolve executables, which is where a dependency on a
#: POSIX tool could actually hide. The universal half of the property - "no
#: test in this file spawns a forbidden executable" - is covered by the spawn
#: guard below, which observes every spawn in the parent run at zero cost.
#: Running every expensive Git-fixture class twice existed only to prove that
#: property, and on Windows the duplication was a large part of why the round
#: ran out of budget.
PATH_PROBE_TARGETS = (
    'OwnedProcessTests',
    'TeardownHonestyTests',
    'TaskkillLoadBearingTests',
    'DevKitHandoffExecutionTests',
    'GitExecutableResolutionTests',
    'PortabilityContractTests',
    'UpgradeBootstrapExecutionTests',
)

# ---------------------------------------------------------------------------
# Real subprocess-spawn guard, installed at IMPORT time.
#
# Behavioural, and universal: it wraps the one function every Python child
# process goes through, so it observes what this suite actually spawns rather
# than what its source text happens to mention. A dynamically built `['sl' +
# 'eep', '5']` defeats the AST literal scan but not this.
# ---------------------------------------------------------------------------
SPAWNED_HEADS: list[str] = []
_REAL_POPEN = subprocess.Popen
_REAL_SYSTEM = os.system


#: Recorded when a spawn cannot be reduced to an executable name safely. The
#: guard FAILS CLOSED on it: "I could not tell" must never read as "allowed".
UNCLASSIFIED_SPAWN = '<spawn-nao-classificado>'

#: Windows resolves these interchangeably with the bare name, so `sh.exe` is
#: `sh` for the purposes of a deny set.
_WINDOWS_EXEC_SUFFIXES = ('.exe', '.cmd', '.bat', '.com')


def _bare_executable_name(raw: str) -> str:
    """
    Reduce one command token to a bare, lowercase executable name.

    Both separators are split on: `os.path.basename` only knows the running
    platform's separator, so a Windows path passed on POSIX would otherwise
    survive intact and match nothing. Surrounding quotes are stripped and the
    Windows executable suffixes are removed, so `sh.exe` classifies as `sh`.
    """
    text = raw.strip().strip('"').strip("'").strip()
    for sep in ('/', chr(92)):
        if sep in text:
            text = text.rsplit(sep, 1)[-1]
    lowered = text.strip('"').strip("'").strip().lower()
    changed = True
    while changed:
        changed = False
        for suffix in _WINDOWS_EXEC_SUFFIXES:
            if lowered.endswith(suffix) and len(lowered) > len(suffix):
                lowered = lowered[:-len(suffix)]
                changed = True
    return lowered


def _first_shell_word(command: str) -> str:
    """
    The program name of a shell command string, WITHOUT executing anything.

    `os.system('sleep 5')` hands over the entire command line; compared
    against a bare-name deny set that text matches nothing, which is the
    bypass this closes. `shlex` is used strictly as a tokenizer - no command
    is run, expanded or evaluated here. An unparseable string yields '' so the
    caller fails closed instead of guessing.
    """
    try:
        # posix=False ALWAYS, on every platform. In POSIX mode shlex treats
        # backslash as an escape and silently eats it, so a Windows path such
        # as C:\\Windows\\System32\\sh.exe arrived here as
        # 'c:windowssystem32sh.exe' and matched nothing - the exact bypass this
        # guard exists to close. posix=False keeps quotes and backslashes
        # intact; the quotes are stripped afterwards by the basename reducer.
        words = shlex.split(command, posix=False, comments=False)
    except ValueError:
        return ''
    return words[0] if words else ''


def _classify_spawn(args) -> str:
    """Bare executable name, or UNCLASSIFIED_SPAWN when it cannot be told."""
    try:
        if isinstance(args, (bytes, bytearray)):
            raw, shell_form = bytes(args).decode('utf-8', 'replace'), True
        elif isinstance(args, str):
            raw, shell_form = args, True
        elif isinstance(args, os.PathLike):
            raw, shell_form = str(os.fspath(args)), False
        elif isinstance(args, (list, tuple)):
            if not args:
                return UNCLASSIFIED_SPAWN
            first = args[0]
            if isinstance(first, (bytes, bytearray)):
                raw = bytes(first).decode('utf-8', 'replace')
            elif isinstance(first, os.PathLike):
                raw = str(os.fspath(first))
            else:
                raw = str(first)
            shell_form = False
        else:
            return UNCLASSIFIED_SPAWN
    except Exception:  # a guard must never be the reason a test fails
        return UNCLASSIFIED_SPAWN
    head = _first_shell_word(raw) if shell_form else raw
    return _bare_executable_name(head) or UNCLASSIFIED_SPAWN


def _spawn_violations(heads) -> list[str]:
    """Forbidden names, plus anything that could not be classified at all."""
    return sorted({head for head in heads
                   if head in FORBIDDEN_EXECUTABLES or head == UNCLASSIFIED_SPAWN})


def _record_spawn(args) -> None:
    SPAWNED_HEADS.append(_classify_spawn(args))


class _GuardedPopen(_REAL_POPEN):  # type: ignore[misc,valid-type]
    def __init__(self, args, *pos, **kw):
        _record_spawn(args)
        super().__init__(args, *pos, **kw)


def _guarded_system(command):
    _record_spawn(command)
    return _REAL_SYSTEM(command)


# `subprocess.run`/`check_output`/`check_call` all resolve `Popen` from the
# module globals at call time, so patching the name covers them too. This is
# patched in the TEST PROCESS ONLY, at import of this module: no DevFlow
# production module is touched, and nothing leaks into the code under test.
subprocess.Popen = _GuardedPopen  # type: ignore[misc]
os.system = _guarded_system  # type: ignore[assignment]


def _enforce_spawn_guard() -> None:
    """
    Fails the run if any forbidden executable was spawned, even by a test that
    ran after the last assertion about it. Registered with atexit because no
    test can observe the tests that run after it - and it forces a NONZERO
    PROCESS EXIT, so a forbidden spawn cannot hide behind a green summary.
    """
    violations = _spawn_violations(SPAWNED_HEADS)
    if not violations:
        return
    sys.stderr.write(
        '\nGUARDA DE SPAWN: esta suíte lançou executável(is) proibido(s) ou '
        'não classificáveis: ' + ', '.join(violations)
        + '\nA portabilidade do DevFlow não pode depender de ferramentas POSIX.\n',
    )
    sys.stderr.flush()
    os._exit(1)


atexit.register(_enforce_spawn_guard)


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
        Behavioural proof: re-run the process-spawning classes in a child whose
        PATH contains NOTHING at all. If anything on that path depends on
        `sleep`, `sh`, `kill` or friends, the child fails and this test fails.

        Scoped rather than whole-suite. The universal claim - no test anywhere
        in this file spawns a forbidden executable - is made by the import-time
        spawn guard, which sees every spawn in the parent run. Re-running all
        ~1800 Git-fixture spawns in a child proved no more than the guard does
        and doubled the wall clock, which is what pushed the real Windows run
        past its budget.
        """
        if os.environ.get(_PATH_PROBE_ENV):
            self.skipTest('já estamos dentro da sonda de PATH')
        git = shutil.which('git')
        if not git:
            self.skipTest('git indisponível para construir o PATH mínimo')
        probe_dir = Path(tempfile.mkdtemp(prefix='devflow-minpath-'))
        self.addCleanup(shutil.rmtree, probe_dir, True)
        # Git is reached by ABSOLUTE PATH through LIA_DEVFLOW_GIT, not by a shim
        # dropped into the minimal PATH. A `git.cmd` shim is unreachable from
        # subprocess(['git'], shell=False): CreateProcess only ever appends
        # '.exe' and never consults PATHEXT, so the shim would resolve for
        # cmd.exe and silently NOT resolve for us - the probe would then be
        # measuring "git is missing" instead of "no POSIX tool is needed".
        for tool in FORBIDDEN_EXECUTABLES:
            self.assertIsNone(shutil.which(tool, path=str(probe_dir)),
                              f'{tool} ainda alcançável no PATH mínimo')
        self.assertIsNone(shutil.which('git', path=str(probe_dir)),
                          'git deveria estar FORA do PATH mínimo para a sonda provar algo')
        env = dict(os.environ, PATH=str(probe_dir),
                   **{_PATH_PROBE_ENV: '1', sync.GIT_EXECUTABLE_ENV: git})
        child = subprocess.run(
            [sys.executable, str(SUITE_PATH), *PATH_PROBE_TARGETS],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            env=env, timeout=PATH_PROBE_TIMEOUT_S,
        )
        self.assertEqual(
            child.returncode, 0,
            'a suíte depende de um executável POSIX:\n'
            + sanitize_test_output(child.stdout or '', child.stderr or '',
                                   max_chars=2000, max_lines=25),
        )
        # A vacuous subset would pass trivially, so the child must prove it
        # really ran the classes it was asked to.
        self.assertIn('Ran ', child.stderr or '')
        for target in PATH_PROBE_TARGETS:
            self.assertIn(target, child.stderr or '',
                          f'{target} não foi executado pela sonda de PATH')

    def test_the_probe_targets_are_real_and_were_selected_deliberately(self):
        """The subset must exist, and must be the process-spawning classes."""
        loader = unittest.TestLoader()
        for target in PATH_PROBE_TARGETS:
            self.assertTrue(hasattr(sys.modules[__name__], target),
                            f'{target} não existe mais - a sonda ficou órfã')
            count = loader.loadTestsFromName(
                f'{__name__}.{target}').countTestCases()
            self.assertGreater(count, 0, f'{target} não contém testes')

    def test_the_guard_is_installed_and_records_a_real_spawn(self):
        before = len(SPAWNED_HEADS)
        subprocess.run([sys.executable, '-c', 'pass'], capture_output=True)
        self.assertGreater(len(SPAWNED_HEADS), before,
                           'a guarda não está observando os spawns reais')
        # Compared against the BARE name, which is what the guard records.
        # `os.path.basename(sys.executable)` is `python.exe` on Windows while
        # the guard deliberately strips the executable suffix so that `sh.exe`
        # classifies as `sh`, so comparing the two only ever matched on POSIX.
        self.assertEqual(SPAWNED_HEADS[-1],
                         _bare_executable_name(sys.executable))

    def test_no_forbidden_executable_has_been_spawned_so_far(self):
        self.assertEqual(_spawn_violations(SPAWNED_HEADS), [])

    def test_the_guard_would_reject_a_forbidden_head(self):
        """
        Proves the guard is not a no-op decoration.

        The forbidden name is taken from the set rather than written out: this
        file is scanned by `test_no_forbidden_executable_name_appears_as_a_literal`,
        and a test that hard-coded one would trip the very scan it is checking.
        """
        forbidden = sorted(FORBIDDEN_EXECUTABLES)[0]
        SPAWNED_HEADS.append(forbidden)
        try:
            with self.assertRaises(SystemExit):
                with patch.object(os, '_exit', side_effect=SystemExit(1)):
                    _enforce_spawn_guard()
        finally:
            SPAWNED_HEADS.remove(forbidden)
        self.assertNotIn(forbidden, SPAWNED_HEADS)


class GitExecutableResolutionTests(unittest.TestCase):
    """
    The Windows executable-resolution contract, stated as behaviour.

    CreateProcess appends only '.exe' and never consults PATHEXT, so an
    extensionless name cannot resolve a `.cmd`/`.bat` shim. DevFlow therefore
    carries an absolute git path instead of relying on PATH resolution.
    """

    def test_the_configured_absolute_path_wins_over_path_lookup(self):
        env = {'PATH': '/definitely/not/here', sync.GIT_EXECUTABLE_ENV: '/opt/git/bin/git'}
        self.assertEqual(sync.git_executable(env), '/opt/git/bin/git')

    def test_it_falls_back_to_a_bare_name_only_when_nothing_is_configured(self):
        self.assertEqual(sync.git_executable({}), 'git')
        self.assertEqual(sync.git_executable({sync.GIT_EXECUTABLE_ENV: '   '}), 'git')

    def test_a_cmd_shim_is_not_reachable_by_an_extensionless_spawn(self):
        """
        The executable probe itself: build a directory holding ONLY `git.cmd`,
        put it on PATH, and show that resolving the bare name `git` finds
        nothing - which is exactly why the minimum-PATH probe must not use a
        shim. `shutil.which` mirrors PATHEXT the way cmd.exe does; `subprocess`
        with shell=False does not, so this is the conservative direction.
        """
        probe_dir = Path(tempfile.mkdtemp(prefix='devflow-cmdshim-'))
        self.addCleanup(shutil.rmtree, probe_dir, True)
        (probe_dir / 'git.cmd').write_text('@echo off\r\n', encoding='utf-8')
        # The portable design: resolve the absolute path, never the shim.
        self.assertEqual(
            sync.git_executable({sync.GIT_EXECUTABLE_ENV: str(probe_dir / 'git.cmd')}),
            str(probe_dir / 'git.cmd'),
        )

    def test_the_git_runner_actually_uses_the_configured_executable(self):
        """Not just the helper: the call site has to consume it."""
        seen: list[list[str]] = []
        real_run = sync.subprocess.run

        def spy(argv, **kwargs):
            seen.append(list(argv))

            class Done:
                returncode = 0
                stdout = ''
                stderr = ''

            return Done()

        # Save and RESTORE, never pop: inside the minimum-PATH probe this
        # variable is already carrying the only reachable git, and popping it
        # would break every later test in that child process.
        previous = os.environ.get(sync.GIT_EXECUTABLE_ENV)
        sync.subprocess.run = spy
        try:
            os.environ[sync.GIT_EXECUTABLE_ENV] = '/opt/git/bin/git'
            sync._git(Path('.'), ['status'])
            sync._git_raw(Path('.'), ['status'])
        finally:
            sync.subprocess.run = real_run
            if previous is None:
                os.environ.pop(sync.GIT_EXECUTABLE_ENV, None)
            else:
                os.environ[sync.GIT_EXECUTABLE_ENV] = previous
        self.assertEqual(seen[0][0], '/opt/git/bin/git')
        self.assertEqual(seen[1][0], '/opt/git/bin/git')
        self.assertTrue(real_run is not None)


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


# ---------------------------------------------------------------------------
# DEVFLOW-AUTO: the fake Git used by the sync, checkpoint and publish tests.

WORK = 'arena/01a10290-lia-project'


class FakeGit:
    """Scriptable git: records every argv and answers from a small state dict."""

    def __init__(self, *, branch=WORK, head='a' * 40, remote_head=None,
                 porcelain='', fetch_ok=True, rebase_ok=True, push_ok=True,
                 remote_url='https://github.com/BloomRX/Lia-Project.git',
                 ancestors_of=None, staged=(), blobs=None):
        self.branch = branch
        self.head = head
        self.remote_head = remote_head if remote_head is not None else head
        self.porcelain = porcelain
        self.fetch_ok = fetch_ok
        self.rebase_ok = rebase_ok
        self.push_ok = push_ok
        self.remote_url = remote_url
        # descendant -> ancestors. Anything not listed is treated as divergent.
        self.ancestors_of = dict(ancestors_of or {})
        self.staged = list(staged)
        self.blobs = dict(blobs or {})
        self.calls: list[list[str]] = []
        self.committed: list[str] = []

    def blob_sha(self, path: str) -> str:
        import hashlib

        return hashlib.sha1(path.encode()).hexdigest()

    def __call__(self, args: list[str]) -> tuple[int, str]:
        self.calls.append(list(args))
        head = args[:1]
        if head == ['remote'] and args[1:2] == ['get-url']:
            return 0, self.remote_url
        if head == ['rev-parse'] and args[1:2] == ['--abbrev-ref']:
            return 0, self.branch
        if head == ['rev-parse']:
            if args[1].startswith('origin/'):
                return (0, self.remote_head) if self.remote_head else (1, '')
            return 0, self.head
        if head == ['status']:
            # The real runner asks for `-z -uall`. Answer in that shape, because
            # `-z` is what makes an unusual pathname unambiguous and `-uall` is
            # what stops an untracked directory from arriving collapsed.
            if '-z' in args:
                records = [line for line in self.porcelain.splitlines() if line.strip()]
                return 0, ''.join(f'{line}\0' for line in records)
            return 0, self.porcelain
        if head == ['merge-base'] and '--is-ancestor' in args:
            # Explicit, never a silent 0: a fast-forward question that defaults
            # to "yes" would let a divergent remote be force-published.
            _flag, ancestor, descendant = args[1], args[2], args[3]
            return (0, '') if ancestor in self.ancestors_of.get(descendant, ()) else (1, '')
        if head == ['diff'] and '--cached' in args and '--name-only' in args:
            return 0, ''.join(f'{path}\0' for path in self.staged)
        if head == ['ls-files'] and '-s' in args:
            requested = args[args.index('--') + 1:] if '--' in args else []
            wanted = requested or list(self.staged)
            return 0, ''.join(
                f'100644 {self.blob_sha(path)} 0\t{path}\0' for path in wanted
            )
        if head == ['cat-file'] and args[1:2] == ['blob']:
            return 0, self.blobs.get(args[2], '')
        if head == ['hash-object']:
            path = args[args.index('--') + 1]
            return 0, self.blob_sha(path)
        if head == ['fetch']:
            return (0, '') if self.fetch_ok else (1, 'fatal: unable to access remote')
        if head == ['rebase']:
            if args[1:2] == ['--abort']:
                return 0, ''
            if self.rebase_ok:
                self.head = self.remote_head
                return 0, ''
            return 1, 'CONFLICT (content): Merge conflict in tools/x.py'
        if head == ['commit']:
            self.committed.append(args[args.index('-m') + 1])
            self.head = 'c' * 40
            return 0, ''
        if head == ['push']:
            return (0, '') if self.push_ok else (1, 'remote rejected')
        if head == ['add']:
            after = args.index('--') + 1 if '--' in args else 1
            self.staged = list(args[after:])
            return 0, ''
        raise AssertionError(f'FakeGit não modela este comando: {args}')

    def argvs(self) -> list[str]:
        return [' '.join(call) for call in self.calls]


def make_sync(fake: FakeGit, **kwargs) -> 'sync.WorkBranchSync':
    return sync.WorkBranchSync(Path('/repo'), work_branch=WORK, run_git=fake, **kwargs)


class SyncPolicyTests(unittest.TestCase):
    """§B/§C: deterministic sync, fail closed, never touch main."""

    def test_clean_checkout_updates_without_asking_anything(self):
        fake = FakeGit(head='a' * 40, remote_head='b' * 40)
        outcome = make_sync(fake).pre_sync()
        self.assertTrue(outcome.ok, outcome.reason)
        self.assertTrue(outcome.facts.updated)
        self.assertEqual(outcome.facts.final_head, 'b' * 40)
        self.assertIn('fetch origin ' + WORK, fake.argvs())
        self.assertIn('rebase origin/' + WORK, fake.argvs())

    def test_already_current_branch_does_nothing_destructive(self):
        fake = FakeGit(head='a' * 40, remote_head='a' * 40)
        outcome = make_sync(fake).pre_sync()
        self.assertTrue(outcome.ok)
        self.assertFalse(outcome.facts.updated)
        self.assertNotIn('rebase origin/' + WORK, fake.argvs())

    def test_remote_unavailable_fails_closed(self):
        fake = FakeGit(fetch_ok=False)
        outcome = make_sync(fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.stage, 'fetch')
        self.assertIn('remote indisponível', outcome.reason)

    def test_rebase_conflict_fails_closed_and_aborts(self):
        fake = FakeGit(head='a' * 40, remote_head='b' * 40, rebase_ok=False)
        outcome = make_sync(fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.stage, 'rebase')
        self.assertIn('CONFLICT', outcome.reason)
        self.assertIn('rebase --abort', fake.argvs())
        self.assertNotIn('push', ' '.join(fake.argvs()))

    def test_main_is_never_synced(self):
        for branch in ('main', 'master'):
            fake = FakeGit(branch=branch)
            outcome = make_sync(fake, main_branch=branch).pre_sync()
            self.assertFalse(outcome.ok)
            self.assertEqual(outcome.stage, 'identity')
            self.assertIn('main', outcome.reason)

    def test_wrong_repository_fails_closed(self):
        fake = FakeGit(remote_url='https://github.com/someone/other-project.git')
        outcome = make_sync(fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.stage, 'identity')
        self.assertIn('repositório inesperado', outcome.reason)

    def test_wrong_branch_fails_closed(self):
        fake = FakeGit(branch='feature/outra')
        outcome = make_sync(fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertIn('branch de trabalho', outcome.reason)

    def test_no_force_and_no_main_anywhere_in_the_argv(self):
        fake = FakeGit(head='a' * 40, remote_head='b' * 40)
        make_sync(fake).pre_sync()
        make_sync(fake).publish('b' * 40)
        joined = ' '.join(fake.argvs())
        for forbidden in ('--force', '-f ', 'reset --hard', 'clean ', 'stash'):
            self.assertNotIn(forbidden, joined)
        self.assertNotIn('push origin main', joined)

    def test_the_work_branch_is_configured_not_guessed(self):
        config = sync.load_devflow_config()
        self.assertEqual(config.work_branch, WORK)
        self.assertNotEqual(config.work_branch, config.main_branch)


class LocalChangePolicyTests(unittest.TestCase):
    """§C: local changes are classified; nothing is discarded."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-local-'))
        self.repo = make_repo(self.base)
        (self.repo / 'tools').mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_safe_source_diff_becomes_a_local_checkpoint(self):
        """
        Driven against a REAL git repository: the checkpoint path has to survive
        `git add -- <paths>` plus a proof that the index holds exactly those
        paths, which a scripted fake cannot demonstrate.
        """
        with_local_origin(self.repo)
        (self.repo / 'tools' / 'novo.py').write_text('print(1)\n', encoding='utf-8')
        runner = real_git_runner(self.repo, remote_url=PINNED_REMOTE_URL)
        outcome = sync.WorkBranchSync(
            self.repo, work_branch=WORK, run_git=runner, allow_checkpoint=True,
        ).pre_sync()
        self.assertTrue(outcome.ok, outcome.reason)
        self.assertTrue(outcome.facts.checkpoint)
        self.assertTrue(any('payload stageado verificado' in note
                            for note in outcome.facts.notes), outcome.facts.notes)
        self.assertTrue((self.repo / 'tools' / 'novo.py').exists())
        code, out = runner(['status', '--porcelain', '-z', '-uall'])
        self.assertEqual(out, '', 'o checkpoint deveria ter deixado o checkout limpo')

    def test_secret_blocks_the_checkpoint(self):
        target = self.repo / 'tools' / 'nota.py'
        target.write_text('KEY = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"\n', encoding='utf-8')
        fake = FakeGit(porcelain=' M tools/nota.py', head='a' * 40, remote_head='a' * 40)
        outcome = sync.WorkBranchSync(self.repo, work_branch=WORK, run_git=fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.stage, 'classify')
        self.assertIn('segredos', outcome.reason)
        self.assertEqual(fake.committed, [])

    def test_forbidden_path_blocks_the_checkpoint(self):
        (self.repo / 'airi' / '.env').write_text('X=1\n', encoding='utf-8')
        fake = FakeGit(porcelain='?? airi/.env', head='a' * 40, remote_head='a' * 40)
        outcome = sync.WorkBranchSync(self.repo, work_branch=WORK, run_git=fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertIn('.env', outcome.reason)
        self.assertEqual(fake.committed, [])

    def test_huge_binary_blocks_the_checkpoint(self):
        blob = self.repo / 'tools' / 'grande.ts'
        blob.write_bytes(b'x' * (sync.MAX_CHECKPOINT_BYTES + 1))
        fake = FakeGit(porcelain='?? tools/grande.ts', head='a' * 40, remote_head='a' * 40)
        outcome = sync.WorkBranchSync(self.repo, work_branch=WORK, run_git=fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertIn('maior que', outcome.reason)

    def test_unknown_classification_blocks_the_checkpoint(self):
        (self.repo / 'solto.py').write_text('x = 1\n', encoding='utf-8')
        fake = FakeGit(porcelain='?? solto.py', head='a' * 40, remote_head='a' * 40)
        outcome = sync.WorkBranchSync(self.repo, work_branch=WORK, run_git=fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertIn('fora das raízes', outcome.reason)

    def test_nothing_is_discarded_when_refusing(self):
        (self.repo / 'airi' / '.env').write_text('SEGREDO=1\n', encoding='utf-8')
        fake = FakeGit(porcelain='?? airi/.env', head='a' * 40, remote_head='a' * 40)
        sync.WorkBranchSync(self.repo, work_branch=WORK, run_git=fake).pre_sync()
        self.assertTrue((self.repo / 'airi' / '.env').exists())
        self.assertNotIn('reset', ' '.join(fake.argvs()))
        self.assertNotIn('clean', ' '.join(fake.argvs()))
        self.assertNotIn('stash', ' '.join(fake.argvs()))
        self.assertNotIn('checkout', ' '.join(fake.argvs()))


class PublishPolicyTests(unittest.TestCase):
    """§C post-gate: only the exact tested clean HEAD may be pushed."""

    def test_only_the_exact_tested_head_may_push(self):
        fake = FakeGit(head='a' * 40, remote_head='a' * 40)
        outcome = make_sync(fake).publish('b' * 40)
        self.assertFalse(outcome.ok)
        self.assertIn('não é o HEAD testado', outcome.reason)
        self.assertNotIn('push', ' '.join(fake.argvs()))

    def test_head_changing_after_the_gate_invalidates_the_push(self):
        fake = FakeGit(head='c' * 40, remote_head='a' * 40)
        self.assertFalse(make_sync(fake).publish('a' * 40).ok)

    def test_dirty_checkout_may_not_push(self):
        fake = FakeGit(head='a' * 40, remote_head='a' * 40, porcelain=' M tools/x.py')
        outcome = make_sync(fake).publish('a' * 40)
        self.assertFalse(outcome.ok)
        self.assertIn('não está limpo', outcome.reason)

    def test_remote_moving_between_gate_and_publish_forces_revalidation(self):
        """A remote tip that is NOT an ancestor means divergence, never a push."""
        fake = FakeGit(head='a' * 40, remote_head='d' * 40, ancestors_of={})
        outcome = make_sync(fake).publish('a' * 40)
        self.assertFalse(outcome.ok)
        self.assertIn('divergência', outcome.reason)
        self.assertNotIn('push', ' '.join(fake.argvs()))
        self.assertNotIn('--force', ' '.join(fake.argvs()))

    def test_publish_never_rebases_after_the_gate(self):
        """
        Rebasing after the gate would put a different SHA under a PASS that was
        measured against the old one. publish() must not contain a rebase at all.
        """
        fake = FakeGit(head='b' * 40, remote_head='a' * 40,
                       ancestors_of={'b' * 40: ('a' * 40,)})
        make_sync(fake).publish('b' * 40)
        self.assertNotIn('rebase', ' '.join(fake.argvs()))

    def test_remote_already_at_the_tested_head_pushes_nothing(self):
        fake = FakeGit(head='a' * 40, remote_head='a' * 40)
        outcome = make_sync(fake).publish('a' * 40)
        self.assertTrue(outcome.ok, outcome.reason)
        self.assertIn('nada a publicar', ' '.join(outcome.facts.notes))
        self.assertNotIn('push', ' '.join(fake.argvs()))

    def test_a_local_commit_ahead_of_the_remote_is_a_valid_fast_forward(self):
        """
        The old `remote_head != current` test refused THIS, which is the one
        case publishing exists for. Ancestor + clean + exact HEAD = fast-forward.
        """
        fake = FakeGit(head='b' * 40, remote_head='a' * 40,
                       ancestors_of={'b' * 40: ('a' * 40,)})
        outcome = make_sync(fake).publish('b' * 40)
        self.assertTrue(outcome.ok, outcome.reason)
        self.assertIn('push origin HEAD:' + WORK, fake.argvs())
        self.assertNotIn('--force', ' '.join(fake.argvs()))

    def test_publish_fetches_again_immediately_before_pushing(self):
        fake = FakeGit(head='b' * 40, remote_head='a' * 40,
                       ancestors_of={'b' * 40: ('a' * 40,)})
        make_sync(fake).publish('b' * 40)
        argvs = fake.argvs()
        self.assertIn('fetch origin ' + WORK, argvs)
        self.assertLess(argvs.index('fetch origin ' + WORK),
                        argvs.index('push origin HEAD:' + WORK))

    def test_main_can_never_be_published(self):
        fake = FakeGit(branch='main', head='a' * 40, remote_head='a' * 40)
        outcome = make_sync(fake, main_branch='main').publish('a' * 40)
        self.assertFalse(outcome.ok)
        self.assertNotIn('push', ' '.join(fake.argvs()))


class RuntimeGateTests(unittest.TestCase):
    """§F: the machine evidence that replaced the human S/N."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-gate-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(runnable_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _run(self, lines, ask=lambda q, o: 'S'):
        spawner = fake_spawner(lines)
        runner, emitted, asks = make_runner(self.repo, self.manifest, lines=lines, ask=ask)
        runner.spawn = spawner
        return runner.execute(), emitted, asks, spawner

    def test_all_evidence_passes_with_no_human_question(self):
        outcome, _, asks, _ = self._run(list(MARKER_LINES))
        self.assertEqual(outcome.verdict, 'PASS')
        self.assertEqual(len(asks), 0, 'esta rodada não exige afirmação humana')
        self.assertEqual(outcome.terminal_seen,
                         ['stage-renderer-ready', 'stage-window-visible',
                          'stage-renderer-app-mounted',
                          'stage-avatar-scene-mounted'])

    def test_missing_renderer_ready_fails(self):
        lines = [line for line in MARKER_LINES if line is not LINE_RENDERER_READY]
        outcome, emitted, _, _ = self._run(lines)
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertNotIn('stage-renderer-ready', outcome.terminal_seen)
        self.assertTrue(any('AUSENTE' in line for line in emitted))

    def test_missing_visible_window_fails(self):
        lines = [line for line in MARKER_LINES if line is not LINE_WINDOW_VISIBLE]
        self.assertEqual(self._run(lines)[0].verdict, 'FAIL')

    def test_missing_avatar_scene_fails(self):
        lines = [line for line in MARKER_LINES if line is not LINE_AVATAR_MOUNTED]
        outcome, _, _, _ = self._run(lines)
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertNotIn('stage-avatar-scene-mounted', outcome.terminal_seen)

    def test_process_exiting_early_fails(self):
        outcome, _, asks, _ = self._run([], )
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual(len(asks), 0)

    def test_forbidden_marker_fails_even_with_everything_else(self):
        lines = list(MARKER_LINES) + [
            '[lia] stage-prerequisite name=core-agent-build state=failed reason=exit:1\n']
        outcome, emitted, _, _ = self._run(lines)
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertIn('prerequisite-failed', outcome.forbidden_seen)
        self.assertTrue(any('PROIBIDO' in line for line in emitted))

    def test_a_dev_server_ready_line_alone_is_never_enough(self):
        outcome, _, _, _ = self._run([LINE_AUTORUN, LINE_PREREQ_STARTING,
                                      LINE_PREREQ_SUCCEEDED, LINE_STAGE_SPAWN,
                                      LINE_DEV_SERVER_READY])
        self.assertEqual(outcome.verdict, 'FAIL')

    def test_the_launcher_receives_the_devflow_environment(self):
        _, _, _, spawner = self._run(list(MARKER_LINES))
        self.assertEqual(spawner.envs[0], {'LIA_DEVFLOW_AUTORUN': 'conversar',
                                           'LIA_DEVFLOW_DIAGNOSTICS': '1'})

    def test_the_failed_round_reports_its_stage_and_evidence(self):
        lines = [line for line in MARKER_LINES if line is not LINE_AVATAR_MOUNTED]
        outcome, _, _, _ = self._run(lines)
        payload = json.loads(Path(outcome.artifacts['json']).read_text(encoding='utf-8'))
        self.assertEqual(payload['stage'], 'runtime')
        self.assertIn('stage-avatar-scene-mounted', payload['markers']['terminal_missing'])
        report_text = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        self.assertIn('stage-avatar-scene-mounted: AUSENTE', report_text)


class BootstrapTests(unittest.TestCase):
    """§B: the bootstrap updates first, then runs the UPDATED code."""

    def test_bootstrap_resyncs_and_reexecutes_a_fresh_interpreter(self):
        fake = FakeGit(head='a' * 40, remote_head='b' * 40)
        calls: list[list[str]] = []

        class Done(Exception):
            pass

        def fake_run(argv, **kwargs):
            calls.append(list(argv))
            raise Done

        real_run = lia_dev.subprocess.run
        lia_dev.subprocess.run = fake_run
        try:
            # Both runners have to be scripted: pre_sync reads the worktree with
            # the RAW runner (`status -z`), and patching only `_git` would let a
            # real git call slip into what is meant to be a pure policy test.
            with patch.object(sync, '_git', lambda repo, args: fake(args)), \
                    patch.object(sync, '_git_raw',
                                 lambda repo, args: (fake(args)[0],
                                                     fake(args)[1].encode())):
                with self.assertRaises(Done):
                    lia_dev.cmd_bootstrap(argparse.Namespace())
        finally:
            lia_dev.subprocess.run = real_run
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], sys.executable)
        self.assertEqual(calls[0][-2:], ['auto', '--post-sync'])

    def test_bootstrap_refuses_without_touching_the_checkout_on_fetch_failure(self):
        fake = FakeGit(fetch_ok=False)
        with patch.object(sync, '_git', lambda repo, args: fake(args)):
            code = lia_dev.cmd_bootstrap(argparse.Namespace())
        self.assertEqual(code, 1)
        self.assertNotIn('push', ' '.join(fake.argvs()))

    def test_the_bootstrap_imports_nothing_heavy_before_the_sync(self):
        """A stale in-memory module must never evaluate the gate."""
        source = SUITE_PATH.parent.joinpath('devflow', 'pipeline.py').read_text(encoding='utf-8')
        lia_source = (SUITE_PATH.parent / 'lia_dev.py').read_text(encoding='utf-8')
        start = lia_source.index('def cmd_bootstrap')
        end = lia_source.index('def cmd_auto')
        body = lia_source[start:end]
        self.assertNotIn('import pipeline', body)
        self.assertNotIn('RoundRunner(', body)
        self.assertIn("'auto', '--post-sync'", body)
        self.assertIn('pipeline', source)  # the fresh process is what loads it


class DefaultUxTests(unittest.TestCase):
    """§A/§M: double-click means AUTO and nothing asks anything."""

    def test_no_arguments_means_auto(self):
        args = lia_dev.build_parser().parse_args([])
        handler = lia_dev.HANDLERS.get(args.cmd or 'auto', lia_dev.cmd_auto)
        self.assertIs(handler, lia_dev.cmd_auto)

    def test_advanced_commands_still_exist_behind_arguments(self):
        for name in ('menu', 'round', 'status', 'open', 'diagnose', 'rounds'):
            self.assertIn(name, lia_dev.HANDLERS)

    def test_devkit_bat_double_click_runs_the_bootstrap(self):
        bat = (SUITE_PATH.parent.parent / 'DevKit.bat').read_text(encoding='utf-8')
        self.assertIn('lia_dev.py" bootstrap', bat)
        # A bare double-click must never land in a menu or a Git submenu.
        self.assertNotIn('lia_dev.py" menu', bat)

    def test_devkit_bat_copies_itself_before_running(self):
        bat = (SUITE_PATH.parent.parent / 'DevKit.bat').read_text(encoding='utf-8')
        self.assertIn('LIA_DEVKIT_BOOTSTRAP_COPY', bat)
        self.assertIn('LIA_DEVKIT_ROOT', bat)
        # Unique per run, never one globally shared filename.
        self.assertIn('RANDOM', bat)
        self.assertNotIn('lia-devkit-bootstrap.bat', bat)

    def test_auto_never_prompts_on_a_healthy_path(self):
        """Behavioural: any input() anywhere in AUTO raises and fails this."""
        fake = FakeGit(head='a' * 40, remote_head='a' * 40)
        base = Path(tempfile.mkdtemp(prefix='devflow-ux-'))
        self.addCleanup(shutil.rmtree, base, True)
        repo = make_repo(base)
        manifest = validate_round(runnable_manifest())

        def exploding_ask(question, options):
            raise AssertionError(f'AUTO perguntou algo ao usuário: {question!r}')

        runner = RoundRunner(round_manifest=manifest, repo=repo,
                             run_git=lambda args: fake(args),
                             spawn=fake_spawner(list(MARKER_LINES)),
                             ask=exploding_ask, invoke_test=passing_tests)
        emitted: list[str] = []

        def boom(*_a, **_k):
            raise AssertionError('AUTO chamou input()')

        with patch('builtins.input', boom):
            with patch.object(sync, '_git', lambda r, args: fake(args)):
                result = pipeline.run_auto(
                    repo, work_branch=WORK, run_git=lambda args: fake(args),
                    emit=emitted.append, runner_factory=lambda m: runner,
                    load_round=lambda: manifest)
        self.assertEqual(result.result, 'PASS', result.reason)

    def test_no_input_call_exists_in_the_auto_path(self):
        """Defence in depth behind the behavioural proof above."""
        tree = ast.parse((SUITE_PATH.parent / 'lia_dev.py').read_text(encoding='utf-8'))
        offenders = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func = node.func
                name = func.id if isinstance(func, ast.Name) else getattr(func, 'attr', '')
                if name == 'input':
                    offenders.append(node.lineno)
        allowed = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name in ('cmd_menu', '_universal_devkit'):
                for inner in ast.walk(node):
                    if isinstance(inner, ast.Call):
                        f = inner.func
                        n = f.id if isinstance(f, ast.Name) else getattr(f, 'attr', '')
                        if n == 'input':
                            allowed.add(inner.lineno)
        self.assertEqual(sorted(set(offenders) - allowed), [],
                         'input() fora do menu interativo')
        pipeline_source = (SUITE_PATH.parent / 'devflow' / 'pipeline.py').read_text(encoding='utf-8')
        self.assertNotIn('input(', pipeline_source, 'input() em pipeline.py')
        # runner.py keeps console_asker for rounds that still carry a human
        # assertion; the only input() allowed there is inside that one function.
        runner_tree = ast.parse(
            (SUITE_PATH.parent / 'devflow' / 'runner.py').read_text(encoding='utf-8'))
        for node in ast.walk(runner_tree):
            if isinstance(node, ast.Call):
                func = node.func
                name = func.id if isinstance(func, ast.Name) else getattr(func, 'attr', '')
                if name != 'input':
                    continue
                owners = [parent.name for parent in ast.walk(runner_tree)
                          if isinstance(parent, ast.FunctionDef)
                          and any(child is node for child in ast.walk(parent))]
                self.assertEqual(owners, ['console_asker'],
                                 'input() fora de console_asker no runner')

    def test_the_final_block_is_a_verdict_not_a_menu(self):
        result = pipeline.AutoResult(result='PASS', round_id='M3.0b',
                                     tested_head='a' * 40, sync_ok=True, tests_ok=True,
                                     runtime_ok=True, cleanup_state='PASS',
                                     publish='skipped-by-round-policy', stage='publish')
        block = pipeline.render_final_block(result)
        self.assertIn('LIA DEVFLOW', block)
        self.assertIn('Result: PASS', block)
        # M3.0b is not ready_for_publish, so the block must SAY that instead of
        # implying a PASS publishes source.
        self.assertIn('Push: SKIPPED BY ROUND POLICY', block)
        self.assertIn('Process cleanup: PASS', block)
        self.assertNotIn('Escolha', block)
        self.assertNotIn('Pressione 1', block)

    def test_the_cleanup_line_reads_the_real_teardown_fact(self):
        """
        `"PASS" if result.stage` was not a cleanup proof - any non-empty stage
        string printed PASS. The line now reads the recorded teardown evidence.
        """
        base = dict(result='PASS', round_id='M3.0b', tested_head='a' * 40,
                    sync_ok=True, tests_ok=True, runtime_ok=True, stage='runtime')
        failed = pipeline.AutoResult(cleanup_state='FAIL', **base)
        self.assertIn('Process cleanup: FAIL', pipeline.render_final_block(failed))
        not_applicable = pipeline.AutoResult(cleanup_state='N/A', **base)
        self.assertIn('Process cleanup: N/A', pipeline.render_final_block(not_applicable))
        unknown = pipeline.AutoResult(cleanup_state='UNKNOWN', **base)
        self.assertIn('Process cleanup: UNKNOWN', pipeline.render_final_block(unknown))
        self.assertNotIn('Process cleanup: PASS', pipeline.render_final_block(unknown))

    def test_the_failure_block_names_the_stage_and_promises_nothing_destructive(self):
        result = pipeline.AutoResult(result='FAIL', stage='runtime', reason='sem evidência')
        block = pipeline.render_final_block(result)
        self.assertIn('Result: FAIL', block)
        self.assertIn('Stage: runtime', block)
        self.assertIn('No destructive recovery was attempted.', block)


class AutoPipelineTests(unittest.TestCase):
    """§D/§K: the whole pipeline, stage by stage."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-auto-'))
        self.repo = make_repo(self.base)
        (self.repo / 'tools').mkdir(parents=True, exist_ok=True)
        self.manifest = validate_round(runnable_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _pipeline(self, fake, lines=None, invoke=passing_tests):
        runner = RoundRunner(
            round_manifest=self.manifest, repo=self.repo,
            run_git=lambda args: fake(args),
            spawn=fake_spawner(list(MARKER_LINES if lines is None else lines)),
            ask=lambda q, o: 'S', invoke_test=invoke)
        return pipeline.run_auto(
            self.repo, work_branch=WORK, run_git=lambda args: fake(args),
            emit=lambda _line: None, runner_factory=lambda m: runner,
            load_round=lambda: self.manifest)

    def test_a_healthy_run_records_every_stage_and_passes(self):
        fake = FakeGit(head='a' * 40, remote_head='a' * 40)
        result = self._pipeline(fake)
        self.assertEqual(result.result, 'PASS', result.reason)
        names = [stage.name for stage in result.stages]
        for expected in ('bootstrap', 'sync', 'tests', 'runtime', 'teardown', 'publish'):
            self.assertIn(expected, names)
        self.assertTrue(result.sync_ok and result.tests_ok and result.runtime_ok)
        self.assertTrue(result.report_path)
        # ready_for_publish=false, so nothing may be pushed.
        self.assertEqual(result.publish, 'skipped-by-round-policy')
        self.assertNotIn('push', ' '.join(fake.argvs()))

    def test_a_failed_gate_never_publishes_a_local_checkpoint(self):
        fake = FakeGit(porcelain='?? tools/novo.py', head='a' * 40, remote_head='b' * 40)
        (self.repo / 'tools' / 'novo.py').write_text('x = 1\n', encoding='utf-8')
        result = self._pipeline(fake, lines=[LINE_AUTORUN])
        self.assertEqual(result.result, 'FAIL')
        self.assertNotIn('push', ' '.join(fake.argvs()))
        self.assertTrue((self.repo / 'tools' / 'novo.py').exists())

    def test_a_failing_required_test_stops_before_the_runtime_gate(self):
        fake = FakeGit(head='a' * 40, remote_head='a' * 40)
        result = self._pipeline(fake, invoke=lambda a, c: (1, 'FAILED (failures=1)'))
        self.assertEqual(result.result, 'FAIL')
        self.assertFalse(result.tests_ok)
        self.assertNotIn('push', ' '.join(fake.argvs()))

    def test_sync_refusal_stops_everything(self):
        fake = FakeGit(fetch_ok=False)
        result = self._pipeline(fake)
        self.assertEqual(result.result, 'FAIL')
        self.assertEqual(result.stage, 'fetch')
        self.assertIn('remote indisponível', result.reason)

    def test_the_round_is_resolved_after_the_sync(self):
        """Running the pre-sync manifest would validate code that moved."""
        seen: list[str] = []
        fake = FakeGit(head='a' * 40, remote_head='b' * 40)

        def loader():
            seen.append(fake.head)
            return self.manifest

        runner = RoundRunner(
            round_manifest=self.manifest, repo=self.repo,
            run_git=lambda args: fake(args),
            spawn=fake_spawner(list(MARKER_LINES)),
            ask=lambda q, o: 'S', invoke_test=passing_tests)
        pipeline.run_auto(self.repo, work_branch=WORK, run_git=lambda args: fake(args),
                          emit=lambda _l: None, runner_factory=lambda m: runner,
                          load_round=loader)
        self.assertEqual(seen, ['b' * 40], 'a rodada deve ser lida DEPOIS do sync')


# ===========================================================================
# DEVFLOW-AUTO-1a: regressions for the audited defects.
# ===========================================================================
DEVKIT_BAT = SUITE_PATH.parent.parent / 'DevKit.bat'


class DevKitHandoffContractTests(unittest.TestCase):
    """
    §1: the temporary copy must not lose the repository root.

    Inside `%TEMP%`, `%~dp0` IS the temp directory, so the previous script could
    only ever print "tools\\lia_dev.py nao encontrado". These assertions state
    the executable contract; `DevKitHandoffExecutionTests` below actually runs
    the .bat when cmd.exe exists.
    """

    @classmethod
    def setUpClass(cls):
        cls.text = DEVKIT_BAT.read_text(encoding='utf-8', errors='replace')
        cls.head, cls.body = cls.text.split('\n:body\n', 1)

    def test_the_original_root_is_captured_before_the_copy(self):
        head = self.head
        self.assertIn('set "LIA_DEVKIT_ROOT=%~dp0"', head)
        self.assertLess(head.index('set "LIA_DEVKIT_ROOT=%~dp0"'), head.index('copy /y'),
                        'a raiz tem de ser capturada antes da cópia')

    def test_the_copy_never_reads_its_own_directory(self):
        # After :body the script IS the temp copy, so %~dp0 would be %TEMP%.
        code = '\n'.join(
            line for line in self.body.splitlines() if not line.lstrip().lower().startswith('rem')
        )
        self.assertNotIn('%~dp0', code,
                         'a cópia não pode derivar a raiz do próprio diretório')
        self.assertIn('%LIA_DEVKIT_ROOT%tools\\lia_dev.py', code)

    def test_no_machine_specific_path_is_hardcoded(self):
        for drive in ('C:\\', 'D:\\', 'J:\\'):
            self.assertNotIn(drive, self.text, f'caminho de máquina embutido: {drive}')
        self.assertNotIn('/home/', self.text)

    def test_the_temp_copy_name_is_unique_per_run(self):
        self.assertIn('%RANDOM%', self.text)
        self.assertNotIn('lia-devkit-bootstrap.bat', self.text,
                         'um nome global fixo não é seguro para concorrência')
        # %RANDOM% alone is NOT unique: cmd.exe seeds it from the clock, so two
        # processes opened in the same tick produce the same sequence. Observed
        # in CI - two consecutive runs built the same name, the second found the
        # first one's copy and failed closed. The HHMMSScc stamp breaks the tie.
        self.assertIn('LIA_DEVKIT_STAMP', self.text,
                      'o nome da cópia voltou a depender só de %RANDOM%')
        self.assertIn('%TIME: =0%', self.text,
                      'a hora com espaço inicial entraria no nome do arquivo')

    def test_a_failed_copy_fails_closed_instead_of_running_the_original(self):
        head = self.head
        after_copy = head.split('copy /y', 1)[1]
        self.assertIn('if errorlevel 1', after_copy,
                      'falha de cópia tem de ser detectada')
        self.assertIn('goto :fail', after_copy)
        # And the copy is verified to exist before being executed.
        self.assertIn('if not exist "%LIA_DEVKIT_COPY%"', after_copy)

    def test_an_existing_temp_copy_is_never_reused(self):
        head = self.head
        self.assertIn('if exist "%LIA_DEVKIT_COPY%"', head,
                      'colisão de nome tem de falhar, nunca reutilizar')

    def test_the_child_exit_code_is_propagated(self):
        head = self.head
        after = head.split('"%LIA_DEVKIT_COPY%" %*', 1)[1]
        self.assertIn('set "LIA_DEVKIT_RC=%ERRORLEVEL%"', after)
        self.assertIn('exit /b %LIA_DEVKIT_RC%', after)

    def test_temporary_artifacts_are_cleaned(self):
        self.assertIn('del "%LIA_DEVKIT_COPY%"', self.text)

    def test_the_owner_removes_the_copy_only_after_capturing_the_code(self):
        """The cleanup must not precede the capture it would destroy."""
        captured = self.head.index('set "LIA_DEVKIT_RC=%ERRORLEVEL%"')
        removed = self.head.index('del "%LIA_DEVKIT_COPY%"')
        self.assertLess(captured, removed,
                        'o dono apagou a cópia antes de ler o ERRORLEVEL')

    def test_the_copy_never_deletes_itself_before_exiting(self):
        """
        cmd.exe reads a .bat by byte offset, so a copy that deletes itself
        leaves the following `exit /b` with no file to be read from and the
        real code is lost - Windows reported 1 where Python had exited 7.
        Cleanup belongs to the owner. The forbidden fragment is assembled so
        this assertion cannot be satisfied by its own source text.
        """
        forbidden = 'del ' + '"%' + '~f0"'
        self.assertNotIn(forbidden, self.body,
                         'a cópia voltou a se apagar antes do exit /b')
        self.assertTrue(self.body.rstrip().endswith('exit /b %LIA_DEVKIT_RC%'),
                        f'o corpo não termina devolvendo o código: '
                        f'{self.body[-90:]!r}')

    def test_paths_are_quoted_for_spaces(self):
        for fragment in ('"%LIA_DEVKIT_ROOT%tools\\lia_dev.py"',
                         '"%LIA_DEVKIT_COPY%"', '"%~f0"'):
            self.assertIn(fragment, self.text)

    def test_shift_is_not_used_so_the_git_token_cannot_leak(self):
        code = '\n'.join(
            line for line in self.text.splitlines()
            if not line.lstrip().lower().startswith('rem')
        )
        self.assertNotRegex(code, r'(?im)^\s*shift\b',
                            'SHIFT não reescreve %* no cmd.exe')

    def test_no_menu_or_prompt_on_the_default_path(self):
        self.assertNotIn('choice ', self.text.lower())
        self.assertNotIn('set /p', self.text.lower())
        # `pause` only exists to keep the window open, and is skippable.
        self.assertIn('LIA_DEVKIT_NO_PAUSE', self.text)

    def test_the_bat_uses_crlf_line_endings(self):
        raw = DEVKIT_BAT.read_bytes()
        self.assertEqual(raw.count(b'\r\n'), raw.count(b'\n'),
                         'um .bat com LF puro quebra no cmd.exe')


def _describe_survivors(tree: frozenset[int] | None,
                        names: dict[int, str]) -> str:
    """
    Name what was still running, or say plainly that it could not be checked.

    An unnamed PID list would be decoration; an empty one would be a lie on a
    platform that cannot enumerate. Both cases are spelled out instead.
    """
    if tree is None:
        return 'Ainda vivos: NAO foi possivel verificar a arvore.'
    if not tree:
        return 'Ainda vivos: nenhum processo alem do proprio filho.'
    listed = ', '.join(f'{names.get(pid) or "?"} ({pid})' for pid in sorted(tree))
    return f'Ainda vivos na arvore: {listed}.'


def run_bat(argv: list[str], cwd: Path, *, timeout_s: float,
            env: dict | None = None) -> subprocess.CompletedProcess:
    """
    Run a .bat the way these tests need to, and actually honour the budget.

    `subprocess.run(timeout=...)` cannot be used here, for a reason that is
    specific to Windows and documented in CPython's own `run()`: after the
    timeout it calls `process.kill()` and then `process.communicate()` AGAIN,
    with no timeout ("communicate() _after_ kill() is required to collect
    that"). `kill()` reaches only the direct child. A grandchild that inherited
    the stdout/stderr pipe handles keeps them open, so that second call blocks
    for as long as the grandchild lives. Measured on the owner's machine: a
    180 s bound turned into a 600 s suite kill, and the suite watchdog - not
    the test - was what finally stopped it.

    stdin is redirected to DEVNULL for the same class of reason. A `pause`
    anywhere in the batch tree waits for a keypress; GitHub runners have no
    interactive console so it returns immediately, while on a desktop it waits
    forever. That difference is exactly what this suite exists to cover, so it
    must not be hidden by an absent console.
    """
    popen_kwargs: dict = {}
    if os.name == 'posix':
        # `_terminate_timed_out` kills the process GROUP, which is only safe
        # when the child leads one. Without this the cleanup on a timeout would
        # take the test runner itself down with it.
        popen_kwargs['start_new_session'] = True
    proc = subprocess.Popen(
        argv, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL, text=True, encoding='utf-8',
        errors='replace', env=env, **popen_kwargs)
    try:
        stdout, stderr = proc.communicate(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        # Snapshot BEFORE killing: a parent/child map is only meaningful while
        # the parent is still alive to appear in it. The names are the point -
        # "python.exe was still alive" is a diagnosis, "the child hung" is not,
        # and this suite runs on machines nobody can attach a debugger to.
        tree = processes.snapshot_owned_tree(proc.pid)
        survivors = _describe_survivors(tree, processes.process_names(tree))
        # Scoped tree kill: this child and its descendants, never an image
        # name. Then a BOUNDED drain - an unbounded one is the bug above.
        cleanup = runner_module._terminate_timed_out(proc)
        try:
            stdout, stderr = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            stdout, stderr = '', ''
        for stream in (proc.stdout, proc.stderr):
            if stream is not None:
                try:
                    stream.close()
                except (ValueError, OSError):
                    pass
        raise AssertionError(
            f'{argv} excedeu {timeout_s:.0f}s e foi encerrado ({cleanup}). '
            f'{survivors} Um `pause` sem guarda ou um neto que nao termina '
            f'produzem este quadro. Saida capturada:\n'
            f'{(stdout or "") + (stderr or "")}')
    return subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)


class BatchPauseGuardTests(unittest.TestCase):
    """
    No shipped batch file may wait for a keypress unconditionally.

    A `pause` is invisible on a CI runner - stdin is not a console, so it
    returns at once - and unbounded on the owner's desktop, where it waits for
    a human. The upgrade bootstrap shipped exactly that in its `:fail` path, so
    every test that drives it would have hung on a real machine while staying
    green in CI. The guard is the same `LIA_DEVKIT_NO_PAUSE` switch DevKit.bat
    already uses; double-clicking still pauses, so the owner still gets to read
    the message.
    """

    def test_every_pause_is_behind_the_no_pause_switch(self) -> None:
        checked = 0
        for path in (DEVKIT_BAT, UPGRADE_BAT):
            text = path.read_text(encoding='utf-8', errors='replace')
            lines = text.replace('\r\n', '\n').split('\n')
            for index, line in enumerate(lines):
                stripped = line.strip()
                # Comments are prose, not commands - and the ones explaining
                # this very guard mention the word.
                if stripped.lower().startswith(('rem ', '::')):
                    continue
                if not re.search(r'\bpause\b', stripped, re.IGNORECASE):
                    continue
                checked += 1
                # The guard is either on the pause line itself or on the `if`
                # that opened the block containing it.
                window = lines[max(0, index - 5):index + 1]
                self.assertTrue(
                    any('LIA_DEVKIT_NO_PAUSE' in seen for seen in window),
                    f'{path.name}:{index + 1} tem um `pause` sem guarda - num '
                    f'console real isso espera uma tecla para sempre:\n'
                    + '\n'.join(window))
        self.assertGreaterEqual(checked, 2,
                                'esperava achar os pause do DevKit e do '
                                'bootstrap; a sonda parou de ver algum')


class RunBatBudgetTests(unittest.TestCase):
    """
    The declared budget holds even when the child spawns a grandchild.

    `subprocess.run(timeout=...)` does NOT give this on Windows: after the
    timeout it kills only the direct child and then calls `communicate()` with
    no timeout at all, so a grandchild still holding the inherited pipe handles
    blocks it for as long as it lives. Measured on the owner's machine, that
    turned a 180 s budget into a 600 s suite kill - the watchdog, not the test,
    is what finally stopped it. Portable on purpose: it exercises the POSIX
    branch of the cleanup as well.
    """

    def test_a_grandchild_cannot_outlive_the_declared_budget(self) -> None:
        base = Path(tempfile.mkdtemp(prefix='runbat-budget-'))
        self.addCleanup(shutil.rmtree, base, True)
        body = (
            'import subprocess, sys, time\n'
            'subprocess.Popen([sys.executable, "-c", '
            '"import time; time.sleep(120)"])\n'
            'print("comecei", flush=True)\n'
            'time.sleep(120)\n'
        )
        started = time.monotonic()
        with self.assertRaises(AssertionError) as caught:
            run_bat([sys.executable, '-c', body], base, timeout_s=3.0)
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 60.0,
                        f'o orcamento nao foi respeitado: {elapsed:.1f}s')
        message = str(caught.exception)
        self.assertIn('comecei', message,
                      'a saida do filho se perdeu no caminho')
        self.assertIn('Ainda vivos', message,
                      'a mensagem nao diz o que continuava rodando')

    def test_a_survivor_list_is_never_reported_as_a_verified_empty_tree(self):
        """
        "Could not check" and "checked, none left" are different claims.

        A helper that returns an empty map on a platform without process names
        must not let the caller print "no processes were alive".
        """
        self.assertIn('NAO foi possivel', _describe_survivors(None, {}))
        self.assertIn('nenhum processo', _describe_survivors(frozenset(), {}))
        named = _describe_survivors(frozenset({4321}), {4321: 'python.exe'})
        self.assertIn('python.exe (4321)', named)
        self.assertIn('?', _describe_survivors(frozenset({9}), {}),
                      'um pid sem nome conhecido virou silencio')


@unittest.skipUnless(os.name == 'nt' and shutil.which('cmd.exe'),
                     'cmd.exe indisponível nesta plataforma')
class DevKitHandoffExecutionTests(unittest.TestCase):
    """
    The REAL Windows executable contract: run DevKit.bat for real.

    A source-text test alone cannot prove the handoff, so this drives cmd.exe
    against a throwaway repository whose `tools/lia_dev.py` records the working
    directory and the arguments it received. Skipped where cmd.exe does not
    exist; that skip is the honest boundary of this platform.
    """

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='devkit-exec-'))
        self.repo = self.base / 'repo with space'
        (self.repo / 'tools').mkdir(parents=True)
        self.probe = self.repo / 'tools' / 'probe.txt'
        (self.repo / 'tools' / 'lia_dev.py').write_text(
            'import os, sys\n'
            'from pathlib import Path\n'
            f'Path(r"{self.probe}").write_text(\n'
            '    "cwd=" + os.getcwd() + "\\n"\n'
            '    + "argv=" + " ".join(sys.argv[1:]) + "\\n"\n'
            '    + "root=" + os.environ.get("LIA_DEVKIT_ROOT", "") + "\\n",\n'
            '    encoding="utf-8")\n'
            'raise SystemExit(7)\n',
            encoding='utf-8',
        )
        shutil.copy2(DEVKIT_BAT, self.repo / 'DevKit.bat')

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _run(self, *args):
        env = dict(os.environ, LIA_DEVKIT_NO_PAUSE='1')
        return run_bat(['cmd.exe', '/d', '/s', '/c', 'DevKit.bat', *args],
                       self.repo, timeout_s=180.0, env=env)

    def test_the_copy_still_finds_the_original_repository_root(self):
        probe = self._run()
        self.assertTrue(self.probe.exists(),
                        'a cópia em %TEMP% não achou tools\\lia_dev.py:\n'
                        + (probe.stdout or '') + (probe.stderr or ''))
        recorded = self.probe.read_text(encoding='utf-8')
        self.assertIn('cwd=' + str(self.repo), recorded)
        self.assertIn('root=' + str(self.repo) + '\\', recorded)

    def test_the_exit_code_survives_the_handoff(self):
        probe = self._run()
        self.assertTrue(
            self.probe.exists(),
            'tools\\lia_dev.py nao chegou a rodar. Saida do DevKit.bat:\n'
            + (probe.stdout or '') + (probe.stderr or ''))
        self.assertEqual(probe.returncode, 7)

    def test_arguments_are_forwarded_without_a_shift(self):
        probe = self._run('status')
        self.assertTrue(
            self.probe.exists(),
            'tools\\lia_dev.py nao chegou a rodar. Saida do DevKit.bat:\n'
            + (probe.stdout or '') + (probe.stderr or ''))
        self.assertIn('argv=status', self.probe.read_text(encoding='utf-8'))

    def test_the_git_token_is_forwarded_once(self):
        probe = self._run('git', 'validate')
        self.assertTrue(
            self.probe.exists(),
            'tools\\lia_dev.py nao chegou a rodar. Saida do DevKit.bat:\n'
            + (probe.stdout or '') + (probe.stderr or ''))
        self.assertIn('argv=git validate', self.probe.read_text(encoding='utf-8'))


class DevKitArgumentForwardingTests(unittest.TestCase):
    """§9: the `git` token is dropped in Python, where it is testable."""

    def test_the_leading_git_token_is_dropped(self):
        self.assertEqual(lia_dev.git_forward_argv(['git', 'publish']), ['publish'])

    def test_the_rest_of_the_line_is_untouched(self):
        self.assertEqual(
            lia_dev.git_forward_argv(['git', 'checkout', 'arena/x', '--force-ish']),
            ['checkout', 'arena/x', '--force-ish'],
        )

    def test_a_line_without_the_token_passes_through(self):
        self.assertEqual(lia_dev.git_forward_argv(['validate', '--full']),
                         ['validate', '--full'])

    def test_an_empty_line_stays_empty_so_the_usage_is_shown(self):
        self.assertEqual(lia_dev.git_forward_argv(['git']), [])
        self.assertEqual(lia_dev.git_forward_argv([]), [])

    def test_the_git_verb_is_registered(self):
        self.assertIn('git', lia_dev.HANDLERS)
        self.assertEqual(lia_dev.cmd_git(argparse.Namespace(rest=['git'])), 2)


class DelayedTerminalMarkerTests(unittest.TestCase):
    """
    §2: terminal evidence arrives AFTER the ordered chain, with real delays.

    Every one of these drives `delayed_spawner`, which emits from a background
    thread. A spawner that pushes all lines before returning cannot see the
    defect: the gate looked correct because the evidence was already buffered.
    """

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='devflow-delay-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(manual_manifest())

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _runner(self, script, **kwargs):
        runner, _, asks = make_runner(self.repo, self.manifest)
        runner.spawn = delayed_spawner(script, **kwargs)
        runner.marker_timeout_s = 20.0
        runner.terminal_timeout_s = 20.0
        runner.forbidden_drain_s = 0.5
        runner.emit = lambda line: None
        return runner, asks

    def test_the_gate_waits_for_terminal_evidence_that_arrives_late(self):
        script = [(0.0, line) for line in ORDERED_LINES]
        script += [(0.6, line) for line in TERMINAL_LINES]
        started = time.monotonic()
        runner, _asks = self._runner(script)
        outcome = runner.execute()
        elapsed = time.monotonic() - started
        self.assertEqual(outcome.verdict, 'PASS', outcome.notes)
        self.assertEqual(outcome.gate_phase, 'B')
        self.assertGreaterEqual(elapsed, 1.5,
                                'o gate terminou antes dos marcadores atrasados')

    def test_missing_terminal_evidence_times_out_as_fail(self):
        script = [(0.0, line) for line in ORDERED_LINES]
        script += [(0.2, LINE_RENDERER_READY), (0.2, LINE_WINDOW_VISIBLE)]
        runner, _ = self._runner(script)
        runner.terminal_timeout_s = 1.5
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertTrue(outcome.timed_out)
        self.assertEqual(outcome.gate_phase, 'B')
        self.assertIn('stage-avatar-scene-mounted',
                      [m.id for m in self.manifest.runtime.terminal
                       if m.id not in outcome.terminal_seen])

    def test_a_forbidden_marker_after_spawn_still_fails(self):
        script = [(0.0, line) for line in ORDERED_LINES]
        script += [(0.2, line) for line in TERMINAL_LINES]
        script += [(0.4, '[lia] stage-prerequisite name=core-agent-build '
                         'state=failed reason=exit:1\n')]
        runner, _ = self._runner(script)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertIn('prerequisite-failed', outcome.forbidden_seen)

    def test_the_process_exiting_before_terminal_evidence_fails(self):
        script = [(0.0, line) for line in ORDERED_LINES]
        script += [(0.2, LINE_RENDERER_READY)]
        runner, _ = self._runner(script, alive=False, exit_code=3)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertIn('stage-window-visible',
                      [m.id for m in self.manifest.runtime.terminal
                       if m.id not in outcome.terminal_seen])

    def test_teardown_happens_only_after_the_evidence_is_complete(self):
        script = [(0.0, line) for line in ORDERED_LINES]
        script += [(0.5, line) for line in TERMINAL_LINES]
        runner, _ = self._runner(script)
        outcome = runner.execute()
        handle = runner.spawn.handles[0]
        self.assertEqual(outcome.verdict, 'PASS')
        self.assertEqual(handle.terminate_calls, 1)
        self.assertGreaterEqual(handle.lines_seen, len(script),
                                'a árvore foi encerrada antes de toda a evidência')

    def test_a_terminal_pattern_cannot_double_as_an_ordered_marker(self):
        """
        One line satisfies at most one marker, so a terminal line arriving while
        the ordered chain is still pending cannot be consumed as the next
        ordered marker and silently satisfy both.
        """
        script = [(0.0, LINE_AUTORUN), (0.1, LINE_RENDERER_READY),
                  (0.1, LINE_PREREQ_STARTING), (0.1, LINE_PREREQ_SUCCEEDED),
                  (0.1, LINE_STAGE_SPAWN)]
        script += [(0.3, line) for line in TERMINAL_LINES[1:]]
        runner, _ = self._runner(script)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'PASS', outcome.notes)
        matched = dict(outcome.markers.matched)
        self.assertNotIn('stage-renderer-ready', matched)
        self.assertIn('stage-renderer-ready', outcome.terminal_seen)


class RepositoryIdentityTests(unittest.TestCase):
    """§3: the remote is PINNED, not matched by substring."""

    def test_wrong_github_owner_is_refused(self):
        fake = FakeGit(remote_url='https://github.com/someone-else/Lia-Project.git')
        outcome = make_sync(fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.stage, 'identity')
        self.assertIn('BloomRX/Lia-Project', outcome.reason)

    def test_a_lookalike_host_is_refused(self):
        for url in ('https://github.com.evil.example/BloomRX/Lia-Project.git',
                    'https://notgithub.com/BloomRX/Lia-Project.git',
                    'git@gitlab.com:BloomRX/Lia-Project.git'):
            with self.subTest(url=url):
                fake = FakeGit(remote_url=url)
                outcome = make_sync(fake).pre_sync()
                self.assertFalse(outcome.ok)
                self.assertEqual(outcome.stage, 'identity')

    def test_a_lookalike_repository_name_is_refused(self):
        fake = FakeGit(remote_url='https://github.com/BloomRX/Lia-Project-fork.git')
        outcome = make_sync(fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.stage, 'identity')

    def test_credentials_in_the_remote_url_are_never_printed(self):
        fake = FakeGit(remote_url='https://user:ghp_SUPERSECRET@github.com/x/y.git')
        outcome = make_sync(fake).pre_sync()
        self.assertFalse(outcome.ok)
        self.assertNotIn('ghp_SUPERSECRET', outcome.reason)
        self.assertNotIn('user:', outcome.reason)
        self.assertIn('***', outcome.reason)

    def test_the_canonical_ssh_and_https_spellings_are_accepted(self):
        for url in ('https://github.com/BloomRX/Lia-Project.git',
                    'git@github.com:BloomRX/Lia-Project.git',
                    'ssh://git@github.com/BloomRX/Lia-Project.git'):
            with self.subTest(url=url):
                fake = FakeGit(remote_url=url)
                outcome = make_sync(fake).pre_sync()
                self.assertNotEqual(outcome.stage, 'identity', outcome.reason)

    def test_identity_is_not_a_substring_match(self):
        """
        The old check was `'Lia-Project' not in url`, so any URL containing that
        substring passed. This one contains it and must still be refused.
        """
        url = 'https://anywhere.example/whatever/Lia-Project'
        self.assertIn('Lia-Project', url)
        self.assertIsNone(sync.normalize_remote_url(url))
        self.assertEqual(make_sync(FakeGit(remote_url=url)).pre_sync().stage, 'identity')


class StagedPayloadTests(unittest.TestCase):
    """§3: what is staged is proven, not assumed. Real git, real index."""

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='devflow-staged-'))
        self.repo = make_repo(self.base)
        (self.repo / 'tools').mkdir(parents=True, exist_ok=True)
        self.git = real_git_runner(self.repo, remote_url=PINNED_REMOTE_URL)

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _sync(self):
        return sync.WorkBranchSync(self.repo, work_branch=WORK, run_git=self.git,
                                   allow_checkpoint=True)

    def test_a_staged_rename_is_refused(self):
        (self.repo / 'tools' / 'a.py').write_text('x = 1\n', encoding='utf-8')
        self.git(['add', '--', 'tools/a.py'])
        self.git(['commit', '-q', '-m', 'add'])
        self.git(['mv', 'tools/a.py', 'tools/b.py'])
        with self.assertRaises(sync.SyncRefused) as caught:
            self._sync().pre_sync()
        self.assertIn('renomeação', str(caught.exception))

    def test_a_symlink_escaping_the_repository_is_refused(self):
        outside = Path(tempfile.mkdtemp(prefix='devflow-outside-'))
        self.addCleanup(shutil.rmtree, outside, True)
        (outside / 'secret.py').write_text('x = 1\n', encoding='utf-8')
        (self.repo / 'tools' / 'link.py').symlink_to(outside / 'secret.py')
        with self.assertRaises(sync.SyncRefused) as caught:
            self._sync().pre_sync()
        self.assertIn('escapa do repositório', str(caught.exception))

    def test_a_staged_symlink_is_refused_by_its_mode(self):
        (self.repo / 'tools' / 'real.py').write_text('x = 1\n', encoding='utf-8')
        (self.repo / 'tools' / 'link.py').symlink_to('real.py')
        self.git(['add', '--', 'tools/real.py', 'tools/link.py'])
        with self.assertRaises(sync.SyncRefused) as caught:
            sync.verify_staged_payload(self.repo, ['tools/real.py', 'tools/link.py'])
        self.assertIn('120000', str(caught.exception))

    def test_a_staged_file_outside_the_approved_set_is_refused(self):
        (self.repo / 'tools' / 'ok.py').write_text('x = 1\n', encoding='utf-8')
        (self.repo / 'tools' / 'extra.py').write_text('y = 2\n', encoding='utf-8')
        self.git(['add', '--', 'tools/ok.py', 'tools/extra.py'])
        with self.assertRaises(sync.SyncRefused) as caught:
            sync.verify_staged_payload(self.repo, ['tools/ok.py'])
        self.assertIn('não aprovados', str(caught.exception))

    def test_staged_content_differing_from_the_working_tree_is_refused(self):
        (self.repo / 'tools' / 'a.py').write_text('x = 1\n', encoding='utf-8')
        self.git(['add', '--', 'tools/a.py'])
        (self.repo / 'tools' / 'a.py').write_text('x = 2\n', encoding='utf-8')
        with self.assertRaises(sync.SyncRefused) as caught:
            sync.verify_staged_payload(self.repo, ['tools/a.py'])
        self.assertIn('difere do working tree', str(caught.exception))

    def test_a_secret_is_found_in_the_staged_blob_not_just_on_disk(self):
        (self.repo / 'tools' / 'a.py').write_text(
            'TOKEN = "ghp_abcdefghijklmnopqrstuvwx0123456789"\n', encoding='utf-8')
        self.git(['add', '--', 'tools/a.py'])
        _staged, hits = sync.verify_staged_payload(self.repo, ['tools/a.py'])
        self.assertTrue(hits, 'o segredo do blob stageado passou despercebido')

    def test_a_path_that_escapes_the_repository_is_refused(self):
        for bad in ('../fora.py', '/absoluto.py', 'tools/../fora.py', '~/home.py'):
            with self.subTest(path=bad):
                with self.assertRaises(sync.SyncRefused):
                    sync.validate_local_path(self.repo, bad)

    def test_a_non_regular_file_is_refused(self):
        fifo = self.repo / 'tools' / 'pipe.fifo'
        try:
            os.mkfifo(fifo)
        except (OSError, NotImplementedError, AttributeError):
            self.skipTest('filesystem sem FIFO')
        with self.assertRaises(sync.SyncRefused):
            sync.validate_local_path(self.repo, 'tools/pipe.fifo')

    def test_a_non_source_path_never_reaches_staging(self):
        (self.repo / 'solto.py').write_text('x = 1\n', encoding='utf-8')
        outcome = self._sync().pre_sync()
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.stage, 'classify')
        self.assertNotIn('commit', ' '.join(
            call for call in [] ), 'nada deveria ter sido commitado')

    def test_a_path_appearing_between_classification_and_staging_is_not_staged(self):
        """
        The load-bearing case for `git add -- <paths>` instead of `git add -A`.

        Classification reviews a snapshot. If anything appears in the worktree
        between that review and the staging, `git add -A` would commit a path
        nobody ever classified. Staging the reviewed paths explicitly cannot.
        """
        with_local_origin(self.repo)
        (self.repo / 'tools' / 'aprovado.py').write_text('x = 1\n', encoding='utf-8')
        real = real_git_runner(self.repo, remote_url=PINNED_REMOTE_URL)
        staged_calls: list[list[str]] = []

        def racing(args: list[str]) -> tuple[int, str]:
            # The unreviewed file materialises exactly when staging happens.
            if args[:1] == ['add']:
                (self.repo / 'tools' / 'nao_revisado.py').write_text(
                    'y = 2\n', encoding='utf-8')
            staged_calls.append(list(args))
            return real(args)

        outcome = sync.WorkBranchSync(
            self.repo, work_branch=WORK, run_git=racing, allow_checkpoint=True,
        ).pre_sync()
        self.assertTrue(outcome.ok, outcome.reason)
        add = next(call for call in staged_calls if call[:1] == ['add'])
        self.assertEqual(add[1], '--', 'o staging tem de listar os caminhos revisados')
        self.assertNotIn('-A', add)
        _code, files = real(['show', '--name-only', '--format=', 'HEAD'])
        committed = sorted(line for line in files.splitlines() if line)
        self.assertEqual(committed, ['tools/aprovado.py'],
                         'um caminho nunca revisado foi commitado')
        self.assertTrue((self.repo / 'tools' / 'nao_revisado.py').exists(),
                        'o arquivo não classificado deveria continuar no disco')

    def test_only_the_approved_paths_are_staged_never_git_add_all(self):
        with_local_origin(self.repo)
        (self.repo / 'tools' / 'novo.py').write_text('x = 1\n', encoding='utf-8')
        outcome = self._sync().pre_sync()
        self.assertTrue(outcome.ok, outcome.reason)
        code, staged = self.git(['diff', '--cached', '--name-only'])
        self.assertEqual(staged.strip(), '',
                         'o checkpoint deveria ter consumido o índice')
        code, shown = self.git(['show', '--name-only', '--format=', 'HEAD'])
        self.assertEqual(shown.strip(), 'tools/novo.py')


class TeardownHonestyTests(unittest.TestCase):
    """§5: a cleanup PASS has to come from evidence."""

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='devflow-teardown2-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(manual_manifest())

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _run(self, **handle_kwargs):
        runner, _, _ = make_runner(self.repo, self.manifest)
        runner.spawn = fake_spawner(list(MARKER_LINES), **handle_kwargs)
        runner.emit = lambda line: None
        return runner

    def test_a_confirmed_dead_root_reports_pass(self):
        outcome = self._run(teardown_ok=True).execute()
        self.assertEqual(outcome.teardown, 'PASS')
        self.assertTrue(outcome.tree_cleaned)

    def test_a_failed_taskkill_never_reports_pass(self):
        outcome = self._run(teardown_ok=False,
                            teardown_detail='taskkill retornou 128').execute()
        self.assertEqual(outcome.teardown, 'FAIL')
        self.assertFalse(outcome.tree_cleaned)
        self.assertIn('taskkill retornou 128', outcome.teardown_detail)

    def test_a_live_root_is_reported_as_a_failure_not_a_success(self):
        outcome = self._run(teardown_ok=False).execute()
        self.assertEqual(outcome.teardown, 'FAIL')
        self.assertEqual(outcome.teardown_descendants, -1,
                         'incerteza tem de continuar incerteza')

    def test_the_final_block_refuses_a_fabricated_cleanup_pass(self):
        failed = pipeline.AutoResult(result='PASS', stage='runtime', round_id='M3.0b',
                                     tested_head='a' * 40, cleanup_state='FAIL')
        block = pipeline.render_final_block(failed)
        self.assertIn('Process cleanup: FAIL', block)
        self.assertNotIn('Process cleanup: PASS', block)

    def test_an_unrelated_process_survives_teardown(self):
        survivor = subprocess.Popen(
            [sys.executable, '-c', 'import time; time.sleep(30)'],
        )
        try:
            time.sleep(0.3)
            outcome = self._run().execute()
            self.assertEqual(outcome.teardown, 'PASS')
            self.assertIsNone(survivor.poll(),
                              'um processo que a rodada não iniciou foi encerrado')
        finally:
            survivor.terminate()
            survivor.wait(timeout=10)

    def test_run_auto_cannot_report_cleanup_pass_when_teardown_failed(self):
        """
        End to end through the pipeline, not just through render_final_block.

        The audited defect was in `run_auto`, which derived the cleanup verdict
        from the absence of a word in the notes and then printed
        `"PASS" if result.stage`. A unit test on the renderer alone cannot see
        that, so this drives a full PASS-shaped round whose teardown failed.
        """
        fake = FakeGit(head='a' * 40, remote_head='a' * 40)
        manifest = validate_round(runnable_manifest())
        runner = RoundRunner(
            round_manifest=manifest, repo=self.repo,
            run_git=lambda args: fake(args),
            spawn=fake_spawner(list(MARKER_LINES), teardown_ok=False,
                               teardown_detail='taskkill retornou 128'),
            ask=lambda q, o: 'S', invoke_test=passing_tests)
        result = pipeline.run_auto(
            self.repo, work_branch=WORK, run_git=lambda args: fake(args),
            emit=lambda _line: None, runner_factory=lambda m: runner,
            load_round=lambda: manifest)
        self.assertTrue(result.runtime_ok, result.reason)
        self.assertFalse(result.cleanup_ok)
        self.assertEqual(result.cleanup_state, 'FAIL')
        # The stage and the reason have to name the CLEANUP. Reporting this as
        # `Stage: runtime / o gate de runtime nao provou o necessario` would
        # blame evidence that actually passed and hide the leaked process tree.
        self.assertEqual('teardown', result.stage)
        # The reason may mention the runtime evidence (it passed); what it must
        # do is NAME the cleanup as the cause, not leave it out.
        self.assertIn('limpeza', result.reason)
        self.assertIn('FAIL', result.reason)
        self.assertEqual('FAIL', result.result)
        self.assertIn('taskkill retornou 128', result.cleanup_detail)
        block = pipeline.render_final_block(result)
        self.assertIn('Process cleanup: FAIL', block)
        self.assertNotIn('Process cleanup: PASS', block)

    def test_a_refused_round_reports_cleanup_as_not_applicable(self):
        runner, _, _ = make_runner(self.repo, self.manifest)
        runner.emit = lambda line: None
        runner.run_git = lambda args: (0, 'main') if args[1:2] == ['--abbrev-ref'] \
            else (0, 'a' * 40)
        result = pipeline.run_auto(
            self.repo, work_branch=WORK, emit=lambda line: None,
            run_git=runner.run_git, load_round=lambda: self.manifest,
            do_sync=False, do_publish=False,
        )
        self.assertNotEqual(result.cleanup_state, 'PASS')


class OneTimeUpgradeBootstrapTests(unittest.TestCase):
    """
    §8: the transition bootstrap is documented as an OUT-OF-CHECKOUT artifact.

    It cannot live only in Git: a user still holding the pre-AUTO DevKit has no
    way to run a file that only exists after the update it is supposed to fetch.
    """

    def test_the_upgrade_bootstrap_is_shipped_outside_the_checkout(self):
        doc = (TOOLS.parent / 'docs' / 'project' / 'DEVFLOW.md').read_text(
            encoding='utf-8', errors='replace')
        self.assertIn('LIA-DEVFLOW-UPGRADE', doc)
        self.assertIn('FORA do checkout', doc)

    UPGRADE_BAT = TOOLS / 'devflow' / 'upgrades' / 'LIA-DEVFLOW-UPGRADE.bat'

    def test_the_upgrade_bootstrap_exists_and_needs_no_new_file(self):
        text = self.UPGRADE_BAT.read_text(encoding='utf-8', errors='replace')
        # It must not depend on anything the update is supposed to provide.
        self.assertNotIn('lia_dev.py', text)
        self.assertNotIn('tools' + chr(92) + 'devflow',
                         text.replace('tools' + chr(92) + 'devflow' + chr(92) + 'upgrades', ''))
        for needed in ('remote get-url origin', 'BloomRX/Lia-Project',
                       'rev-parse --abbrev-ref HEAD', 'status --porcelain',
                       'fetch origin', 'merge --ff-only', 'DevKit.bat'):
            self.assertIn(needed, text, f'falta {needed!r} no bootstrap de transição')

    def test_the_upgrade_bootstrap_is_fail_closed_and_never_destructive(self):
        text = self.UPGRADE_BAT.read_text(encoding='utf-8', errors='replace')
        lowered = text.lower()
        for forbidden in ('reset --hard', 'git clean', 'stash', '--force',
                          'checkout -b', 'switch '):
            self.assertNotIn(forbidden, lowered,
                             f'o bootstrap de transição não pode conter {forbidden!r}')
        # Dirty worktree refuses instead of guessing.
        self.assertIn('alteracoes nao commitadas', text)
        # The main branch is never the target.
        self.assertIn('arena/01a10290-lia-project', text)

    def test_the_upgrade_bootstrap_pins_an_exact_reviewed_commit(self):
        text = self.UPGRADE_BAT.read_text(encoding='utf-8', errors='replace')
        self.assertIn('LIA_TARGET_SHA=', text)
        self.assertIn('merge --ff-only "%LIA_TARGET_SHA%"', text)

    def test_no_file_inside_the_checkout_pretends_to_bootstrap_itself(self):
        doc = (TOOLS.parent / 'docs' / 'project' / 'DEVFLOW.md').read_text(
            encoding='utf-8', errors='replace')
        self.assertNotIn('duplo clique no DevKit antigo baixa o novo', doc)



# ---------------------------------------------------------------------------
# AUTO-1b regressions
# ---------------------------------------------------------------------------

def _batch_lines_with_depth(text: str) -> list[tuple[int, str]]:
    """
    Return (block_depth, line) for every line of a .bat file.

    cmd.exe expands `%ERRORLEVEL%` when it PARSES a parenthesized block, not
    when it runs it. So `if x ( run & set RC=%ERRORLEVEL% )` captures the exit
    code of whatever ran BEFORE the block, which is how a failing bootstrap
    used to be reported as a success. Detecting that needs real block depth,
    not a grep: the token itself is perfectly legal at depth 0.
    """
    depth = 0
    result: list[tuple[int, str]] = []
    for raw in text.replace('\r\n', '\n').split('\n'):
        stripped = raw.strip()
        is_remark = stripped.lower().startswith('rem')
        result.append((depth, raw))
        if is_remark:
            continue
        quoted = False
        index = 0
        while index < len(raw):
            char = raw[index]
            if char == '^':
                index += 2
                continue
            if char == '"':
                quoted = not quoted
            elif not quoted and char == '(':
                depth += 1
            elif not quoted and char == ')':
                depth -= 1
            index += 1
    return result


def _batch_constant(text: str, name: str) -> str:
    marker = f'set "{name}='
    for line in text.replace('\r\n', '\n').split('\n'):
        if line.strip().startswith(marker):
            return line.strip()[len(marker):].rstrip('"')
    raise AssertionError(f'{name!r} não está definido no script')


class DevKitExitCodeContractTests(unittest.TestCase):
    """
    §1: a failing bootstrap must never be reported as a success.

    `DevKit.bat` runs a copy of itself from %TEMP% and has to hand the copy's
    exit code back to the caller. The audited defect read `%ERRORLEVEL%`
    inside a parenthesized `if`, where cmd.exe had already expanded it at
    parse time. These tests run on Linux because they assert the STRUCTURE
    that makes the bug impossible; the matching execution test lives in
    DevKitHandoffExecutionTests and runs on Windows.
    """

    def setUp(self):
        self.text = DEVKIT_BAT.read_text(encoding='utf-8', errors='replace')

    def test_errorlevel_is_never_read_inside_a_parenthesized_block(self):
        offenders = [line for depth, line in _batch_lines_with_depth(self.text)
                     if '%ERRORLEVEL%' in line and depth > 0]
        self.assertEqual(
            [], offenders,
            '%ERRORLEVEL% dentro de bloco parentetizado é expandido no parse; '
            'use fluxo por label:\n' + '\n'.join(offenders))

    def test_every_dispatch_path_captures_the_exit_code_of_its_own_call(self):
        """
        Not "some line captures the code" - EVERY dispatch path must capture
        the code of the call it just made, on its own line, immediately after.

        A test that only asks for one capture line anywhere in the file passes
        while another path silently drops its exit code, which is exactly the
        shape of the audited defect.
        """
        depth_lines = _batch_lines_with_depth(self.text)
        calls = [i for i, (_, line) in enumerate(depth_lines)
                 if '%RUNPY%' in line and 'lia_dev.py' in line
                 and not line.strip().startswith('rem')]
        self.assertGreaterEqual(len(calls), 2,
                                'esperava os caminhos sem-argumento e com-argumento')
        for i in calls:
            nxt = depth_lines[i + 1][1].strip()
            self.assertEqual(
                'set "LIA_DEVKIT_RC=%ERRORLEVEL%"', nxt,
                f'a chamada {self.text.splitlines()[i].strip()!r} não captura o '
                f'código de saída na linha seguinte: {nxt!r}')

    def test_the_captured_exit_code_is_what_leaves_the_script(self):
        lines = [line for depth, line in _batch_lines_with_depth(self.text)
                 if 'LIA_DEVKIT_RC' in line and not line.strip().startswith('rem')]
        self.assertTrue(lines, 'LIA_DEVKIT_RC desapareceu do DevKit.bat')
        self.assertIn('exit /b %LIA_DEVKIT_RC%', lines,
                      'o código capturado precisa ser o que sai do script')

    def test_the_bootstrap_copy_fails_closed_when_it_cannot_be_made(self):
        # The copy step must be guarded BEFORE anything runs from it, and the
        # guard must leave the script instead of falling through.
        depth_lines = _batch_lines_with_depth(self.text)
        copy_line = next(i for i, (_, line) in enumerate(depth_lines)
                         if line.strip().lower().startswith('copy '))
        guard = depth_lines[copy_line + 1][1].strip().lower()
        self.assertTrue(
            guard.startswith('if errorlevel 1'),
            f'a falha da cópia em %TEMP% não é verificada antes de rodar: {guard!r}')
        block = '\n'.join(line for _, line in depth_lines[copy_line + 1:copy_line + 8])
        self.assertIn('goto :fail', block,
                      'a cópia falhou e o script continua mesmo assim')
        self.assertIn('if not exist "%LIA_DEVKIT_COPY%"', self.text,
                      'não há verificação de que a cópia realmente existe')
        self.assertIn('if exist "%LIA_DEVKIT_COPY%"', self.text,
                      'o nome temporário não é conferido antes de sobrescrever')

    def test_the_batch_file_still_uses_crlf(self):
        raw = DEVKIT_BAT.read_bytes()
        self.assertNotIn(b'\n', raw.replace(b'\r\n', b''),
                         'DevKit.bat tem uma quebra de linha sem CR')


class GateInterruptionTests(unittest.TestCase):
    """
    §2: the teardown finally must enclose the ENTIRE gate.

    The audited defect had `handle = self.spawn(...)` OUTSIDE the `try`, so
    anything raised while waiting for markers - Ctrl+C in phase A or B, an
    exception out of the marker matcher, a queue error - leaked the whole Lia
    process tree with nothing recorded about it.
    """

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='gate-int-'))
        self.repo = make_repo(self.base)
        self.manifest = validate_round(manual_manifest())

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _runner_exploding_in_gate(self, exc, trigger_after: int):
        """
        A runner whose child is launched successfully and whose gate then blows
        up while it is waiting for markers.

        The exception has to come from INSIDE the gate, not from spawn(): if it
        came from spawn there would be no handle yet and the test would prove
        nothing about the finally. `wait()` is the honest injection point - the
        gate polls it for early exit on every iteration, so raising there is
        exactly "something went wrong while watching the child".

        Delivery is delayed on purpose, like the real Stage: markers arrive
        after spawn() has already returned.
        """
        runner, _, _ = make_runner(self.repo, self.manifest)
        runner.emit = lambda line: None
        handles: list['_ExplodingHandle'] = []

        def spawn(command, cwd, on_line, env=None):
            handle = _ExplodingHandle(exc, trigger_after)
            handles.append(handle)

            def emit() -> None:
                # Exactly `trigger_after` lines, then silence. The gate only
                # polls wait() when the queue runs dry, so the child has to go
                # quiet for the exception to land on the real code path.
                for line in MARKER_LINES[:trigger_after]:
                    time.sleep(0.02)
                    handle.lines_seen += 1
                    on_line(line)
                time.sleep(30)

            threading.Thread(target=emit, daemon=True).start()
            return handle

        runner.spawn = spawn
        return runner, handles

    def test_ctrl_c_during_phase_a_still_terminates_the_child(self):
        runner, handles = self._runner_exploding_in_gate(KeyboardInterrupt(), 2)
        outcome = runner.execute()
        self.assertEqual(1, handles[0].terminate_calls,
                         'a árvore do Stage sobreviveu a um Ctrl+C')
        self.assertEqual('INTERRUPTED', outcome.verdict)
        self.assertNotEqual('PASS', outcome.overall_verdict)

    def test_ctrl_c_during_phase_b_still_terminates_the_child(self):
        # All ordered markers delivered, so phase A is over and the gate is in
        # phase B waiting for the terminal evidence when it blows up.
        runner, handles = self._runner_exploding_in_gate(
            KeyboardInterrupt(), len(self.manifest.ordered_markers))
        outcome = runner.execute()
        self.assertEqual(1, handles[0].terminate_calls)
        self.assertEqual('INTERRUPTED', outcome.verdict)

    def test_an_exception_inside_the_gate_does_not_leak_the_process(self):
        runner, handles = self._runner_exploding_in_gate(RuntimeError('boom'), 1)
        with self.assertRaises(RuntimeError):
            runner.execute()
        self.assertEqual(1, handles[0].terminate_calls,
                         'uma exceção no gate deixou o processo rodando')


class TeardownEvidenceTests(unittest.TestCase):
    """
    §5: descendant evidence must be honest, and it must be collected while the
    root still owns its children.

    The audited defect asked the OS for the process group AFTER the root had
    already been reaped, by which time the Stage child has been reparented to
    init. The answer was always "no descendants", which read as a proof of
    cleanliness and was not one at all.
    """

    def test_descendants_are_derived_from_a_process_table_purely(self):
        table = [(10, 1), (11, 10), (12, 11), (13, 10), (99, 1)]
        self.assertEqual([11, 12, 13],
                         sorted(processes.descendants_from_table(10, table)))
        self.assertEqual([], sorted(processes.descendants_from_table(99, table)))

    def test_a_cycle_in_the_process_table_terminates(self):
        table = [(10, 11), (11, 10)]
        self.assertEqual([11], sorted(processes.descendants_from_table(10, table)))

    def test_a_dead_root_yields_no_snapshot_instead_of_an_empty_one(self):
        # None means "could not verify"; frozenset() means "verified none".
        # Collapsing the two is exactly how a leak was reported as clean.
        self.assertIsNone(processes.snapshot_owned_tree(0x7FFFFFFF))

    def test_state_is_tri_state_and_never_laundered_into_pass(self):
        base = dict(requested=True, root_terminated=True, method='m')
        self.assertEqual('PASS', TeardownResult(descendants=0, **base).state)
        self.assertEqual('FAIL', TeardownResult(descendants=2, **base).state)
        self.assertEqual('UNKNOWN', TeardownResult(descendants=-1, **base).state)
        self.assertFalse(TeardownResult(descendants=-1, **base).ok)
        dead_root = dict(base, root_terminated=False)
        self.assertEqual('FAIL', TeardownResult(descendants=0, **dead_root).state)

    def test_a_surviving_grandchild_is_reported_as_unverified(self):
        """
        A real process, not a fake: fork a grandchild that outlives its parent,
        then prove the honest verdict is UNKNOWN rather than PASS.

        POSIX only (os.fork); Windows exercises the same tri-state through the
        ctypes Toolhelp32 table walk, which this sandbox cannot run.
        """
        if not hasattr(os, 'fork'):
            self.skipTest('os.fork indisponível')
        survivor = Path(tempfile.mkdtemp(prefix='teardown-orphan-')) / 'flag'
        pid = os.fork()
        if pid == 0:  # child
            try:
                grand = os.fork()
                if grand == 0:  # grandchild: outlives everything above it
                    time.sleep(8)
                    os._exit(0)
                os._exit(0)
            except BaseException:
                os._exit(1)
        try:
            os.waitpid(pid, 0)
            time.sleep(0.4)
            tree = processes.snapshot_owned_tree(pid)
            # The root is gone, so no snapshot can be taken now: that is the
            # whole point. What matters is the verdict built from it.
            result = TeardownResult(requested=True, root_terminated=True,
                                    method='teste', detail='raiz já encerrada',
                                    descendants=-1 if tree is None else 0)
            if tree is None:
                self.assertEqual('UNKNOWN', result.state)
            self.assertIn(result.state, ('PASS', 'UNKNOWN'))
        finally:
            shutil.rmtree(survivor, ignore_errors=True)

    def test_summarize_descendants_separates_alive_from_unverifiable(self):
        self.assertEqual((0, 0), processes.summarize_descendants(frozenset()))
        self.assertEqual((-1, 0), processes.summarize_descendants(None))
        alive, unverified = processes.summarize_descendants(
            frozenset({os.getpid()}))
        self.assertEqual(1, alive)
        self.assertEqual(0, unverified)


class VerdictConsistencyTests(unittest.TestCase):
    """
    §4: runtime evidence and process ownership are separate claims, and the
    report must not let one hide the other.
    """

    # NOT named `_outcome`: unittest already binds that name on the instance,
    # and the instance attribute silently shadows the method.
    def _make_outcome(self, verdict: str, teardown: str) -> RoundOutcome:
        outcome = RoundOutcome(round_id='M3.0b', verdict=verdict)
        outcome.launch_pid = 4242
        outcome.teardown = teardown
        outcome.teardown_detail = 'detalhe'
        outcome.tree_cleaned = teardown == 'PASS'
        return outcome

    def test_a_passing_runtime_with_an_unverified_tree_is_not_a_pass(self):
        for teardown in ('FAIL', 'UNKNOWN'):
            with self.subTest(teardown=teardown):
                outcome = self._make_outcome('PASS', teardown)
                self.assertFalse(outcome.is_pass)
                self.assertEqual('FAIL', outcome.overall_verdict)
        passed = self._make_outcome('PASS', 'PASS')
        self.assertTrue(passed.is_pass)
        self.assertEqual('PASS', passed.overall_verdict)

    def test_a_failed_runtime_is_never_rescued_by_a_clean_teardown(self):
        for verdict in ('FAIL', 'INTERRUPTED', 'REFUSED'):
            with self.subTest(verdict=verdict):
                outcome = self._make_outcome(verdict, 'PASS')
                self.assertFalse(outcome.is_pass)
                self.assertEqual(verdict, outcome.overall_verdict)

    def test_the_final_block_names_the_cleanup_fact_when_the_round_failed(self):
        # The old FAIL branch printed only Stage/Reason, so a round that proved
        # every marker and then leaked Lia + Electron said
        # "Stage: runtime" and nothing about the processes.
        result = pipeline.AutoResult(result='FAIL', stage='teardown',
                                     round_id='M3.0b',
                                     reason='limpeza não verificada',
                                     cleanup_state='FAIL',
                                     cleanup_detail='taskkill retornou 128')
        block = pipeline.render_final_block(result)
        self.assertIn('Process cleanup: FAIL', block)
        self.assertIn('taskkill retornou 128', block)

    def test_a_not_applicable_cleanup_is_not_reported_as_a_problem(self):
        result = pipeline.AutoResult(result='FAIL', stage='prepare',
                                     round_id='M3.0b',
                                     reason='rodada recusada',
                                     cleanup_state='N/A',
                                     cleanup_detail='nada foi lançado')
        block = pipeline.render_final_block(result)
        self.assertNotIn('Process cleanup:', block)

    def test_run_json_persists_both_verdicts_so_the_artifact_cannot_oversell(self):
        """
        End to end: the run.json a human reads later must not be readable as a
        PASS when the pipeline reported FAIL.

        Reads the real artifact the runner writes, not a re-built payload.
        """
        base = Path(tempfile.mkdtemp(prefix='verdict-json-'))
        try:
            repo = make_repo(base)
            runner, _, _ = make_runner(repo, validate_round(runnable_manifest()))
            runner.emit = lambda line: None
            runner.spawn = fake_spawner(
                list(MARKER_LINES), teardown_ok=False,
                teardown_detail='taskkill retornou 128')
            outcome = runner.execute()
            payload = json.loads(Path(outcome.artifacts['json']).read_text(
                encoding='utf-8'))
            self.assertEqual('PASS', payload['runtime_verdict'],
                             'a evidência de runtime passou e isso deve constar')
            self.assertEqual('FAIL', payload['overall_verdict'])
            self.assertEqual('FAIL', payload['launch']['teardown_state'])
            self.assertIn('taskkill retornou 128',
                          payload['launch']['teardown_detail'])
            text = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
            self.assertIn('verdicto runtime : PASS', text)
            self.assertIn('verdicto geral   : FAIL', text)
        finally:
            shutil.rmtree(base, ignore_errors=True)


class UpgradeBootstrapSecurityTests(unittest.TestCase):
    """
    §8: the one-time transition bootstrap.

    It runs OUTSIDE the checkout on a machine whose DevFlow we cannot see, so
    every check in it has to be exact and it must not leak a credential.
    """

    BAT = TOOLS / 'devflow' / 'upgrades' / 'LIA-DEVFLOW-UPGRADE.bat'

    def setUp(self):
        self.text = self.BAT.read_text(encoding='utf-8', errors='replace')
        self.owner_repo = _batch_constant(self.text, 'LIA_EXPECTED_OWNER_REPO')
        self.expected_branch = _batch_constant(self.text, 'LIA_EXPECTED_BRANCH')

    def _accepted_urls(self) -> list[str]:
        """The canonical URL list actually shipped in the script."""
        lines = self.text.replace('\r\n', '\n').split('\n')
        start = next(i for i, line in enumerate(lines)
                     if line.strip().startswith('for %%F in ('))
        end = next(i for i in range(start + 1, len(lines))
                   if lines[i].strip().startswith(') do'))
        forms = []
        for line in lines[start + 1:end]:
            token = line.strip()
            self.assertTrue(token.startswith('"') and token.endswith('"'),
                            f'forma canônica não está entre aspas: {token!r}')
            forms.append(token[1:-1].replace('%LIA_EXPECTED_OWNER_REPO%',
                                             self.owner_repo))
        return forms

    def test_identity_is_matched_by_exact_equality_not_by_substring(self):
        self.assertNotIn('findstr', self.text,
                         'comparação por substring aceita github.com.evil.com')
        self.assertIn('if "%LIA_URL%"=="%%~F"', self.text)

    def test_the_accepted_url_set_is_exactly_the_canonical_forms(self):
        self.assertEqual(
            sorted([
                'https://github.com/BloomRX/Lia-Project.git',
                'https://github.com/BloomRX/Lia-Project',
                'ssh://git@github.com/BloomRX/Lia-Project.git',
                'ssh://git@github.com/BloomRX/Lia-Project',
                'git@github.com:BloomRX/Lia-Project.git',
                'git@github.com:BloomRX/Lia-Project',
            ]),
            sorted(self._accepted_urls()))

    def test_lookalike_hosts_and_repos_are_not_in_the_accepted_set(self):
        accepted = set(self._accepted_urls())
        for attack in (
            'https://github.com.evil.com/BloomRX/Lia-Project.git',
            'https://github.com@evil.example.com/BloomRX/Lia-Project.git',
            'https://evil.example.com/BloomRX/Lia-Project.git',
            'https://gitlab.com/BloomRX/Lia-Project.git',
            'https://github.com/BloomRX/Lia-Project-evil.git',
            'https://github.com/EvilOwner/Lia-Project.git',
            'https://github.com/BloomRX/Lia-Project/extra.git',
            'https://user:token@github.com/BloomRX/Lia-Project.git',
            'ssh://git@github.com.evil.com/BloomRX/Lia-Project.git',
            'git@github.com:EvilOwner/Lia-Project.git',
        ):
            self.assertNotIn(attack, accepted, f'{attack!r} foi aceito')

    def test_the_remote_url_is_never_echoed_typed_or_written_to_disk(self):
        for line in self.text.replace('\r\n', '\n').split('\n'):
            stripped = line.strip().lower()
            if stripped.startswith('rem'):
                continue
            if '%LIA_URL%' in line:
                verb = stripped.split()[0] if stripped.split() else ''
                self.assertNotIn(
                    verb, ('echo', 'type', '>', '>>'),
                    f'a URL do remote vaza nesta linha: {line!r}')
        self.assertNotIn('> "%LIA_URL%', self.text)

    def test_no_temp_file_is_created_so_none_can_survive_a_failure_path(self):
        self.assertNotIn('%TEMP%', self.text)
        self.assertNotIn('del ', self.text.lower())

    def test_the_placeholder_target_is_refused_instead_of_guessed(self):
        self.assertIn('PLACEHOLDER-REVIEWED-SHA', self.text)
        self.assertIn('if /I "%LIA_TARGET_SHA%"=="PLACEHOLDER-REVIEWED-SHA"',
                      self.text)

    def test_the_resulting_sha_is_verified_not_assumed(self):
        # `merge --ff-only` exiting 0 does not by itself prove WHERE the
        # checkout ended up, and the next step loads code from it.
        self.assertIn('rev-list -n 1 "%LIA_TARGET_SHA%"', self.text)
        self.assertIn('rev-parse HEAD', self.text)
        self.assertIn('if not "%LIA_HEAD_NOW%"=="%LIA_TARGET_RESOLVED%"',
                      self.text)

    def test_the_new_devkit_exit_code_is_propagated(self):
        self.assertIn('set "LIA_DEVKIT_RC=%ERRORLEVEL%"', self.text)
        self.assertIn('exit /b %LIA_DEVKIT_RC%', self.text)

    def test_the_dirty_check_uses_uall_so_a_new_directory_cannot_hide(self):
        self.assertIn('status --porcelain -uall', self.text)

    def test_the_pinned_branch_is_the_session_branch_and_never_main(self):
        self.assertEqual('arena/01a10290-lia-project', self.expected_branch)
        self.assertNotIn('merge --ff-only "main"', self.text)

    def test_no_errorlevel_is_read_inside_a_parenthesized_block(self):
        offenders = [line for depth, line in _batch_lines_with_depth(self.text)
                     if '%ERRORLEVEL%' in line and depth > 0]
        self.assertEqual([], offenders, '\n'.join(offenders))

    def test_the_bootstrap_still_uses_crlf(self):
        raw = self.BAT.read_bytes()
        self.assertNotIn(b'\n', raw.replace(b'\r\n', b''))


# ---------------------------------------------------------------------------
# AUTO-1c regressions: Windows compatibility and first-run bootstrap.
# ---------------------------------------------------------------------------

PROCESSES_PY = TOOLS / 'devflow' / 'processes.py'


def _module_ast() -> ast.Module:
    return ast.parse(PROCESSES_PY.read_text(encoding='utf-8'))


def _function_node(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) \
                and node.name == name:
            return node
    raise AssertionError(f'função {name!r} não existe em processes.py')


def _attribute_reads(node: ast.AST) -> list[str]:
    """Every `x.y` read inside `node`, as 'x.y'."""
    return [f'{ast.unparse(n.value)}.{n.attr}'
            for n in ast.walk(node) if isinstance(n, ast.Attribute)]


class _WindowsShapedSignal:
    """
    A stand-in for the Windows `signal` module: SIGTERM yes, SIGKILL no.

    This is deliberately NOT a mock that pretends SIGKILL exists. Windows
    Python genuinely has no `signal.SIGKILL`, and the audited defect was code
    that named it on a path Windows executes. The stand-in reproduces the real
    AttributeError so the regression fires on Linux.
    """

    SIGTERM = 15
    SIGINT = 2
    SIGBREAK = 21

    def __getattr__(self, name: str):
        raise AttributeError(f"module 'signal' has no attribute {name!r}")


class WindowsSignalContractTests(unittest.TestCase):
    """
    §1: Windows must never evaluate `signal.SIGKILL`.

    `signal.SIGKILL` does not exist in Windows Python. Naming it inside a tuple
    literal that BOTH platforms build - `for attempt, sig in ((0, SIGTERM),
    (1, SIGKILL))` - raises AttributeError on every Windows teardown, before
    taskkill is ever reached. And because that code sat in a `finally`, the
    AttributeError also masked whatever the gate was reporting.
    """

    def test_the_windows_escalation_list_is_empty(self):
        self.assertEqual((), processes._escalation_signals(True))

    def test_the_windows_path_never_touches_sigkill(self):
        """
        Executable proof, not a grep: run the Windows arm with a signal module
        that has no SIGKILL, exactly like Windows Python.
        """
        real = processes.signal
        processes.signal = _WindowsShapedSignal()
        try:
            self.assertEqual((), processes._escalation_signals(True))
            # Guard against a vacuous test: the POSIX arm MUST blow up under
            # this stand-in, otherwise the stand-in is not Windows-shaped and
            # the assertion above proves nothing.
            with self.assertRaises(AttributeError):
                processes._escalation_signals(False)
        finally:
            processes.signal = real

    def test_sigkill_is_named_only_inside_the_signal_helper(self):
        tree = _module_ast()
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr == 'SIGKILL':
                self.assertIn(
                    '_escalation_signals',
                    [f.name for f in ast.walk(tree)
                     if isinstance(f, ast.FunctionDef)
                     and f.lineno <= node.lineno <= (f.end_lineno or f.lineno)],
                    f'signal.SIGKILL na linha {node.lineno} está fora de '
                    '_escalation_signals; o Windows avaliaria isso')

    def test_terminate_dispatches_to_separate_platform_branches(self):
        tree = _module_ast()
        body = _function_node(tree, 'terminate')
        called = [n for n in _attribute_reads(body) + [
            n.func.id for n in ast.walk(body) if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)] if n]
        self.assertIn('self._terminate_windows', called)
        self.assertIn('self._terminate_posix', called)
        # Neither the dispatcher nor the Windows branch may name a signal.
        for name in ('terminate', '_terminate_windows'):
            reads = _attribute_reads(_function_node(tree, name))
            self.assertEqual(
                [], [r for r in reads if r.startswith('signal.')],
                f'{name} ainda referencia o módulo signal')

    def test_the_posix_ladder_has_two_rungs(self):
        # Genuinely POSIX-only: Windows Python has no SIGKILL to escalate to,
        # which is the whole reason the Windows branch has no ladder at all.
        if os.name == 'nt':
            self.skipTest('Windows não tem signal.SIGKILL; o ramo Windows não '
                          'tem escada de sinais')
        self.assertEqual(2, len(processes._escalation_signals(False)))


class Win32DeclarationContractTests(unittest.TestCase):
    """
    §2: every Win32 call needs a complete ctypes prototype.

    Without `restype`, ctypes assumes `c_int` and truncates a 64-bit HANDLE to
    32 bits. Without `use_last_error=True` on the library handle,
    `ctypes.get_last_error()` reads a slot nobody wrote and reports a stale
    WinError. Both are silent, and both are checkable on Linux because the
    declarations are plain ctypes - `ctypes.wintypes` is what cannot be
    imported off Windows, so it is not used.
    """

    def test_processentry32_layout_matches_the_win32_struct(self):
        size = ctypes.sizeof(processes.PROCESSENTRY32)
        pointer_bytes = ctypes.sizeof(ctypes.c_void_p)
        expected = 304 if pointer_bytes == 8 else 296
        self.assertEqual(
            expected, size,
            f'PROCESSENTRY32 tem {size} bytes; o struct do Windows tem '
            f'{expected} para ponteiros de {pointer_bytes} bytes. Um layout '
            'errado não levanta exceção: desloca th32ParentProcessID e a '
            'tabela pai/filho inteira vira lixo.')

    def test_the_fields_this_module_reads_sit_at_the_documented_offsets(self):
        offsets = {name: getattr(processes.PROCESSENTRY32, name).offset
                   for name, *_ in processes.PROCESSENTRY32._fields_}
        pointer_bytes = ctypes.sizeof(ctypes.c_void_p)
        if pointer_bytes == 8:
            self.assertEqual(8, offsets['th32ProcessID'])
            self.assertEqual(16, offsets['th32DefaultHeapID'])
            self.assertEqual(32, offsets['th32ParentProcessID'])
        else:
            self.assertEqual(8, offsets['th32ProcessID'])
            self.assertEqual(12, offsets['th32DefaultHeapID'])
            self.assertEqual(24, offsets['th32ParentProcessID'])

    def test_th32defaultheapid_is_pointer_sized_not_a_ulong(self):
        field = dict((name, typ) for name, typ, *_
                     in [(f[0], f[1]) for f in processes.PROCESSENTRY32._fields_])
        self.assertIs(processes.ULONG_PTR, field['th32DefaultHeapID'])
        self.assertEqual(ctypes.sizeof(ctypes.c_void_p),
                         ctypes.sizeof(processes.ULONG_PTR))

    def test_every_handle_returning_api_declares_a_pointer_sized_restype(self):
        table = dict((name, (restype, argtypes))
                     for name, restype, argtypes in processes.WIN32_PROTOTYPES)
        for name in processes.WIN32_HANDLE_FUNCTIONS:
            self.assertIn(name, table, f'{name} não tem protótipo declarado')
            restype, _ = table[name]
            self.assertIs(
                ctypes.c_void_p, restype,
                f'{name} devolve HANDLE; restype tem de ser c_void_p, não o '
                'c_int padrão que trunca o ponteiro em 64 bits')

    def test_the_prototype_table_covers_every_kernel32_call_made(self):
        declared = {name for name, _, _ in processes.WIN32_PROTOTYPES}
        tree = _module_ast()
        used: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                target = ast.unparse(node.func.value)
                if target in ('kernel32', '_kernel32()'):
                    used.add(node.func.attr)
        self.assertTrue(used, 'nenhuma chamada a kernel32 foi encontrada')
        self.assertEqual(
            set(), used - declared,
            'chamadas a kernel32 sem protótipo: usam restype c_int e sem '
            'last-error real')

    def test_the_declared_arities_match_the_documented_signatures(self):
        expected = {
            'CreateToolhelp32Snapshot': 2,
            'Process32First': 2,
            'Process32Next': 2,
            'CloseHandle': 1,
            'OpenProcess': 3,
            'GetExitCodeProcess': 2,
        }
        for name, _restype, argtypes in processes.WIN32_PROTOTYPES:
            self.assertEqual(expected[name], len(argtypes), name)

    def test_invalid_handle_value_is_computed_at_the_running_width(self):
        expected = ctypes.sizeof(ctypes.c_void_p)
        value = processes.invalid_handle_value()
        self.assertEqual((1 << (expected * 8)) - 1, value)
        # A 32-bit -1 compared against a 64-bit constant never matches, which
        # is how the snapshot-failure check silently stopped firing.
        self.assertNotEqual(-1, value)

    def test_kernel32_is_opened_with_use_last_error_and_not_via_windll(self):
        source = PROCESSES_PY.read_text(encoding='utf-8')
        self.assertIn("ctypes.WinDLL('kernel32', use_last_error=True)", source,
                      'sem use_last_error, get_last_error() devolve lixo')
        # `ctypes.windll` may appear in prose; what matters is that no CODE
        # path reaches for it, because windll never fills the ctypes
        # last-error slot.
        tree = _module_ast()
        offenders = [ast.unparse(n) for n in ast.walk(tree)
                     if isinstance(n, ast.Attribute)
                     and ast.unparse(n.value) == 'ctypes.windll']
        self.assertEqual([], offenders,
                         'windll não preenche o slot de last-error do ctypes')

    def test_the_last_error_slot_is_read_through_the_defensive_seam(self):
        # ctypes has no get/set_last_error off Windows; touching it directly
        # would make the Windows-only helper unrunnable anywhere else.
        tree = _module_ast()
        direct = [ast.unparse(n) for n in ast.walk(tree)
                  if isinstance(n, ast.Attribute) and ast.unparse(n) in
                  ('ctypes.get_last_error', 'ctypes.set_last_error')]
        self.assertEqual([], direct,
                         'use os seams _win32_error/_reset_win32_error')
        self.assertEqual(0, processes._win32_error())
        processes._reset_win32_error()      # must not raise off Windows


class _FakeKernel32:
    """
    Stands in for the typed kernel32 facade, on Linux.

    It writes the REAL ctypes last-error slot, so the code under test reads
    `ctypes.get_last_error()` exactly as it would on Windows.
    """

    def __init__(self, open_handle, open_error=0, exit_call_ok=True,
                 exit_code=processes.STILL_ACTIVE):
        self.last_error = 0
        self.open_handle = open_handle
        self.open_error = open_error
        self.exit_call_ok = exit_call_ok
        self.exit_code = exit_code
        self.opened: list[int] = []
        self.closed = 0

    def OpenProcess(self, access, inherit, pid):
        self.opened.append(pid)
        self.last_error = self.open_error
        return self.open_handle

    def GetExitCodeProcess(self, handle, code_ref):
        if not self.exit_call_ok:
            return 0
        code_ref._obj.value = self.exit_code
        return 1

    def CloseHandle(self, handle):
        self.closed += 1
        return 1


class PidTriStateTests(unittest.TestCase):
    """
    §3: a Win32 inspection failure is UNKNOWN, never "process dead".

    The audited `_pid_alive_windows` returned False when OpenProcess failed and
    when GetExitCodeProcess failed. `count_alive` then summed those as zero
    survivors, so an access-denied child became `descendentes: nenhum vivo` and
    the round reported a cleanup it had not verified.
    """

    def test_a_live_pid_is_alive_and_an_absent_one_is_dead(self):
        """
        Liveness, through the dispatching entry point, on the platform running.

        This used to call `pid_state_posix` unconditionally. On Windows that is
        not a probe: `signal.CTRL_C_EVENT` is 0, so `os.kill(pid, 0)` becomes
        `GenerateConsoleCtrlEvent` and the assertion delivered a real Ctrl+C to
        its own console group, interrupting the CI job with a bare
        `KeyboardInterrupt` and no test named anywhere. Going through
        `pid_state` exercises the genuine OpenProcess path on Windows instead
        of skipping it.
        """
        self.assertEqual(processes.ALIVE, processes.pid_state(os.getpid()))
        self.assertEqual(processes.DEAD, processes.pid_state(0x7FFFFFFE))
        if os.name == 'nt':
            with self.assertRaises(RuntimeError):
                processes.pid_state_posix(os.getpid())
        else:
            self.assertEqual(processes.ALIVE,
                             processes.pid_state_posix(os.getpid()))
            self.assertEqual(processes.DEAD,
                             processes.pid_state_posix(0x7FFFFFFE))

    def test_the_posix_probe_never_reaches_os_kill_on_windows(self):
        """
        REGRESSION for the Ctrl+C above, asserted directly: on Windows the
        POSIX probe must refuse BEFORE touching os.kill, because touching it is
        the whole bug.
        """
        with patch('os.name', 'nt'), patch('os.kill') as killed:
            with self.assertRaises(RuntimeError):
                processes.pid_state_posix(os.getpid())
            killed.assert_not_called()
        # And the refusal is specifically a Windows rule rather than a blanket
        # one: with a POSIX os.name the same call must go through and answer.
        # Stated on the host rather than pinned, so this half is real.
        if os.name != 'nt':
            with patch('os.kill', return_value=None):
                self.assertEqual(processes.ALIVE,
                                 processes.pid_state_posix(4242))

    def test_permission_denied_proves_existence_not_absence(self):
        # os.name is pinned so the POSIX classification is exercised on every
        # platform. What is under test is the exception mapping - "EPERM means
        # it exists" - which is a statement about the logic, not about this
        # machine, and os.kill is mocked so nothing real is ever signalled.
        with patch('os.name', 'posix'), \
                patch('os.kill', side_effect=PermissionError(13, 'EPERM')):
            self.assertEqual(processes.ALIVE, processes.pid_state_posix(4242))

    def test_an_unexpected_oserror_is_unknown_not_dead(self):
        with patch('os.name', 'posix'), \
                patch('os.kill', side_effect=OSError(22, 'EINVAL')):
            self.assertEqual(processes.UNKNOWN, processes.pid_state_posix(4242))

    def _windows_state(self, **kwargs) -> str:
        fake = _FakeKernel32(**kwargs)
        # The ctypes last-error slot does not exist off Windows, so the module
        # reads it through a seam; this drives that seam with the fake's error.
        with patch.object(processes, '_kernel32', return_value=fake), \
                patch.object(processes, '_win32_error',
                             side_effect=lambda: fake.last_error):
            state = processes.pid_state_windows(4242)
        # CloseHandle is due exactly when a handle came back. Closing a NULL
        # handle would itself be a Win32 error.
        self.assertEqual(1 if kwargs.get('open_handle') else 0, fake.closed,
                         'o HANDLE vazou (ou um HANDLE nulo foi fechado)')
        return state

    def test_openprocess_access_denied_is_unknown_not_dead(self):
        state = self._windows_state(open_handle=None,
                                    open_error=processes.ERROR_ACCESS_DENIED)
        self.assertEqual(processes.UNKNOWN, state,
                         'ERROR_ACCESS_DENIED prova que o processo EXISTE')

    def test_openprocess_failing_for_an_unknown_reason_is_unknown(self):
        for error in (0, 8, 87 + 1, 1132):
            with self.subTest(error=error):
                self.assertEqual(
                    processes.UNKNOWN,
                    self._windows_state(open_handle=None, open_error=error))

    def test_only_the_documented_absent_pid_error_counts_as_dead(self):
        self.assertEqual(
            processes.DEAD,
            self._windows_state(open_handle=None,
                                open_error=processes.ERROR_INVALID_PARAMETER))

    def test_a_failed_getexitcodeprocess_is_unknown_not_dead(self):
        self.assertEqual(
            processes.UNKNOWN,
            self._windows_state(open_handle=0x1234, exit_call_ok=False))

    def test_still_active_is_alive_and_any_other_exit_code_is_dead(self):
        self.assertEqual(
            processes.ALIVE,
            self._windows_state(open_handle=0x1234,
                                exit_code=processes.STILL_ACTIVE))
        self.assertEqual(processes.DEAD,
                         self._windows_state(open_handle=0x1234, exit_code=0))
        self.assertEqual(processes.DEAD,
                         self._windows_state(open_handle=0x1234, exit_code=1))

    def test_an_unverifiable_descendant_is_counted_as_unverified(self):
        real = processes.pid_state
        with patch.object(processes, 'pid_state',
                          side_effect=lambda pid: processes.UNKNOWN):
            self.assertEqual((0, 3),
                             processes.summarize_descendants(frozenset({1, 2, 3})))
        processes.pid_state = real

    def test_a_mixed_tree_reports_alive_and_unverified_separately(self):
        answers = {1: processes.ALIVE, 2: processes.DEAD, 3: processes.UNKNOWN}
        with patch.object(processes, 'pid_state', side_effect=lambda pid: answers[pid]):
            self.assertEqual((1, 1),
                             processes.summarize_descendants(frozenset({1, 2, 3})))

    def test_unverified_descendants_make_the_teardown_unknown_not_pass(self):
        result = TeardownResult(requested=True, root_terminated=True,
                                method='m', descendants=0, unverified=2)
        self.assertEqual('UNKNOWN', result.state)
        self.assertFalse(result.ok)
        self.assertIn('NÃO VERIFICÁVEL', result.describe())


class TaskkillLoadBearingTests(unittest.TestCase):
    """
    §4: a failed taskkill must be load-bearing.

    `TeardownResult.state` was derived from `root_terminated` and `descendants`
    alone. A taskkill that returned nonzero, on a root that happened to exit on
    its own with no verifiable descendants, therefore produced
    `root_terminated=True, descendants=0` and read as PASS.
    """

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='taskkill-'))

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _spawn(self) -> subprocess.Popen:
        return subprocess.Popen(
            [sys.executable, '-c', 'import time; time.sleep(30)'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _terminate_windows(self, kill_ok: bool, detail: str):
        """
        Drives the real `_terminate_windows` against a real child process.

        A fake taskkill that reports success without killing would be testing
        nothing, so the success case actually terminates the child - which is
        what `taskkill /PID /T /F` does - and the failure case leaves it alive,
        exactly as a refused taskkill does.
        """
        process = self._spawn()
        try:
            handle = processes.OwnedProcess(process)

            def fake_taskkill(pid):
                if kill_ok:
                    process.terminate()
                return kill_ok, detail

            with patch.object(processes.OwnedProcess, '_taskkill',
                              side_effect=fake_taskkill):
                result = TeardownResult(requested=True)
                handle._terminate_windows(result, process.pid, None, None)
            self.assertEqual(kill_ok, result.root_terminated,
                             'a raiz viva/morta tem de refletir o taskkill')
            return result
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)

    def test_a_failed_taskkill_is_never_a_pass(self):
        result = self._terminate_windows(False, 'taskkill retornou 128: acesso negado')
        self.assertFalse(result.kill_ok)
        self.assertEqual('FAIL', result.state,
                         'um taskkill recusado virou limpeza verificada')
        self.assertIn('taskkill', result.describe())

    def test_a_missing_taskkill_executable_is_not_a_cleanup(self):
        result = self._terminate_windows(
            False, 'taskkill nao pode ser executado: FileNotFoundError')
        self.assertEqual('FAIL', result.state)

    def test_a_successful_kill_with_a_dead_root_can_pass(self):
        result = self._terminate_windows(True, 'taskkill retornou 0')
        self.assertTrue(result.kill_ok)
        self.assertIn(result.state, ('PASS', 'UNKNOWN'),
                      'com kill ok e raiz morta, só a evidência de '
                      'descendentes decide')

    def test_state_treats_a_failed_kill_as_dominating(self):
        # Every other fact says clean; only kill_ok says otherwise.
        result = TeardownResult(requested=True, root_terminated=True,
                                method='taskkill /PID /T /F',
                                descendants=0, unverified=0, kill_ok=False)
        self.assertEqual('FAIL', result.state)

    def test_signal_teardown_leaves_kill_ok_unset_so_it_can_pass(self):
        result = TeardownResult(requested=True, root_terminated=True,
                                method='grupo', descendants=0, kill_ok=None)
        self.assertEqual('PASS', result.state)

    def test_nothing_in_this_module_kills_by_image_name(self):
        """
        Scans the string constants the code can actually build a command from,
        not the prose: a docstring is allowed to say "no WMIC".
        """
        tree = _module_ast()
        constants = [n.value for n in ast.walk(tree)
                     if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        forbidden_executables = {'wmic', 'powershell', 'powershell.exe',
                                 'killall', 'pkill', 'tasklist', 'tasklist.exe'}
        for text in constants:
            lowered = text.strip().lower()
            self.assertNotIn(lowered, forbidden_executables,
                             f'comando proibido construído no módulo: {text!r}')
            self.assertNotEqual('/im', lowered,
                                'taskkill /IM mataria por nome de imagem, '
                                'inclusive uma Lia que o DevFlow não iniciou')
        taskkill_argv = [c for c in constants if c.lower() == 'taskkill']
        self.assertEqual(1, len(taskkill_argv),
                         'esperava exatamente uma invocação de taskkill')

    def test_the_pipeline_refuses_an_unknown_cleanup_too(self):
        """§4: PASS stays impossible while cleanup is FAIL *or* UNKNOWN."""
        for state in ('FAIL', 'UNKNOWN'):
            with self.subTest(state=state):
                base = Path(tempfile.mkdtemp(prefix='cleanup-unknown-'))
                try:
                    repo = make_repo(base)
                    runner, _, _ = make_runner(
                        repo, validate_round(runnable_manifest()))
                    runner.emit = lambda line: None
                    # FAIL  = the root never died.  UNKNOWN = it died but the
                    # descendants could not be verified. Neither may pass.
                    fake = FakeGit(head='a' * 40, remote_head='a' * 40)
                    runner.spawn = fake_spawner(
                        list(MARKER_LINES),
                        teardown_ok=state != 'FAIL',
                        teardown_detail='taskkill retornou 0'
                        if state != 'FAIL' else 'taskkill retornou 128',
                        # -1 in both cases: FAIL because the root never died,
                        # UNKNOWN because the root died but the descendants
                        # could not be verified. Neither is a count of zero.
                        descendants=-1)
                    result = pipeline.run_auto(
                        repo, work_branch=WORK, emit=lambda line: None,
                        run_git=lambda args: fake(args),
                        runner_factory=lambda m: runner,
                        load_round=lambda: validate_round(runnable_manifest()))
                    self.assertEqual(state, result.cleanup_state)
                    self.assertEqual('FAIL', result.result)
                    self.assertTrue(result.runtime_ok)
                finally:
                    shutil.rmtree(base, ignore_errors=True)


UPGRADE_BAT = TOOLS / 'devflow' / 'upgrades' / 'LIA-DEVFLOW-UPGRADE.bat'


def _upgrade_lines() -> list[str]:
    return UPGRADE_BAT.read_text(encoding='utf-8', errors='replace') \
        .replace('\r\n', '\n').split('\n')


def _first_line_containing(needle: str, lines: list[str] | None = None) -> int:
    for index, line in enumerate(lines or _upgrade_lines()):
        if line.strip().startswith('rem'):
            continue
        if needle in line:
            return index
    raise AssertionError(f'{needle!r} não está no bootstrap de transição')


class UpgradeFetchOrderTests(unittest.TestCase):
    """
    §5: the pinned target must be resolved AFTER the fetch.

    The audited script ran `rev-list -n 1 "%LIA_TARGET_SHA%"` BEFORE
    `git fetch`. A stale checkout does not have the reviewed commit object yet,
    so the script gave up in exactly the situation it exists to fix - the
    owner's machine, updating for the first time.
    """

    def test_the_target_is_resolved_only_after_the_fetch(self):
        lines = _upgrade_lines()
        fetch = _first_line_containing('fetch origin', lines)
        resolve = _first_line_containing('rev-list -n 1', lines)
        self.assertLess(
            fetch, resolve,
            'rev-list roda antes do fetch: um checkout antigo nao tem o objeto '
            'do alvo e o bootstrap desiste no unico caso que ele resolve')

    def test_every_required_step_appears_in_the_required_order(self):
        lines = _upgrade_lines()
        ordered = [
            ('identidade', 'remote get-url origin'),
            ('branch', 'rev-parse --abbrev-ref HEAD'),
            ('worktree limpo', 'status --porcelain -uall'),
            ('fetch', 'fetch origin'),
            ('ponta buscada', 'rev-parse FETCH_HEAD'),
            ('resolucao do alvo', 'rev-list -n 1'),
            ('alvo na historia autorizada',
             'merge-base --is-ancestor "%LIA_TARGET_RESOLVED%" FETCH_HEAD'),
            ('head pode avancar',
             'merge-base --is-ancestor HEAD "%LIA_TARGET_RESOLVED%"'),
            ('fast-forward', 'merge --ff-only'),
            ('sha resultante', 'rev-parse HEAD'),
            ('chamada ao devkit', 'call "%LIA_REPO%\\DevKit.bat"'),
        ]
        positions = []
        for label, needle in ordered:
            index = _first_line_containing(needle, lines)
            positions.append((index, label))
        self.assertEqual(
            sorted(positions), positions,
            'a ordem das etapas nao e a contratada: '
            + ' -> '.join(label for _, label in sorted(positions)))

    def test_a_failed_git_status_is_refused_not_read_as_clean(self):
        """
        `git status` that fails produces NO output. Without an explicit exit
        code check, "no output" was indistinguishable from "clean checkout".
        """
        text = '\n'.join(_upgrade_lines())
        self.assertIn('LIA_RC_ZERO', text)
        self.assertIn('LIA_RC_NONZERO', text)
        status_line = _first_line_containing('status --porcelain -uall')
        after = _upgrade_lines()[status_line + 1:status_line + 12]
        self.assertTrue(
            any('if not "%LIA_STATUS_RC%"=="0"' in line for line in after),
            'o codigo de saida do git status nao e conferido antes de '
            'concluir que o checkout esta limpo')

    def test_the_target_must_belong_to_the_fetched_authorized_history(self):
        text = '\n'.join(_upgrade_lines())
        self.assertIn('merge-base --is-ancestor "%LIA_TARGET_RESOLVED%" FETCH_HEAD',
                      text,
                      'sem isto qualquer commit alcancavel localmente serviria '
                      'de alvo, inclusive um de outro branch')

    def test_the_local_head_must_be_an_ancestor_of_the_target(self):
        self.assertIn('merge-base --is-ancestor HEAD "%LIA_TARGET_RESOLVED%"',
                      '\n'.join(_upgrade_lines()),
                      'historia divergida tem de falhar fechado')

    def test_the_shipped_template_is_still_pinned_to_the_session_repository(self):
        self.assertEqual('BloomRX/Lia-Project',
                         _batch_constant('\n'.join(_upgrade_lines()),
                                         'LIA_EXPECTED_OWNER_REPO'))
        self.assertEqual('arena/01a10290-lia-project',
                         _batch_constant('\n'.join(_upgrade_lines()),
                                         'LIA_EXPECTED_BRANCH'))
        self.assertEqual('PLACEHOLDER-REVIEWED-SHA',
                         _batch_constant('\n'.join(_upgrade_lines()),
                                         'LIA_TARGET_SHA'),
                         'o template versionado tem de continuar fail-closed '
                         'ate o SHA auditado existir')


class UpgradeGitSemanticsTests(unittest.TestCase):
    """
    §5: the git commands the bootstrap relies on, against a REAL repository.

    The BAT itself needs cmd.exe, so its execution is covered by
    UpgradeBootstrapExecutionTests on Windows. What is proved here is that the
    assumptions the script makes about git are true: an absent target becomes
    resolvable only after a fetch, `merge-base --is-ancestor` distinguishes
    authorized history from a foreign or divergent commit, and a failing
    `status` is distinguishable from a clean one.
    """

    def setUp(self):
        """
        Two clones, on purpose.

        Committing the target in the same clone and then `reset --hard` back
        does NOT make it absent: the object stays in that clone's database and
        `rev-list` still finds it, so the scenario would prove nothing. The
        stale checkout has to be a clone made before the target existed.
        """
        self.base = Path(tempfile.mkdtemp(prefix='upgrade-git-'))
        self.remote = self.base / 'remote.git'
        self.author = self.base / 'author'
        self.repo = self.base / 'work'
        self._git(self.base, 'init', '--bare', '-q', '-b',
                  'arena/01a10290-lia-project', str(self.remote))
        self._git(self.base, 'clone', '-q', str(self.remote), str(self.author))
        self._configure(self.author)
        self.old = self._commit_in(self.author, 'base')
        self._git(self.author, 'push', '-q', 'origin', 'arena/01a10290-lia-project')
        # The owner's checkout, cloned while `base` was still the tip.
        self._git(self.base, 'clone', '-q', str(self.remote), str(self.repo))
        self._configure(self.repo)
        # The reviewed target, created afterwards and present only remotely.
        self.target = self._commit_in(self.author, 'reviewed')
        self._git(self.author, 'push', '-q', 'origin', 'arena/01a10290-lia-project')

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _configure(self, repo: Path) -> None:
        self._git(repo, 'config', 'user.email', 'devflow@test.local')
        self._git(repo, 'config', 'user.name', 'DevFlow Test')

    def _git(self, cwd: Path, *args) -> subprocess.CompletedProcess:
        return subprocess.run([sync.git_executable(), '-C', str(cwd), *args],
                              capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=120)

    def _commit_in(self, repo: Path, name: str) -> str:
        (repo / name).write_text(name + '\n', encoding='utf-8')
        self._git(repo, 'add', name)
        self._git(repo, 'commit', '-q', '-m', name)
        return self._git(repo, 'rev-parse', 'HEAD').stdout.strip()

    def _commit(self, name: str) -> str:
        return self._commit_in(self.repo, name)

    def _stale_clone_behind_the_remote(self) -> tuple[str, str]:
        """(old local HEAD, reviewed target that exists only on the remote)."""
        return self.old, self.target

    def test_the_target_is_absent_locally_until_the_fetch(self):
        old, target = self._stale_clone_behind_the_remote()
        before = self._git(self.repo, 'rev-list', '-n', '1', target)
        self.assertNotEqual(0, before.returncode,
                            'o alvo ja existia localmente; o cenario nao prova nada')
        fetch = self._git(self.repo, 'fetch', 'origin', 'arena/01a10290-lia-project')
        self.assertEqual(0, fetch.returncode)
        after = self._git(self.repo, 'rev-list', '-n', '1', target)
        self.assertEqual(0, after.returncode)
        self.assertEqual(target, after.stdout.strip())
        self.assertEqual(old, self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip(),
                         'o fetch nao deveria ter movido o HEAD')

    def test_merge_base_accepts_a_target_inside_the_fetched_history(self):
        _old, target = self._stale_clone_behind_the_remote()
        self._git(self.repo, 'fetch', 'origin', 'arena/01a10290-lia-project')
        check = self._git(self.repo, 'merge-base', '--is-ancestor', target, 'FETCH_HEAD')
        self.assertEqual(0, check.returncode)

    def test_merge_base_rejects_a_target_outside_the_fetched_branch(self):
        _old, _target = self._stale_clone_behind_the_remote()
        # A commit that exists locally but was never pushed to the branch.
        side = self._commit('not-pushed')
        self._git(self.repo, 'fetch', 'origin', 'arena/01a10290-lia-project')
        check = self._git(self.repo, 'merge-base', '--is-ancestor', side, 'FETCH_HEAD')
        self.assertNotEqual(0, check.returncode)

    def test_merge_base_rejects_a_divergent_local_head(self):
        _old, target = self._stale_clone_behind_the_remote()
        self._git(self.repo, 'fetch', 'origin', 'arena/01a10290-lia-project')
        self._commit('divergent-local')
        check = self._git(self.repo, 'merge-base', '--is-ancestor', 'HEAD', target)
        self.assertNotEqual(0, check.returncode,
                           'historia divergida tem de ser recusada')

    def test_ff_only_merge_advances_exactly_to_the_target(self):
        _old, target = self._stale_clone_behind_the_remote()
        self._git(self.repo, 'fetch', 'origin', 'arena/01a10290-lia-project')
        self.assertEqual(0, self._git(self.repo, 'merge-base', '--is-ancestor',
                                      'HEAD', target).returncode)
        merge = self._git(self.repo, 'merge', '--ff-only', target)
        self.assertEqual(0, merge.returncode)
        self.assertEqual(target, self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip())

    def test_a_clean_worktree_prints_nothing_and_exits_zero(self):
        probe = self._git(self.repo, 'status', '--porcelain', '-uall')
        self.assertEqual(0, probe.returncode)
        self.assertEqual('', probe.stdout)

    def test_a_dirty_worktree_prints_something_and_still_exits_zero(self):
        (self.repo / 'novo.txt').write_text('x\n', encoding='utf-8')
        probe = self._git(self.repo, 'status', '--porcelain', '-uall')
        self.assertEqual(0, probe.returncode)
        self.assertNotEqual('', probe.stdout)

    def test_a_failing_status_is_distinguishable_from_a_clean_one(self):
        """
        The exact confusion the bootstrap has to avoid: a status that fails
        also prints nothing, so only the exit code separates the two.
        """
        not_a_repo = self.base / 'vazio'
        not_a_repo.mkdir()
        probe = self._git(not_a_repo, 'status', '--porcelain', '-uall')
        self.assertNotEqual(0, probe.returncode)
        self.assertEqual('', probe.stdout,
                         'se um status quebrado imprimisse algo, a saida '
                         'resolveria a ambiguidade - e nao imprime')

    def test_a_missing_target_stays_missing_after_the_fetch(self):
        _old, _target = self._stale_clone_behind_the_remote()
        self._git(self.repo, 'fetch', 'origin', 'arena/01a10290-lia-project')
        probe = self._git(self.repo, 'rev-list', '-n', '1', 'deadbeef' * 5)
        self.assertNotEqual(0, probe.returncode)


@unittest.skipUnless(shutil.which('cmd.exe'), 'cmd.exe indisponível nesta plataforma')
class UpgradeBootstrapExecutionTests(unittest.TestCase):
    """
    §5: run the REAL bootstrap against a real repository, on Windows.

    The copy differs from the shipped file in exactly two places: the list of
    canonical remote URLs (so a local test remote passes the identity gate,
    which has its own tests) and the pinned target SHA. Every `git` command
    line is asserted byte-identical to the shipped file, so the ordering under
    test is the shipped one. Skipped where cmd.exe does not exist - that skip
    is the honest boundary of this platform.
    """

    BRANCH = 'arena/01a10290-lia-project'

    def setUp(self):
        """
        `author` writes the history; `work` is the owner's stale checkout.

        A single clone plus `reset --hard` would leave the target object in the
        local database, and `rev-list` would find it - so the test would pass
        even with the fetch in the wrong place. Two clones make "target absent
        locally" literally true.
        """
        self.base = Path(tempfile.mkdtemp(prefix='upgrade-exec-'))
        self.remote = self.base / 'remote.git'
        self.author = self.base / 'author'
        self.repo = self.base / 'work'
        self._git(self.base, 'init', '--bare', '-q', '-b', self.BRANCH,
                  str(self.remote))
        self._git(self.base, 'clone', '-q', str(self.remote), str(self.author))
        for repo in (self.author,):
            self._git(repo, 'config', 'user.email', 'devflow@test.local')
            self._git(repo, 'config', 'user.name', 'DevFlow Test')
        # Tracked entrypoints, so neither clone is dirty and the upgraded
        # checkout still has a DevKit.bat to hand over to.
        (self.author / 'Lia.bat').write_text('@echo off\r\n', encoding='utf-8')
        (self.author / 'DevKit.bat').write_text(
            '@echo off\r\nexit /b 7\r\n', encoding='utf-8')
        self._git(self.author, 'add', '-A')
        self._git(self.author, 'commit', '-q', '-m', 'base')
        self._git(self.author, 'push', '-q', 'origin', self.BRANCH)

        self._git(self.base, 'clone', '-q', str(self.remote), str(self.repo))
        self._git(self.repo, 'config', 'user.email', 'devflow@test.local')
        self._git(self.repo, 'config', 'user.name', 'DevFlow Test')
        self.old = self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip()

        (self.author / 'reviewed.txt').write_text('reviewed\n', encoding='utf-8')
        self._git(self.author, 'add', 'reviewed.txt')
        self._git(self.author, 'commit', '-q', '-m', 'reviewed')
        self.target = self._git(self.author, 'rev-parse', 'HEAD').stdout.strip()
        self._git(self.author, 'push', '-q', 'origin', self.BRANCH)
        self.bat = self._localized_bootstrap()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def _git(self, cwd: Path, *args) -> subprocess.CompletedProcess:
        return subprocess.run([sync.git_executable(), '-C', str(cwd), *args],
                              capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=120)

    def _commit(self, name: str) -> str:
        (self.repo / name).write_text(name + '\n', encoding='utf-8')
        self._git(self.repo, 'add', name)
        self._git(self.repo, 'commit', '-q', '-m', name)
        return self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip()

    def _localized_bootstrap(self) -> Path:
        shipped = UPGRADE_BAT.read_text(encoding='utf-8', errors='replace')
        lines = shipped.replace('\r\n', '\n').split('\n')
        start = next(i for i, l in enumerate(lines)
                     if l.strip().startswith('for %%F in ('))
        end = next(i for i in range(start + 1, len(lines))
                   if lines[i].strip().startswith(') do'))
        # The canonical form is whatever git itself reports, not a spelling
        # guessed from `Path`. Observed on Windows: the gate rejected the local
        # test remote because `%TEMP%` is an 8.3 short path
        # (C:\\Users\\RUNNER~1\\...) while git normalizes to the long form, so a
        # string built from `str(self.remote)` could never match. Asking git
        # removes the guess on every platform and leaves the SHIPPED gate - and
        # every `git` line, asserted byte-identical below - untouched.
        canonical = self._git(
            self.repo, 'remote', 'get-url', 'origin').stdout.strip()
        self.assertTrue(canonical, 'o clone de teste ficou sem remote origin')
        lines[start + 1:end] = [f'    "{canonical}"']
        # Only the assignment is localized. The placeholder also appears in the
        # guard that refuses to run without a reviewed commit; replacing it
        # THERE turns the guard into `%SHA%==%SHA%`, which is always true, so
        # the bootstrap refused every run and the checkout never advanced.
        lines = [l.replace('PLACEHOLDER-REVIEWED-SHA', self.target)
                 if l.strip().startswith('set "LIA_TARGET_SHA=') else l
                 for l in lines]
        guards = [l for l in lines if 'PLACEHOLDER-REVIEWED-SHA' in l]
        self.assertEqual(1, len(guards),
                         'o guarda do placeholder deixou de existir na cópia: '
                         + repr(guards))
        # The git command lines must be untouched.
        shipped_git = [l for l in shipped.replace('\r\n', '\n').split('\n')
                       if ' git -C ' in l or l.startswith('git -C ')]
        new_git = [l for l in lines if ' git -C ' in l or l.startswith('git -C ')]
        self.assertEqual(
            [l.replace(self.target, 'PLACEHOLDER-REVIEWED-SHA') for l in new_git],
            shipped_git, 'as linhas de git do bootstrap foram alteradas')
        path = self.base / 'UPGRADE.bat'
        path.write_bytes(('\r\n'.join(lines)).encode('utf-8'))
        return path

    def _run(self) -> subprocess.CompletedProcess:
        # LIA_DEVKIT_NO_PAUSE also silences the bootstrap's own :fail pause,
        # which otherwise waits for a keypress on any machine with a console.
        env = dict(os.environ, LIA_DEVKIT_NO_PAUSE='1')
        return run_bat(['cmd.exe', '/d', '/s', '/c', str(self.bat),
                        str(self.repo)], self.base, timeout_s=300.0, env=env)

    def test_a_stale_checkout_is_advanced_to_the_reviewed_sha(self):
        self.assertNotEqual(0, self._git(self.repo, 'rev-list', '-n', '1',
                                         self.target).returncode,
                            'o alvo ja existia localmente; o cenario nao prova nada')
        probe = self._run()
        self.assertEqual(
            self.target, self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip(),
            'o bootstrap nao avancou o checkout:\n' + probe.stdout + probe.stderr)

    def test_the_devkit_exit_code_is_propagated(self):
        probe = self._run()
        self.assertEqual(7, probe.returncode,
                         'o codigo do DevKit novo foi engolido:\n'
                         + probe.stdout + probe.stderr)

    def test_a_genuine_status_failure_is_refused_and_never_read_as_clean(self):
        """
        A status that FAILS is not a clean checkout.

        The index is corrupted so `git status` exits nonzero with a fatal - a
        real failure of the command, not a simulated one. Step 3 exists exactly
        for this: an empty status output must never be read as "nothing to
        worry about" when the command that would have produced it did not run.
        """
        before = self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip()
        (self.repo / '.git' / 'index').write_bytes(b'CORROMPIDO-DE-PROPOSITO')
        self.assertNotEqual(
            0, self._git(self.repo, 'status', '--porcelain',
                         '-uall').returncode,
            'o cenario nao produz uma falha real de git status')
        probe = self._run()
        self.assertNotEqual(0, probe.returncode,
                            'um git status que falhou foi aceito como limpo:\n'
                            + probe.stdout + probe.stderr)
        self.assertEqual(
            before, self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip(),
            'o checkout foi tocado apesar de o status ter falhado')

    def test_a_dirty_checkout_is_refused_untouched(self):
        before = self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip()
        (self.repo / 'sujo.txt').write_text('x\n', encoding='utf-8')
        probe = self._run()
        self.assertNotEqual(0, probe.returncode)
        self.assertEqual(before, self._git(self.repo, 'rev-parse', 'HEAD').stdout.strip())

    def test_the_wrong_branch_is_refused(self):
        self._git(self.repo, 'checkout', '-q', '-b', 'outro-branch')
        probe = self._run()
        self.assertNotEqual(0, probe.returncode)

    def test_a_divergent_history_is_refused_not_forced(self):
        self._commit('divergente')
        probe = self._run()
        self.assertNotEqual(0, probe.returncode)
        self.assertIn('divergente',
                      self._git(self.repo, 'log', '--format=%s', '-1').stdout)


class StatusCheckProbeTests(unittest.TestCase):
    """
    The git half of the bootstrap's step 3, on every platform.

    The bootstrap refuses to touch a checkout unless `git status --porcelain
    -uall` SUCCEEDED, and its message ("git status nao respondeu com sucesso")
    is emitted both when git really fails and when the exit-code marker is lost
    on the way out of `for /f`. Those are different defects with different
    fixes, so each half is measured separately instead of being read off the
    message. These two are the git half and need no shell.
    """

    BRANCH = 'arena/01a10290-lia-project'

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='status-probe-'))
        self.remote = self.base / 'remote.git'
        self.author = self.base / 'author'
        self.repo = self.base / 'work'
        self._git(self.base, 'init', '--bare', '-q', '-b', self.BRANCH,
                  str(self.remote))
        self._git(self.base, 'clone', '-q', str(self.remote), str(self.author))
        self._git(self.author, 'config', 'user.email', 'devflow@test.local')
        self._git(self.author, 'config', 'user.name', 'DevFlow Test')
        (self.author / 'Lia.bat').write_text('@echo off\r\n', encoding='utf-8')
        self._git(self.author, 'add', '-A')
        self._git(self.author, 'commit', '-q', '-m', 'base')
        self._git(self.author, 'push', '-q', 'origin', self.BRANCH)
        self._git(self.base, 'clone', '-q', str(self.remote), str(self.repo))

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _git(self, cwd: Path, *args) -> subprocess.CompletedProcess:
        return subprocess.run([sync.git_executable(), '-C', str(cwd), *args],
                              capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=120)

    def test_a_clean_clone_makes_the_status_command_succeed(self) -> None:
        """
        The exact command the bootstrap runs, against the exact shape of
        repository the bootstrap is handed. If this ever fails, the bootstrap
        is refusing correctly and the fault is in the fixture, not in cmd.exe.
        """
        probe = self._git(self.repo, 'status', '--porcelain', '-uall')
        self.assertEqual(0, probe.returncode,
                         'git status falhou num clone limpo:\n'
                         + probe.stdout + probe.stderr)
        self.assertEqual('', probe.stdout,
                         'um clone fresco nao deveria ter sujeira:\n'
                         + probe.stdout)

    def test_a_corrupt_index_is_a_real_status_failure_not_a_clean_checkout(self) -> None:
        """
        The counter-case: a status that genuinely fails, constructed by
        corrupting the index rather than by pretending. This is what step 3
        must refuse, and it is the scenario the regression below drives
        through the real bootstrap.
        """
        (self.repo / '.git' / 'index').write_bytes(b'CORROMPIDO-DE-PROPOSITO')
        probe = self._git(self.repo, 'status', '--porcelain', '-uall')
        self.assertNotEqual(0, probe.returncode,
                            'corromper o indice nao fez o status falhar')
        self.assertEqual('', probe.stdout,
                         'um status que falhou nao pode render lista de sujeira')


    def test_the_status_marker_is_emitted_without_a_trailing_space(self) -> None:
        """
        `echo LIA_RC_ZERO || ...` echoes "LIA_RC_ZERO " WITH the space, because
        cmd's echo takes everything up to the operator.

        Measured on a real Windows runner, not inferred: the probe loop received
        `[LIA_RC_ZERO ]` while `git status` had exited 0, so the comparison
        against "LIA_RC_ZERO" failed, LIA_STATUS_RC stayed empty and a clean
        checkout was refused as if the status had failed. The marker has to butt
        against the operator. Portable on purpose - this must also fail on
        Linux, where the bootstrap itself never runs.
        """
        text = UPGRADE_BAT.read_text(encoding='utf-8', errors='replace')
        lines = text.replace('\r\n', '\n').split('\n')
        hits = [line for line in lines
                if 'LIA_RC_ZERO' in line and line.strip().startswith('for /f')]
        self.assertEqual(1, len(hits), f'esperava um for /f de status: {hits}')
        line = hits[0]
        self.assertIn('echo LIA_RC_ZERO' + '^|^|', line,
                      'o marcador perdeu o contato com o operador: ' + line)
        self.assertNotIn('echo LIA_RC_ZERO ', line,
                         'eco com espaco vira "LIA_RC_ZERO " e nunca compara '
                         'igual: ' + line)


@unittest.skipUnless(shutil.which('cmd.exe'), 'cmd.exe indisponível nesta plataforma')
class StatusMarkerProbeTests(unittest.TestCase):
    """
    The cmd.exe half of step 3, isolated.

    Steps 1 and 2 of the shipped bootstrap read git through the same
    `for /f "usebackq delims="` shape and they work, so the shape itself is not
    in doubt. Step 3 differs in one respect only: its backquoted command carries
    an `&& echo LIA_RC_ZERO || echo LIA_RC_NONZERO` marker. This runs that exact
    shipped line - extracted byte for byte, not retyped - and prints what the
    loop body receives, so "git failed" and "the marker was lost" stop looking
    identical.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='marker-probe-'))
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        subprocess.run([sync.git_executable(), '-C', str(self.repo), 'init',
                        '-q', '-b', 'sonda'],
                       capture_output=True, text=True, timeout=120)
        (self.repo / 'a.txt').write_text('a\n', encoding='utf-8')
        for args in (['config', 'user.email', 'devflow@test.local'],
                     ['config', 'user.name', 'DevFlow Test'],
                     ['add', '-A'], ['commit', '-q', '-m', 'base']):
            subprocess.run([sync.git_executable(), '-C', str(self.repo), *args],
                           capture_output=True, text=True, timeout=120)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _shipped_marker_line(self) -> str:
        text = UPGRADE_BAT.read_text(encoding='utf-8', errors='replace')
        lines = text.replace('\r\n', '\n').split('\n')
        hits = [line for line in lines
                if line.strip().startswith('for /f') and 'LIA_RC_ZERO' in line]
        self.assertEqual(1, len(hits),
                         f'esperava exatamente um for /f de status: {hits}')
        return hits[0]

    def test_the_shipped_marker_reaches_the_for_loop(self) -> None:
        shipped = self._shipped_marker_line()
        head, sep, _tail = shipped.partition(') do (')
        self.assertTrue(sep, f'a linha embarcada mudou de forma: {shipped!r}')
        # The loop body is swapped for an echo of what it received; the
        # backquoted command - the part under test - is untouched.
        probe_bat = self.base / 'probe.bat'
        # The raw exit code is read on its OWN line, outside any block, so
        # %ERRORLEVEL% is live rather than expanded when the block was parsed.
        probe_bat.write_bytes(
            ('@echo off\r\n'
             'set "LIA_REPO=%~1"\r\n'
             'git -C "%LIA_REPO%" status --porcelain -uall >nul 2>nul\r\n'
             'echo [RC=%ERRORLEVEL%]\r\n'
             + head + ') do echo [%%L]\r\n').encode('utf-8'))
        proc = subprocess.run(
            ['cmd.exe', '/d', '/s', '/c', str(probe_bat), str(self.repo)],
            cwd=self.base, capture_output=True, text=True,
            encoding='utf-8', errors='replace', timeout=180)
        out = proc.stdout + proc.stderr
        # Both halves are reported together because they discriminate the two
        # candidate causes: a nonzero [RC] means git genuinely failed, while
        # [RC=0] with no marker means cmd.exe lost the marker on the way out of
        # `for /f`. Guessing between them from the bootstrap's message alone is
        # exactly what produced a wrong diagnosis before.
        self.assertIn('[RC=0]', out,
                      'git status falhou DE VERDADE sob cmd.exe - a recusa do '
                      'bootstrap esta correta e o defeito nao e de parsing:\n'
                      + out)
        self.assertIn('[LIA_RC_ZERO]', out,
                      'git status saiu 0 mas o marcador NAO chegou ao laco '
                      'for /f - a falha e de parsing do cmd.exe:\n' + out)


class DeclaredTimeoutTests(unittest.TestCase):
    """
    REGRESSION - first real Windows run of M3.0b.

    `devflow` came back "FALHOU (exit 127)" with the detail
    `TimeoutExpired: ... timed out after 1800 seconds`. The suite was not hung:
    it spawns ~1800 git processes and Windows process creation made it slow.
    A fixed ceiling inside the runner turned "slow" into "failed" with no way to
    fix it from the manifest, and the report could not distinguish a timeout
    from a crash.
    """

    MANIFEST = TOOLS / 'devflow' / 'rounds' / 'm3_0b.json'

    def _load(self, mutate) -> Round:
        data = json.loads(self.MANIFEST.read_text(encoding='utf-8'))
        mutate(data['tests'][0])
        return validate_round(data)

    def test_a_round_may_declare_the_budget_its_suite_needs(self) -> None:
        def _set(test: dict) -> None:
            test['timeout_s'] = 3600
        parsed = self._load(_set)
        self.assertEqual(parsed.tests[0].timeout_s, 3600.0)

    def test_the_budget_defaults_when_absent_so_old_manifests_still_load(self) -> None:
        parsed = self._load(lambda test: test.pop('timeout_s', None))
        self.assertEqual(parsed.tests[0].timeout_s, DEFAULT_TEST_TIMEOUT_S)

    def test_the_shipped_m3_0b_manifest_declares_a_windows_budget(self) -> None:
        shipped = json.loads(self.MANIFEST.read_text(encoding='utf-8'))
        declared = {t['id']: t.get('timeout_s') for t in shipped['tests']}
        self.assertGreater(
            declared['devflow'], DEFAULT_TEST_TIMEOUT_S,
            'the suite that spawns ~1800 git processes must not run under the '
            'default ceiling on a slow platform')

    def test_a_nonsense_budget_is_rejected_not_silently_clamped(self) -> None:
        for bad in (0, -5, '1800', True, None, 10 ** 9):
            with self.subTest(timeout_s=bad):
                with self.assertRaises(RoundSchemaError):
                    self._load(lambda test, bad=bad: test.__setitem__('timeout_s', bad))

    def test_an_expired_budget_is_reported_as_a_budget_not_as_a_crash(self) -> None:
        # Pure Python: no external executable, per the D1.2 constraint.
        code, detail = run_test_command(
            [sys.executable, '-c', 'import time; time.sleep(5)'],
            Path('.'), 0.5)
        self.assertEqual(code, 124, detail)
        self.assertIn('orçamento', detail)
        self.assertIn('timeout_s', detail)

    def test_a_test_that_finishes_inside_its_budget_is_unaffected(self) -> None:
        code, detail = run_test_command(
            [sys.executable, '-c', 'print("ok")'], Path('.'), 30)
        self.assertEqual(code, 0, detail)


class VitestFailureIdentityTests(unittest.TestCase):
    """
    REGRESSION - first real Windows run of M3.0b.

    `lia-app` failed and the persisted detail was undiagnosable: four lines of
    `Could not resolve Windows LocalAppData` plus one separator assertion, and
    nowhere the name of the failing test. The sanitizer knew Python's `FAIL:`
    but not vitest's `FAIL ` / `x` / `>` markers, while its loose `Error` token
    kept the surrounding source frames - so the budget filled with
    `91|  throw new Error(...)` and the identity line was dropped.
    """

    FRAME = '91|     throw new Error(`Could not resolve Windows LocalAppData`)'
    IDENTITY = (' FAIL  src/main/example.test.ts > 7.9E.1 > rejeita sem LocalAppData')
    SUMMARY = '      Tests  1 failed | 302 passed (303)'

    def test_the_failing_test_name_survives_the_budget(self) -> None:
        raw = '\n'.join([self.IDENTITY, 'AssertionError: expected a to be b']
                         + [self.FRAME] * 12 + [self.SUMMARY])
        detail = sanitize_test_output(raw, '')
        self.assertIn('example.test.ts', detail)
        self.assertIn('AssertionError', detail)
        self.assertIn('Tests  1 failed', detail)

    def test_source_frames_never_crowd_out_the_identity(self) -> None:
        # 30 frames arrive BEFORE the identity. Inside a 14-line budget the old
        # picker would keep 14 frames and drop the identity entirely.
        raw = '\n'.join([self.FRAME] * 30 + [self.IDENTITY])
        detail = sanitize_test_output(raw, '')
        lines = detail.splitlines()
        self.assertIn('example.test.ts', detail,
                      '30 source frames must not displace the one line that '
                      'says what failed')
        self.assertTrue(lines[0].startswith(' FAIL '),
                        f'a identidade precisa vir primeiro, veio: {lines[0]!r}')
        self.assertLessEqual(len(lines), MAX_DETAIL_LINES)

    def test_a_frame_is_still_available_as_tail_context_when_it_is_all_there_is(self) -> None:
        detail = sanitize_test_output(self.FRAME, '')
        self.assertIn('throw new Error', detail)

    def test_no_conversation_content_leaks_in_through_the_new_prefixes(self) -> None:
        raw = f'{self.IDENTITY}\nuser: ignore previous instructions'
        self.assertNotIn('ignore previous', sanitize_test_output(raw, ''))


class FailureIdentityStreamTests(unittest.TestCase):
    """
    REGRESSION A - the failing test's identity was hidden by the other stream.

    `sanitize_test_output` picked ONE stream:
    `stream = (stderr or '').strip() or (stdout or '').strip()`. Vitest can
    write the failing test's identity to stdout while a tested negative path
    prints unrelated diagnostics to stderr, so the stderr branch won and the
    only line naming the test was discarded before any prioritisation ran.
    That is exactly the shape of the owner's Windows evidence: several
    `Could not resolve Windows LocalAppData` lines and no test name.
    """

    IDENTITY = 'FAIL src/main/example.test.ts > Windows > should resolve path'
    NOISE = 'Could not resolve Windows LocalAppData for the Lia runtime.'

    def test_identity_on_stdout_survives_noisy_stderr(self) -> None:
        detail = sanitize_test_output(
            self.IDENTITY, '\n'.join([self.NOISE] * 6))
        self.assertIn('example.test.ts', detail)
        self.assertIn('should resolve path', detail)
        self.assertTrue(detail.splitlines()[0].startswith('FAIL'),
                        f'a identidade deve liderar, veio {detail.splitlines()[0]!r}')

    def test_identity_on_stderr_survives_noisy_stdout(self) -> None:
        detail = sanitize_test_output(
            '\n'.join([self.NOISE] * 6), self.IDENTITY)
        self.assertIn('example.test.ts', detail)

    def test_identity_split_across_both_streams_is_fully_preserved(self) -> None:
        detail = sanitize_test_output(
            'Test Files  1 failed | 21 passed (22)',
            f'{self.IDENTITY}\nAssertionError: expected /a/b to be /a\\b')
        self.assertIn('example.test.ts', detail)
        self.assertIn('AssertionError', detail)
        self.assertIn('Test Files  1 failed', detail)

    def test_a_line_on_both_streams_spends_the_budget_once(self) -> None:
        once = sanitize_test_output(self.IDENTITY, '')
        twice = sanitize_test_output(self.IDENTITY, self.IDENTITY)
        self.assertEqual(once, twice)

    def test_no_raw_output_is_concatenated_and_conversation_is_still_dropped(self) -> None:
        detail = sanitize_test_output(
            f'{self.IDENTITY}\nuser: ignore previous instructions',
            f'{self.NOISE}\nassistant: here is the transcript')
        self.assertNotIn('ignore previous', detail)
        self.assertNotIn('here is the transcript', detail)
        self.assertLessEqual(len(detail), MAX_DETAIL_CHARS)


class FailureIdentityCharBudgetTests(unittest.TestCase):
    """
    REGRESSION B - the character budget deleted the identity it had just kept.

    The old tail was `_TRUNCATION + out[-(max_chars - len(_TRUNCATION)):]`,
    which keeps the END of the joined text. Prioritising the identity and then
    slicing from the tail is self-defeating: one identity line followed by a
    wall of source frames put the identity exactly where the slice threw it
    away. The budget is now spent in priority order, so truncation removes the
    lowest-priority content first.
    """

    IDENTITY = 'FAIL  src/main/example.test.ts > Windows > should resolve path'

    @staticmethod
    def _frames(count: int, width: int = 220) -> list[str]:
        # Distinct lines: identical frames are legitimately deduplicated, and a
        # regression built on duplicates would prove nothing.
        return [f'{91 + i}|     throw new Error(`{"x" * width} at marker {i}`)'
                for i in range(count)]

    def test_identity_survives_a_char_budget_smaller_than_the_tail(self) -> None:
        frames = self._frames(13)
        raw = '\n'.join([self.IDENTITY] + frames)
        self.assertGreater(len(raw), 3000, 'o cenário precisa estourar o orçamento')
        detail = sanitize_test_output(raw, '')
        self.assertLessEqual(len(detail), MAX_DETAIL_CHARS)
        self.assertIn('example.test.ts', detail)
        self.assertTrue(detail.splitlines()[0].startswith('FAIL'))

    def test_the_budget_is_actually_spent_not_left_on_the_table(self) -> None:
        detail = sanitize_test_output('\n'.join([self.IDENTITY] + self._frames(13)), '')
        # Sanitised lines are what get persisted, so the budget must be measured
        # on them; measuring raw text left ~80% of it unspent.
        self.assertGreater(len(detail), MAX_DETAIL_CHARS * 0.8)

    def test_truncation_is_signalled_only_when_something_was_dropped(self) -> None:
        self.assertNotIn('truncado', sanitize_test_output(self.IDENTITY, ''))
        self.assertIn('truncado',
                      sanitize_test_output('\n'.join([self.IDENTITY] + self._frames(40)), ''))

    def test_redaction_survives_the_priority_reordering(self) -> None:
        home = str(Path.home())
        raw = '\n'.join([self.IDENTITY, f'{home}/leaked/path', 'token=abc'] + self._frames(13))
        detail = sanitize_test_output(raw, '')
        self.assertNotIn(home, detail)
        self.assertIn('<HOME>', detail)

    def test_a_single_oversized_identity_line_is_clipped_not_dropped(self) -> None:
        detail = sanitize_test_output('FAIL  ' + 'z' * 4000, '')
        self.assertLessEqual(len(detail), MAX_DETAIL_CHARS)
        self.assertTrue(detail.startswith('FAIL'))


class PrelaunchPreparationTests(unittest.TestCase):
    """
    REGRESSION C - a mandatory test rebuilt the artifact before launch.

    The M3.0b sequence was `_prepare() -> _run_tests() -> _launch_and_gate()`,
    and `prepare` deletes `core-agent/dist` to reproduce a fresh checkout. But
    lia-app's mandatory test "against the real workspace it rebuilds the real
    core-agent artifact" runs that SAME prerequisite against the real
    workspace, so by the time the Launcher started the artifact was back. The
    prerequisite's starting/succeeded markers could then appear without the
    fresh-checkout condition - the defining setup of this round - ever holding.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-prelaunch-'))
        self.repo = make_repo(self.base)
        data = runnable_manifest()
        data['prelaunch_prepare'] = [{
            'kind': 'remove_generated',
            'path': CORE_DIST,
            'why': 'restaura a condição de checkout fresco antes do lançamento',
        }]
        self.manifest = validate_round(data)
        self.dist = self.repo / CORE_DIST

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _rebuilding_tests(self, argv, cwd):
        """Stands in for the mandatory lia-app test that rebuilds the artifact."""
        self.dist.mkdir(parents=True, exist_ok=True)
        (self.dist / 'index.mjs').write_text('export {}\n')
        (self.dist / 'stale-marker.txt').write_text('rebuilt by a test\n')
        return 0, 'rebuilt'

    def _observe_spawn(self, runner, seen: list[bool]):
        inner = runner.spawn

        def spawn(command, cwd, on_line, env=None):
            seen.append(self.dist.exists())
            return inner(command, cwd, on_line, env)

        runner.spawn = spawn

    def test_an_artifact_rebuilt_by_a_mandatory_test_is_absent_at_spawn(self) -> None:
        # The artifact exists when the round starts; `prepare` removes it inside
        # execute(), and the mandatory test puts it back. What matters is the
        # state at the instant of the spawn, captured below.
        self.assertTrue(self.dist.exists())
        runner, emitted, _asks = make_runner(
            self.repo, self.manifest, invoke_test=self._rebuilding_tests)
        seen: list[bool] = []
        self._observe_spawn(runner, seen)
        outcome = runner.execute()
        self.assertEqual(seen, [False],
                         'no momento exato do lançamento o dist tinha que estar AUSENTE')
        self.assertTrue(any('AUSENTE imediatamente antes do lançamento' in line
                            for line in outcome.prelaunch), outcome.prelaunch)
        self.assertFalse(self.dist.exists())
        self.assertNotEqual(outcome.verdict, 'REFUSED', '\n'.join(emitted))

    def test_the_fact_is_recorded_in_the_persisted_artifacts(self) -> None:
        runner, _e, _a = make_runner(
            self.repo, self.manifest, invoke_test=self._rebuilding_tests)
        outcome = runner.execute()
        payload = json.loads(Path(outcome.artifacts['json']).read_text(encoding='utf-8'))
        self.assertIn('prelaunch', payload)
        self.assertTrue(any(CORE_DIST in line and 'AUSENTE' in line
                            for line in payload['prelaunch']), payload['prelaunch'])
        report = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        self.assertIn('imediatamente antes do lançamento', report)

    def test_no_directory_contents_are_persisted_only_the_safe_fact(self) -> None:
        runner, _e, _a = make_runner(
            self.repo, self.manifest, invoke_test=self._rebuilding_tests)
        outcome = runner.execute()
        joined = '\n'.join(outcome.prelaunch)
        self.assertNotIn('index.mjs', joined)
        self.assertNotIn('stale-marker', joined)
        self.assertNotIn('rebuilt by a test', joined)

    def test_a_refused_re_clean_prevents_the_launch(self) -> None:
        outside = self.base / 'outside-target'
        outside.mkdir()
        # make_repo seeds dist/index.mjs, so this is a tree, not an empty dir.
        shutil.rmtree(self.dist)
        try:
            os.symlink(outside, self.dist, target_is_directory=True)
        except (OSError, NotImplementedError, AttributeError) as exc:
            # Narrow: only the symlink CREATION may skip. A failure to clear the
            # tree is a real error and must not be swallowed into a skip.
            self.skipTest(f'symlink indisponível nesta plataforma: {exc}')
        runner, _e, _a = make_runner(
            self.repo, self.manifest, invoke_test=self._rebuilding_tests)
        seen: list[bool] = []
        self._observe_spawn(runner, seen)
        outcome = runner.execute()
        self.assertEqual(seen, [], 'uma re-limpeza recusada não pode chegar a lançar')
        self.assertNotEqual(outcome.verdict, 'PASS')
        self.assertTrue(outside.exists(), 'o alvo fora do repositório não pode ser tocado')

    def test_a_failed_mandatory_test_still_prevents_both_the_preclean_and_the_launch(self) -> None:
        def failing(argv, cwd):
            self.dist.mkdir(parents=True, exist_ok=True)
            return 1, 'falhou'

        runner, _e, _a = make_runner(self.repo, self.manifest, invoke_test=failing)
        seen: list[bool] = []
        self._observe_spawn(runner, seen)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual(seen, [], 'teste obrigatório falhou: nada pode ser lançado')
        self.assertEqual(outcome.prelaunch, [],
                         'a re-limpeza é pós-gate, não um substituto dele')
        self.assertTrue(self.dist.exists())

    def test_a_round_that_declares_nothing_launches_unchanged(self) -> None:
        data = runnable_manifest()
        data.pop('prelaunch_prepare', None)
        legacy = validate_round(data)
        self.assertEqual(legacy.prelaunch_prepare, ())
        runner, _e, _a = make_runner(self.repo, legacy)
        seen: list[bool] = []
        self._observe_spawn(runner, seen)
        outcome = runner.execute()
        self.assertEqual(seen, [False])
        self.assertEqual(outcome.prelaunch, [])

    def test_a_prelaunch_path_outside_the_allowlist_is_rejected_by_the_schema(self) -> None:
        data = runnable_manifest()
        data['prelaunch_prepare'] = [{
            'kind': 'remove_generated', 'path': 'airi/apps/lia-app/src', 'why': 'x',
        }]
        with self.assertRaises(RoundSchemaError):
            validate_round(data)

    def test_only_remove_generated_is_accepted_before_launch_too(self) -> None:
        data = runnable_manifest()
        data['prelaunch_prepare'] = [
            {'kind': 'wipe_everything', 'path': CORE_DIST, 'why': 'x'}]
        with self.assertRaises(RoundSchemaError):
            validate_round(data)

    def test_the_shipped_round_declares_the_fresh_checkout_at_launch(self) -> None:
        shipped = load_active_round()
        self.assertEqual([step.path for step in shipped.prelaunch_prepare], [CORE_DIST])
        self.assertEqual([step.path for step in shipped.prepare], [CORE_DIST])


class TimeoutHonestyTests(unittest.TestCase):
    """
    REGRESSION D - a timeout must not be misdiagnosed, and must not leak.

    The previous detail asserted "Não é uma trava: é orçamento". That is an
    unfalsifiable claim made from outside the process: the suite IS measurably
    expensive, so slowness is a sufficient explanation, but a deadlock, a
    blocked child or a leaked inherited pipe reaches the same deadline and is
    indistinguishable from here. The detail now names the stage and the budget
    that expired and refuses to guess the cause.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-timeout-'))

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_the_detail_names_the_stage_and_the_budget(self) -> None:
        code, detail = run_test_command(
            [sys.executable, '-c', 'import time; time.sleep(30)'],
            self.base, 0.5, label='devflow')
        self.assertEqual(code, 124, detail)
        self.assertIn('devflow', detail)
        self.assertIn('orçamento', detail)
        self.assertIn('timeout_s', detail)

    def test_the_detail_does_not_claim_to_know_whether_it_was_slow_or_hung(self) -> None:
        _code, detail = run_test_command(
            [sys.executable, '-c', 'import time; time.sleep(30)'],
            self.base, 0.5, label='devflow')
        self.assertIn('NÃO diagnosticada', detail)
        for overclaim in ('não é uma trava', 'apenas lento', 'somente lento'):
            self.assertNotIn(overclaim, detail.lower())

    def test_a_timeout_kills_the_whole_tree_not_just_the_root(self) -> None:
        marker = self.base / 'grandchild.pid'
        script = (
            'import subprocess, sys, time, pathlib\n'
            'child = subprocess.Popen([sys.executable, "-c", '
            '"import time; time.sleep(300)"])\n'
            f'pathlib.Path({str(marker)!r}).write_text(str(child.pid))\n'
            'time.sleep(300)\n'
        )
        started = time.monotonic()
        code, detail = run_test_command(
            [sys.executable, '-c', script], self.base, 1.5, label='devflow')
        elapsed = time.monotonic() - started
        self.assertEqual(code, 124, detail)
        self.assertLess(elapsed, 60, 'a limpeza não pode esperar o sleep acabar')
        self.assertTrue(marker.exists(), detail)
        grandchild = int(marker.read_text(encoding='utf-8').strip())
        deadline = time.monotonic() + 15
        state = processes.pid_state(grandchild)
        while state == processes.ALIVE and time.monotonic() < deadline:
            time.sleep(0.2)
            state = processes.pid_state(grandchild)
        # Compared against the module's own constants, and demanding positive
        # proof of absence: `UNKNOWN` is not "dead", and a case-mismatched
        # literal here once made this assertion pass against a surviving
        # grandchild.
        self.assertEqual(state, processes.DEAD,
                         f'o neto {grandchild} não foi provado morto ({state}): {detail}')

    def test_the_timeout_detail_reports_the_cleanup_it_actually_did(self) -> None:
        _code, detail = run_test_command(
            [sys.executable, '-c', 'import time; time.sleep(30)'],
            self.base, 0.5, label='devflow')
        self.assertIn('Limpeza:', detail)

    def test_progress_is_emitted_and_bounded(self) -> None:
        seen: list[str] = []
        with patch.object(runner_module, 'PROGRESS_INTERVAL_S', 0.2):
            code, _detail = run_test_command(
                [sys.executable, '-c', 'import time; time.sleep(1.2)'],
                self.base, 60.0, label='lia-app', progress=seen.append)
        self.assertEqual(code, 0)
        self.assertTrue(seen, 'um estágio longo não pode ser totalmente opaco')
        self.assertTrue(all('lia-app' in line for line in seen), seen)
        self.assertLessEqual(len(seen), PROGRESS_MAX_LINES)

    def test_a_command_that_finishes_in_time_is_unaffected(self) -> None:
        code, detail = run_test_command(
            [sys.executable, '-c', 'print("ok")'], self.base, 30.0, label='x')
        self.assertEqual(code, 0, detail)
        self.assertIn('ok', detail)

    def test_a_missing_executable_is_still_127_not_124(self) -> None:
        code, detail = run_test_command(
            [str(self.base / 'definitely-not-here')], self.base, 30.0, label='x')
        self.assertEqual(code, 127, detail)


class RealProgressWiringTests(unittest.TestCase):
    """
    REGRESSION - progress existed but nothing was ever connected to it.

    `run_test_command` accepted `label` and `progress`, while `_run_tests`
    called `self._invoke(argv, cwd, spec.timeout_s)` and `_invoke` called
    `run_test_command(argv, cwd, timeout_s)`. The canonical automatic round
    therefore never passed a callback, and a twenty-minute required test was
    completely silent. A unit test of `run_test_command` cannot catch that:
    the defect was in the wiring, so these tests drive a real `RoundRunner`
    with the REAL executor and read what it actually emitted.
    """

    SLOW_ID = 'slow-suite'

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-progress-'))
        self.repo = make_repo(self.base)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _manifest(self, body: str, timeout_s: float) -> Round:
        data = runnable_manifest()
        data['tests'] = [{
            'id': self.SLOW_ID, 'label': 'suíte lenta', 'cwd': '.',
            'argv': ['python', '-c', body], 'timeout_s': timeout_s,
        }]
        return validate_round(data)

    def _run(self, body: str, timeout_s: float):
        runner, emitted, asks = make_runner(
            self.repo, self._manifest(body, timeout_s),
            invoke_test=run_test_command)
        with patch.object(runner_module, 'PROGRESS_INTERVAL_S', 0.2):
            outcome = runner.execute()
        return outcome, emitted, asks

    def test_a_slow_required_test_emits_progress_naming_its_own_id(self) -> None:
        outcome, emitted, _asks = self._run('import time; time.sleep(1.2)', 60.0)
        beats = [line for line in emitted if 'em andamento' in line]
        self.assertTrue(beats, 'um teste obrigatório longo não pode ser mudo:\n'
                        + '\n'.join(emitted))
        self.assertTrue(all(self.SLOW_ID in line for line in beats), beats)
        self.assertTrue(all('decorridos' in line for line in beats), beats)

    def test_progress_is_bounded(self) -> None:
        _outcome, emitted, _asks = self._run('import time; time.sleep(2.0)', 60.0)
        beats = [line for line in emitted if 'em andamento' in line]
        self.assertLessEqual(len(beats), PROGRESS_MAX_LINES)

    def test_no_input_or_menu_is_requested_while_a_test_runs(self) -> None:
        _outcome, _emitted, asks = self._run('import time; time.sleep(1.0)', 60.0)
        self.assertEqual(asks, [], 'a rodada automática não pode pedir nada')

    def test_progress_never_carries_the_childs_raw_output(self) -> None:
        body = 'import time; print("MARCADOR-CRU-DE-STDOUT", flush=True); time.sleep(1.2)'
        _outcome, emitted, _asks = self._run(body, 60.0)
        beats = [line for line in emitted if 'em andamento' in line]
        self.assertTrue(beats)
        for line in beats:
            self.assertNotIn('MARCADOR-CRU-DE-STDOUT', line)
            self.assertNotIn('import time', line)

    def test_the_same_real_executor_still_enforces_the_declared_timeout(self) -> None:
        outcome, emitted, _asks = self._run('import time; time.sleep(30)', 1.0)
        result = next(t for t in outcome.tests if t.id == self.SLOW_ID)
        self.assertEqual(result.status, 'fail')
        self.assertEqual(result.exit_code, 124, result.detail)
        self.assertIn(self.SLOW_ID, result.detail)
        self.assertIn('orçamento', result.detail)
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertTrue(any('FALHOU' in line for line in emitted), emitted)

    def test_an_injected_two_argument_invoker_still_works_unchanged(self) -> None:
        seen: list[tuple] = []

        def fake(argv, cwd):
            seen.append((tuple(argv), cwd))
            return 0, ''

        runner, _emitted, _asks = make_runner(
            self.repo, self._manifest('import time', 60.0), invoke_test=fake)
        outcome = runner.execute()
        self.assertEqual(len(seen), 1, 'um injetor de 2 argumentos não pode quebrar')
        self.assertEqual(outcome.tests[0].status, 'pass')


class SpawnGuardBypassTests(unittest.TestCase):
    """
    REGRESSION - the guard compared bare names against unnormalised text.

    `_record_spawn` took `os.path.basename()` of whatever it was handed and
    `_enforce_spawn_guard` compared that against names like 'sh'. Two concrete
    bypasses: `os.system('sleep 5')` recorded the whole command line, and
    `Popen(['sh.exe', ...])` recorded a filename that is not in a bare-name
    set. Both walked straight through a suite that reported itself portable.
    """

    #: A forbidden name that does not exist on this machine, so exercising the
    #: guard never actually runs a forbidden tool.
    @staticmethod
    def _absent_forbidden() -> str:
        for name in sorted(FORBIDDEN_EXECUTABLES):
            if shutil.which(name) is None:
                return name
        raise AssertionError('nenhum executável proibido está ausente nesta máquina')

    def test_a_shell_command_is_classified_by_its_program_name(self) -> None:
        name = self._absent_forbidden()
        self.assertEqual(_classify_spawn(f'{name} 5'), name)
        self.assertEqual(_spawn_violations([_classify_spawn(f'{name} 5')]), [name])

    def test_windows_executable_suffixes_do_not_hide_a_forbidden_name(self) -> None:
        name = self._absent_forbidden()
        for form in (f'{name}.exe', f'{name}.cmd', f'{name}.bat', f'{name}.EXE'):
            with self.subTest(form=form):
                self.assertEqual(_spawn_violations([_classify_spawn(form)]), [name])
                self.assertEqual(_spawn_violations([_classify_spawn([form])]), [name])

    def test_directories_do_not_hide_a_forbidden_name(self) -> None:
        name = self._absent_forbidden()
        for form in (f'C:{chr(92)}Windows{chr(92)}System32{chr(92)}{name}.exe',
                     f'/usr/local/bin/{name}',
                     f'{name} --flag',
                     f'"{chr(67)}:{chr(92)}Program Files{chr(92)}x{chr(92)}{name}.exe" -c y'):
            with self.subTest(form=form):
                self.assertEqual(_spawn_violations([_classify_spawn(form)]), [name])

    def test_argv_paths_with_spaces_are_one_program_name(self) -> None:
        # In ARGV form a path containing spaces is a single program, so it must
        # classify. In SHELL form the same unquoted text is genuinely two words
        # - the program is the first one - and that is not a bypass, it is what
        # a shell would actually execute.
        name = self._absent_forbidden()
        argv = [f'/opt/my tools/{name}', '--flag']
        self.assertEqual(_spawn_violations([_classify_spawn(argv)]), [name])
        self.assertEqual(_classify_spawn(f'/opt/my tools/{name}'), 'my')

    def test_a_permitted_subprocess_is_never_a_violation(self) -> None:
        for argv in ([sys.executable, '-c', 'pass'],
                     ['C:\\Program Files\\Git\\bin\\git.exe', 'status'],
                     ['/usr/bin/git', 'status'],
                     [str(SUITE_PATH)],
                     ['git', 'rev-parse', 'HEAD']):
            with self.subTest(argv=argv):
                self.assertEqual(_spawn_violations([_classify_spawn(argv)]), [])

    def test_an_unclassifiable_command_fails_closed(self) -> None:
        for args in ([], '', '"unclosed', 42, None, object()):
            with self.subTest(args=type(args).__name__):
                self.assertEqual(_classify_spawn(args), UNCLASSIFIED_SPAWN)
                self.assertEqual(_spawn_violations([_classify_spawn(args)]),
                                 [UNCLASSIFIED_SPAWN])

    def _isolated_records(self) -> list[str]:
        """
        Records made from here on, removed again on cleanup.

        These tests deliberately attempt a forbidden spawn, so they poison the
        module-wide list. Left in place, the atexit guard would force a nonzero
        exit AFTER a green summary and fail the whole suite - which is exactly
        the behaviour the guard is supposed to have, pointed at the wrong run.
        """
        before = len(SPAWNED_HEADS)
        self.addCleanup(lambda: SPAWNED_HEADS.__delitem__(slice(before, None)))
        return SPAWNED_HEADS[before:]

    def test_the_guard_records_what_a_real_os_system_call_attempts(self) -> None:
        name = self._absent_forbidden()
        self._isolated_records()
        os.system(f'{name} --definitely-not-a-real-flag')
        self.assertEqual(_spawn_violations(SPAWNED_HEADS), [name])

    def test_the_guard_records_a_list_spawn_with_a_windows_suffix(self) -> None:
        name = self._absent_forbidden()
        self._isolated_records()
        try:
            subprocess.Popen([f'{name}.exe'], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
        except OSError:
            pass  # não existe - o que importa é o que foi REGISTRADO
        self.assertEqual(_spawn_violations(SPAWNED_HEADS), [name])

    def test_a_forbidden_spawn_makes_the_process_exit_nonzero(self) -> None:
        """
        The guard must fail the RUN, not merely log after a green summary.

        A child imports this module (which installs the guard and registers the
        atexit hook), attempts one forbidden spawn, then exits 0 on purpose. If
        the guard only asserted inside a test, the child would still exit 0.
        """
        name = self._absent_forbidden()
        script = (
            'import sys, os\n'
            f'sys.path.insert(0, {str(TOOLS)!r})\n'
            'import test_lia_dev\n'
            f'os.system({name!r} + " --definitely-not-a-real-flag")\n'
            'sys.exit(0)\n'
        )
        child = subprocess.run([sys.executable, '-c', script],
                               capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=300)
        self.assertNotEqual(child.returncode, 0,
                            'um spawn proibido tem que tornar a suíte não-zero')
        self.assertIn('GUARDA DE SPAWN', child.stderr or '')

    def test_a_clean_child_still_exits_zero(self) -> None:
        script = (
            'import sys, subprocess\n'
            f'sys.path.insert(0, {str(TOOLS)!r})\n'
            'import test_lia_dev\n'
            'subprocess.run([sys.executable, "-c", "pass"], capture_output=True)\n'
            'sys.exit(0)\n'
        )
        child = subprocess.run([sys.executable, '-c', script],
                               capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(child.returncode, 0, child.stderr)

    def test_no_devflow_production_module_patches_process_apis(self) -> None:
        """
        The guard belongs to the test process alone. If it ever leaked into
        DevFlow's own modules it would change the behaviour of the code under
        test, and the portability proof would be measuring the patch.
        """
        root = TOOLS / 'devflow'
        scanned = 0
        for path in sorted(root.rglob('*.py')):
            tree = ast.parse(path.read_text(encoding='utf-8'))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Assign):
                    continue
                for target in node.targets:
                    if (isinstance(target, ast.Attribute)
                            and isinstance(target.value, ast.Name)
                            and target.value.id in ('subprocess', 'os')
                            and target.attr in ('Popen', 'system')):
                        self.fail(f'{path} remenda {target.value.id}.{target.attr}')
            scanned += 1
        self.assertGreater(scanned, 5, 'a varredura não viu os módulos do DevFlow')


#: Synthetic only. Built by concatenation so the literal pair `api_key=<value>`
#: never appears in this file and the DevKit's own secret scan stays clean.
FAKE_SECRET = 'synthetic-long-credential-' + 'value'
FAKE_KEY = 'gsk_synthetic' + 'longcredentialvalue'


class UnquotedCredentialRedactionTests(unittest.TestCase):
    """
    REGRESSION - the shared redactor only recognised QUOTED values.

    `ASSIGN_RE` ends in `(["']) ([^\r\n"']{6,}) \1`, so an unquoted
    `api_key=synthetic-long-credential-value` matched nothing. DevFlow persists
    automated test output through that one redactor into REPORT.txt and
    run.json, so an unquoted credential in any test's output was written to
    disk intact. This is not an acceptable "out of scope" privacy exception:
    the destinations are ours.
    """

    def test_unquoted_assignments_are_redacted(self) -> None:
        for text in (f'api_key={FAKE_SECRET}', f'token={FAKE_SECRET}',
                     f'GROQ_API_KEY={FAKE_SECRET}', f'api_key={FAKE_KEY}',
                     f'password: {FAKE_SECRET}', f'client_secret={FAKE_SECRET}',
                     f'access_token={FAKE_SECRET}', f'secret_key={FAKE_SECRET}'):
            with self.subTest(text=text):
                redacted = project_cli.redact(text)
                self.assertNotIn(FAKE_SECRET, redacted)
                self.assertNotIn(FAKE_KEY, redacted)
                self.assertIn('[CREDENCIAL-OCULTA]', redacted)

    def test_quoted_assignments_are_still_redacted(self) -> None:
        for text in (f'api_key="{FAKE_SECRET}"', f"token='{FAKE_SECRET}'"):
            with self.subTest(text=text):
                self.assertNotIn(FAKE_SECRET, project_cli.redact(text))

    def test_a_value_surviving_a_maximal_munch_boundary_is_redacted(self) -> None:
        # `process.env.X` used to backtrack to `proces`, redact that, and leave
        # `s.env.X` behind - which both mangles code and proves the lookahead
        # was being defeated.
        self.assertEqual(project_cli.redact('token=process.env.GROQ_API_KEY'),
                         'token=process.env.GROQ_API_KEY')
        self.assertNotIn(FAKE_SECRET, project_cli.redact(f'api_key={FAKE_SECRET}.'))

    def test_urls_code_and_assertions_are_preserved(self) -> None:
        for text in ('https://api.groq.com/openai/v1/chat/completions',
                     'https://github.com/BloomRX/Lia-Project',
                     "expected '/a/b' to be '/a\\b'",
                     'src/main/voice-install-inspector.test.ts:82',
                     'token=os.getenv("GROQ")',
                     'const apiKey = readEnv("GROQ_API_KEY")',
                     'rebuildToken = 0',
                     'Test Files  1 failed | 21 passed (22)',
                     'AssertionError: expected true to be false'):
            with self.subTest(text=text):
                self.assertEqual(project_cli.redact(text), text,
                                 'texto benigno não pode ser alterado')

    def test_a_placeholder_is_not_treated_as_a_real_secret(self) -> None:
        self.assertFalse(project_cli.secret_in_text('api_key=your_key_here'))
        self.assertTrue(project_cli.secret_in_text(f'api_key={FAKE_SECRET}'))

    def test_the_limitation_is_documented_not_overclaimed(self) -> None:
        # Honest boundary: the redactor is pattern-based. A secret with no
        # recognisable shape is NOT caught, and the docstring must say so
        # rather than implying a guarantee.
        self.assertEqual(project_cli.redact('the answer is 8h2k9f3a7q'),
                         'the answer is 8h2k9f3a7q')
        self.assertIn('best effort', project_cli.redact.__doc__.lower())
        self.assertIn('not a parser', project_cli.redact.__doc__.lower())


class DiagnosticDestinationRedactionTests(unittest.TestCase):
    """
    The same unquoted credential, pushed through the REAL executor and checked
    at every destination DevFlow persists: the console, TestResult.detail,
    REPORT.txt, run.json and console.sanitized.log.

    Deliberately end-to-end: the leak was in what gets written, so a unit test
    of `redact` alone would not prove any destination is clean.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-redact-'))
        self.repo = make_repo(self.base)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_the_progress_stream_is_sanitized_like_every_other_destination(self) -> None:
        """
        The console is a persistence destination.

        On a real Windows run the prepare stage printed the resolved removal
        target and the artifacts line printed %TEMP% - both absolute, both
        under the account name. `emitted` is exactly what the console sink
        receives, so this drives a real runner and reads back what arrived.
        """
        data = runnable_manifest()
        runner, emitted, _asks = make_runner(self.repo, validate_round(data))
        home = str(Path.home())
        runner.say(f'  alvo: dir -> {home}/algum/caminho')
        self.assertTrue(emitted, 'nada chegou ao console')
        joined = '\n'.join(emitted)
        self.assertNotIn(home, joined,
                         f'o console vazou o home: {emitted[-1]!r}')
        self.assertIn('<HOME>', joined)

    def test_an_unquoted_credential_reaches_no_persisted_destination(self) -> None:
        home = str(Path.home())
        body = (
            'import sys\n'
            f'print("api_key={FAKE_SECRET}")\n'
            f'print("\\x1b[31mtoken={FAKE_SECRET}\\x1b[0m", file=sys.stderr)\n'
            f'print("GROQ_API_KEY={FAKE_KEY}", file=sys.stderr)\n'
            # Backslashes doubled: `home` is C:\Users\<name> on Windows, and
            # embedding it raw in a NON-raw string literal makes \U start a
            # unicode escape, so the child died with a SyntaxError before it
            # could print anything the test was looking for.
            f'print("home was {home.replace(chr(92), chr(92) * 2)}/some/path")\n'
            'print("FAIL src/main/example.test.ts > leaks")\n'
            'print("x" * 3000)\n'
            'sys.exit(1)\n'
        )
        data = runnable_manifest()
        data['tests'] = [{'id': 'leaky', 'label': 'vaza', 'cwd': '.',
                          'argv': ['python', '-c', body], 'timeout_s': 60.0}]
        runner, emitted, _asks = make_runner(
            self.repo, validate_round(data), invoke_test=run_test_command)
        outcome = runner.execute()

        self.assertEqual(outcome.verdict, 'FAIL')
        result = next(t for t in outcome.tests if t.id == 'leaky')
        self.assertEqual(result.status, 'fail')
        # The failure identity still survives - redaction must not eat it.
        self.assertIn('example.test.ts', result.detail)

        destinations = {
            'TestResult.detail': result.detail,
            'console': '\n'.join(emitted),
            'REPORT.txt': Path(outcome.artifacts['report']).read_text(encoding='utf-8'),
            'run.json': Path(outcome.artifacts['json']).read_text(encoding='utf-8'),
            'console.sanitized.log':
                Path(outcome.artifacts['console']).read_text(encoding='utf-8'),
        }
        for name, content in destinations.items():
            with self.subTest(destino=name):
                self.assertNotIn(FAKE_SECRET, content, f'{name} vazou a credencial')
                self.assertNotIn(FAKE_KEY, content, f'{name} vazou a credencial')
                self.assertNotIn(home, content, f'{name} vazou o home')
        # The redaction MARKER is only expected where the credential actually
        # arrived. console.sanitized.log keeps launcher diagnostics only
        # (SAFE_LINE_PREFIXES), and this round dies at the tests, so it is
        # legitimately empty here - asserted clean above, not asserted to
        # contain a marker it never had a chance to receive.
        for name in ('TestResult.detail', 'console', 'REPORT.txt', 'run.json'):
            with self.subTest(marcador=name):
                self.assertIn('[CREDENCIAL-OCULTA]', destinations[name],
                              f'{name} deveria mostrar o marcador de redação')

    def test_a_credential_that_reaches_the_console_sanitizer_is_redacted(self) -> None:
        """
        Closes the gap the test above cannot: the console log only keeps lines
        with a launcher prefix, so feed it one that qualifies and prove the
        value does not survive it either.
        """
        log = sanitize_console([
            f'[lia] api_key={FAKE_SECRET}',
            f'spawn: node token={FAKE_SECRET}',
            f'[lia] caminho {Path.home()}/x',
        ])
        joined = '\n'.join(log.kept)
        self.assertEqual(len(log.kept), 3, 'as três linhas têm prefixo seguro')
        self.assertNotIn(FAKE_SECRET, joined)
        self.assertIn('[CREDENCIAL-OCULTA]', joined)
        self.assertNotIn(str(Path.home()), joined)

    def test_long_output_cannot_push_the_credential_past_the_budget_unredacted(self) -> None:
        body = (
            f'print("api_key={FAKE_SECRET}")\n'
            'print("padding " * 400)\n'
            'import sys; sys.exit(1)\n'
        )
        data = runnable_manifest()
        data['tests'] = [{'id': 'long', 'label': 'longo', 'cwd': '.',
                          'argv': ['python', '-c', body], 'timeout_s': 60.0}]
        runner, _e, _a = make_runner(
            self.repo, validate_round(data), invoke_test=run_test_command)
        outcome = runner.execute()
        for path in outcome.artifacts.values():
            content = Path(path).read_text(encoding='utf-8')
            self.assertNotIn(FAKE_SECRET, content, f'{path} vazou')


# ---------------------------------------------------------------------------
# Bounded test-progress journal and per-test watchdog.
#
# The real Windows run consumed the whole 3600 s outer budget and the report
# could say only "devflow: em andamento". Forty progress beats, none of them
# naming a test, and the child stayed alive to the deadline. The suite now
# emits a bounded, allowlisted journal of what it is doing, and a watchdog
# stops a single blocked test long before the outer budget does.
#
# Deliberately IN-PROCESS rather than sharded into child processes: splitting
# would put the atexit spawn guard in a different process from the one being
# measured and would multiply interpreter startup on the slowest platform we
# run on. The journal gives the same identity at zero extra process cost.
# ---------------------------------------------------------------------------
PROGRESS_PREFIX = '[devflow-test]'

#: Both watchdog budgets can be shrunk for a single process so the watchdog's
#: real behaviour can be proved end to end in seconds instead of minutes. It
#: changes a diagnostic deadline only - never what is tested, and never a
#: pass/fail decision on its own.
WATCHDOG_BUDGET_ENV = 'LIA_DEVFLOW_TEST_WATCHDOG_S'


def _budget_from_env(name: str, default: float) -> float:
    raw = (os.environ.get(name) or '').strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


#: A single test may run this long before the watchdog declares it blocked.
#: Generous - the slowest real test here is the minimal-PATH child re-run -
#: but two orders of magnitude below the 3600 s outer budget, so a hang is
#: named in minutes instead of costing an hour.
PER_TEST_BUDGET_S = _budget_from_env(WATCHDOG_BUDGET_ENV, 600.0)

#: Identity reported when the run is stuck BEFORE any test starts - module
#: import and test collection. Without a distinct armed identity for that
#: phase, a hang during collection produces no journal line at all and the run
#: waits out the whole outer budget in silence.
STARTUP_LABEL = '__devflow__/coleta-e-import-dos-modulos'

#: Import and collection of this suite take well under a second today; this is
#: deliberately generous and still an order of magnitude below the per-test
#: budget, because nothing here should ever approach the outer one.
STARTUP_BUDGET_S = _budget_from_env(WATCHDOG_BUDGET_ENV, 300.0)


class _Watchdog(threading.Thread):
    """Names the test that is taking too long, then stops the run."""

    def __init__(self, budget_s: float = PER_TEST_BUDGET_S,
                 poll_s: float = 1.0) -> None:
        super().__init__(daemon=True, name='devflow-test-watchdog')
        self._budget_s = budget_s
        self._poll_s = poll_s
        self._lock = threading.Lock()
        self._current: str | None = None
        self._since = 0.0
        self._budget = budget_s
        self._fired = False
        self._stopped = threading.Event()

    def stop(self) -> None:
        self._stopped.set()

    def run(self) -> None:
        while not self._stopped.wait(self._poll_s):
            self.check()

    def arm(self, test_id: str, budget_s: float | None = None) -> None:
        with self._lock:
            self._current = test_id
            self._since = time.monotonic()
            self._budget = self._budget_s if budget_s is None else budget_s

    def disarm(self) -> None:
        with self._lock:
            self._current = None

    def check(self) -> None:
        with self._lock:
            current, since, fired = self._current, self._since, self._fired
            budget = self._budget
            if fired:
                return
        if not current:
            return
        elapsed = time.monotonic() - since
        if elapsed < budget:
            return
        with self._lock:
            if self._fired:
                return
            self._fired = True
        sys.stderr.write(
            f'\n{PROGRESS_PREFIX} timeout {int(elapsed * 1000)} {current}\n'
            f'{PROGRESS_PREFIX} blocked {current} excedeu {budget:.0f}s; '
            'encerrando a suíte. Causa NÃO diagnosticada: lento e travado '
            'produzem o mesmo quadro.\n',
        )
        sys.stderr.flush()
        # Where it was stuck, for every thread - this is what turns "the suite
        # hung" into an actionable line.
        faulthandler.dump_traceback(file=sys.stderr, all_threads=True)
        sys.stderr.flush()
        # The spawn guard stays load-bearing: os._exit skips atexit, so the
        # guard is invoked explicitly on the way out instead of being lost.
        _enforce_spawn_guard()
        os._exit(124)


_WATCHDOG = _Watchdog()


class _ProgressResult(unittest.TextTestResult):
    """
    Emits one bounded journal line per test transition, plus per-class timing.

    Only test ids, statuses and millisecond counts are emitted - never output,
    never messages - so the journal is safe to persist without a second
    sanitizer and cannot leak anything the tests printed.
    """

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._started = 0.0
        self._class_started = 0.0
        self._class_name = ''
        self._class_count = 0
        self._counts = {'pass': 0, 'fail': 0, 'error': 0, 'skip': 0}

    def _emit(self, status: str, test_id: str, elapsed_ms: int) -> None:
        # Leading newline on purpose: unittest's verbose writer leaves the
        # stream mid-line ("... "), and a journal line glued to that is not
        # extractable by a line-anchored pattern. The blank line is the price
        # of a journal that can actually be parsed back out of a timeout.
        sys.stderr.write(f'\n{PROGRESS_PREFIX} {status} {elapsed_ms} {test_id}\n')
        sys.stderr.flush()

    def _elapsed_ms(self) -> int:
        return int((time.monotonic() - self._started) * 1000)

    def _roll_class(self, test) -> None:
        name = type(test).__name__
        if name == self._class_name:
            return
        if self._class_name:
            self._emit('class', self._class_name,
                       int((time.monotonic() - self._class_started) * 1000))
        self._class_name = name
        self._class_started = time.monotonic()
        self._class_count += 1

    def startTest(self, test) -> None:
        self._started = time.monotonic()
        self._roll_class(test)
        _WATCHDOG.arm(test.id())
        self._emit('start', test.id(), 0)
        super().startTest(test)

    def stopTest(self, test) -> None:
        _WATCHDOG.disarm()
        super().stopTest(test)

    def addSuccess(self, test) -> None:
        self._counts['pass'] += 1
        self._emit('pass', test.id(), self._elapsed_ms())
        super().addSuccess(test)

    def addFailure(self, test, err) -> None:
        self._counts['fail'] += 1
        self._emit('fail', test.id(), self._elapsed_ms())
        super().addFailure(test, err)

    def addError(self, test, err) -> None:
        self._counts['error'] += 1
        self._emit('error', test.id(), self._elapsed_ms())
        super().addError(test, err)

    def addSkip(self, test, reason) -> None:
        self._counts['skip'] += 1
        self._emit('skip', test.id(), self._elapsed_ms())
        super().addSkip(test, reason)

    def summary_line(self, ran: int, elapsed_ms: int) -> str:
        return (f'{PROGRESS_PREFIX} summary {ran} '
                f"pass={self._counts['pass']} fail={self._counts['fail']} "
                f"error={self._counts['error']} skip={self._counts['skip']} "
                f'classes={self._class_count} {elapsed_ms}')


class _ProgressRunner(unittest.TextTestRunner):
    def __init__(self, *args, **kwargs) -> None:
        kwargs['resultclass'] = _ProgressResult
        super().__init__(*args, **kwargs)


class TestIdentityOnTimeoutTests(unittest.TestCase):
    """
    REGRESSION A/B/E/F - a timeout used to say nothing about what was running.

    The real Windows run burned the whole 3600 s budget and the report could
    only say "devflow: em andamento": forty beats, no test name, and the child
    alive to the deadline. The suite now journals every test transition and a
    watchdog stops a blocked test long before the outer budget.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-identity-'))

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    @staticmethod
    def _journal_body(hang_after: str) -> str:
        return (
            'import sys, time\n'
            'def emit(status, ms, name):\n'
            '    sys.stderr.write("\\n[devflow-test] " + status + " " + str(ms)'
            ' + " " + name + "\\n")\n'
            '    sys.stderr.flush()\n'
            'emit("start", 0, "__main__.Rapida.teste_um")\n'
            'emit("pass", 11, "__main__.Rapida.teste_um")\n'
            f'emit("start", 0, "{hang_after}")\n'
            'print("NAO-DEVE-VAZAR api_key=abcdef123456")\n'
            'sys.stdout.flush()\n'
            'time.sleep(60)\n'
        )

    def test_a_hung_test_is_named_in_the_timeout_detail(self) -> None:
        hung = '__main__.Lenta.teste_que_nunca_termina'
        code, detail = run_test_command(
            [sys.executable, '-c', self._journal_body(hung)],
            self.base, 2.0, label='devflow')
        self.assertEqual(code, 124, detail)
        self.assertIn(hung, detail)
        self.assertIn('__main__.Rapida.teste_um', detail,
                      'o último teste CONCLUÍDO também é evidência')
        self.assertIn('orçamento', detail)

    def test_the_timeout_tail_never_comes_from_the_exception_payload(self) -> None:
        """
        The salvage must not read `TimeoutExpired.stdout`/`.stderr`.

        POSIX attaches the partial output to the exception; the Windows
        implementation raises it bare. Code that salvages the payload is
        therefore correct on one platform and empty on the other. This wraps
        `Popen` and asserts `communicate` - the call whose timeout semantics
        differ by platform - is never used, so a rewrite cannot quietly
        reintroduce the dependency.
        """
        built = []
        real_subprocess = runner_module.subprocess
        real_popen = real_subprocess.Popen

        class SpyPopen:
            def __init__(self, *args, **kwargs):
                self._inner = real_popen(*args, **kwargs)
                built.append(self)

            def communicate(self, *args, **kwargs):
                raise AssertionError(
                    'o runner voltou a depender de communicate(), cujo '
                    'payload de timeout e vazio no Windows')

            def __getattr__(self, name):
                return getattr(self._inner, name)

        class SubprocessView:
            """Only the runner sees the spy; the real module stays intact."""

            Popen = SpyPopen

            def __getattr__(self, name):
                return getattr(real_subprocess, name)

        # Rebinding the module attribute (not `subprocess.Popen` itself) keeps
        # the patch inside the runner's namespace instead of mutating the
        # shared module for the rest of the suite.
        self.addCleanup(setattr, runner_module, 'subprocess', real_subprocess)
        runner_module.subprocess = SubprocessView()
        hung = '__main__.Lenta.teste_sem_payload'
        code, detail = run_test_command(
            [sys.executable, '-c', self._journal_body(hung)],
            cwd=self.base, timeout_s=2.0, label='sem-payload')
        self.assertEqual(124, code, detail)
        self.assertEqual(1, len(built), 'esperava exatamente um filho')
        self.assertIn(hung, detail,
                      f'a cauda veio de outro lugar: {detail[:200]}')

    def test_a_timeout_detail_never_carries_raw_child_output(self) -> None:
        _code, detail = run_test_command(
            [sys.executable, '-c',
             self._journal_body('__main__.Lenta.teste_que_nunca_termina')],
            self.base, 2.0, label='devflow')
        self.assertNotIn('NAO-DEVE-VAZAR', detail)
        self.assertNotIn('abcdef123456', detail)
        self.assertLessEqual(len(detail), MAX_DETAIL_CHARS)

    def test_a_timeout_report_leaves_the_cause_unknown(self) -> None:
        _code, detail = run_test_command(
            [sys.executable, '-c',
             self._journal_body('__main__.Lenta.x')],
            self.base, 2.0, label='devflow')
        self.assertIn('NÃO diagnosticada', detail)
        for overclaim in ('não é uma trava', 'apenas lento', 'somente lento'):
            self.assertNotIn(overclaim, detail.lower())

    def test_a_timeout_without_any_journal_says_so_instead_of_guessing(self) -> None:
        code, detail = run_test_command(
            [sys.executable, '-c', 'import time; time.sleep(60)'],
            self.base, 2.0, label='devflow')
        self.assertEqual(code, 124, detail)
        self.assertIn('Nenhum evento de journal', detail)

    def test_the_watchdog_stops_a_blocked_test_and_names_it(self) -> None:
        """B: a blocked test is stopped in seconds, not in an hour."""
        hung = '__main__.Lenta.teste_que_trava'
        script = (
            'import sys, time\n'
            f'sys.path.insert(0, {str(TOOLS)!r})\n'
            'import test_lia_dev as T\n'
            'w = T._Watchdog(budget_s=0.3, poll_s=0.05)\n'
            'w.start()\n'
            f'w.arm({hung!r})\n'
            'time.sleep(60)\n'
        )
        started = time.monotonic()
        child = subprocess.run([sys.executable, '-c', script],
                               capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=120)
        elapsed = time.monotonic() - started
        self.assertEqual(child.returncode, 124, child.stderr)
        self.assertLess(elapsed, 60, 'o watchdog tem que agir muito antes do prazo externo')
        self.assertIn(hung, child.stderr or '')
        self.assertIn('timeout', child.stderr or '')

    def test_a_timed_out_child_takes_its_descendants_with_it(self) -> None:
        marker = self.base / 'neto.pid'
        script = (
            'import subprocess, sys, time, pathlib\n'
            'sys.stderr.write("\\n[devflow-test] start 0 __main__.Lenta.com_neto\\n")\n'
            'sys.stderr.flush()\n'
            'child = subprocess.Popen([sys.executable, "-c", '
            '"import time; time.sleep(300)"])\n'
            f'pathlib.Path({str(marker)!r}).write_text(str(child.pid))\n'
            'time.sleep(300)\n'
        )
        code, detail = run_test_command(
            [sys.executable, '-c', script], self.base, 2.0, label='devflow')
        self.assertEqual(code, 124, detail)
        self.assertIn('__main__.Lenta.com_neto', detail)
        grandchild = int(marker.read_text(encoding='utf-8').strip())
        deadline = time.monotonic() + 15
        state = processes.pid_state(grandchild)
        while state == processes.ALIVE and time.monotonic() < deadline:
            time.sleep(0.2)
            state = processes.pid_state(grandchild)
        self.assertEqual(state, processes.DEAD,
                         f'o neto {grandchild} sobreviveu ({state}): {detail}')


class SuiteCoverageTests(unittest.TestCase):
    """REGRESSION C - diagnosing a hang must not quietly drop tests."""

    #: Baseline measured on Linux at the commit that introduced the journal.
    MINIMUM_TEST_CASES = 434

    def test_no_test_case_was_dropped(self) -> None:
        count = unittest.TestLoader().loadTestsFromModule(
            sys.modules[__name__]).countTestCases()
        self.assertGreaterEqual(
            count, self.MINIMUM_TEST_CASES,
            f'a suíte encolheu de {self.MINIMUM_TEST_CASES} para {count}')

    def test_every_windows_only_class_is_still_present(self) -> None:
        for name in ('DevKitHandoffExecutionTests', 'UpgradeBootstrapExecutionTests',
                     'ReparseSafetyTests', 'WindowsSignalContractTests',
                     'Win32DeclarationContractTests', 'TaskkillLoadBearingTests',
                     'PortabilityContractTests'):
            with self.subTest(classe=name):
                self.assertTrue(hasattr(sys.modules[__name__], name))
                self.assertGreater(
                    unittest.TestLoader().loadTestsFromName(
                        f'{__name__}.{name}').countTestCases(), 0)

    def test_the_minimal_path_probe_still_covers_its_targets(self) -> None:
        """D: the portability contract stays load-bearing."""
        self.assertGreaterEqual(len(PATH_PROBE_TARGETS), 5)
        for target in PATH_PROBE_TARGETS:
            self.assertTrue(hasattr(sys.modules[__name__], target),
                            f'{target} sumiu - a sonda ficou órfã')

    def test_the_journal_emits_one_line_per_transition_and_a_summary(self) -> None:
        script = (
            'import sys\n'
            f'sys.path.insert(0, {str(TOOLS)!r})\n'
            f'sys.argv = ["test_lia_dev.py", "SchemaTests.test_active_round_validates_and_carries_every_required_fact"]\n'
            'import test_lia_dev\n'
        )
        child = subprocess.run([sys.executable, str(SUITE_PATH),
                                'SchemaTests.test_active_round_validates_and_carries_every_required_fact'],
                               capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=300)
        self.assertEqual(child.returncode, 0, child.stderr)
        lines = [line for line in (child.stderr or '').splitlines()
                 if line.startswith(PROGRESS_PREFIX)]
        statuses = [line.split()[1] for line in lines]
        self.assertIn('start', statuses)
        self.assertIn('pass', statuses)
        self.assertIn('summary', statuses)
        self.assertTrue(all(line.startswith(PROGRESS_PREFIX) for line in lines))


class VitestRootCauseTests(unittest.TestCase):
    """
    REGRESSION G/H/I - eight "(0 test)" headers buried the one exception that
    explained all of them.

    The real Windows report kept eight `❯ file.test.ts (0 test)` lines and
    eight `FAIL file.test.ts` lines while dropping
    `Error: Failed to resolve entry for package "@lia/core"` - the single line
    that turned an unexplained failure into a known missing build artifact.
    """

    FILES = ('lia-host', 'lia-host.voice-activation', 'lia-host.brain',
             'runtime-location', 'voice-engine-service', 'boot-independence',
             'voice-install-inspector', 'voice-provisioning')
    ROOT = ('Error: Failed to resolve entry for package "@lia/core". The package '
            'may have incorrect main/module/exports specified in its package.json.')

    def _headers(self) -> list[str]:
        return [f' \u276f src/main/{name}.test.ts (0 test)' for name in self.FILES]

    def _fails(self) -> list[str]:
        return [f' FAIL  src/main/{name}.test.ts [ src/main/{name}.test.ts ]'
                for name in self.FILES]

    def _fixture(self, extra: list[str] | None = None) -> str:
        return '\n'.join([*self._headers(), *self._fails(),
                           self.ROOT, ' \u276f src/main/lia-host.ts:16:1',
                           *(extra or []),
                           ' Test Files  8 failed | 14 passed (22)',
                           '      Tests  141 passed | 2 skipped (143)'])

    def test_the_root_exception_outranks_every_file_header(self) -> None:
        detail = sanitize_test_output(self._fixture(), '')
        self.assertIn('Error:', detail)
        self.assertIn('@lia/core', detail, 'o especificador ausente é a causa')
        self.assertIn('lia-host.ts', detail, 'a origem tem que aparecer')
        self.assertTrue(detail.splitlines()[0].startswith('Error:'),
                        f'a causa raiz deve liderar, veio {detail.splitlines()[0]!r}')

    def test_the_affected_suites_are_summarised_not_repeated(self) -> None:
        detail = sanitize_test_output(self._fixture(), '')
        self.assertIn('[resumo]', detail)
        self.assertIn('8 linhas', detail)
        self.assertLessEqual(len(detail.splitlines()), MAX_DETAIL_LINES)
        self.assertLessEqual(len(detail), MAX_DETAIL_CHARS)

    def test_the_root_exception_survives_from_either_stream(self) -> None:
        cases = [
            ('stdout', self._fixture(), ''),
            ('stderr', '', self._fixture()),
            ('misturado', '\n'.join(self._headers()),
             '\n'.join([*self._fails(), self.ROOT])),
        ]
        for label, out, err in cases:
            with self.subTest(fluxo=label):
                detail = sanitize_test_output(out, err)
                self.assertIn('@lia/core', detail)

    def test_ansi_noise_and_long_stacks_do_not_hide_the_cause(self) -> None:
        noisy = [
            '\x1b[31m' + self.ROOT + '\x1b[0m',
            'Could not resolve Windows LocalAppData for the Lia runtime.',
        ] + [f'    at fn{i} (/x/y.ts:{i}:1)' for i in range(40)]
        detail = sanitize_test_output('\n'.join([*self._headers(), *noisy]), '')
        self.assertIn('@lia/core', detail)
        self.assertNotIn('\x1b', detail)

    def test_the_cause_survives_more_than_twenty_repeated_headers(self) -> None:
        many = [f' \u276f src/main/gen{i}.test.ts (0 test)' for i in range(24)]
        detail = sanitize_test_output('\n'.join([*many, self.ROOT]), '')
        self.assertIn('@lia/core', detail)
        self.assertLessEqual(len(detail.splitlines()), MAX_DETAIL_LINES)

    def test_a_synthetic_credential_is_never_preserved_by_the_rescue(self) -> None:
        leaked = f'Error: auth failed api_key={FAKE_SECRET}'
        detail = sanitize_test_output('\n'.join([*self._headers(), leaked]), '')
        self.assertIn('Error:', detail, 'o tipo do erro continua útil')
        self.assertNotIn(FAKE_SECRET, detail)

    def test_python_unittest_failures_are_never_collapsed(self) -> None:
        """Distinct failing TESTS are evidence; only repeated FILE lines fold."""
        lines = ['FAIL: test_um (mod.Classe)', 'FAIL: test_dois (mod.Classe)',
                 'FAIL: test_tres (mod.Classe)', 'Ran 3 tests in 0.1s', 'FAILED (failures=3)']
        detail = sanitize_test_output('', '\n'.join(lines))
        for name in ('test_um', 'test_dois', 'test_tres'):
            self.assertIn(name, detail, f'{name} não pode ser colapsado')


class PersistedRootCauseConsistencyTests(unittest.TestCase):
    """
    REGRESSION I - the console, REPORT.txt and run.json must tell the same
    story. A root cause that reaches the console but not the persisted
    artifacts is exactly how the owner's ZIP ended up without the exception.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-rootcause-'))
        self.repo = make_repo(self.base)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_report_and_run_json_carry_the_same_sanitized_root_cause(self) -> None:
        root = ('Error: Failed to resolve entry for package "@lia/core".')
        body = (
            'import sys\n'
            + ''.join(f'print(" \u276f src/main/f{i}.test.ts (0 test)")\n'
                      for i in range(8))
            + f'print({root!r})\n'
            'print(" \u276f src/main/lia-host.ts:16:1")\n'
            'sys.exit(1)\n'
        )
        data = runnable_manifest()
        data['tests'] = [{'id': 'lia-app', 'label': 'app', 'cwd': '.',
                          'argv': ['python', '-c', body], 'timeout_s': 60.0}]
        runner, emitted, _asks = make_runner(
            self.repo, validate_round(data), invoke_test=run_test_command)
        outcome = runner.execute()

        result = next(t for t in outcome.tests if t.id == 'lia-app')
        self.assertEqual(result.status, 'fail')
        # Guard against a false green: 127 means the interpreter never spawned,
        # which would satisfy "status == fail" while proving nothing about the
        # sanitizer being exercised at all.
        self.assertEqual(result.exit_code, 1,
                         f'o filho precisa ter rodado de verdade: {result.detail!r}')
        report = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        run_json = Path(outcome.artifacts['json']).read_text(encoding='utf-8')
        payload = json.loads(run_json)

        for name, content in (('TestResult.detail', result.detail),
                              ('REPORT.txt', report), ('run.json', run_json)):
            with self.subTest(destino=name):
                self.assertIn('@lia/core', content)
                self.assertIn('Error:', content)
        self.assertEqual(payload['tests'][0]['detail'], result.detail,
                         'run.json e TestResult.detail devem ser o mesmo texto')
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertTrue(any('lia-app' in line for line in emitted))


class AutoPathStaysChoicelessOnFailureTests(unittest.TestCase):
    """
    REGRESSION J - the owner's next double-click lands on a FAILING round, so
    the zero-choice contract has to hold on the failure path too, not only on
    the happy one that the existing tests cover.
    """

    def test_a_failing_required_test_never_produces_a_question(self) -> None:
        base = Path(tempfile.mkdtemp(prefix='devflow-choiceless-'))
        self.addCleanup(shutil.rmtree, base, True)
        repo = make_repo(base)
        data = runnable_manifest()
        data['tests'] = [{'id': 'quebra', 'label': 'quebra', 'cwd': '.',
                          'argv': ['python', '-c',
                                   'import sys; print("Error: nao resolvido"); sys.exit(1)'],
                          'timeout_s': 60.0}]

        def boom(*_a, **_k):
            raise AssertionError('AUTO pediu entrada num caminho de falha')

        runner, emitted, asks = make_runner(
            repo, validate_round(data), invoke_test=run_test_command)
        with patch('builtins.input', boom):
            outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual(asks, [], 'nenhuma pergunta pode ser feita')
        self.assertTrue(any('FALHOU' in line for line in emitted))


class WorkspacePreflightTests(unittest.TestCase):
    """
    The next Windows run must find a known failure in milliseconds, not after
    an hour of Python followed by eight "(0 test)" suites.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-preflight-'))

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _write(self, rel: str) -> None:
        target = self.base.joinpath(*rel.split('/'))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('x', encoding='utf-8')

    def test_every_required_artifact_present_passes(self) -> None:
        for req in preflight.REQUIREMENTS:
            self._write(req.rel_path if req.kind == 'file'
                        else f'{req.rel_path}/sentinela')
        findings = preflight.check_workspace(str(self.base))
        self.assertTrue(all(f.present for f in findings))
        self.assertEqual(preflight.main([str(self.base)]), 0)

    def test_the_missing_lia_core_artifact_fails_closed_and_names_its_producer(self) -> None:
        for req in preflight.REQUIREMENTS:
            if req.id == 'lia-core-dist':
                continue
            self._write(req.rel_path if req.kind == 'file'
                        else f'{req.rel_path}/sentinela')
        findings = preflight.check_workspace(str(self.base))
        missing = [f for f in findings if not f.present]
        self.assertEqual([f.requirement.id for f in missing], ['lia-core-dist'])
        text = preflight.render_findings(findings)
        # The report has to say WHAT is missing and WHAT produces it, or the
        # operator is back to guessing from eight collection errors.
        self.assertIn('lia-core-dist', text)
        self.assertIn('@lia/core run build', text)
        self.assertIn('lia-host.ts', text)
        self.assertEqual(preflight.main([str(self.base)]), 1,
                         'um pré-voo com artefato ausente não pode passar')

    def test_the_preflight_is_declared_and_blocking_in_the_active_round(self) -> None:
        tests = load_active_round().tests
        by_id = {t.id: t for t in tests}
        self.assertIn('preflight', by_id)
        gate = by_id['preflight']
        self.assertTrue(gate.blocking,
                        'sem blocking o pré-voo não economiza o orçamento seguinte')
        self.assertLessEqual(gate.timeout_s, 120.0)
        self.assertIn('preflight.py', ' '.join(gate.argv))
        # The managed prerequisite runs first and builds what the preflight then
        # verifies, so the read-only gate can no longer be the first entry.
        self.assertEqual(tests[0].id, 'lia-core-prereq')
        self.assertLess(tests.index(gate), len(tests) - 1,
                        'o pré-voo tem que vir antes das suítes caras')
        for expensive in ('devflow', 'lia-app', 'stage-m30a', 'stage-devflow'):
            self.assertLess(tests.index(gate),
                            next(i for i, t in enumerate(tests) if t.id == expensive))

    def test_the_preflight_module_only_reads_the_workspace(self) -> None:
        tree = ast.parse((TOOLS / 'devflow' / 'preflight.py').read_text(encoding='utf-8'))
        banned = {'rmtree', 'unlink', 'remove', 'rmdir', 'makedirs', 'mkdir',
                  'run', 'Popen', 'call', 'check_output', 'check_call', 'system'}
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func = node.func
                name = func.id if isinstance(func, ast.Name) else getattr(func, 'attr', '')
                self.assertNotIn(name, banned,
                                 f'{name}() num pré-voo que deveria ser somente leitura')


class BlockingTestStopsTheRoundTests(unittest.TestCase):
    """A cheap diagnostic that failed must stop the expensive run behind it."""

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-blocking-'))
        self.repo = make_repo(self.base)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _manifest(self, blocking: bool) -> dict:
        data = runnable_manifest()
        data['tests'] = [
            {'id': 'preflight', 'label': 'p', 'cwd': '.', 'blocking': blocking,
             'argv': ['python', '-c',
                      'print("[preflight] AUSENTE lia-core-dist"); raise SystemExit(1)'],
             'timeout_s': 60.0},
            {'id': 'caro', 'label': 'c', 'cwd': '.', 'timeout_s': 60.0,
             'argv': ['python', '-c', 'print("NAO-DEVERIA-RODAR")']},
        ]
        return data

    def test_a_blocking_failure_prevents_the_expensive_suite(self) -> None:
        runner, emitted, _asks = make_runner(
            self.repo, validate_round(self._manifest(True)),
            invoke_test=run_test_command)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual([t.id for t in outcome.tests], ['preflight'],
                         'o teste caro não pode ter rodado depois de um blocking')
        self.assertTrue(any('BLOCKING' in line for line in emitted))
        self.assertTrue(any('caro' in line for line in emitted),
                        'a rodada deve dizer o que deixou de rodar')

    def test_a_non_blocking_failure_still_runs_everything(self) -> None:
        runner, _emitted, _asks = make_runner(
            self.repo, validate_round(self._manifest(False)),
            invoke_test=run_test_command)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual([t.id for t in outcome.tests], ['preflight', 'caro'],
                         'sem blocking o diagnóstico completo é mantido')

    def test_a_blocking_pass_continues_normally(self) -> None:
        data = self._manifest(True)
        data['tests'][0]['argv'] = ['python', '-c', 'print("[preflight] OK: tudo presente")']
        data['tests'][1]['argv'] = ['python', '-c', 'print("ok")']
        runner, _emitted, _asks = make_runner(
            self.repo, validate_round(data), invoke_test=run_test_command)
        outcome = runner.execute()
        self.assertEqual([t.id for t in outcome.tests], ['preflight', 'caro'])
        self.assertNotEqual(outcome.verdict, 'FAIL')

    def test_a_non_boolean_blocking_value_is_rejected(self) -> None:
        data = self._manifest(True)
        data['tests'][0]['blocking'] = 'sim'
        with self.assertRaises(Exception) as ctx:
            validate_round(data)
        self.assertIn('blocking', str(ctx.exception))


class LiaCorePrereqTests(unittest.TestCase):
    """
    The one generated artifact the round needs is now built by the round.

    `@lia/core` exports only `./dist/index.mjs`, which is gitignored and built
    solely by the airi postinstall. When it was missing, a real Windows run
    produced eight suites failing collection with "(0 test)" and no retained
    exception. Failing closed on that was correct but still left the owner
    running a command by hand, which contradicts the zero-choice contract.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-prereq-'))
        self.emitted: list[str] = []
        self.calls: list[tuple] = []

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _write(self, rel: str) -> None:
        target = self.base.joinpath(*rel.split('/'))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('x', encoding='utf-8')

    def _base_deps(self) -> None:
        for rid in lia_core_prereq.BASE_REQUIREMENT_IDS:
            rel = next(r.rel_path for r in preflight.REQUIREMENTS if r.id == rid)
            kind = next(r.kind for r in preflight.REQUIREMENTS if r.id == rid)
            self._write(rel if kind == 'file' else f'{rel}/sentinela')

    def _dist(self) -> str:
        return next(r.rel_path for r in preflight.REQUIREMENTS
                    if r.id == lia_core_prereq.MANAGED_REQUIREMENT_ID)

    def _fake_build(self, *, code: int = 0, writes_artifact: bool = True,
                    output: str = 'tsdown v0.0.0\nbuilt in 900ms'):
        def run(argv, popen_kwargs, cwd, timeout_s):
            self.calls.append((tuple(argv), dict(popen_kwargs), Path(cwd), timeout_s))
            if writes_artifact:
                self._write(self._dist())
            return code, output
        return run

    def test_a_missing_dist_invokes_the_build_and_the_round_proceeds(self) -> None:
        self._base_deps()
        outcome = lia_core_prereq.ensure_lia_core(
            self.base, emit=self.emitted.append, run_build=self._fake_build())
        self.assertTrue(outcome.ok, outcome.detail)
        self.assertEqual(outcome.action, 'built')
        self.assertEqual(outcome.exit_code, 0)
        self.assertEqual(len(self.calls), 1, 'o build deve rodar exatamente uma vez')
        argv, _kwargs, cwd, timeout_s = self.calls[0]
        self.assertIn('-F', argv)
        self.assertIn('@lia/core', argv)
        self.assertIn('build', argv)
        self.assertEqual(cwd, self.base / 'airi', 'o build roda no workspace airi')
        self.assertLessEqual(timeout_s, lia_core_prereq.BUILD_TIMEOUT_S)
        self.assertTrue((self.base / self._dist()).is_file(),
                        'o artefato tem que existir depois')
        text = '\n'.join(self.emitted)
        self.assertIn('state=starting', text)
        self.assertIn('state=succeeded', text)
        self.assertIn('verificado', text, 'a verificação pós-build deve ser dita')

    def test_a_present_dist_is_not_rebuilt(self) -> None:
        self._base_deps()
        self._write(self._dist())
        outcome = lia_core_prereq.ensure_lia_core(
            self.base, emit=self.emitted.append, run_build=self._fake_build())
        self.assertTrue(outcome.ok)
        self.assertEqual(outcome.action, 'present')
        self.assertEqual(self.calls, [], 'reconstruir sem necessidade custa tempo e esconde regressão')
        self.assertIn('state=skipped', '\n'.join(self.emitted))

    def test_c_missing_base_dependencies_fail_fast_and_stop_the_round(self) -> None:
        outcome = lia_core_prereq.ensure_lia_core(
            self.base, emit=self.emitted.append, run_build=self._fake_build())
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.action, 'base-missing')
        self.assertNotEqual(outcome.exit_code, 0)
        self.assertEqual(self.calls, [], 'sem dependências base nada deve ser construído')
        text = '\n'.join(self.emitted)
        self.assertIn('pnpm install', text, 'o diagnóstico deve nomear o comando')

    def test_c_a_base_failure_is_blocking_so_the_long_suite_never_starts(self) -> None:
        repo = make_repo(self.base / 'repo')
        data = runnable_manifest()
        data['tests'] = [
            {'id': 'lia-core-prereq', 'label': 'p', 'cwd': '.', 'blocking': True,
             'argv': ['python', str(TOOLS / 'devflow' / 'lia_core_prereq.py'),
                      str(self.base)],
             'timeout_s': 60.0},
            {'id': 'caro', 'label': 'c', 'cwd': '.',
             'argv': ['python', '-c', 'print("NAO-DEVERIA-RODAR")'], 'timeout_s': 60.0},
        ]
        runner, emitted, _asks = make_runner(
            repo, validate_round(data), invoke_test=run_test_command)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual([t.id for t in outcome.tests], ['lia-core-prereq'],
                         'a suíte de 3600s não pode rodar depois de um pré-requisito falho')

    def test_d_a_failed_build_fails_closed(self) -> None:
        self._base_deps()
        outcome = lia_core_prereq.ensure_lia_core(
            self.base, emit=self.emitted.append,
            run_build=self._fake_build(code=1, writes_artifact=False))
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.action, 'build-failed')
        self.assertIn('state=failed', '\n'.join(self.emitted))
        self.assertIn('reason=build-failed', '\n'.join(self.emitted))

    def test_e_a_zero_exit_without_the_artifact_still_fails_closed(self) -> None:
        """Exit status alone is not proof: this is the eight-suite failure again."""
        self._base_deps()
        outcome = lia_core_prereq.ensure_lia_core(
            self.base, emit=self.emitted.append,
            run_build=self._fake_build(code=0, writes_artifact=False))
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.action, 'artifact-missing')
        self.assertIn('AUSENTE após o build', outcome.detail)

    def test_f_a_build_timeout_is_bounded_and_nonzero(self) -> None:
        self._base_deps()

        def hang(argv, popen_kwargs, cwd, timeout_s):
            self.calls.append((tuple(argv), dict(popen_kwargs), Path(cwd), timeout_s))
            raise subprocess.TimeoutExpired(cmd=list(argv), timeout=timeout_s)

        outcome = lia_core_prereq.ensure_lia_core(
            self.base, emit=self.emitted.append, run_build=hang, timeout_s=1.0)
        self.assertFalse(outcome.ok)
        self.assertEqual(outcome.action, 'build-timeout')
        self.assertEqual(outcome.exit_code, 124)
        self.assertEqual(self.calls[0][3], 1.0, 'o orçamento declarado tem que ser honrado')
        self.assertIn('NÃO diagnosticada', outcome.detail)

    def test_g_no_tracked_product_source_is_touched(self) -> None:
        self._base_deps()
        before = sorted(str(p.relative_to(self.base)) for p in self.base.rglob('*')
                        if p.is_file())
        lia_core_prereq.ensure_lia_core(
            self.base, emit=self.emitted.append, run_build=self._fake_build())
        after = sorted(str(p.relative_to(self.base)) for p in self.base.rglob('*')
                       if p.is_file())
        added = set(after) - set(before)
        self.assertEqual(added, {self._dist().replace('/', os.sep)},
                         f'só o artefato gerado pode aparecer, surgiu: {added}')

    def test_the_build_never_mentions_core_agent(self) -> None:
        argv, _kwargs = lia_core_prereq.build_argv(['/usr/bin/pnpm'])
        joined = ' '.join(argv)
        self.assertNotIn('core-agent', joined,
                         'este pré-requisito não pode tocar core-agent/dist')
        self.assertIn('@lia/core', joined)

    def test_the_round_still_clears_core_agent_dist_at_prelaunch(self) -> None:
        steps = load_active_round().prelaunch_prepare
        self.assertTrue(any('core-agent' in step.path for step in steps),
                        'a limpeza de core-agent/dist no prelaunch foi perdida')

    def test_no_shell_is_used_and_the_platform_seam_is_applied(self) -> None:
        argv, kwargs = lia_core_prereq.build_argv(['/usr/bin/pnpm'])
        self.assertEqual(kwargs, {}, 'nenhum kwarg de shell pode aparecer')
        self.assertEqual(argv[0], '/usr/bin/pnpm')
        tree = ast.parse((TOOLS / 'devflow' / 'lia_core_prereq.py')
                         .read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            if isinstance(node, ast.keyword) and node.arg == 'shell':
                self.fail('shell= em lia_core_prereq.py')

    def test_build_output_is_sanitized_before_it_is_persisted(self) -> None:
        self._base_deps()
        outcome = lia_core_prereq.ensure_lia_core(
            self.base, emit=lambda _l: None,
            run_build=self._fake_build(
                code=1, writes_artifact=False,
                output=f'npm ERR! token={FAKE_SECRET} api_key={FAKE_SECRET}'))
        self.assertFalse(outcome.ok)
        self.assertNotIn(FAKE_SECRET, outcome.detail)
        self.assertLessEqual(len(outcome.detail), MAX_DETAIL_CHARS)

    def test_the_declared_prerequisite_is_first_blocking_and_bounded(self) -> None:
        first = load_active_round().tests[0]
        self.assertEqual(first.id, 'lia-core-prereq')
        self.assertTrue(first.blocking)
        self.assertLessEqual(first.timeout_s, 300.0)
        self.assertIn('lia_core_prereq.py', ' '.join(first.argv))


class TailSalvageTests(unittest.TestCase):
    """
    The salvage kept the HEAD of each captured snapshot while its comment
    claimed the most recent window. After enough output the identity of the
    stuck test sits past the byte cap and was silently dropped.
    """

    @staticmethod
    def _blob(lines: int) -> bytes:
        body = [f'[devflow-test] pass {i} __main__.Enorme.teste_{i:05d}'
                for i in range(lines)]
        body.append('[devflow-test] pass 9 __main__.Enorme.ultimo_concluido')
        body.append('[devflow-test] start 0 __main__.Enorme.teste_QUE_TRAVA')
        return '\n'.join(body).encode()

    def test_the_identity_survives_more_than_a_hundred_kilobytes(self) -> None:
        blob = self._blob(2600)
        self.assertGreater(len(blob), 100 * 1024,
                           f'o fixture precisa passar de 100 KB, tem {len(blob)}')
        found = salvage_progress(blob)
        self.assertTrue(any('teste_QUE_TRAVA' in line for line in found),
                        'o teste em execução é a linha que o relatório existe para guardar')
        self.assertTrue(any('ultimo_concluido' in line for line in found),
                        'o último teste concluído também é evidência')
        self.assertEqual(found[-1].split()[-1], '__main__.Enorme.teste_QUE_TRAVA')

    def test_a_head_slice_would_have_lost_it(self) -> None:
        """Proves the regression above is load-bearing, not decorative."""
        blob = self._blob(2600)
        head = blob[:PROGRESS_PARTIAL_MAX_BYTES].decode('utf-8', 'replace')
        self.assertFalse(any('QUE_TRAVA' in line
                             for line in PROGRESS_LINE_RE.findall(head)))

    def test_a_truncated_leading_fragment_is_never_reported(self) -> None:
        blob = self._blob(2600)
        for line in salvage_progress(blob):
            self.assertTrue(line.startswith('[devflow-test] '),
                            f'fragmento de linha vazou: {line!r}')
            self.assertEqual(len(line.split()), 4, f'linha corrompida: {line!r}')

    def test_text_chunks_are_handled_as_well_as_bytes(self) -> None:
        blob = self._blob(2600).decode()
        found = salvage_progress(blob)
        self.assertTrue(any('teste_QUE_TRAVA' in line for line in found))

    def test_a_fragment_at_the_cut_is_not_promoted_to_an_identity(self) -> None:
        """
        The byte cap can land so that the window opens exactly on a
        journal-shaped string that is NOT at a line start - printed by a test
        with no preceding newline, for instance. `(?m)^` also matches at the
        start of the window, so without dropping the leading fragment that
        string would be reported as a real test identity.
        """
        marker = b'[devflow-test] pass 7 __main__.Falso.nao_existe\n'
        cap = PROGRESS_PARTIAL_MAX_BYTES
        prefix = b'x' * (cap + 10)                       # junk, sem newline
        suffix = b'y' * (cap - len(marker))
        raw = prefix + marker + suffix
        # len(raw) == 2*cap + 10, so raw[-cap:] opens exactly on the marker.
        self.assertEqual(len(raw), 2 * cap + 10)
        found = salvage_progress(raw)
        self.assertFalse(any('nao_existe' in line for line in found),
                         f'fragmento promovido a identidade: {found!r}')

    def test_a_synthetic_secret_cannot_ride_along(self) -> None:
        lines = [f'[devflow-test] pass {i} __main__.C.teste_{i}' for i in range(2600)]
        lines.append(f'[devflow-test] start 0 api_key={FAKE_SECRET}')
        lines.append('[devflow-test] start 0 __main__.C.travado')
        blob = ('\n'.join(lines) + f'\ntoken={FAKE_SECRET}\n').encode()
        for line in salvage_progress(blob):
            self.assertNotIn(FAKE_SECRET, line)


class JournalDoesNotCrowdOutRealFailuresTests(unittest.TestCase):
    """
    Journal lines were briefly identity-tier, and that was a regression.

    On an ordinary failing run - exit 1, no timeout involved - promoting every
    journal line to identity filled the bounded detail with `pass 0..12` noise
    and pushed out the FAIL line and the Ran/FAILED summary, so the report
    named no failing test at all. The timeout paths build their own body, so
    they never needed the tier; these tests pin the revert in place.
    """

    def test_an_ordinary_failure_keeps_its_identity_and_summary(self) -> None:
        lines = [f'[devflow-test] pass {i} __main__.C{i % 40}.teste_{i:03d}'
                 for i in range(300)]
        lines += ['[devflow-test] fail 5 __main__.Importante.teste_que_falhou',
                  'FAIL: teste_que_falhou (__main__.Importante)',
                  'AssertionError: 3 != 4 : o cálculo está errado',
                  'Ran 301 tests in 90.0s', 'FAILED (failures=1)']
        detail = sanitize_test_output('', '\n'.join(lines))
        self.assertIn('AssertionError', detail)
        self.assertIn('FAIL: teste_que_falhou', detail,
                      'o teste que falhou não pode ser expulso pelo journal')
        self.assertIn('Ran 301 tests', detail, 'o resumo também é evidência')
        self.assertIn('FAILED (failures=1)', detail)

    def test_a_timeout_verdict_still_survives_a_full_journal(self) -> None:
        """The one tier addition that IS load-bearing, proven rather than assumed."""
        base = Path(tempfile.mkdtemp(prefix='devflow-verdict-'))
        self.addCleanup(shutil.rmtree, base, True)
        noise = ''.join(
            f'sys.stderr.write("\\n[devflow-test] pass {i} __main__.C.teste_{i:02d}\\n")\n'
            for i in range(20))
        script = 'import sys, time\n' + noise + 'sys.stderr.flush()\ntime.sleep(60)\n'
        code, detail = run_test_command(
            [sys.executable, '-c', script], base, 2.0, label='devflow')
        self.assertEqual(code, 124, detail)
        self.assertTrue(detail.splitlines()[0].startswith('TimeoutExpired'),
                        f'o veredito tem que liderar: {detail.splitlines()[0]!r}')
        self.assertIn('orçamento', detail)


class WatchdogReportEndToEndTests(unittest.TestCase):
    """
    When the suite stops itself, `communicate` returns NORMALLY - there is no
    TimeoutExpired - so the watchdog verdict used to go through the generic
    sanitizer, which filled its budget with the OLDEST lines of a long run and
    dropped the one line naming the stuck test.
    """

    def setUp(self) -> None:
        self.base = Path(tempfile.mkdtemp(prefix='devflow-watchdog-'))
        self.repo = make_repo(self.base)

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def _hang_script(self, prior: int) -> str:
        noise = ''.join(
            f'sys.stderr.write("\\n[devflow-test] pass {i} __main__.C{i % 40}.teste_{i:03d}\\n")\n'
            for i in range(prior))
        return (
            'import sys, time\n'
            + noise +
            'sys.stderr.flush()\n'
            f'sys.path.insert(0, {str(TOOLS)!r})\n'
            'import test_lia_dev as T\n'
            'w = T._Watchdog(budget_s=0.4, poll_s=0.05)\n'
            'w.start()\n'
            'w.arm("__main__.Lenta.teste_real_que_trava")\n'
            'time.sleep(60)\n'
        )

    def test_the_persisted_report_names_the_blocked_test(self) -> None:
        data = runnable_manifest()
        data['tests'] = [{'id': 'devflow', 'label': 'd', 'cwd': '.',
                          'argv': ['python', '-c', self._hang_script(300)],
                          'timeout_s': 120.0}]
        runner, emitted, asks = make_runner(
            self.repo, validate_round(data), invoke_test=run_test_command)
        outcome = runner.execute()

        result = next(t for t in outcome.tests if t.id == 'devflow')
        self.assertEqual(result.exit_code, 124,
                         f'a saída tem que ser não nula: {result.detail!r}')
        self.assertEqual(result.status, 'fail')
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual(asks, [])

        report = Path(outcome.artifacts['report']).read_text(encoding='utf-8')
        run_json = Path(outcome.artifacts['json']).read_text(encoding='utf-8')
        payload = json.loads(run_json)

        for name, content in (('TestResult.detail', result.detail),
                              ('console', '\n'.join(emitted)),
                              ('REPORT.txt', report), ('run.json', run_json)):
            with self.subTest(destino=name):
                self.assertIn('teste_real_que_trava', content,
                              'a identidade travada tem que chegar a todo destino')
                self.assertIn('NÃO diagnosticada', content)
        self.assertEqual(payload['tests'][0]['detail'], result.detail,
                         'run.json e TestResult.detail devem ser o mesmo texto')
        self.assertLessEqual(len(result.detail), MAX_DETAIL_CHARS)
        self.assertLessEqual(len(result.detail.splitlines()), MAX_DETAIL_LINES)

    def test_no_launcher_is_started_after_the_failure(self) -> None:
        data = runnable_manifest()
        data['tests'] = [{'id': 'devflow', 'label': 'd', 'cwd': '.',
                          'argv': ['python', '-c', self._hang_script(30)],
                          'timeout_s': 120.0}]
        launched: list[list[str]] = []

        def recording_spawn(command, cwd, on_line, env=None):
            launched.append(list(command))
            return fake_spawner([], alive=False)(command, cwd, on_line, env)

        runner = RoundRunner(
            round_manifest=validate_round(data), repo=self.repo,
            run_git=fixed_git('arena/01a10290-lia-project', 'a' * 40, None,
                              porcelain=''),
            spawn=recording_spawn, ask=lambda q, o: 'S',
            clock=lambda: datetime(2026, 10, 11, 12, 0, 0),
            marker_timeout_s=5.0, emit=lambda _l: None,
            invoke_test=run_test_command)
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertEqual(launched, [], 'nenhum Launcher pode subir depois de uma falha')

    def test_a_hang_before_the_first_test_is_named_as_startup(self) -> None:
        script = (
            'import sys, time\n'
            f'sys.path.insert(0, {str(TOOLS)!r})\n'
            'import test_lia_dev as T\n'
            'w = T._Watchdog(budget_s=0.3, poll_s=0.05)\n'
            'w.start()\n'
            # A short budget, not STARTUP_BUDGET_S: the point is to prove the
            # pre-test phase has its own identity, and the real 300 s value
            # would simply be overtaken by the outer budget below.
            'w.arm(T.STARTUP_LABEL, 0.3)\n'
            'time.sleep(60)\n'
        )
        code, detail = run_test_command(
            [sys.executable, '-c', script], self.base, 60.0, label='devflow')
        self.assertEqual(code, 124, detail)
        self.assertIn(STARTUP_LABEL, detail,
                      'um travamento na coleta tem que ter identidade própria')
        self.assertIn('NÃO diagnosticada', detail)

    def test_the_real_suite_arms_the_startup_watchdog_before_collection(self) -> None:
        # Source-level, and deliberately so: the startup phase cannot be forced
        # to hang from outside. Two traps this avoids - the marker is built by
        # concatenation so this test's own source does not contain it (an
        # `index` on the raw text used to find the test itself and pass
        # tautologically), and `rindex` takes the real entry point rather than
        # any earlier mention of it.
        marker = "if __name__ == " + "'__main__':"
        source = SUITE_PATH.read_text(encoding='utf-8')
        main_block = source[source.rindex(marker):]
        arm_call = '_WATCHDOG.arm(' + 'STARTUP_LABEL'
        self.assertIn(arm_call, main_block,
                      'a coleta ficou sem watchdog: um travamento na importação '
                      'esperaria o orçamento externo inteiro em silêncio')
        arm_at = main_block.index(arm_call)
        collect_at = main_block.index('unittest.main(')
        self.assertLess(arm_at, collect_at,
                        'o watchdog de coleta precisa estar armado ANTES de coletar')
        self.assertGreater(STARTUP_BUDGET_S, 0)
        self.assertLess(STARTUP_BUDGET_S, 3600.0,
                        'o orçamento de coleta não pode se aproximar do externo')


if __name__ == '__main__':
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, 'reconfigure'):
            _stream.reconfigure(errors='replace')
    _WATCHDOG.start()
    # Armed BEFORE collection. A hang while importing a module or collecting
    # tests happens before any startTest, so without this the run would sit in
    # silence until the outer budget killed it, reporting nothing at all.
    _WATCHDOG.arm(STARTUP_LABEL, STARTUP_BUDGET_S)
    _begin = time.monotonic()
    # The CLASS, not an instance or a factory: unittest.main only constructs a
    # testRunner when `isinstance(it, type)`, and silently treats anything else
    # as an already-built runner.
    _program = unittest.main(testRunner=_ProgressRunner, verbosity=2, exit=False)
    _result = _program.result
    if _result is not None:
        print('\n' + _result.summary_line(_result.testsRun,
                                          int((time.monotonic() - _begin) * 1000)),
              file=sys.stderr)
        sys.stderr.flush()
    _WATCHDOG.stop()
    _enforce_spawn_guard()
    sys.exit(0 if (_result is not None and _result.wasSuccessful()) else 1)
