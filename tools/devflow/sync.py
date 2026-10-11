"""
DevFlow: zero-choice Git synchronization.

The one-click contract means the user never opens a Git menu, so the policy has
to be deterministic instead of interactive. Three hard rules shape everything
here:

  * FAIL CLOSED beats guessing. An ambiguous local change, an unreachable
    remote, a divergence we cannot fast-forward and a rebase conflict all stop
    the round with a reason. Nothing is discarded, stashed or auto-resolved.
  * NEVER touch main, and never force anything.
  * Never auto-commit something that could be a secret, a generated artifact
    that belongs in .gitignore, a model weight, a huge binary or user data.

Local changes are CLASSIFIED, not assumed. Only paths that are unambiguously
project source, small, text-shaped and secret-free may become a local
checkpoint commit; everything else refuses the round.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import subprocess
from typing import Callable

DEFAULT_MAIN_BRANCH = 'main'
MAX_CHECKPOINT_BYTES = 5 * 1024 * 1024

# Paths that must never be committed automatically, whatever they contain.
FORBIDDEN_NAME_PARTS = (
    '.env', 'credential', 'secret', 'vault', 'id_rsa', 'id_ed25519', '.netrc',
    '.npmrc', '.pypirc', 'token', 'lia-product.json',
)
FORBIDDEN_SUFFIXES = (
    '.env', '.pem', '.key', '.crt', '.p12', '.pfx', '.keystore', '.jks',
    # model weights and opaque blobs
    '.safetensors', '.onnx', '.gguf', '.bin', '.pt', '.pth', '.ckpt', '.tflite',
    # media / archives / native binaries
    '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.mp4', '.mov', '.zip', '.7z',
    '.rar', '.tar', '.gz', '.exe', '.dll', '.so', '.dylib', '.node', '.wasm',
    '.db', '.sqlite', '.sqlite3',
)
# Only these roots are project source for checkpoint purposes. Anything else
# is "unknown classification" and refuses the round.
ALLOWED_SOURCE_ROOTS = ('tools/', 'docs/', 'airi/', 'Tests/', 'qa/', '.github/')
ALLOWED_SOURCE_SUFFIXES = (
    '.py', '.ts', '.tsx', '.vue', '.js', '.mjs', '.cjs', '.json', '.md', '.yml',
    '.yaml', '.txt', '.html', '.css', '.scss', '.bat', '.ps1', '.sh', '.toml',
    '.cfg', '.ini', '.gitignore',
)

CHECKPOINT_MESSAGE = 'dev: devflow checkpoint before round sync'

CONFIG_PATH = Path(__file__).resolve().parent / 'devflow-config.json'


@dataclass(frozen=True)
class DevflowConfig:
    """The target branch is CONFIGURED here, never guessed from the checkout."""

    work_branch: str
    remote: str = 'origin'
    main_branch: str = DEFAULT_MAIN_BRANCH


def load_devflow_config(path: Path = CONFIG_PATH) -> DevflowConfig:
    import json

    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise SyncRefused(f'não consegui ler a configuração do DevFlow em {path}: {exc}') from exc
    branch = str(data.get('work_branch', '')).strip()
    if not branch:
        raise SyncRefused('devflow-config.json: work_branch ausente; nada é adivinhado')
    main = str(data.get('main_branch', DEFAULT_MAIN_BRANCH)).strip() or DEFAULT_MAIN_BRANCH
    if branch == main:
        raise SyncRefused('devflow-config.json: work_branch não pode ser o branch main')
    return DevflowConfig(
        work_branch=branch,
        remote=str(data.get('remote', 'origin')).strip() or 'origin',
        main_branch=main,
    )


GitRunner = Callable[[list[str]], tuple[int, str]]


class SyncRefused(RuntimeError):
    """Synchronization could not proceed safely. Nothing was discarded."""


@dataclass
class ChangeClassification:
    """Why the working tree is (or is not) eligible for a local checkpoint."""

    kind: str  # 'clean' | 'safe' | 'blocked'
    reason: str = ''
    blocked: tuple[str, ...] = ()
    count: int = 0


@dataclass
class SyncFacts:
    branch: str = ''
    initial_head: str = ''
    remote_head: str | None = None
    final_head: str = ''
    checkpoint: str | None = None
    updated: bool = False
    dirty_before: int = 0
    dirty_after: int = 0
    notes: list[str] = field(default_factory=list)


@dataclass
class SyncOutcome:
    ok: bool
    stage: str  # 'identity' | 'classify' | 'checkpoint' | 'fetch' | 'rebase'
    reason: str
    facts: SyncFacts


def _git(repo: Path, args: list[str]) -> tuple[int, str]:
    probe = subprocess.run(
        ['git', *args], cwd=repo, capture_output=True, text=True,
        encoding='utf-8', errors='replace',
    )
    return probe.returncode, (probe.stdout or probe.stderr or '').strip()


def porcelain_paths(repo: Path, run_git: GitRunner | None = None) -> list[tuple[str, str]]:
    """(status, path) pairs for every non-ignored change, or [] when clean."""
    runner = run_git or (lambda args: _git(repo, args))
    code, out = runner(['status', '--porcelain'])
    if code != 0:
        raise SyncRefused(f'git status falhou: {out[:200]}')
    entries = []
    for line in out.splitlines():
        if len(line) < 4 or not line.strip():
            continue
        status, _, raw = line[:2], line[2], line[3:]
        path = raw.split(' -> ')[-1].strip().strip('"')
        entries.append((status.strip() or '?', path))
    return entries


def classify_path(path: str) -> tuple[bool, str]:
    """(allowed, reason). Deterministic, and deliberately conservative."""
    normalized = path.replace('\\', '/')
    lowered = normalized.lower()
    for part in FORBIDDEN_NAME_PARTS:
        if part in lowered:
            return False, f'caminho sensível ({part})'
    for suffix in FORBIDDEN_SUFFIXES:
        if lowered.endswith(suffix):
            return False, f'extensão não commitável automaticamente ({suffix})'
    if not normalized.startswith(ALLOWED_SOURCE_ROOTS):
        return False, 'fora das raízes de código do projeto (classificação desconhecida)'
    if not lowered.endswith(ALLOWED_SOURCE_SUFFIXES):
        return False, 'tipo de arquivo fora da política de código-fonte'
    return True, ''


def classify_changes(repo: Path, entries: list[tuple[str, str]],
                     max_bytes: int = MAX_CHECKPOINT_BYTES) -> ChangeClassification:
    if not entries:
        return ChangeClassification(kind='clean', count=0)
    blocked: list[str] = []
    for _status, path in entries:
        allowed, reason = classify_path(path)
        if not allowed:
            blocked.append(f'{path}: {reason}')
            continue
        absolute = repo / path
        try:
            if absolute.is_file() and absolute.stat().st_size > max_bytes:
                blocked.append(f'{path}: maior que {max_bytes} bytes')
        except OSError:
            blocked.append(f'{path}: não consegui inspecionar o tamanho')
    if blocked:
        return ChangeClassification(
            kind='blocked', count=len(entries),
            reason='; '.join(blocked[:8]) + ('…' if len(blocked) > 8 else ''),
            blocked=tuple(blocked),
        )
    return ChangeClassification(kind='safe', count=len(entries))


def _load_secret_scanner():
    """Reuse the universal DevKit secret scanner - no second, weaker regex."""
    import importlib.util

    candidate = Path(__file__).resolve().parents[1] / 'project_cli.py'
    spec = importlib.util.spec_from_file_location('devflow_sync_project_cli', candidate)
    if spec is None or spec.loader is None:
        raise SyncRefused(f'não consegui carregar o verificador de segredos em {candidate}')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.secret_in_text


SECRET_IN_TEXT = _load_secret_scanner()


def scan_for_secrets(repo: Path, entries: list[tuple[str, str]]) -> list[str]:
    hits: list[str] = []
    for _status, path in entries:
        absolute = repo / path
        if not absolute.is_file():
            continue
        try:
            text = absolute.read_text(encoding='utf-8', errors='replace')
        except OSError:
            hits.append(f'{path}: ilegível para verificação de segredos')
            continue
        if SECRET_IN_TEXT(text):
            hits.append(f'{path}: contém algo parecido com credencial')
    return hits


class WorkBranchSync:
    """
    Owns the whole pre-round synchronization, with no prompts anywhere.
    """

    def __init__(
        self,
        repo: Path,
        *,
        work_branch: str,
        remote: str = 'origin',
        main_branch: str = DEFAULT_MAIN_BRANCH,
        run_git: GitRunner | None = None,
        allow_checkpoint: bool = True,
    ) -> None:
        self.repo = repo
        self.work_branch = work_branch
        self.remote = remote
        self.main_branch = main_branch
        self.run_git = run_git or (lambda args: _git(repo, args))
        self.allow_checkpoint = allow_checkpoint

    # -- helpers --------------------------------------------------------
    def _git(self, args: list[str]) -> tuple[int, str]:
        return self.run_git(args)

    def _ref(self, revision: str) -> str:
        code, out = self._git(['rev-parse', revision])
        return out.strip() if code == 0 else ''

    # -- public API -----------------------------------------------------
    def identity(self) -> SyncFacts:
        """Proves this is the right repository on the right branch."""
        facts = SyncFacts()
        code, url = self._git(['remote', 'get-url', self.remote])
        if code != 0:
            raise SyncRefused(f'repositório sem remote {self.remote!r}: {url[:200]}')
        if 'Lia-Project' not in url:
            raise SyncRefused(f'repositório inesperado: remote {self.remote!r} = {url!r}')
        code, branch = self._git(['rev-parse', '--abbrev-ref', 'HEAD'])
        if code != 0:
            raise SyncRefused('não consegui descobrir o branch atual')
        branch = branch.strip()
        facts.branch = branch
        if branch == self.main_branch:
            raise SyncRefused(
                f'o branch atual é {self.main_branch!r}; o DevFlow nunca atualiza o main',
            )
        if branch != self.work_branch:
            raise SyncRefused(
                f'branch atual {branch!r} diferente do branch de trabalho {self.work_branch!r}',
            )
        facts.initial_head = self._ref('HEAD')
        facts.final_head = facts.initial_head
        return facts

    def pre_sync(self) -> SyncOutcome:
        """Fetch + rebase the work branch, checkpointing safe local work first."""
        facts = SyncFacts()
        try:
            facts = self.identity()
        except SyncRefused as exc:
            return SyncOutcome(ok=False, stage='identity', reason=str(exc), facts=facts)

        entries = porcelain_paths(self.repo, self.run_git)
        facts.dirty_before = len(entries)
        classification = classify_changes(self.repo, entries)
        facts.notes.append(
            f'alterações locais: {classification.count} ({classification.kind})',
        )

        if classification.kind == 'blocked':
            return SyncOutcome(
                ok=False, stage='classify', facts=facts,
                reason=f'alterações locais não commitáveis automaticamente: {classification.reason}',
            )

        if classification.kind == 'safe':
            secret_hits = scan_for_secrets(self.repo, entries)
            if secret_hits:
                return SyncOutcome(
                    ok=False, stage='classify', facts=facts,
                    reason='verificação de segredos bloqueou o checkpoint: '
                           + '; '.join(secret_hits[:5]),
                )
            if not self.allow_checkpoint:
                return SyncOutcome(
                    ok=False, stage='classify', facts=facts,
                    reason='checkpoint local desativado e há alterações não commitadas',
                )
            code, out = self._git(['add', '-A'])
            if code != 0:
                return SyncOutcome(ok=False, stage='checkpoint', facts=facts,
                                   reason=f'git add falhou: {out[:200]}')
            code, out = self._git(['commit', '-m', CHECKPOINT_MESSAGE])
            if code != 0:
                return SyncOutcome(ok=False, stage='checkpoint', facts=facts,
                                   reason=f'git commit falhou: {out[:200]}')
            facts.checkpoint = self._ref('HEAD')
            facts.final_head = facts.checkpoint
            facts.notes.append(f'checkpoint local criado: {facts.checkpoint[:12]}')

        code, out = self._git(['fetch', self.remote, self.work_branch])
        if code != 0:
            return SyncOutcome(
                ok=False, stage='fetch', facts=facts,
                reason=f'remote indisponível ou branch inexistente: {out[:200]}',
            )
        remote_ref = f'{self.remote}/{self.work_branch}'
        facts.remote_head = self._ref(remote_ref) or None
        if not facts.remote_head:
            return SyncOutcome(ok=False, stage='fetch', facts=facts,
                               reason=f'não consegui resolver {remote_ref}')

        local = self._ref('HEAD')
        if local == facts.remote_head:
            facts.notes.append('já estava atualizado')
            return SyncOutcome(ok=True, stage='rebase', reason='', facts=facts)

        code, out = self._git(['rebase', remote_ref])
        if code != 0:
            # Leave the tree exactly as it was. Aborting is the inverse of the
            # rebase, never a resolution and never a discard of user work.
            self._git(['rebase', '--abort'])
            return SyncOutcome(
                ok=False, stage='rebase', facts=facts,
                reason=f'rebase conflitou; nada foi resolvido automaticamente: {out[:200]}',
            )
        facts.updated = True
        facts.final_head = self._ref('HEAD')
        facts.dirty_after = len(porcelain_paths(self.repo, self.run_git))
        facts.notes.append(f'atualizado {local[:12]} -> {facts.final_head[:12]}')
        return SyncOutcome(ok=True, stage='rebase', reason='', facts=facts)

    def publish(self, tested_head: str) -> SyncOutcome:
        """
        Push the EXACT tested HEAD. Anything else refuses.

        A gate result belongs to one commit. If the remote moved, or the local
        HEAD is no longer the tested one, this refuses instead of pushing
        something nobody validated.
        """
        facts = SyncFacts()
        try:
            facts = self.identity()
        except SyncRefused as exc:
            return SyncOutcome(ok=False, stage='identity', reason=str(exc), facts=facts)

        current = self._ref('HEAD')
        if current != tested_head:
            return SyncOutcome(
                ok=False, stage='publish', facts=facts,
                reason=f'HEAD atual {current[:12]} não é o HEAD testado {tested_head[:12]}',
            )
        if len(porcelain_paths(self.repo, self.run_git)):
            return SyncOutcome(
                ok=False, stage='publish', facts=facts,
                reason='o checkout não está limpo; um push precisa descrever um commit exato',
            )

        code, out = self._git(['fetch', self.remote, self.work_branch])
        if code != 0:
            return SyncOutcome(ok=False, stage='fetch', facts=facts,
                               reason=f'remote indisponível: {out[:200]}')
        remote_ref = f'{self.remote}/{self.work_branch}'
        facts.remote_head = self._ref(remote_ref) or None
        if facts.remote_head and facts.remote_head != current:
            return SyncOutcome(
                ok=False, stage='publish', facts=facts,
                reason=f'o remote avançou para {facts.remote_head[:12]} depois do gate; '
                       'revalide antes de publicar',
            )

        code, out = self._git(['push', self.remote, f'HEAD:{self.work_branch}'])
        if code != 0:
            return SyncOutcome(ok=False, stage='publish', facts=facts,
                               reason=f'push recusado: {out[:200]}')
        facts.final_head = self._ref('HEAD')
        facts.notes.append(f'publicado em {self.remote}/{self.work_branch}')
        return SyncOutcome(ok=True, stage='publish', reason='', facts=facts)
