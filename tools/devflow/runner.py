"""
DevFlow: the round runner.

One command drives a whole development round on Windows:

    prove the branch -> identify HEAD -> safe cleanup -> targeted tests
    -> managed launch -> marker gate -> human visual assertion -> report

Design rules that shaped this file:

  * NO Git mutation. The round only READS Git facts (`rev-parse`,
    `status --porcelain`, `check-ignore`). Publish stays with the universal
    DevKit and is a D2 concern.
  * A log can never produce a visual PASS. The verdict is PASS only when
    every marker matched AND every human assertion was explicitly accepted.
  * An interrupted run stays honest: it is written as INTERRUPTED, never as
    a pass and never as a silent nothing.
  * Every injectable seam (git, spawn, ask, clock) exists so the gate is
    testable without Windows, Electron or a human.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import queue
from pathlib import Path
import subprocess
import sys
import threading
from typing import Callable, Protocol

from . import safe_paths
from .markers import MarkerReport, evaluate_markers
from .report import SanitizedLog, prune_runs, run_dir, sanitize_console, utc_stamp, write_run
from .schema import Round


class RoundAborted(RuntimeError):
    """The round must stop and be recorded as REFUSED - never as a pass."""


class SpawnHandle(Protocol):
    def wait(self, timeout: float) -> int | None: ...
    def terminate(self) -> None: ...


GitRunner = Callable[[list[str]], tuple[int, str]]
Spawner = Callable[[list[str], Path, Callable[[str], None]], SpawnHandle]
Asker = Callable[[str, tuple[str, ...]], str]
Clock = Callable[[], datetime]


@dataclass
class TestResult:
    id: str
    label: str
    status: str  # 'pass' | 'fail' | 'skipped'
    exit_code: int | None = None
    detail: str = ''


@dataclass
class RoundOutcome:
    round_id: str
    verdict: str  # 'PASS' | 'FAIL' | 'NOT_PASS' | 'REFUSED' | 'INTERRUPTED'
    branch: str = ''
    head_sha: str = ''
    dirty: int | None = None
    cleanup: list[str] = field(default_factory=list)
    tests: list[TestResult] = field(default_factory=list)
    markers: MarkerReport | None = None
    optional_seen: list[str] = field(default_factory=list)
    manual: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    artifacts: dict[str, str] = field(default_factory=dict)
    console_withheld: int = 0

    @property
    def is_pass(self) -> bool:
        return self.verdict == 'PASS'


def default_git(args: list[str], cwd: Path) -> tuple[int, str]:
    try:
        probe = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return 128, str(exc)
    return probe.returncode, (probe.stdout or probe.stderr or '').strip()


def git_facts(repo: Path, run_git: GitRunner) -> tuple[str, str, int]:
    _, branch = run_git(['rev-parse', '--abbrev-ref', 'HEAD'])
    _, head = run_git(['rev-parse', 'HEAD'])
    code, porcelain = run_git(['status', '--porcelain'])
    dirty = 0 if code != 0 else len([line for line in porcelain.splitlines() if line.strip()])
    return branch.strip(), head.strip(), dirty


class _ThreadedSpawn:
    """Reads the child's stdout on a thread and replays it line by line."""

    def __init__(self, process: subprocess.Popen) -> None:
        self._process = process

    def wait(self, timeout: float) -> int | None:
        try:
            return self._process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return None

    def terminate(self) -> None:
        if self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self._process.kill()


def default_spawner(command: list[str], cwd: Path, on_line: Callable[[str], None]) -> SpawnHandle:
    """
    Runs the managed launcher with its console captured. No `shell=True`:
    the argv list is passed straight through, so nothing is interpolated.
    """
    process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
        bufsize=1,
    )

    def pump() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            on_line(line)

    threading.Thread(target=pump, daemon=True).start()
    return _ThreadedSpawn(process)


def console_asker(question: str, options: tuple[str, ...]) -> str:
    prompt = f'{question} [{"|".join(options)}] '
    try:
        return input(prompt).strip()
    except EOFError:
        return ''


