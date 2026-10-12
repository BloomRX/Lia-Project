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
import time
from pathlib import Path
import subprocess
import sys
import threading
from typing import Callable, Protocol

from . import processes, safe_paths
from .markers import MarkerReport, evaluate_markers
from .report import (SanitizedLog, prune_runs, run_dir, sanitize_console,
                     sanitize_test_output, utc_stamp, write_run)
from .sync import git_executable
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
    launch_pid: int | None = None
    tree_cleaned: bool = False
    # Cleanup is a CLAIM about evidence, not about intent. `teardown` carries
    # what was actually proven; `tree_cleaned` stays a derived convenience.
    teardown: str = ''
    teardown_detail: str = ''
    teardown_descendants: int = -1
    timed_out: bool = False
    gate_phase: str = ''
    # Machine-verifiable runtime evidence (§F): every terminal marker seen, and
    # any forbidden marker that appeared at all.
    terminal_seen: list[str] = field(default_factory=list)
    forbidden_seen: list[str] = field(default_factory=list)
    stage: str = ''
    notes: list[str] = field(default_factory=list)
    artifacts: dict[str, str] = field(default_factory=dict)
    console_withheld: int = 0

    @property
    def is_pass(self) -> bool:
        return self.verdict == 'PASS'


def run_test_command(argv: list[str], cwd: Path) -> tuple[int, str]:
    """
    Runs one declared test. A missing tool is reported as failure, not pass.

    The returned detail is already bounded and redacted by the ONE test-output
    sanitizer, because this same string is echoed to the console, stored in
    `TestResult.detail`, written to REPORT.txt and persisted into run.json.
    `encoding='utf-8'` is explicit so a Windows console codepage cannot turn a
    test failure into a decode error.
    """
    try:
        probe = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=1800)
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, sanitize_test_output('', f'{type(exc).__name__}: {exc}')
    return probe.returncode, sanitize_test_output(probe.stdout or '', probe.stderr or '')


