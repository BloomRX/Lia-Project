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
import os
import re
import subprocess
from typing import Callable

DEFAULT_MAIN_BRANCH = 'main'
MAX_CHECKPOINT_BYTES = 5 * 1024 * 1024

# The repository identity is PINNED, not matched by substring. A substring
# check accepts any host or owner that happens to contain 'Lia-Project', which
# is not identity verification at all.
EXPECTED_HOST = 'github.com'
DEFAULT_EXPECTED_OWNER = 'BloomRX'
DEFAULT_EXPECTED_REPO = 'Lia-Project'

# An absolute git executable, for callers that must work with a minimal PATH.
# CreateProcess only ever appends '.exe' - it does not consult PATHEXT - so a
# `git.cmd` shim is NOT reachable from subprocess(['git'], shell=False).
GIT_EXECUTABLE_ENV = 'LIA_DEVFLOW_GIT'

_URL_WITH_SCHEME = re.compile(
    r'^(?P<scheme>[A-Za-z][A-Za-z0-9+.-]*)://'
    r'(?P<auth>[^/@]*@)?(?P<host>[^/:?#]+)(?::\d+)?/(?P<path>.*)$',
)
_URL_SCP_LIKE = re.compile(r'^(?P<user>[^@/:\s]+)@(?P<host>[^/:\s]+):(?P<path>.+)$')
_CREDENTIALS_IN_URL = re.compile(r'://[^/@\s]*@')

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
    expected_owner: str = DEFAULT_EXPECTED_OWNER
    expected_repo: str = DEFAULT_EXPECTED_REPO
    # Off by default: for the first managed M3.0b run a CLEAN checkout is the
    # contract. The hardened checkpoint path below is implemented and tested,
    # but it only runs when it is explicitly switched on.
    allow_checkpoint: bool = False


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
    owner = str(data.get('expected_owner', DEFAULT_EXPECTED_OWNER)).strip()
    repo = str(data.get('expected_repo', DEFAULT_EXPECTED_REPO)).strip()
    if not owner or not repo:
        raise SyncRefused(
            'devflow-config.json: expected_owner/expected_repo vazios; '
            'a identidade do repositório não é adivinhada',
        )
    flag = data.get('allow_checkpoint', False)
    if not isinstance(flag, bool):
        raise SyncRefused('devflow-config.json: allow_checkpoint precisa ser booleano')
    return DevflowConfig(
        work_branch=branch,
        remote=str(data.get('remote', 'origin')).strip() or 'origin',
        main_branch=main,
        expected_owner=owner,
        expected_repo=repo,
        allow_checkpoint=flag,
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


def git_executable(env: dict[str, str] | None = None) -> str:
    """
    The git executable to invoke.

    `LIA_DEVFLOW_GIT` carries an ABSOLUTE path. It exists because the minimum-PATH
    self-test has to hide the POSIX tools from Git's `usr/bin` without breaking
    Git itself, and on Windows `CreateProcess` only ever appends `.exe` - it does
    not consult PATHEXT - so a `git.cmd` shim is unreachable from
    `subprocess(['git'], shell=False)`.
    """
    source = os.environ if env is None else env
    configured = (source.get(GIT_EXECUTABLE_ENV) or '').strip()
    return configured or 'git'


def _git(repo: Path, args: list[str]) -> tuple[int, str]:
    probe = subprocess.run(
        [git_executable(), *args], cwd=repo, capture_output=True, text=True,
        encoding='utf-8', errors='replace',
    )
    return probe.returncode, (probe.stdout or probe.stderr or '').strip()


def _git_raw(repo: Path, args: list[str]) -> tuple[int, bytes]:
    """Raw bytes, for `-z` output that must never be re-encoded by git."""
    probe = subprocess.run(
        [git_executable(), *args], cwd=repo, capture_output=True,
    )
    return probe.returncode, probe.stdout or b''


def redact_url(url: str) -> str:
    """Strips `user:token@` so a remote URL can never leak credentials."""
    return _CREDENTIALS_IN_URL.sub('://***@', url)


def normalize_remote_url(url: str) -> tuple[str, str] | None:
    """
    (owner, repo) for the pinned host, or None for anything else.

    Accepts the canonical GitHub HTTPS and SSH spellings and rejects every
    other host, owner and repository. Lookalike hosts are rejected because the
    authority is compared exactly, not searched for.
    """
    candidate = url.strip()
    if not candidate:
        return None
    match = _URL_WITH_SCHEME.match(candidate)
    if match:
        host, path = match.group('host').lower(), match.group('path')
    else:
        match = _URL_SCP_LIKE.match(candidate)
        if not match:
            return None
        host, path = match.group('host').lower(), match.group('path')
    if host != EXPECTED_HOST:
        return None
    parts = [part for part in path.split('/') if part]
    if len(parts) != 2:
        return None
    owner, repo = parts
    if repo.endswith('.git'):
        repo = repo[:-4]
    if not owner or not repo:
        return None
    return owner, repo


RawGitRunner = Callable[[list[str]], tuple[int, bytes]]

# Modes a checkpoint may contain. Anything else - a symlink (120000) or a
# submodule (160000) - is refused rather than interpreted.
REGULAR_FILE_MODES = frozenset({'100644', '100755'})


def _parse_porcelain_z(payload: bytes) -> list[tuple[str, str]]:
    """
    Parses `git status --porcelain -z`.

    `-z` is not cosmetic: without it git quotes any path containing a space or
    a non-ASCII byte and writes octal escapes, so the string we classify would
    not be the path on disk. `-z` gives raw bytes and one NUL per record.
    Renames, copies and unmerged paths are REFUSED, not guessed: a rename has
    two paths and the old one matters as much as the new one.
    """
    records = payload.split(b'\0')
    if records and records[-1] == b'':
        records.pop()
    entries: list[tuple[str, str]] = []
    index = 0
    while index < len(records):
        record = records[index]
        if len(record) < 4 or record[2:3] != b' ':
            raise SyncRefused('git status -z devolveu um registro malformado')
        status = record[:2].decode('ascii', 'replace')
        if 'R' in status or 'C' in status:
            raise SyncRefused(
                'renomeação ou cópia não é commitada automaticamente: '
                'os dois caminhos teriam de ser revisados',
            )
        if 'U' in status or status in ('AA', 'DD'):
            raise SyncRefused('caminho em conflito não é commitado automaticamente')
        try:
            path = record[3:].decode('utf-8')
        except UnicodeDecodeError as exc:
            raise SyncRefused('git devolveu um caminho que não é UTF-8; nada é adivinhado') from exc
        entries.append((status.strip() or '?', path))
        index += 1
    return entries


def _split_z(payload: bytes) -> list[str]:
    records = payload.split(b'\0')
    if records and records[-1] == b'':
        records.pop()
    out = []
    for record in records:
        try:
            out.append(record.decode('utf-8'))
        except UnicodeDecodeError as exc:
            raise SyncRefused('git devolveu um caminho que não é UTF-8; nada é adivinhado') from exc
    return out


def validate_local_path(repo: Path, path: str) -> None:
    """
    Refuses any path that is not an ordinary regular file inside the repo.

    Absolute paths, `..` escapes, symlink/reparse escapes and non-regular files
    are all refused BEFORE anything is staged.
    """
    if not path:
        raise SyncRefused('git devolveu um caminho vazio')
    if path.startswith('/') or path.startswith('~') or path.startswith('\\'):
        raise SyncRefused(f'caminho absoluto ou de home não é aceito: {path!r}')
    parts = path.replace('\\', '/').split('/')
    if any(part in ('', '..', '.') for part in parts):
        raise SyncRefused(f'caminho com componente vazio ou de subida: {path!r}')
    root = repo.resolve()
    full = (repo / path)
    try:
        resolved = full.resolve()
    except (OSError, ValueError) as exc:
        raise SyncRefused(f'caminho não resolve dentro do repositório: {path!r}') from exc
    if resolved != root and root not in resolved.parents:
        raise SyncRefused(f'caminho escapa do repositório (symlink/reparse): {path!r}')
    if full.is_symlink():
        raise SyncRefused(f'symlink não é commitado automaticamente: {path!r}')
    if full.exists() and not full.is_file():
        raise SyncRefused(f'não é um arquivo regular: {path!r}')


def porcelain_paths(
    repo: Path,
    run_git: GitRunner | None = None,
    run_git_raw: RawGitRunner | None = None,
) -> list[tuple[str, str]]:
    """(status, path) pairs for every non-ignored change, or [] when clean."""
    if run_git_raw is None:
        if run_git is not None:
            code, out = run_git(['status', '--porcelain', '-z', '-uall'])
            if code != 0:
                raise SyncRefused(f'git status falhou: {out[:200]}')
            payload = out.encode('utf-8')
        else:
            code, payload = _git_raw(repo, ['status', '--porcelain', '-z', '-uall'])
            if code != 0:
                raise SyncRefused(f'git status falhou: {payload[:200]!r}')
    else:
        code, payload = run_git_raw(['status', '--porcelain', '-z', '-uall'])
        if code != 0:
            raise SyncRefused(f'git status falhou: {payload[:200]!r}')
    entries = _parse_porcelain_z(payload)
    for _status, path in entries:
        validate_local_path(repo, path)
    return entries


def staged_index_entries(repo: Path, paths: list[str],
                         run_git_raw: RawGitRunner | None = None) -> list[tuple[str, str, str]]:
    """(mode, blob_sha, path) for what is actually in the index."""
    runner = run_git_raw or (lambda args: _git_raw(repo, args))
    code, payload = runner(['ls-files', '-s', '-z', '--', *paths])
    if code != 0:
        raise SyncRefused(f'git ls-files falhou: {payload[:200]!r}')
    out = []
    for record in _split_z(payload):
        head, _, path = record.partition('\t')
        fields = head.split()
        if len(fields) != 3:
            raise SyncRefused(f'git ls-files devolveu um registro malformado: {record[:80]!r}')
        out.append((fields[0], fields[1], path))
    return out


def staged_paths(repo: Path, run_git_raw: RawGitRunner | None = None) -> list[str]:
    """Every path currently staged against HEAD."""
    runner = run_git_raw or (lambda args: _git_raw(repo, args))
    code, payload = runner(['diff', '--cached', '--name-only', '-z'])
    if code != 0:
        raise SyncRefused(f'git diff --cached falhou: {payload[:200]!r}')
    return _split_z(payload)


def staged_blob(repo: Path, blob_sha: str,
                run_git_raw: RawGitRunner | None = None) -> bytes:
    """The bytes that would actually be committed, read from the index object."""
    runner = run_git_raw or (lambda args: _git_raw(repo, args))
    code, payload = runner(['cat-file', 'blob', blob_sha])
    if code != 0:
        raise SyncRefused(f'não consegui ler o blob {blob_sha[:12]} do índice')
    return payload


def worktree_hash(repo: Path, path: str) -> str:
    """Hash of the working-tree file, to compare against the staged blob."""
    code, out = _git(repo, ['hash-object', '--', path])
    if code != 0:
        raise SyncRefused(f'git hash-object falhou para {path!r}: {out[:160]}')
    return out.strip()


def scan_payload_for_secrets(payload: list[tuple[str, bytes]],
                             max_bytes: int = MAX_CHECKPOINT_BYTES) -> list[str]:
    """Secret + size checks over the EFFECTIVE payload, not the file on disk."""
    hits: list[str] = []
    for path, blob in payload:
        if len(blob) > max_bytes:
            hits.append(f'{path}: {len(blob)} bytes acima do limite de {max_bytes}')
            continue
        if SECRET_IN_TEXT(blob.decode('utf-8', errors='replace')):
            hits.append(f'{path}: contém algo parecido com credencial')
    return hits


def verify_staged_payload(repo: Path, approved: list[str],
                          run_git_raw: RawGitRunner | None = None) -> tuple[list[str], list[str]]:
    """
    Proves the index holds exactly the approved paths, with regular-file modes,
    blob content equal to the working tree, and no secret or oversize payload.

    Returns (staged_paths, secret_hits). Raises SyncRefused on any ambiguity.
    """
    approved_set = set(approved)
    staged = staged_paths(repo, run_git_raw)
    extra = sorted(set(staged) - approved_set)
    if extra:
        raise SyncRefused(
            'o índice contém caminhos não aprovados: ' + ', '.join(extra[:5]),
        )
    missing = sorted(approved_set - set(staged))
    if missing:
        raise SyncRefused(
            'caminhos aprovados não foram stageados: ' + ', '.join(missing[:5]),
        )
    entries = staged_index_entries(repo, staged, run_git_raw)
    if len(entries) != len(staged):
        raise SyncRefused('git ls-files e git diff --cached discordam sobre o índice')
    payload: list[tuple[str, bytes]] = []
    for mode, blob_sha, path in entries:
        if mode not in REGULAR_FILE_MODES:
            raise SyncRefused(f'{path}: modo {mode} não é um arquivo regular')
        if worktree_hash(repo, path) != blob_sha:
            raise SyncRefused(
                f'{path}: o conteúdo stageado difere do working tree; '
                'nada é commitado a partir de uma dúvida',
            )
        payload.append((path, staged_blob(repo, blob_sha, run_git_raw)))
    return staged, scan_payload_for_secrets(payload)


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
        run_git_raw: RawGitRunner | None = None,
        allow_checkpoint: bool = False,
        expected_owner: str = DEFAULT_EXPECTED_OWNER,
        expected_repo: str = DEFAULT_EXPECTED_REPO,
    ) -> None:
        self.repo = repo
        self.work_branch = work_branch
        self.remote = remote
        self.main_branch = main_branch
        self.run_git = run_git or (lambda args: _git(repo, args))
        if run_git_raw is not None:
            self.run_git_raw = run_git_raw
        elif run_git is not None:
            # Derive the raw runner from the injected text runner so a single
            # fake git can answer both shapes and the two cannot disagree.
            def _adapt(args: list[str]) -> tuple[int, bytes]:
                code, out = run_git(args)
                return code, out.encode('utf-8')

            self.run_git_raw = _adapt
        else:
            self.run_git_raw = lambda args: _git_raw(repo, args)
        self.allow_checkpoint = allow_checkpoint
        self.expected_owner = expected_owner
        self.expected_repo = expected_repo

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
            raise SyncRefused(
                f'repositório sem remote {self.remote!r}: {redact_url(url)[:200]}',
            )
        # PINNED identity. A substring match on 'Lia-Project' would accept any
        # host or owner containing it, which is not identity verification.
        parsed = normalize_remote_url(url)
        wanted = (self.expected_owner, self.expected_repo)
        if parsed != wanted:
            shown = f'{parsed[0]}/{parsed[1]}' if parsed else 'irreconhecível'
            raise SyncRefused(
                f'repositório inesperado: remote {self.remote!r} aponta para '
                f'{shown}, esperado {wanted[0]}/{wanted[1]} '
                f'({redact_url(url)[:160]})',
            )
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

        entries = porcelain_paths(self.repo, self.run_git, self.run_git_raw)
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
            approved = sorted(path for _status, path in entries)
            for path in approved:
                validate_local_path(self.repo, path)
            # NEVER `git add -A`: that would stage the whole checkout, not the
            # paths classification actually reviewed. `--` also stops a path
            # that looks like an option from being parsed as one.
            code, out = self._git(['add', '--', *approved])
            if code != 0:
                return SyncOutcome(ok=False, stage='checkpoint', facts=facts,
                                   reason=f'git add falhou: {out[:200]}')
            try:
                staged, staged_hits = verify_staged_payload(
                    self.repo, approved, self.run_git_raw,
                )
            except SyncRefused as exc:
                # The index may now hold entries, but the working tree is
                # untouched and nothing was committed. We report instead of
                # running a reset/clean to "tidy up".
                return SyncOutcome(
                    ok=False, stage='checkpoint', facts=facts,
                    reason=f'prova do payload stageado falhou: {exc} '
                           '(índice pode conter caminhos stageados; nada foi commitado)',
                )
            if staged_hits:
                return SyncOutcome(
                    ok=False, stage='checkpoint', facts=facts,
                    reason='verificação do payload stageado bloqueou o checkpoint: '
                           + '; '.join(staged_hits[:5]),
                )
            facts.notes.append(f'payload stageado verificado: {len(staged)} caminho(s)')
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
        facts.dirty_after = len(porcelain_paths(self.repo, self.run_git, self.run_git_raw))
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
        if len(porcelain_paths(self.repo, self.run_git, self.run_git_raw)):
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
        if not facts.remote_head:
            return SyncOutcome(ok=False, stage='publish', facts=facts,
                               reason=f'não consegui resolver {remote_ref} antes do push')
        if facts.remote_head == current:
            facts.notes.append('remote já está no HEAD testado; nada a publicar')
            facts.final_head = current
            return SyncOutcome(ok=True, stage='publish', reason='', facts=facts)
        # A legitimate fast-forward is local-ahead-of-remote, which the old
        # `!=` test refused. What must be refused is divergence: the remote tip
        # has to be an ANCESTOR of the tested HEAD, otherwise the push would not
        # be a fast-forward and only --force could do it.
        code, _ = self._git(['merge-base', '--is-ancestor', facts.remote_head, current])
        if code != 0:
            return SyncOutcome(
                ok=False, stage='publish', facts=facts,
                reason=f'o remote {facts.remote_head[:12]} não é ancestral do HEAD testado '
                       f'{current[:12]}; houve divergência e nada é forçado - revalide',
            )
        # No rebase happens here, ever: rebasing after the gate would put a
        # different SHA under a PASS that was measured against this one.
        code, out = self._git(['push', self.remote, f'HEAD:{self.work_branch}'])
        if code != 0:
            return SyncOutcome(ok=False, stage='publish', facts=facts,
                               reason=f'push recusado: {out[:200]}')
        facts.final_head = self._ref('HEAD')
        facts.notes.append(f'publicado em {self.remote}/{self.work_branch}')
        return SyncOutcome(ok=True, stage='publish', reason='', facts=facts)