@dataclass
class RoundRunner:
    round_manifest: Round
    repo: Path
    run_git: GitRunner = field(default=None)  # type: ignore[assignment]
    spawn: Spawner = field(default=None)  # type: ignore[assignment]
    ask: Asker = field(default=console_asker)
    clock: Clock = field(default=lambda: datetime.now(timezone.utc))
    marker_timeout_s: float = 600.0
    emit: Callable[[str], None] = field(default=print)
    run_tests: bool = True
    _console: SanitizedLog | None = None

    def __post_init__(self) -> None:
        if self.run_git is None:
            self.run_git = lambda args: default_git(args, self.repo)
        if self.spawn is None:
            self.spawn = default_spawner

    # -- public ---------------------------------------------------------
    def execute(self) -> RoundOutcome:
        moment = self.clock()
        stamp = utc_stamp(moment)
        directory = run_dir(self.repo, stamp, self.round_manifest.id)
        captured: list[str] = []

        def note(line: str) -> None:
            captured.append(line)
            self.emit(line)

        outcome = RoundOutcome(round_id=self.round_manifest.id, verdict='REFUSED')
        try:
            self._execute(outcome, note)
        except RoundAborted as exc:
            outcome.verdict = 'REFUSED'
            outcome.notes.append(f'rodada recusada: {exc}')
        except KeyboardInterrupt:
            outcome.verdict = 'INTERRUPTED'
            outcome.notes.append(
                'interrompido pelo operador (Ctrl+C); nada foi inferido como sucesso',
            )
        finally:
            self._persist(outcome, captured, directory)
            try:
                prune_runs(
                    self.repo,
                    keep=self.round_manifest.retention.keep_runs,
                    max_age_days=self.round_manifest.retention.max_age_days,
                )
            except (OSError, RuntimeError):
                outcome.notes.append('retenção não executada nesta rodada')
        return outcome

    # -- internals ------------------------------------------------------
    def _execute(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        manifest = self.round_manifest
        note(f'== DevFlow rodada {manifest.id}: {manifest.title} ==')

        branch, head, dirty = git_facts(self.repo, self.run_git)
        outcome.branch, outcome.head_sha, outcome.dirty = branch, head, dirty
        note(f'branch={branch} head={head[:12]} alteracoes_nao_commitadas={dirty}')

        if branch != manifest.expected_branch:
            outcome.verdict = 'REFUSED'
            outcome.notes.append(
                f'branch {branch!r} diferente da esperada {manifest.expected_branch!r}; nada foi executado',
            )
            note('RECUSADO: branch inesperada. Nenhuma limpeza, teste ou lançamento foi feito.')
            return

        self._prepare(outcome, note)
        if self.run_tests:
            self._run_tests(outcome, note)

        self._launch_and_gate(outcome, note)
        self._decide(outcome, note)

    def _prepare(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        manifest = self.round_manifest
        allowlist = list(manifest.cleanup.allowlisted_generated)
        if not manifest.prepare:
            note('preparo: nenhum passo declarado')
            return
        for step in manifest.prepare:
            note(f'preparo: {step.kind} {step.path} - {step.why}')
            try:
                plan = safe_paths.plan_removal(self.repo, step.path, allowlist)
            except safe_paths.PathSafetyError as exc:
                outcome.notes.append(f'limpeza recusada para {step.path}: {exc}')
                note(f'  RECUSADO: {exc}')
                raise RoundAborted(str(exc)) from exc
            for line in plan.describe():
                note(f'  {line}')
            report = safe_paths.execute_removal(plan)
            outcome.cleanup.extend(report.lines)

    def _run_tests(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        for spec in self.round_manifest.tests:
            cwd = self.repo / spec.cwd
            argv = list(spec.argv)
            # `python` is a token, not a PATH lookup: `py -3`/`python` differ
            # per machine, so we always run OUR OWN interpreter.
            if argv[0] == 'python':
                argv[0] = sys.executable
            # A `node <script>` test is skipped (never passed) when the script
            # is absent - i.e. `pnpm install` has not run on this checkout.
            if argv[0] == 'node' and not (cwd / argv[1]).exists():
                outcome.tests.append(TestResult(
                    id=spec.id, label=spec.label, status='skipped',
                    detail='dependências não instaladas neste checkout',
                ))
                note(f'teste {spec.id}: PULADO (ambiente indisponível) - não conta como sucesso')
                continue
            if not cwd.is_dir():
                outcome.tests.append(TestResult(
                    id=spec.id, label=spec.label, status='skipped',
                    detail='diretório ausente',
                ))
                note(f'teste {spec.id}: PULADO (diretório ausente) - não conta como sucesso')
                continue
            code, tail = self._invoke(argv, cwd)
            status = 'pass' if code == 0 else 'fail'
            outcome.tests.append(TestResult(
                id=spec.id, label=spec.label, status=status, exit_code=code, detail=tail,
            ))
            note(f'teste {spec.id}: {"OK" if code == 0 else f"FALHOU (exit {code})"}')

    def _invoke(self, argv: list[str], cwd: Path) -> tuple[int, str]:
        try:
            probe = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=1800)
        except (OSError, subprocess.SubprocessError) as exc:
            return 127, str(exc)
        return probe.returncode, (probe.stdout or probe.stderr or '')[-400:]

    def _launch_and_gate(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        # No early return here: a refused round never reaches this method, it
        # raises RoundAborted out of _prepare instead. `outcome.verdict` starts
        # as 'REFUSED' purely as a safe default, so it must not be read as a
        # control signal.
        manifest = self.round_manifest
        lines: list[str] = []
        gate = queue.Queue()

        def on_line(line: str) -> None:
            lines.append(line)
            gate.put(line)

        note(f'lançamento gerenciado: {" ".join(manifest.launch.command)}')
        note(f'operador: {manifest.launch.operator_hint}')
        handle = self.spawn(list(manifest.launch.command), self.repo, on_line)

        deadline = self.clock().timestamp() + self.marker_timeout_s
        pending = list(manifest.ordered_markers)
        matched: list[tuple[str, int]] = []
        try:
            while pending:
                remaining = deadline - self.clock().timestamp()
                if remaining <= 0:
                    break
                try:
                    line = gate.get(timeout=min(remaining, 1.0))
                except queue.Empty:
                    if handle.wait(0) is not None:
                        break
                    continue
                if pending[0].matches(line):
                    matched.append((pending[0].id, len(lines) - 1))
                    note(f'marcador {pending[0].id}: OK')
                    pending.pop(0)
        finally:
            self._collect_manual(outcome, note)
            handle.terminate()

        optional_seen = [
            marker.id
            for marker in manifest.optional_markers
            if any(marker.matches(line) for line in lines)
        ]
        outcome.optional_seen = optional_seen
        if pending:
            outcome.markers = MarkerReport(
                ok=False, matched=matched, missing=pending[0].id,
                reason=f'marcador {pending[0].id!r} não apareceu: {pending[0].pattern!r}',
            )
        else:
            outcome.markers = MarkerReport(ok=True, matched=matched)
        for line in outcome.markers.describe():
            note(f'gate: {line}')
        if optional_seen:
            note(f'gate: opcionais vistos: {", ".join(optional_seen)}')
        self._console = sanitize_console(lines)
        outcome.console_withheld = self._console.withheld
        note(f'log sanitizado: {len(self._console.kept)} linhas mantidas, '
             f'{self._console.withheld} retidas por não serem diagnóstico do launcher')

    def _collect_manual(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        for assertion in self.round_manifest.manual_assertions:
            options = (*assertion.accept, *assertion.reject)
            answer = self.ask(assertion.question, options)
            outcome.manual[assertion.id] = answer
            note(f'afirmação humana {assertion.id}: {answer or "(sem resposta)"}')

    def _decide(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        manifest = self.round_manifest
        tests_failed = any(test.status == 'fail' for test in outcome.tests)
        markers_ok = bool(outcome.markers and outcome.markers.ok)
        accepted = all(
            outcome.manual.get(assertion.id, '') in assertion.accept
            for assertion in manifest.manual_assertions
        )

        if not markers_ok:
            outcome.verdict = 'FAIL'
        elif not accepted:
            outcome.verdict = 'NOT_PASS'
        elif tests_failed:
            outcome.verdict = 'FAIL'
        else:
            outcome.verdict = 'PASS'

        # A log-only run is never a visual pass, by construction.
        if outcome.verdict == 'PASS' and not manifest.manual_assertions:
            outcome.verdict = 'NOT_PASS'
        note(f'verdicto: {outcome.verdict}')
        if not manifest.ready_for_publish:
            note('round.ready_for_publish=false: esta rodada não está marcada para publicar')

    def _persist(self, outcome: RoundOutcome, captured: list[str], directory: Path) -> None:
        console: SanitizedLog = self._console or sanitize_console(captured)
        manifest = self.round_manifest
        payload = {
            'schema_version': 1,
            'round': {
                'id': manifest.id,
                'title': manifest.title,
                'phase': manifest.phase,
                'ready_for_publish': manifest.ready_for_publish,
                'manifest': str(manifest.source.name),
            },
            'git': {
                'branch': outcome.branch,
                'head_sha': outcome.head_sha,
                'uncommitted_changes': outcome.dirty,
            },
            'verdict': outcome.verdict,
            'cleanup': outcome.cleanup,
            'tests': [test.__dict__ for test in outcome.tests],
            'markers': {
                'ok': bool(outcome.markers and outcome.markers.ok),
                'matched': outcome.markers.matched if outcome.markers else [],
                'missing': outcome.markers.missing if outcome.markers else None,
                'optional_seen': outcome.optional_seen,
            },
            'manual_assertions': outcome.manual,
            'notes': outcome.notes,
            'console': {'kept_lines': len(console.kept), 'withheld_lines': console.withheld},
            'finished_at': self.clock().isoformat(),
        }
        report_text = render_report(payload)
        try:
            paths = write_run(directory, payload=payload, console=console, report_text=report_text)
        except OSError as exc:
            outcome.notes.append(f'não consegui gravar artefatos: {exc}')
            return
        outcome.artifacts = {key: str(value) for key, value in paths.items()}
        self.emit(f'artefatos: {directory}')


def render_report(payload: dict) -> str:
    lines = [
        'DevFlow - relatório de rodada',
        '=' * 40,
        f'rodada      : {payload["round"]["id"]} - {payload["round"]["title"]}',
        f'fase        : {payload["round"]["phase"]}',
        f'verdicto    : {payload["verdict"]}',
        f'branch      : {payload["git"]["branch"]}',
        f'HEAD        : {payload["git"]["head_sha"]}',
        f'nao commitadas: {payload["git"]["uncommitted_changes"]}',
        '',
        'limpeza (perfis gerados, allowlist):',
        *([f'  - {line}' for line in payload['cleanup']] or ['  - nenhuma']),
        '',
        'testes automatizados:',
    ]
    for test in payload['tests']:
        lines.append(f'  - {test["id"]}: {test["status"]}'
                     + (f' (exit {test["exit_code"]})' if test['exit_code'] is not None else '')
                     + (f' - {test["detail"]}' if test['status'] == 'skipped' else ''))
    if not payload['tests']:
        lines.append('  - nenhum executado')
    lines += ['', 'marcadores de diagnóstico (ordem exigida):']
    for name, index in payload['markers']['matched']:
        lines.append(f'  - {name}: linha {index + 1}')
    if payload['markers']['missing']:
        lines.append(f'  - FALTANDO: {payload["markers"]["missing"]}')
    if payload['markers']['optional_seen']:
        lines.append(f'  - opcionais: {", ".join(payload["markers"]["optional_seen"])}')
    lines += ['', 'afirmações humanas (nunca inferidas de log):']
    for key, value in payload['manual_assertions'].items():
        lines.append(f'  - {key}: {value or "(sem resposta)"}')
    lines += ['', 'notas:']
    lines += [f'  - {line}' for line in payload['notes']] or ['  - nenhuma']
    lines += [
        '',
        f'console sanitizado: {payload["console"]["kept_lines"]} linhas mantidas, '
        f'{payload["console"]["withheld_lines"]} retidas',
        f'pronto para publicar: {str(payload["round"]["ready_for_publish"]).lower()}',
        f'finalizado em: {payload["finished_at"]}',
    ]
    return '\n'.join(lines) + '\n'


def pass_validity(recorded_sha: str, current_sha: str) -> str:
    """
    A PASS belongs to the exact commit that produced it. 'stale' means the
    code moved and the recorded PASS no longer describes this checkout.
    """
    if not recorded_sha or not current_sha:
        return 'unknown'
    return 'current' if recorded_sha == current_sha else 'stale'


def latest_run(repo: Path) -> dict | None:
    root = repo.joinpath(*('Tests', 'runs', 'devflow'))
    if not root.is_dir():
        return None
    candidates = sorted((item for item in root.iterdir() if item.is_dir()), reverse=True)
    for candidate in candidates:
        payload = candidate / 'run.json'
        if payload.is_file():
            import json

            try:
                return json.loads(payload.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
    return None

