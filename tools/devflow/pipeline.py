"""
DevFlow AUTO: the zero-choice development autopilot.

Double-clicking DevKit.bat lands here. There is no menu, no numbered choice, no
Git submenu and no manual build, launch, click or S/N answer. Everything that
can be decided deterministically IS decided here; everything that cannot be is
refused with a reason.

Pipeline (§D):

    bootstrap -> sync -> local_change_classification -> checkpoint
              -> tests -> runtime -> teardown -> publish

The round itself stays machine-driven: AUTO reads `active-round.json` and never
asks which round to run. The manifest is (re)loaded AFTER the sync, because the
sync may have moved the checkout - running the pre-sync manifest would validate
code that is no longer on disk.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .runner import RoundOutcome, RoundRunner
from .schema import Round, RoundSchemaError, load_active_round
from .sync import (DEFAULT_EXPECTED_OWNER, DEFAULT_EXPECTED_REPO,
                  SyncOutcome, WorkBranchSync)

STAGES = (
    'bootstrap', 'sync', 'local_change_classification', 'checkpoint', 'prepare',
    'tests', 'runtime', 'teardown', 'publish',
)


@dataclass
class StageRecord:
    name: str
    ok: bool
    reason: str = ''
    facts: dict = field(default_factory=dict)


@dataclass
class AutoResult:
    result: str = 'FAIL'  # 'PASS' | 'FAIL'
    stage: str = 'bootstrap'
    reason: str = ''
    round_id: str = ''
    initial_head: str = ''
    remote_head: str | None = None
    tested_head: str = ''
    pushed_head: str | None = None
    dirty_before: int = 0
    dirty_after: int = 0
    checkpoint: str | None = None
    sync_ok: bool = False
    tests_ok: bool = False
    runtime_ok: bool = False
    cleanup_ok: bool = False
    # What teardown PROVED, not what it attempted. 'N/A' means the round never
    # launched anything, which is the honest answer for a refusal at prepare.
    cleanup_state: str = 'UNKNOWN'  # 'PASS' | 'FAIL' | 'N/A' | 'UNKNOWN'
    cleanup_detail: str = ''
    publish: str = 'skipped'  # 'ok' | 'nothing-to-push' | 'skipped-by-round-policy' |
    #                         'skipped' | 'refused'
    report_path: str = ''
    stages: list[StageRecord] = field(default_factory=list)

    @property
    def is_pass(self) -> bool:
        return self.result == 'PASS'


def _record(result: AutoResult, name: str, ok: bool, reason: str = '',
            **facts: object) -> None:
    result.stages.append(StageRecord(name=name, ok=ok, reason=reason, facts=facts))


def run_auto(
    repo: Path,
    *,
    work_branch: str,
    remote: str = 'origin',
    main_branch: str = 'main',
    do_sync: bool = True,
    do_publish: bool = True,
    emit: Callable[[str], None] = print,
    run_git: Callable[[list[str]], tuple[int, str]] | None = None,
    run_git_raw: Callable[[list[str]], tuple[int, bytes]] | None = None,
    allow_checkpoint: bool = False,
    expected_owner: str = DEFAULT_EXPECTED_OWNER,
    expected_repo: str = DEFAULT_EXPECTED_REPO,
    runner_factory: Callable[[Round], RoundRunner] | None = None,
    load_round: Callable[[], Round] = load_active_round,
) -> AutoResult:
    """Runs the whole pipeline with zero user interaction."""
    result = AutoResult()

    def say(line: str) -> None:
        emit(line)

    # -- 1. bootstrap ----------------------------------------------------
    say('== LIA DEVFLOW AUTO ==')
    _record(result, 'bootstrap', True)
    say(f'repositório: {repo}')

    # -- 2/3/4. sync, classification, checkpoint -------------------------
    sync = WorkBranchSync(
        repo, work_branch=work_branch, remote=remote, main_branch=main_branch,
        run_git=run_git, run_git_raw=run_git_raw,
        allow_checkpoint=allow_checkpoint,
        expected_owner=expected_owner, expected_repo=expected_repo,
    )
    if do_sync:
        say('etapa sync: buscando o branch de trabalho')
        outcome: SyncOutcome = sync.pre_sync()
        result.initial_head = outcome.facts.initial_head
        result.remote_head = outcome.facts.remote_head
        result.dirty_before = outcome.facts.dirty_before
        result.checkpoint = outcome.facts.checkpoint
        result.tested_head = outcome.facts.final_head
        for line in outcome.facts.notes:
            say(f'  {line}')
        _record(result, 'local_change_classification', outcome.stage != 'classify',
                outcome.reason, changes=outcome.facts.dirty_before)
        _record(result, 'checkpoint', outcome.stage != 'checkpoint', outcome.reason,
                sha=outcome.facts.checkpoint)
        _record(result, 'sync', outcome.ok, outcome.reason,
                updated=outcome.facts.updated, remote=outcome.facts.remote_head)
        result.sync_ok = outcome.ok
        if not outcome.ok:
            result.stage = outcome.stage
            result.reason = outcome.reason
            say(f'FALHA em {outcome.stage}: {outcome.reason}')
            say('Nenhuma recuperação destrutiva foi tentada.')
            return result
    else:
        _record(result, 'sync', True, 'sincronização desativada nesta invocação')
        result.sync_ok = True

    # -- 5. resolve the round AFTER the sync -----------------------------
    try:
        manifest = load_round()
    except RoundSchemaError as exc:
        _record(result, 'sync', False, str(exc))
        result.stage = 'bootstrap'
        result.reason = f'manifesto da rodada inválido: {exc}'
        return result
    result.round_id = manifest.id
    say(f'rodada ativa: {manifest.id} - {manifest.title}')

    # -- 6/7/8. tests, runtime, teardown ---------------------------------
    runner = (runner_factory or (lambda m: RoundRunner(round_manifest=m, repo=repo,
                                                       emit=say)))(manifest)
    round_outcome: RoundOutcome = runner.execute()
    result.tested_head = round_outcome.head_sha or result.tested_head
    result.dirty_after = round_outcome.dirty or 0
    result.tests_ok = bool(round_outcome.tests) and all(
        test.status == 'pass' for test in round_outcome.tests)
    # The cleanup verdict comes from teardown evidence only. The old version
    # derived it from the absence of the word 'recusada' in the notes and then
    # rendered `"PASS" if result.stage`, which is not a cleanup proof at all.
    result.cleanup_ok = round_outcome.tree_cleaned
    if round_outcome.launch_pid is None and not round_outcome.teardown:
        result.cleanup_state = 'N/A'
        result.cleanup_detail = 'nada foi lançado nesta rodada'
    else:
        result.cleanup_state = 'PASS' if round_outcome.tree_cleaned else 'FAIL'
        result.cleanup_detail = round_outcome.teardown_detail
    result.runtime_ok = round_outcome.is_pass
    result.report_path = str(round_outcome.artifacts.get('report', ''))
    _record(result, 'tests', result.tests_ok,
            '' if result.tests_ok else 'um teste obrigatório não passou',
            count=len(round_outcome.tests))
    terminal_missing = [marker.id for marker in manifest.runtime.terminal
                        if marker.id not in round_outcome.terminal_seen]
    _record(result, 'runtime', result.runtime_ok,
            '' if result.runtime_ok else f'verdicto {round_outcome.verdict}',
            verdict=round_outcome.verdict,
            terminal_missing=terminal_missing,
            forbidden=round_outcome.forbidden_seen)
    _record(result, 'teardown',
            result.cleanup_state in ('PASS', 'N/A'),
            result.cleanup_detail
            or ('a árvore owned não foi encerrada' if result.cleanup_state == 'FAIL' else ''),
            state=result.cleanup_state,
            descendants=round_outcome.teardown_descendants,
            pid=round_outcome.launch_pid)

    if not round_outcome.is_pass:
        result.result = 'FAIL'
        result.stage = round_outcome.stage or ('tests' if not result.tests_ok else 'runtime')
        # A refusal at prepare never launched anything: teardown was not
        # skipped, it was never applicable. Say so instead of printing FAIL.
        if result.cleanup_state == 'UNKNOWN':
            result.cleanup_state = 'N/A'
            result.cleanup_detail = result.cleanup_detail or 'nada foi lançado nesta rodada'
        refusal = next((note for note in round_outcome.notes
                        if 'RECUSADO' in note or 'recusada' in note), None)
        if not result.tests_ok:
            failed = [t.id for t in round_outcome.tests if t.status != 'pass']
            result.reason = f'teste(s) obrigatório(s) não passaram: {", ".join(failed)}'
        elif refusal:
            result.reason = refusal
        elif round_outcome.forbidden_seen:
            result.reason = ('marcador proibido observado: '
                             + ', '.join(round_outcome.forbidden_seen))
        elif terminal_missing:
            result.reason = ('evidência de runtime ausente: '
                             + ', '.join(terminal_missing))
        else:
            result.reason = f'o gate de runtime não provou o necessário ({round_outcome.verdict})'
        say('Nenhum commit local foi publicado: o gate não passou.')
        return result

    # -- 9. publish -------------------------------------------------------
    if not do_publish:
        result.publish = 'skipped'
        _record(result, 'publish', True, 'publicação desativada nesta invocação')
    elif not manifest.ready_for_publish:
        result.publish = 'skipped-by-round-policy'
        _record(result, 'publish', True,
                'round.ready_for_publish=false: nada é publicado por política')
    else:
        say('etapa publish: publicando exatamente o HEAD testado')
        pushed = sync.publish(result.tested_head)
        result.publish = 'ok' if pushed.ok else 'refused'
        result.pushed_head = pushed.facts.final_head if pushed.ok else None
        _record(result, 'publish', pushed.ok, pushed.reason, sha=result.pushed_head)
        if not pushed.ok:
            result.result = 'FAIL'
            result.stage = 'publish'
            result.reason = pushed.reason
            return result

    result.result = 'PASS'
    result.stage = 'publish'
    return result


# §J: the Push line must not imply that a PASS publishes source. M3.0b is not
# marked ready_for_publish, so the honest label is an explicit skip.
PUBLISH_LABELS = {
    'ok': 'PUSHED',
    'nothing-to-push': 'NOTHING TO PUSH',
    'skipped-by-round-policy': 'SKIPPED BY ROUND POLICY',
    'skipped': 'SKIPPED',
    'refused': 'REFUSED',
}


def render_final_block(result: AutoResult) -> str:
    """The §J console block: a verdict, no menu, no decision to make."""
    bar = '=' * 40
    round_id = result.round_id or '(não resolvida)'
    lines = [bar, 'LIA DEVFLOW', f'Round: {round_id}', f'Result: {result.result}']
    if result.result == 'PASS':
        lines += [
            f'SHA: {result.tested_head}',
            f'Sync: {"OK" if result.sync_ok else "FALHOU"}',
            f'Tests: {"PASS" if result.tests_ok else "FAIL"}',
            f'Runtime gate: {"PASS" if result.runtime_ok else "FAIL"}',
            f'Process cleanup: {result.cleanup_state}',
            f'Push: {PUBLISH_LABELS.get(result.publish, result.publish)}',
        ]
    else:
        lines += [
            f'Stage: {result.stage}',
            f'Reason: {result.reason}',
            'No destructive recovery was attempted.',
        ]
    if result.report_path:
        lines.append(f'Report: {result.report_path}')
    lines.append(bar)
    return '\n'.join(lines)
