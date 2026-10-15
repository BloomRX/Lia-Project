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
import re
import time
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
from typing import Callable, Protocol

from . import processes, safe_paths
from .markers import MarkerReport, evaluate_markers
from .report import (REDACT, SanitizedLog, collapse_home, prune_runs, run_dir,
                     sanitize_console, sanitize_test_output, utc_stamp,
                     write_run)
from .sync import git_executable
from .schema import DEFAULT_TEST_TIMEOUT_S, Round


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
    # What was proven about the generated tree IMMEDIATELY BEFORE the managed
    # launch. A mandatory test may legitimately rebuild an artifact that
    # `prepare` removed, so "prepare ran" is not evidence about launch time.
    # Only the safe fact is recorded - path plus presence - never a directory
    # listing.
    prelaunch: list[str] = field(default_factory=list)
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
        return self.overall_verdict == 'PASS'

    @property
    def overall_verdict(self) -> str:
        """
        The verdict the outside world is allowed to act on.

        `verdict` describes the RUNTIME evidence only. A round can prove every
        marker and still have leaked its whole process tree, and that is not a
        PASS: it leaves Lia and Electron running behind the report. So the
        overall verdict additionally requires teardown to be PASS - FAIL and
        UNKNOWN both downgrade it. INTERRUPTED and REFUSED pass through
        unchanged, because they are already not a PASS.
        """
        if self.verdict != 'PASS':
            return self.verdict
        if self.teardown in ('FAIL', 'UNKNOWN'):
            return 'FAIL'
        return 'PASS'


#: How often a long-running test command reports that it is still alive, and
#: how many such lines it may emit. Bounded on purpose: progress must make a
#: 20-minute stage legible, not bury the report.
PROGRESS_INTERVAL_S = 60.0
PROGRESS_MAX_LINES = 40


#: The suite's own progress journal. Only these shapes are ever salvaged out
#: of a killed child, so no arbitrary captured output can reach an artifact:
#: a status word, a millisecond count and a dotted test id, nothing else.
#: A test identity is a dotted Python id - or the startup label - and nothing
#: else. This used to be `\S.*`, which let anything the child printed ride
#: along inside the "identity" field, secret included. Every shape the suite
#: actually emits is spelled out instead.
_TEST_ID = r'[A-Za-z0-9_./-]+'
PROGRESS_LINE_RE = re.compile(
    r'(?m)^\[devflow-test\] (?:'
    r'(?:start|pass|fail|error|skip|class|timeout) \d+ ' + _TEST_ID +
    r'|blocked ' + _TEST_ID + r' excedeu \d+s; encerrando a suíte\. '
    r'Causa NÃO diagnosticada: lento e travado produzem o mesmo quadro\.'
    r'|summary \d+ pass=\d+ fail=\d+ error=\d+ skip=\d+ classes=\d+ \d+'
    r')$')
#: How many journal lines a timeout report keeps. Enough to show the last
#: completed test, the one that was running, and the aggregate.
PROGRESS_SALVAGE_MAX = 12
#: Partial output is held only long enough to be filtered, and it is bounded on
#: both axes: a chatty child must not be able to turn a 3600 s timeout into an
#: unbounded allocation. We keep the most recent window, on the reasoning that
#: a hang is late and the running test's identity is in the newest output.
PROGRESS_PARTIAL_MAX_CHUNKS = 8
PROGRESS_PARTIAL_MAX_BYTES = 64 * 1024


def salvage_progress(*chunks) -> list[str]:
    """
    Allowlisted progress lines recovered from partial child output.

    A timed-out child has usually already printed which test it was on. That
    is the single most useful fact in the whole report, and `communicate`
    hands it over on the exception - but only if somebody looks. Nothing
    outside the allowlist is returned, so this cannot become a channel for
    raw captured output.
    """
    found: list[str] = []
    for chunk in chunks[-PROGRESS_PARTIAL_MAX_CHUNKS:]:
        if not chunk:
            continue
        raw = (bytes(chunk) if isinstance(chunk, (bytes, bytearray))
               else str(chunk).encode('utf-8', 'replace'))
        # A TAIL, not a head. `communicate` hands over a cumulative snapshot,
        # so after enough output the identity of the test that is actually
        # stuck lives past the first PROGRESS_PARTIAL_MAX_BYTES and a head
        # slice would silently discard the one line the report exists to keep.
        truncated = len(raw) > PROGRESS_PARTIAL_MAX_BYTES
        window = raw[-PROGRESS_PARTIAL_MAX_BYTES:] if truncated else raw
        if truncated:
            # Drop the leading fragment. A cut can land mid-line, and a
            # half-line must never be mistaken for a test identity; dropping
            # it costs one line and makes the boundary unambiguous.
            _head, _sep, window = window.partition(b'\n')
        found.extend(PROGRESS_LINE_RE.findall(window.decode('utf-8', 'replace')))
    return found[-PROGRESS_SALVAGE_MAX:]


