#!/usr/bin/env python3
"""
DevKit Lia - camada de orquestração por rodada (Phase DEVFLOW-D1).

Ponto de entrada humano: dê dois cliques em `DevKit.bat` na raiz e escolha
"Executar rodada atual". Você não precisa lembrar comandos Git, pré-requisitos
de build, comandos de teste nem o gate manual da rodada: tudo isso vem do
manifesto machine-readable em `tools/devflow/rounds/`.

Este módulo NÃO contém o gate em si - ele apenas carrega a rodada ativa e a
entrega ao runner. A lógica vive em `tools/devflow/` para ser testável sem
Windows, sem Electron e sem operador.

Fronteiras: nada aqui muta o Git. Publicar continua no DevKit universal e é
assunto do D2.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from devflow.runner import RoundRunner, default_spawner, latest_run, pass_validity  # noqa: E402
from devflow.schema import (  # noqa: E402
    Round,
    RoundSchemaError,
    active_round_id,
    load_active_round,
    load_round_file,
)
from devflow.safe_paths import PathSafetyError, repo_root  # noqa: E402


def _fail(message: str) -> int:
    print(f'ERRO: {message}')
    return 1


def cmd_round(args: argparse.Namespace) -> int:
    """Executa a rodada ativa de ponta a ponta e grava os artefatos."""
    try:
        manifest = load_active_round()
    except RoundSchemaError as exc:
        return _fail(str(exc))
    runner = RoundRunner(round_manifest=manifest, repo=repo_root())
    try:
        outcome = runner.execute()
    except PathSafetyError as exc:
        return _fail(f'limpeza recusada: {exc}')
    if outcome.artifacts.get('report'):
        print(f'relatório: {outcome.artifacts["report"]}')
    print(f'verdicto: {outcome.verdict}')
    return 0 if outcome.is_pass else 1


def cmd_status(_args: argparse.Namespace) -> int:
    """Mostra a rodada ativa e se o último PASS ainda vale para o HEAD atual."""
    repo = repo_root()
    try:
        manifest = load_active_round()
    except RoundSchemaError as exc:
        return _fail(str(exc))

    branch = _git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
    head = _git(repo, ['rev-parse', 'HEAD'])
    print('== Rodada ativa ==')
    print(f'  id            : {manifest.id}')
    print(f'  título        : {manifest.title}')
    print(f'  fase          : {manifest.phase}')
    print(f'  branch esperada: {manifest.expected_branch}')
    print(f'  pronta p/ publicar: {str(manifest.ready_for_publish).lower()}')
    print(f'  SHA testado   : {manifest.tested_sha or "(nenhum registrado)"}')
    print(f'  manifesto     : {manifest.source.name}')
    print(f'  limpeza       : {manifest.cleanup.id} -> {list(manifest.cleanup.allowlisted_generated)}')

    print('== Repositório ==')
    print(f'  branch        : {branch}')
    print(f'  HEAD          : {head}')
    if branch != manifest.expected_branch:
        print(f'  ATENÇÃO       : branch diferente da esperada; a rodada seria RECUSADA')

    last = latest_run(repo)
    print('== Última execução registrada ==')
    if not last:
        print('  nenhuma. Rode "Executar rodada atual".')
        return 0
    recorded = last.get('git', {}).get('head_sha', '')
    validity = pass_validity(recorded, head)
    print(f'  rodada        : {last.get("round", {}).get("id")}')
    print(f'  veredito      : {last.get("verdict")}')
    print(f'  SHA registrado: {recorded}')
    print(f'  validade      : {validity}')
    dirty_now = len([x for x in _git(repo, ['status', '--porcelain']).splitlines() if x.strip()])
    if validity == 'current' and dirty_now:
        print(f'  ATENÇÃO       : o checkout atual tem {dirty_now} alteração(ões) não commitada(s).')
        print('                  Um PASS descreve um checkout EXATO; este não é "validado atual".')
        validity = 'dirty'
    if validity == 'stale':
        print('  ATENÇÃO       : o HEAD mudou desde aquela execução.')
        print('                  Um PASS anterior NÃO vale mais para este código; rode a rodada de novo.')
    elif last.get('verdict') == 'PASS' and validity == 'current':
        print('  o PASS registrado corresponde ao HEAD atual.')
    return 0


def cmd_open(_args: argparse.Namespace) -> int:
    """Abre o Lia pelo caminho canônico, sem gate (uso casual)."""
    repo = repo_root()
    try:
        manifest = load_active_round()
        command = list(manifest.launch.command)
    except RoundSchemaError:
        command = ['Lia.bat']
    launcher = repo / command[0]
    if not launcher.exists():
        return _fail(f'{command[0]} não encontrado na raiz do repositório')
    print(f'Abrindo o Lia via {" ".join(command)} (Ctrl+C para fechar)...')
    handle = default_spawner(command, repo, lambda line: print(line, end=''))
    try:
        while True:
            code = handle.wait(1.0)
            if code is not None:
                print(f'Lia terminou com código {code}.')
                return 0 if code == 0 else 1
    except KeyboardInterrupt:
        handle.terminate()
        print('\nInterrompido. O Launcher foi encerrado.')
        return 130


def cmd_diagnose(_args: argparse.Namespace) -> int:
    """Fatos do ambiente - só metadados, nenhum segredo."""
    repo = repo_root()
    print('== Diagnóstico ==')
    print(f'  raiz do repo  : {repo}')
    print(f'  python        : {sys.version.split()[0]} ({sys.executable})')
    for tool in ('git', 'node', 'pnpm', 'corepack'):
        path = shutil.which(tool)
        print(f'  {tool:<14}: {"OK" if path else "AUSENTE"}')
    print(f'  branch        : {_git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])}')
    print(f'  HEAD          : {_git(repo, ["rev-parse", "HEAD"])}')
    print(f'  não commitadas: {len([x for x in _git(repo, ["status", "--porcelain"]).splitlines() if x.strip()])}')
    dist = repo / 'airi' / 'packages' / 'core-agent' / 'dist'
    print(f'  core-agent/dist: {"presente (gerado)" if dist.exists() else "ausente - a rodada o reconstrói"}')
    node_modules = repo / 'airi' / 'node_modules'
    print(f'  airi/node_modules: {"presente" if node_modules.is_dir() else "AUSENTE - rode pnpm install em airi/"}')
    try:
        print(f'  rodada ativa  : {active_round_id()}')
    except RoundSchemaError as exc:
        print(f'  rodada ativa  : ERRO - {exc}')
    return 0


def cmd_rounds(_args: argparse.Namespace) -> int:
    """Lista as rodadas disponíveis e marca a ativa."""
    from devflow.schema import ROUNDS_DIR

    try:
        current = active_round_id()
    except RoundSchemaError as exc:
        return _fail(str(exc))
    print('== Rodadas ==')
    for path in sorted(ROUNDS_DIR.glob('*.json')):
        try:
            manifest: Round = load_round_file(path)
        except RoundSchemaError as exc:
            print(f'  {path.name}: INVÁLIDA ({exc})')
            continue
        flag = 'ATIVA ' if manifest.id == current else '      '
        publish = 'pronta p/ publicar' if manifest.ready_for_publish else 'não publica'
        print(f'  [{flag}] {manifest.id:<8} {manifest.title} ({publish})')
    return 0


def cmd_menu(_args: argparse.Namespace) -> int:
    """Menu Lia no DevKit.bat. A ação primária é executar a rodada atual."""
    try:
        manifest = load_active_round()
        active = f'{manifest.id} - {manifest.title}'
    except RoundSchemaError as exc:
        active = f'(indisponível: {exc})'
    while True:
        print('')
        print('DevKit Lia - desenvolvimento por rodada')
        print(f'  rodada ativa: {active}')
        print('  1) Executar rodada atual')
        print('  2) Abrir Lia normalmente')
        print('  3) Mostrar rodada / estado atual')
        print('  4) Diagnóstico do ambiente')
        print('  5) Listar rodadas')
        print('  6) DevKit universal (Git)  [futuro/D2: consolidação de publish]')
        print('  0) Sair')
        try:
            choice = input('Escolha: ').strip()
        except (EOFError, KeyboardInterrupt):
            print('')
            return 0
        if choice == '1':
            cmd_round(argparse.Namespace())
        elif choice == '2':
            cmd_open(argparse.Namespace())
        elif choice == '3':
            cmd_status(argparse.Namespace())
        elif choice == '4':
            cmd_diagnose(argparse.Namespace())
        elif choice == '5':
            cmd_rounds(argparse.Namespace())
        elif choice == '6':
            _universal_devkit()
        elif choice == '0':
            return 0
        else:
            print('Opção inválida.')
        input('\nPressione ENTER para voltar ao menu...')


def _universal_devkit() -> None:
    """Encaminha para o DevKit universal (primitivas Git seguras)."""
    cli = Path(__file__).resolve().parent / 'project_cli.py'
    try:
        subprocess.run([sys.executable, str(cli)], check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f'Não consegui abrir o DevKit universal: {exc}')


def _git(repo: Path, args: list[str]) -> str:
    try:
        from devflow.sync import git_executable

        probe = subprocess.run([git_executable(), *args], cwd=repo,
                               capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return ''
    return (probe.stdout or '').strip()


def cmd_bootstrap(_args: argparse.Namespace) -> int:
    """
    Atualiza o branch de trabalho PRIMEIRO e só depois roda o DevFlow.

    O processo atual importa apenas o módulo de sincronização; a rodada em si é
    executada por um processo NOVO, lançado depois do sync. É isso que garante
    que o código que avalia o gate é o recém-atualizado, e não uma mistura de
    módulos antigos já importados com novos.
    """
    from devflow.pipeline import AutoResult, render_final_block
    from devflow.sync import SyncRefused, WorkBranchSync, load_devflow_config

    print('== LIA DEVFLOW BOOTSTRAP ==')
    try:
        config = load_devflow_config()
    except SyncRefused as exc:
        print(render_final_block(AutoResult(stage='bootstrap', reason=str(exc))))
        return 1
    print(f'branch de trabalho: {config.work_branch} (configurado, não adivinhado)')
    sync = WorkBranchSync(
        repo_root(), work_branch=config.work_branch, remote=config.remote,
        main_branch=config.main_branch,
        allow_checkpoint=config.allow_checkpoint,
        expected_owner=config.expected_owner, expected_repo=config.expected_repo,
    )
    outcome = sync.pre_sync()
    for line in outcome.facts.notes:
        print(f'  {line}')
    if not outcome.ok:
        result = AutoResult(
            stage=outcome.stage, reason=outcome.reason,
            initial_head=outcome.facts.initial_head,
            remote_head=outcome.facts.remote_head,
        )
        print()
        print(render_final_block(result))
        return 1
    print(f'checkout pronto em {outcome.facts.final_head[:12]}; executando o DevFlow atualizado')
    # Fresh interpreter, fresh imports: the gate is evaluated by the code that
    # was just fetched, never by this process's already-imported modules.
    probe = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), 'auto', '--post-sync'],
        cwd=repo_root(),
    )
    return probe.returncode


def cmd_auto(args: argparse.Namespace) -> int:
    """
    O modo padrão: ZERO escolha. Sincroniza, resolve a rodada ativa, limpa,
    testa, lança o gate de runtime sozinho, encerra a árvore que criou,
    publica se a política permitir e imprime um veredito. Nenhum input().
    """
    from devflow.pipeline import render_final_block, run_auto
    from devflow.sync import SyncRefused, load_devflow_config

    try:
        config = load_devflow_config()
    except SyncRefused as exc:
        return _fail(str(exc))
    result = run_auto(
        repo_root(),
        work_branch=config.work_branch,
        remote=config.remote,
        main_branch=config.main_branch,
        do_sync=not (getattr(args, 'no_sync', False) or getattr(args, 'post_sync', False)),
        do_publish=not getattr(args, 'no_publish', False),
        allow_checkpoint=config.allow_checkpoint,
        expected_owner=config.expected_owner,
        expected_repo=config.expected_repo,
    )
    print()
    print(render_final_block(result))
    return 0 if result.is_pass else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='lia_dev', description='DevKit Lia por rodada')
    sub = parser.add_subparsers(dest='cmd')
    auto = sub.add_parser('auto', help='piloto automático sem nenhuma escolha (padrão)')
    auto.add_argument('--no-sync', action='store_true',
                      help='não sincroniza com o remote (avançado)')
    auto.add_argument('--no-publish', action='store_true',
                      help='não publica ao final (avançado)')
    auto.add_argument('--post-sync', action='store_true',
                      help='uso interno: o bootstrap já sincronizou este checkout')
    sub.add_parser('bootstrap', help='uso interno: sincroniza e reexecuta o auto')
    universal = sub.add_parser(
        'git', help='DevKit universal (publish, pull, validate, ...)',
    )
    # REMAINDER keeps the user's own quoting intact; `git` is dropped in Python.
    universal.add_argument('rest', nargs=argparse.REMAINDER)
    sub.add_parser('menu', help='menu interativo (avançado)')
    sub.add_parser('round', help='executa a rodada ativa')
    sub.add_parser('status', help='rodada ativa + validade do último PASS')
    sub.add_parser('open', help='abre o Lia normalmente, sem gate')
    sub.add_parser('diagnose', help='fatos do ambiente')
    sub.add_parser('rounds', help='lista as rodadas')
    return parser


def git_forward_argv(rest: list[str]) -> list[str]:
    """
    The argv for the universal DevKit, with the leading `git` token dropped.

    This exists because `DevKit.bat` must not use SHIFT: in cmd.exe SHIFT does
    not rewrite `%*`, so `DevKit.bat git publish` would forward the token `git`
    along with the real subcommand. The .bat therefore passes its argument line
    through untouched and the token is dropped HERE, where it is testable and
    where quoting is already parsed by Python.
    """
    forwarded = list(rest)
    if forwarded and forwarded[0] == 'git':
        forwarded.pop(0)
    return forwarded


def cmd_git(args: argparse.Namespace) -> int:
    """`DevKit.bat git <sub>` -> tools/project_cli.py <sub>, sem o token 'git'."""
    forwarded = git_forward_argv(list(getattr(args, 'rest', []) or []))
    if not forwarded:
        print('uso: DevKit.bat git <subcomando> [args]')
        print('subcomandos: publish, pull, validate, branches, checkout, '
              'new-branch, create-repo, resume-repo, pr, diagnose, kokoro-smoke')
        return 2
    probe = subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parent / 'project_cli.py'),
         *forwarded],
        cwd=repo_root(),
    )
    return probe.returncode


HANDLERS = {
    'git': cmd_git,
    'bootstrap': cmd_bootstrap,
    'auto': cmd_auto,
    'round': cmd_round,
    'status': cmd_status,
    'open': cmd_open,
    'diagnose': cmd_diagnose,
    'rounds': cmd_rounds,
    'menu': cmd_menu,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # DOUBLE-CLICK / no arguments means AUTO. The menu is advanced-only now.
    handler = HANDLERS.get(args.cmd or 'auto', cmd_auto)
    try:
        return handler(args)
    except KeyboardInterrupt:
        print('\nInterrompido. Nada foi limpo nem commitado automaticamente.')
        return 130


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(errors='replace')
    raise SystemExit(main())