def default_git(args: list[str], cwd: Path) -> tuple[int, str]:
    try:
        probe = subprocess.run([git_executable(), *args], cwd=cwd,
                               capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as exc:
        return 128, str(exc)
    return probe.returncode, (probe.stdout or probe.stderr or '').strip()


def git_facts(repo: Path, run_git: GitRunner) -> tuple[str, str, int]:
    _, branch = run_git(['rev-parse', '--abbrev-ref', 'HEAD'])
    _, head = run_git(['rev-parse', 'HEAD'])
    code, porcelain = run_git(['status', '--porcelain'])
    dirty = 0 if code != 0 else len([line for line in porcelain.splitlines() if line.strip()])
    return branch.strip(), head.strip(), dirty


def default_spawner(command: list[str], cwd: Path, on_line: Callable[[str], None],
                    env: dict[str, str] | None = None) -> SpawnHandle:
    """
    Launches the managed path in its OWN process group, so teardown can reach
    the whole tree (cmd -> Lia.bat -> pnpm -> Launcher -> Stage) instead of
    stranding grandchildren. Fixed argv, no shell - see `processes`.
    """
    return processes.spawn_owned(command, cwd, on_line, env=env)


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
    # Phase B budget, counted from the moment the ordered chain completed. The
    # renderer mounts asynchronously long after `spawn: node`, so it gets its
    # own bound instead of sharing the startup one.
    terminal_timeout_s: float = 300.0
    # Bounded window for catching a forbidden marker that lands right after the
    # last piece of required evidence. Never waits for NEW evidence.
    forbidden_drain_s: float = 1.0
    emit: Callable[[str], None] = field(default=print)
    invoke_test: Callable[[list[str], Path], tuple[int, str]] | None = None
    _console: SanitizedLog | None = None

    def __post_init__(self) -> None:
        if self.run_git is None:
            self.run_git = lambda args: default_git(args, self.repo)
        if self.spawn is None:
            self.spawn = default_spawner
        if self.invoke_test is None:
            self.invoke_test = run_test_command

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
            outcome.stage = 'prepare'
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

        # A PASS belongs to an EXACT checkout, not only to a SHA. Git's
        # porcelain already excludes ignored files (Tests/runs, core-agent/dist),
        # so anything it reports is real source drift. Only the count is
        # printed: filenames are not needed to refuse.
        if dirty > 0:
            outcome.verdict = 'REFUSED'
            outcome.notes.append(
                f'{dirty} alteração(ões) não commitada(s); um PASS precisa descrever um '
                'checkout exato. Nada foi limpo, testado ou lançado.',
            )
            note(f'RECUSADO: {dirty} alteração(ões) não commitada(s). '
                 'Faça commit (ou desfaça) antes de rodar a rodada.')
            return

        self._prepare(outcome, note)

        # EVERY declared test is required. A skip means the environment is not
        # ready, which is a REFUSAL - never a silent pass.
        gate = self._run_tests(outcome, note)
        if gate == 'refused':
            outcome.verdict = 'REFUSED'
            outcome.notes.append('teste obrigatório não pôde executar; o gate do Windows não foi lançado')
            return
        if gate == 'fail':
            outcome.verdict = 'FAIL'
            outcome.notes.append('teste obrigatório falhou; o gate do Windows não foi lançado')
            return

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

    def _run_tests(self, outcome: RoundOutcome, note: Callable[[str], None]) -> str:
        """
        Runs every declared test. Returns 'proceed', 'fail' or 'refused'.

        Skipped is NOT neutral: a test that could not run proves nothing, so it
        refuses the round instead of letting a launch happen unguarded.
        """
        decision = 'proceed'
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
                decision = 'refused'
                continue
            if not cwd.is_dir():
                outcome.tests.append(TestResult(
                    id=spec.id, label=spec.label, status='skipped',
                    detail='diretório ausente',
                ))
                note(f'teste {spec.id}: PULADO (diretório ausente) - não conta como sucesso')
                decision = 'refused'
                continue
            code, raw = self._invoke(argv, cwd)
            status = 'pass' if code == 0 else 'fail'
            # Sanitised HERE, at the persistence boundary, and not only inside
            # the default invoker: no pluggable invoker and no future call path
            # may put raw subprocess output into detail, REPORT.txt or run.json.
            tail = sanitize_test_output('', raw) if raw else ''
            outcome.tests.append(TestResult(
                id=spec.id, label=spec.label, status=status, exit_code=code, detail=tail,
            ))
            note(f'teste {spec.id}: {"OK" if code == 0 else f"FALHOU (exit {code})"}')
            if code != 0:
                decision = 'fail'
                # A bare "FALHOU (exit 1)" defeats the point of a unified DevKit.
                for detail_line in (tail or '(sem saída capturada)').splitlines():
                    note(f'  detalhe: {detail_line}')
        return decision

    def _invoke(self, argv: list[str], cwd: Path) -> tuple[int, str]:
        return self.invoke_test(argv, cwd)

    def _launch_and_gate(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        # No early return here: a refused round never reaches this method, it
        # raises RoundAborted out of _prepare instead. `outcome.verdict` starts
        # as 'REFUSED' purely as a safe default, so it must not be read as a
        # control signal.
        manifest = self.round_manifest
        lines: list[str] = []
        gate = queue.Queue()

        def on_line(line: str) -> None:
            # The sequence number is stamped at EMISSION time. Deriving it from
            # len(lines) on the consumer side would be wrong whenever the child
            # writes faster than the gate reads, and every line would then look
            # like the same one to the "one line, one marker" rule.
            index = len(lines)
            lines.append(line)
            gate.put((index, line))

        note(f'lançamento gerenciado: {" ".join(manifest.launch.command)}')
        note(f'operador: {manifest.launch.operator_hint}')
        launch_env = dict(manifest.launch.env)
        if launch_env:
            note(f'ambiente DEVFLOW do lançamento: '
                 f'{", ".join(sorted(launch_env))}')
        handle = self.spawn(list(manifest.launch.command), self.repo, on_line,
                            env=launch_env or None)
        outcome.launch_pid = getattr(handle, 'pid', None)

        # ------------------------------------------------------------------
        # TWO PHASES, both bounded, both watching the same three things:
        #
        #   A  the ordered startup chain (prerequisite -> build -> spawn);
        #   B  ALL terminal markers, which arrive ASYNCHRONOUSLY after the
        #      child is spawned - the renderer mounts seconds later.
        #
        # The previous version read `terminal_seen` out of the lines it already
        # had as soon as phase A finished, so a perfectly healthy Lia was torn
        # down before its renderer mounted and reported as FAIL. Timeouts use
        # time.monotonic(): a wall-clock jump must never shorten a gate.
        # ------------------------------------------------------------------
        pending = list(manifest.ordered_markers)
        terminal_pending = list(manifest.runtime.terminal)
        matched: list[tuple[str, int]] = []
        outcome.terminal_seen = []
        outcome.forbidden_seen = []
        # A line is attributed to at most ONE marker, so a terminal pattern can
        # never double as an ordered marker or the other way round.
        consumed: set[int] = set()
        phase_deadline = time.monotonic() + self.marker_timeout_s
        outcome.gate_phase = 'A'
        early_exit = False

        def scan_forbidden(line: str, index: int) -> None:
            for marker in manifest.runtime.forbidden:
                if marker.id not in outcome.forbidden_seen and marker.matches(line):
                    outcome.forbidden_seen.append(marker.id)
                    consumed.add(index)
                    note(f'marcador PROIBIDO visto: {marker.id}')

        while (pending or terminal_pending) and not outcome.forbidden_seen:
            remaining = phase_deadline - time.monotonic()
            if remaining <= 0:
                outcome.timed_out = True
                if pending:
                    note(f'gate fase A: tempo esgotado aguardando {pending[0].id}')
                else:
                    note('gate fase B: tempo esgotado aguardando a evidência terminal: '
                         + ', '.join(marker.id for marker in terminal_pending))
                break
            try:
                index, line = gate.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                if handle.wait(0) is not None:
                    early_exit = True
                    note('gate: o processo gerenciado encerrou antes da evidência completa')
                    break
                continue

            # Forbidden evidence wins over everything, at any point.
            scan_forbidden(line, index)
            if outcome.forbidden_seen:
                break
            if pending and index not in consumed and pending[0].matches(line):
                matched.append((pending[0].id, index))
                consumed.add(index)
                note(f'marcador {pending[0].id}: OK')
                pending.pop(0)
                if not pending:
                    outcome.gate_phase = 'B'
                    phase_deadline = time.monotonic() + self.terminal_timeout_s
                    note('gate fase B: cadeia de inicialização completa; aguardando a '
                         'evidência terminal do Stage')
            else:
                for marker in list(terminal_pending):
                    if index in consumed:
                        break
                    if marker.matches(line):
                        terminal_pending.remove(marker)
                        consumed.add(index)
                        outcome.terminal_seen.append(marker.id)
                        note(f'evidência terminal {marker.id}: OK')
                        break

        # Evidence is complete, but forbidden evidence must not be dropped just
        # because it landed a moment later. This drain is BOUNDED (nothing new
        # is waited for beyond one short window) so it cannot stall the gate,
        # and it cannot invent evidence either: it only reads lines the child
        # already wrote.
        if not outcome.forbidden_seen and not early_exit:
            drain_until = time.monotonic() + self.forbidden_drain_s
            while True:
                remaining = drain_until - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    index, line = gate.get(timeout=min(remaining, 0.25))
                except queue.Empty:
                    # Keep waiting until the window closes: an empty queue right
                    # now says nothing about the next line the child will write.
                    continue
                scan_forbidden(line, index)
                if outcome.forbidden_seen:
                    break

        missing_terminal = [marker.id for marker in terminal_pending]
        if early_exit:
            outcome.notes.append(
                'o processo encerrou antes da evidência completa; nada foi inferido',
            )
        try:
            # The marker verdict is decided BEFORE any human is involved.
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

            # Section 4 of D1.1: the human question (when a round declares one)
            # is asked ONLY when the automatic gate passed. Asking after a dead
            # stage, a missing marker or a timeout would invite a meaningless
            # answer.
            if missing_terminal:
                note(f'evidência terminal AUSENTE: {", ".join(missing_terminal)}')
            if outcome.forbidden_seen:
                note(f'marcadores PROIBIDOS: {", ".join(outcome.forbidden_seen)}')

            if outcome.markers.ok and not outcome.forbidden_seen and not missing_terminal:
                self._collect_manual(outcome, note)
            elif not outcome.markers.ok:
                outcome.notes.append(
                    'afirmação visual não foi perguntada: o gate automático não passou',
                )
                note('gate: afirmação visual NÃO perguntada - o gate automático não passou')
        finally:
            # Always clean up the tree THIS round started - on success, on
            # marker failure, and on Ctrl+C. Rooted at our own PID only. The
            # result is RECORDED, because terminate() used to return None and
            # the caller then asserted a cleanup it had never verified.
            teardown = handle.terminate()
            outcome.tree_cleaned = teardown.ok
            outcome.teardown = 'PASS' if teardown.ok else 'FAIL'
            outcome.teardown_detail = teardown.describe()
            outcome.teardown_descendants = teardown.descendants
            note(f'limpeza da árvore própria: {outcome.teardown} ({teardown.describe()})')

        if outcome.optional_seen:
            note(f'gate: opcionais vistos: {", ".join(outcome.optional_seen)}')
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
        tests_failed = any(test.status != 'pass' for test in outcome.tests)
        markers_ok = bool(outcome.markers and outcome.markers.ok)
        terminal_required = tuple(manifest.runtime.terminal)
        terminal_ok = all(marker.id in outcome.terminal_seen for marker in terminal_required)
        forbidden_hit = list(outcome.forbidden_seen)
        accepted = all(
            outcome.manual.get(assertion.id, '') in assertion.accept
            for assertion in manifest.manual_assertions
        ) if manifest.manual_assertions else True

        if forbidden_hit:
            outcome.verdict = 'FAIL'
            outcome.stage = 'runtime'
        elif not markers_ok:
            outcome.verdict = 'FAIL'
            outcome.stage = 'runtime'
        elif not terminal_ok:
            outcome.verdict = 'FAIL'
            outcome.stage = 'runtime'
        elif tests_failed:
            outcome.verdict = 'FAIL'
            outcome.stage = 'tests'
        elif not accepted:
            outcome.verdict = 'NOT_PASS'
            outcome.stage = 'runtime'
        else:
            outcome.verdict = 'PASS'
        note(f'verdicto: {outcome.verdict}')
        if not manifest.ready_for_publish:
            note('round.ready_for_publish=false: esta rodada não está marcada para publicar')
        if outcome.verdict == 'PASS':
            # A PASS is a claim about an EXACT checkout. Assert its
            # preconditions here so a future edit cannot silently weaken it.
            evidence = {
                'worktree limpo': outcome.dirty == 0,
                'todos os testes obrigatórios passaram':
                    bool(outcome.tests) and all(t.status == 'pass' for t in outcome.tests),
                'marcadores ordenados': markers_ok,
                'evidência terminal completa': terminal_ok,
                'nenhum marcador proibido': not forbidden_hit,
                # A round must prove itself by machine evidence or by a human.
                # The schema forbids having neither; this enforces it at runtime.
                'evidência suficiente (terminal ou humana)':
                    bool(terminal_required) or bool(manifest.manual_assertions),
                'afirmação humana aceita': accepted,
            }
            missing = [name for name, ok in evidence.items() if not ok]
            if missing:
                outcome.verdict = 'NOT_PASS'
                outcome.notes.append(f'PASS negado por falta de evidência: {missing}')
                note(f'verdicto rebaixado para NOT_PASS: {missing}')

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
                'worktree_clean': outcome.dirty == 0,
            },
            'verdict': outcome.verdict,
            'launch': {'pid': outcome.launch_pid, 'tree_cleaned': outcome.tree_cleaned},
            'cleanup': outcome.cleanup,
            'tests': [test.__dict__ for test in outcome.tests],
            'stage': outcome.stage,
            'markers': {
                'ok': bool(outcome.markers and outcome.markers.ok),
                'matched': outcome.markers.matched if outcome.markers else [],
                'missing': outcome.markers.missing if outcome.markers else None,
                'optional_seen': outcome.optional_seen,
                # The machine evidence that replaced the human S/N (§F).
                'terminal_required': [m.id for m in self.round_manifest.runtime.terminal],
                'terminal_seen': outcome.terminal_seen,
                'terminal_missing': [m.id for m in self.round_manifest.runtime.terminal
                                     if m.id not in outcome.terminal_seen],
                'forbidden_seen': outcome.forbidden_seen,
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
                     + (f' (exit {test["exit_code"]})' if test['exit_code'] is not None else ''))
        if test['status'] in ('fail', 'skipped') and test.get('detail'):
            for detail_line in str(test['detail']).splitlines():
                lines.append(f'    detail: {detail_line}')
    if not payload['tests']:
        lines.append('  - nenhum executado')
    lines += ['', 'marcadores de diagnóstico (ordem exigida):']
    for name, index in payload['markers']['matched']:
        lines.append(f'  - {name}: linha {index + 1}')
    if payload['markers']['missing']:
        lines.append(f'  - FALTANDO: {payload["markers"]["missing"]}')
    if payload['markers'].get('terminal_required'):
        lines.append('  evidência terminal (substitui a confirmação visual humana):')
        for name in payload['markers']['terminal_required']:
            seen = name in payload['markers'].get('terminal_seen', [])
            lines.append(f'    - {name}: {"OK" if seen else "AUSENTE"}')
    if payload['markers'].get('forbidden_seen'):
        lines.append(f'  - PROIBIDO VISTO: {", ".join(payload["markers"]["forbidden_seen"])}')
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