#: The exit code the suite's own watchdog uses when it stops a blocked test.
#: `run_test_command` uses the same code for its own outer budget, which is
#: deliberate: both mean "a declared budget was exhausted", and neither may be
#: reported as an ordinary failure.
WATCHDOG_EXIT_CODE = 124


def watchdog_detail(stdout: str, stderr: str, who: str, timeout_s: float) -> str:
    """
    The report for a child that ended on the watchdog's exit code.

    When the suite stops itself, `communicate` returns NORMALLY - there is no
    `TimeoutExpired` to hook - so this path used to fall through to the generic
    sanitizer. On a long run that sanitizer fills its budget with the EARLIEST
    lines of output, and the watchdog's verdict, which is the last thing
    printed, was dropped entirely: the report named test 000 and said nothing
    about the test that was actually stuck.

    The journal is salvaged from the tail and its verdict lines are put first.
    The cause stays UNKNOWN: slow and hung are still indistinguishable.
    """
    events = salvage_progress(stdout, stderr)
    verdict = [e for e in events
               if e.split(' ', 2)[1:2] and e.split(' ', 2)[1] in ('timeout', 'blocked')]
    recent = [e for e in events if e not in verdict]
    head = (
        f'[devflow-timeout] o estágio de teste {who!r} encerrou com código '
        f'{WATCHDOG_EXIT_CODE} (orçamento por teste da suíte esgotado; '
        f'orçamento externo {timeout_s:.0f}s). Causa NÃO diagnosticada: '
        f'lentidão e travamento produzem o mesmo quadro.')
    body = '\n'.join([head, *verdict, *recent])
    return sanitize_test_output('', body)


def _terminate_timed_out(proc: 'subprocess.Popen') -> str:
    """
    Best-effort SCOPED cleanup of a test process that outlived its budget.

    Scoped means "this process and its own tree", never an image name: killing
    by name would take down unrelated work on a developer machine. On POSIX the
    child is its own session leader, so the whole group goes. On Windows the
    tree is taken with `taskkill /T`; if that is unavailable the child alone is
    killed and the report says so instead of implying the tree was verified.
    """
    pid = proc.pid
    try:
        if os.name == 'posix':
            os.killpg(os.getpgid(pid), signal.SIGKILL)
            note = 'grupo de processos terminado'
        elif sys.platform == 'win32':
            probe = subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'],
                                   capture_output=True, text=True,
                                   encoding='utf-8', errors='replace', timeout=60)
            note = ('árvore terminada' if probe.returncode == 0
                    else f'taskkill rc={probe.returncode}; apenas o processo raiz '
                         'foi morto, a árvore NÃO foi verificada')
        else:
            proc.kill()
            note = 'processo raiz morto; árvore não verificada'
    except (OSError, subprocess.SubprocessError) as exc:
        try:
            proc.kill()
        except OSError:
            pass
        note = f'limpeza falhou ({type(exc).__name__}); processo raiz morto à força'
    try:
        proc.wait(timeout=30)
    except subprocess.SubprocessError:
        note += '; o processo não encerrou em 30s'
    # The captured pipes must not outlive the command. A gate that leaks one
    # file descriptor per timed-out stage is how "leaked inherited pipe" stops
    # being a hypothesis and becomes the next incident.
    for stream in (proc.stdout, proc.stderr):
        try:
            if stream is not None:
                stream.close()
        except OSError:
            pass
    return note


