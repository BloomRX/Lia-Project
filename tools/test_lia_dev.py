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

import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

from devflow import safe_paths  # noqa: E402
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
    def __init__(self, exit_code: int = 0) -> None:
        self.exit_code = exit_code
        self.terminated = False

    def wait(self, timeout: float) -> int | None:
        return self.exit_code

    def terminate(self) -> None:
        self.terminated = True


def fake_spawner(lines: list[str], exit_code: int = 0):
    """Emits the scripted console up front, then hands back a dead handle."""
    handles: list[FakeHandle] = []

    def spawn(command: list[str], cwd: Path, on_line) -> FakeHandle:
        for line in lines:
            on_line(line)
        handle = FakeHandle(exit_code)
        handles.append(handle)
        return handle

    spawn.handles = handles  # type: ignore[attr-defined]
    return spawn


def fixed_git(branch: str, sha: str, calls: list[list[str]] | None = None):
    def run_git(args: list[str]) -> tuple[int, str]:
        if calls is not None:
            calls.append(list(args))
        if args[:1] == ['rev-parse'] and args[1:2] == ['--abbrev-ref']:
            return 0, branch
        if args[:1] == ['rev-parse']:
            return 0, sha
        if args[:1] == ['status']:
            return 0, ''
        return 0, ''
    return run_git


MARKER_LINES = [
    '[lia] 2026-10-11T00:00:00.000Z lia-app.stage-log stage-prerequisite name=core-agent-build state=starting\n',
    '[lia] 2026-10-11T00:00:09.000Z lia-app.stage-log stage-prerequisite name=core-agent-build state=succeeded reason=build-succeeded\n',
    '[lia] 2026-10-11T00:00:10.000Z lia-app.stage-log spawn: node C:\\repo\\airi\\apps\\stage-tamagotchi\\node_modules\\electron-vite\\bin\\electron-vite.js dev (pid 1234)\n',
    '> ready in 512 ms\n',
]


def make_runner(repo: Path, manifest: Round, *, lines=None, ask=lambda q, o: 'S',
                branch='arena/01a10290-lia-project', sha='a' * 40, git_calls=None,
                run_tests: bool = False):
    emitted: list[str] = []
    runner = RoundRunner(
        round_manifest=manifest,
        repo=repo,
        run_git=fixed_git(branch, sha, git_calls),
        spawn=fake_spawner(list(MARKER_LINES if lines is None else lines)),
        ask=ask,
        clock=lambda: __import__('datetime').datetime(2026, 10, 11, 12, 0, 0),
        marker_timeout_s=5.0,
        emit=emitted.append,
        run_tests=run_tests,
    )
    return runner, emitted


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
        with self.assertRaisesRegex(safe_paths.PathSafetyError, 'link/reparse'):
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
        with self.assertRaisesRegex(safe_paths.PathSafetyError, 'link/reparse'):
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
        self.manifest = validate_round(base_manifest())

    def tearDown(self) -> None:
        shutil.rmtree(self.base, ignore_errors=True)

    def test_full_round_passes_and_writes_artifacts_tied_to_the_sha(self):
        sha = 'c' * 40
        runner, _ = make_runner(self.repo, self.manifest, sha=sha)
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
        runner, emitted = make_runner(self.repo, self.manifest, branch='main')
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'REFUSED')
        self.assertIsNone(outcome.markers)
        # Nothing was cleaned: the generated artifact is still there.
        self.assertTrue((self.repo / CORE_DIST).exists())
        self.assertTrue(any('RECUSADO' in line for line in emitted))

    def test_missing_marker_fails_the_round(self):
        runner, _ = make_runner(self.repo, self.manifest, lines=[MARKER_LINES[0]])
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')
        self.assertFalse(outcome.markers.ok)

    def test_out_of_order_marker_fails_the_round(self):
        runner, _ = make_runner(self.repo, self.manifest,
                                lines=[MARKER_LINES[2], MARKER_LINES[0], MARKER_LINES[1]])
        outcome = runner.execute()
        self.assertEqual(outcome.verdict, 'FAIL')

    def test_visual_pass_is_never_inferred_from_logs(self):
        # Every marker matched, the operator said NO: that is NOT PASS.
        runner, _ = make_runner(self.repo, self.manifest, ask=lambda q, o: 'N')
        outcome = runner.execute()
        self.assertTrue(outcome.markers.ok)
        self.assertEqual(outcome.verdict, 'NOT_PASS')

    def test_unanswered_visual_assertion_is_not_a_pass(self):
        # EOF / empty answer must never be read as agreement.
        runner, _ = make_runner(self.repo, self.manifest, ask=lambda q, o: '')
        self.assertEqual(runner.execute().verdict, 'NOT_PASS')

    def test_unknown_visual_answer_is_not_a_pass(self):
        runner, _ = make_runner(self.repo, self.manifest, ask=lambda q, o: 'talvez')
        self.assertEqual(runner.execute().verdict, 'NOT_PASS')

    def test_interrupted_run_stays_honest(self):
        def boom(question, options):
            raise KeyboardInterrupt

        runner, _ = make_runner(self.repo, self.manifest, ask=boom)
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
        runner, _ = make_runner(self.repo, self.manifest, git_calls=calls)
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
        runner, _ = make_runner(self.repo, self.manifest, lines=lines)
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
        runner, _ = make_runner(self.repo, self.manifest, lines=lines)
        outcome = runner.execute()
        console = Path(outcome.artifacts['console']).read_text(encoding='utf-8')
        self.assertNotIn('meu segredo', console)
        self.assertGreaterEqual(outcome.console_withheld, 1)

    def test_run_json_records_every_section(self):
        runner, _ = make_runner(self.repo, self.manifest)
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


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')
    unittest.main(verbosity=2)