def run_test_command(argv: list[str], cwd: Path,
                     timeout_s: float = DEFAULT_TEST_TIMEOUT_S,
                     label: str = '',
                     progress: Callable[[str], None] | None = None,
                     ) -> tuple[int, str]:
    """
    Runs one declared test. A missing tool is reported as failure, not pass.

    `timeout_s` comes from the round manifest: the honest budget for a suite is
    a property of that suite and of the machine, not a constant baked into the
    runner. What is NOT claimed is a diagnosis. This suite is measurably
    expensive (~1800 git process spawns, ~131 s on Linux), so a slow platform
    is a sufficient explanation for the 1800 s the first real Windows run
    consumed - but "expensive" is not proof that the run was merely slow. A
    deadlock, a blocked child or a leaked inherited pipe reaches the same
    deadline and looks identical from here. The detail below therefore names
    the stage and the budget that expired and stops there.

    The returned detail is already bounded and redacted by the ONE test-output
    sanitizer, because this same string is echoed to the console, stored in
    `TestResult.detail`, written to REPORT.txt and persisted into run.json.
    `encoding='utf-8'` is explicit so a Windows console codepage cannot turn a
    test failure into a decode error.
    """
    who = label or (argv[0] if argv else 'teste')
    popen_kwargs: dict = {}
    if os.name == 'posix':
        # Own session, so a timeout can take the whole group and not just the
        # shell that started it.
        popen_kwargs['start_new_session'] = True
    started = time.monotonic()
    try:
        proc = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True,
                                encoding='utf-8', errors='replace', **popen_kwargs)
    except OSError as exc:
        return 127, sanitize_test_output('', f'{type(exc).__name__}: {exc}')

    def expired_detail(cleanup: str, journal: list[str]) -> str:
        # Deliberately no claim about WHY: slow and hung are indistinguishable
        # from outside, and saying "just slow" is how a real deadlock gets
        # closed as noise.
        head = (
            f'TimeoutExpired: o estágio de teste {who!r} atingiu o orçamento '
            f'declarado de {timeout_s:.0f}s e foi encerrado. Causa NÃO '
            f'diagnosticada: lentidão e travamento produzem o mesmo prazo. '
            f'Limpeza: {cleanup}.')
        if journal:
            head += '\nÚltimos eventos do journal de testes:'
        else:
            head += ('\nNenhum evento de journal recuperado: o filho não '
                     'chegou a reportar progresso.')
        body = '\n'.join([head, *journal])
        body += ('\nSe o trabalho for legítimo nesta máquina, aumente '
                 'tests[].timeout_s no manifesto da rodada.')
        return sanitize_test_output('', body)

    # Output is drained by reader threads rather than collected by
    # `communicate()`, and this is not a style choice. On POSIX a timed-out
    # `communicate` raises `TimeoutExpired(self.args, t, output=..., stderr=...)`
    # and hands over everything read so far; the Windows implementation raises
    # `TimeoutExpired(self.args, t)` with no output at all. Salvaging the
    # exception payload therefore worked on one platform and silently returned
    # nothing on the other - which is precisely the platform whose hangs this
    # reporting exists to explain. Reading continuously makes the tail
    # available everywhere.
    out_parts: list[str] = []
    err_parts: list[str] = []

    def _drain(stream, sink: list[str]) -> None:
        if stream is None:
            return
        try:
            for line in stream:
                sink.append(line)
        except (ValueError, OSError):
            # The pipe was closed under us by the timeout cleanup. Whatever was
            # already captured stays captured; that is the evidence we have.
            pass

    readers = [threading.Thread(target=_drain, args=(proc.stdout, out_parts),
                                daemon=True),
               threading.Thread(target=_drain, args=(proc.stderr, err_parts),
                                daemon=True)]
    for reader in readers:
        reader.start()

    def _captured() -> str:
        return ''.join(out_parts) + '\n' + ''.join(err_parts)

    beats = 0
    while True:
        # The wait is clamped to what is LEFT of the budget. Waiting a full
        # progress interval when only a fraction of the budget remains would
        # let a command overrun its own deadline unnoticed - which is exactly
        # the bug this loop exists to prevent.
        remaining = timeout_s - (time.monotonic() - started)
        if remaining <= 0:
            cleanup = _terminate_timed_out(proc)
            for reader in readers:
                reader.join(timeout=5)
            return 124, expired_detail(cleanup, salvage_progress(_captured()))
        try:
            proc.wait(timeout=min(PROGRESS_INTERVAL_S, remaining))
            break
        except subprocess.TimeoutExpired:
            if time.monotonic() - started >= timeout_s:
                cleanup = _terminate_timed_out(proc)
                for reader in readers:
                    reader.join(timeout=5)
                return 124, expired_detail(cleanup,
                                           salvage_progress(_captured()))
            if progress is not None and beats < PROGRESS_MAX_LINES:
                beats += 1
                progress(f'  {who}: em andamento, '
                         f'{int(time.monotonic() - started)}s de '
                         f'{timeout_s:.0f}s decorridos')

    for reader in readers:
        reader.join(timeout=30)
    # `communicate` used to close these for us; draining by hand does not, and
    # an unclosed pipe per declared test is a leak the round would carry.
    for stream in (proc.stdout, proc.stderr):
        if stream is not None:
            try:
                stream.close()
            except (ValueError, OSError):
                pass
    stdout, stderr = ''.join(out_parts), ''.join(err_parts)
    if proc.returncode == WATCHDOG_EXIT_CODE:
        # The suite stopped itself. Route through the watchdog report instead
        # of the generic sanitizer, which would keep the oldest lines and lose
        # the verdict.
        return proc.returncode, watchdog_detail(
            stdout or '', stderr or '', who, timeout_s)
    return proc.returncode, sanitize_test_output(stdout or '', stderr or '')


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

        # AFTER the tests passed and BEFORE the launch: a mandatory test may
        # have rebuilt the very artifact `prepare` removed.
        self._prelaunch_prepare(outcome, note)

        self._launch_and_gate(outcome, note)
        self._decide(outcome, note)

    def _prepare(self, outcome: RoundOutcome, note: Callable[[str], None]) -> None:
        manifest = self.round_manifest
        if not manifest.prepare:
            note('preparo: nenhum passo declarado')
            return
        self._apply_prepare_steps(
            manifest.prepare, outcome, note, label='preparo', sink=outcome.cleanup)

    def _prelaunch_prepare(self, outcome: RoundOutcome,
                           note: Callable[[str], None]) -> None:
        """
        Re-establishes the declared launch-time state, after the tests ran.

        M3.0b's whole premise is "fresh checkout": `prepare` deletes
        `core-agent/dist` so the managed prerequisite has to rebuild it. But a
        MANDATORY test - lia-app's "rebuilds the real core-agent artifact" -
        runs that same prerequisite against the real workspace and puts the
        artifact back. `_prepare` therefore proves nothing about the moment the
        Launcher starts, and the prerequisite's starting/succeeded markers can
        appear without the fresh-checkout condition ever having held.

        So the declared step is applied AGAIN here, immediately before the
        launch, and the resulting absence is verified and recorded. Refusal
        aborts the round: launching without the declared precondition would
        make the round's evidence describe a different setup than the one it
        claims.
        """
        manifest = self.round_manifest
        if not manifest.prelaunch_prepare:
            return
        self._apply_prepare_steps(
            manifest.prelaunch_prepare, outcome, note,
            label='pré-lançamento', sink=outcome.prelaunch)
        for step in manifest.prelaunch_prepare:
            target = self.repo / step.path
            absent = not target.exists()
            fact = f'{step.path} {"AUSENTE" if absent else "PRESENTE"} imediatamente antes do lançamento'
            outcome.prelaunch.append(fact)
            note(f'  {fact}')
            if not absent:
                message = (f'{step.path} ainda existe imediatamente antes do lançamento; '
                           'a condição de checkout fresco desta rodada não está provada')
                outcome.notes.append(message)
                raise RoundAborted(message)

    def _apply_prepare_steps(self, steps, outcome: RoundOutcome,
                             note: Callable[[str], None], *, label: str,
                             sink: list[str]) -> None:
        """
        Removes declared generated artifacts through the ONE safe-path seam.

        Both `prepare` and `prelaunch_prepare` go through here, so there is no
        second removal path and no ad-hoc rmtree in the launcher: the allowlist,
        the symlink/junction/reparse escape checks and the staged planning all
        come from `safe_paths`, exactly as they do for cleanup.
        """
        allowlist = list(self.round_manifest.cleanup.allowlisted_generated)
        for step in steps:
            note(f'{label}: {step.kind} {step.path} - {step.why}')
            try:
                plan = safe_paths.plan_removal(self.repo, step.path, allowlist)
            except safe_paths.PathSafetyError as exc:
                outcome.notes.append(f'limpeza recusada para {step.path}: {exc}')
                note(f'  RECUSADO: {exc}')
                raise RoundAborted(str(exc)) from exc
            for line in plan.describe():
                note(f'  {line}')
            report = safe_paths.execute_removal(plan)
            sink.extend(report.lines)

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
            code, raw = self._invoke(argv, cwd, spec.timeout_s,
                                     label=spec.id, progress=note)
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
                if spec.blocking:
                    rest = [t.id for t in self.round_manifest.tests
                            if t.id not in {x.id for x in outcome.tests}]
                    note(f'teste {spec.id} é BLOCKING: a rodada para aqui. '
                         f'Não executados: {", ".join(rest) or "nenhum"}.')
                    break
        return decision

    def _invoke(self, argv: list[str], cwd: Path,
                timeout_s: float = DEFAULT_TEST_TIMEOUT_S, *, label: str = '',
                progress: Callable[[str], None] | None = None) -> tuple[int, str]:
        # `invoke_test` is a two-argument seam so tests can inject a fake. Only
        # the real invoker has a wall-clock budget to honour and progress to
        # report, so those are passed to it and to nothing else - an injected
        # fake keeps working unchanged.
        invoker = self.invoke_test
        if invoker is run_test_command:
            return invoker(argv, cwd, timeout_s, label=label, progress=progress)
        return invoker(argv, cwd)

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
        try:

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
            # OWNERSHIP SCOPE: this finally encloses the ENTIRE gate, from the
            # instant spawn() returned. Every exit path is covered - phase A
            # success or timeout, phase B success or timeout, a forbidden
            # marker, an early child exit, Ctrl+C in either phase, an exception
            # out of the queue or the marker matching, and an interrupt during
            # the forbidden-marker drain. The previous version opened the try
            # only around the reporting section, so anything raised while
            # waiting for markers leaked the whole Lia process tree.
            # Rooted at our own PID only; the result is RECORDED, because
            # terminate() used to return None and the caller then asserted a
            # cleanup it had never verified.
            teardown = handle.terminate()
            outcome.tree_cleaned = teardown.ok
            # The tri-state, verbatim. Collapsing UNKNOWN into FAIL here would
            # claim a failure we did not observe; the pipeline treats FAIL and
            # UNKNOWN identically, so honesty costs nothing.
            outcome.teardown = teardown.state
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
        note(f'verdicto de runtime: {outcome.verdict}')
        if outcome.overall_verdict != outcome.verdict:
            note(f'verdicto geral: {outcome.overall_verdict} '
                 f'(limpeza da árvore = {outcome.teardown or "N/A"}; '
                 'evidência de runtime não basta sozinha)')
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
            # Two different claims, both persisted. `runtime_verdict` is what
            # the markers and tests proved; `overall_verdict` is what the
            # outside world may act on, and it also requires a verified
            # teardown. A run.json must never be readable as PASS while the
            # pipeline reports FAIL.
            'verdict': outcome.verdict,
            'runtime_verdict': outcome.verdict,
            'overall_verdict': outcome.overall_verdict,
            'launch': {
                'pid': outcome.launch_pid,
                'tree_cleaned': outcome.tree_cleaned,
                'teardown_state': outcome.teardown or 'N/A',
                'teardown_detail': outcome.teardown_detail,
                'teardown_descendants': outcome.teardown_descendants,
            },
            'cleanup': outcome.cleanup,
            'prelaunch': outcome.prelaunch,
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
    # Tolerates a payload written before the two verdicts were split, so an old
    # run.json still renders instead of raising.
    runtime_verdict = payload.get('runtime_verdict') or payload.get('verdict', '')
    overall_verdict = payload.get('overall_verdict') or runtime_verdict
    lines = [
        'DevFlow - relatório de rodada',
        '=' * 40,
        f'rodada      : {payload["round"]["id"]} - {payload["round"]["title"]}',
        f'fase        : {payload["round"]["phase"]}',
        f'verdicto runtime : {runtime_verdict}',
        f'verdicto geral   : {overall_verdict}'
        + ('' if runtime_verdict == overall_verdict
           else '  (rebaixado pela limpeza de processo)'),
        f'branch      : {payload["git"]["branch"]}',
        f'HEAD        : {payload["git"]["head_sha"]}',
        f'nao commitadas: {payload["git"]["uncommitted_changes"]}',
        '',
        'limpeza (perfis gerados, allowlist):',
        *([f'  - {line}' for line in payload['cleanup']] or ['  - nenhuma']),
        '',
        'estado imediatamente antes do lançamento:',
        *([f'  - {line}' for line in payload.get('prelaunch', [])]
          or ['  - nenhum passo declarado']),
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
    # The report is a persisted artifact, so it is a persistence boundary like
    # any other. Several sections interpolate absolute paths that came from
    # elsewhere - cleanup targets, prelaunch steps, notes - and none of them
    # passed through the redactor on the way in. On Linux that was invisible
    # because the temporary directory lives in /tmp, outside the home
    # directory; on Windows it lives under %USERPROFILE%, so the operator's
    # home path was written straight into REPORT.txt.
    return '\n'.join(REDACT(collapse_home(line)) for line in lines) + '\n'


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

