"""
DevFlow: the active-round manifest schema.

The manifest is the MACHINE CONTRACT for a development round. Prose in
`docs/project/CURRENT-STATE.md` may mirror it, but nothing in DevFlow ever
parses that prose: execution is driven exclusively by the JSON validated
here. Validation is strict and fails closed - an unknown key, a missing key
or a wrong type is an error, not a default.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1

DEVFLOW_DIR = Path(__file__).resolve().parent
ROUNDS_DIR = DEVFLOW_DIR / 'rounds'
ACTIVE_POINTER = DEVFLOW_DIR / 'active-round.json'


class RoundSchemaError(RuntimeError):
    """The manifest is not a usable machine contract."""


@dataclass(frozen=True)
class PrepareStep:
    kind: str
    path: str
    why: str


@dataclass(frozen=True)
class CleanupProfile:
    id: str
    allowlisted_generated: tuple[str, ...]


@dataclass(frozen=True)
class RoundTest:
    id: str
    label: str
    cwd: str
    argv: tuple[str, ...]


@dataclass(frozen=True)
class Marker:
    id: str
    pattern: str
    # Optional extra substring that must also appear on the same line.
    also: str = ''

    def matches(self, line: str) -> bool:
        return self.pattern in line and (not self.also or self.also in line)


@dataclass(frozen=True)
class LaunchSpec:
    kind: str
    command: tuple[str, ...]
    operator_hint: str


@dataclass(frozen=True)
class ManualAssertion:
    id: str
    question: str
    accept: tuple[str, ...]
    reject: tuple[str, ...]


@dataclass(frozen=True)
class Retention:
    keep_runs: int
    max_age_days: int


@dataclass(frozen=True)
class Round:
    id: str
    title: str
    phase: str
    ready_for_publish: bool
    tested_sha: str | None
    expected_branch: str
    prepare: tuple[PrepareStep, ...]
    cleanup: CleanupProfile
    tests: tuple[RoundTest, ...]
    launch: LaunchSpec
    ordered_markers: tuple[Marker, ...]
    optional_markers: tuple[Marker, ...]
    manual_assertions: tuple[ManualAssertion, ...]
    retention: Retention
    source: Path = field(default=Path('.'), compare=False)


def _require(mapping: Any, key: str, where: str) -> Any:
    if not isinstance(mapping, dict):
        raise RoundSchemaError(f'{where}: esperado um objeto')
    if key not in mapping:
        raise RoundSchemaError(f'{where}: falta a chave obrigatória {key!r}')
    return mapping[key]


def _reject_unknown(mapping: dict, allowed: set[str], where: str) -> None:
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise RoundSchemaError(f'{where}: chave(s) desconhecida(s) {unknown}; o contrato é estrito')


def _as_str(value: Any, where: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not value.strip() and not allow_empty):
        raise RoundSchemaError(f'{where}: esperado um texto não vazio')
    return value


def _as_str_tuple(value: Any, where: str, *, minimum: int = 1) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) < minimum:
        raise RoundSchemaError(f'{where}: esperado uma lista com pelo menos {minimum} texto(s)')
    return tuple(_as_str(item, f'{where}[{index}]') for index, item in enumerate(value))


def _marker(item: Any, where: str) -> Marker:
    _reject_unknown(item, {'id', 'pattern', 'also'}, where)
    marker = Marker(
        id=_as_str(_require(item, 'id', where), f'{where}.id'),
        pattern=_as_str(_require(item, 'pattern', where), f'{where}.pattern'),
        also=_as_str(item.get('also', ''), f'{where}.also', allow_empty=True),
    )
    if not marker.pattern:
        raise RoundSchemaError(f'{where}.pattern: vazio')
    return marker


def validate_round(data: Any, source: Path | None = None) -> Round:
    """Strictly validates a parsed manifest and returns an immutable Round."""
    if not isinstance(data, dict):
        raise RoundSchemaError('manifesto: esperado um objeto JSON')
    _reject_unknown(
        data,
        {'schema_version', 'round', 'git', 'prepare', 'cleanup_profile', 'tests',
         'launch', 'diagnostics', 'manual_assertions', 'retention'},
        'manifesto',
    )

    version = _require(data, 'schema_version', 'manifesto')
    if version != SCHEMA_VERSION:
        raise RoundSchemaError(
            f'manifesto.schema_version={version!r} não suportado (esperado {SCHEMA_VERSION})',
        )

    head = _require(data, 'round', 'manifesto')
    _reject_unknown(head, {'id', 'title', 'phase', 'ready_for_publish', 'tested_sha'}, 'round')
    tested_sha = head.get('tested_sha')
    if tested_sha is not None:
        tested_sha = _as_str(tested_sha, 'round.tested_sha')
        if len(tested_sha) != 40 or any(char not in '0123456789abcdef' for char in tested_sha):
            raise RoundSchemaError('round.tested_sha: esperado um SHA completo de 40 hexadecimais')
    ready = head.get('ready_for_publish')
    if not isinstance(ready, bool):
        raise RoundSchemaError('round.ready_for_publish: esperado true/false')

    git = _require(data, 'git', 'manifesto')
    _reject_unknown(git, {'expected_branch'}, 'git')

    profile = _require(data, 'cleanup_profile', 'manifesto')
    _reject_unknown(profile, {'id', 'allowlisted_generated'}, 'cleanup_profile')

    raw_prepare = _require(data, 'prepare', 'manifesto')
    if not isinstance(raw_prepare, list):
        raise RoundSchemaError('prepare: esperado uma lista')
    prepare: list[PrepareStep] = []
    for index, item in enumerate(raw_prepare):
        where = f'prepare[{index}]'
        _reject_unknown(item, {'kind', 'path', 'why'}, where)
        kind = _as_str(_require(item, 'kind', where), f'{where}.kind')
        if kind != 'remove_generated':
            raise RoundSchemaError(f'{where}.kind={kind!r} não suportado (só remove_generated em D1)')
        prepare.append(PrepareStep(
            kind=kind,
            path=_as_str(_require(item, 'path', where), f'{where}.path'),
            why=_as_str(_require(item, 'why', where), f'{where}.why'),
        ))

    tests: list[RoundTest] = []
    for index, item in enumerate(_require(data, 'tests', 'manifesto')):
        where = f'tests[{index}]'
        _reject_unknown(item, {'id', 'label', 'cwd', 'argv'}, where)
        tests.append(RoundTest(
            id=_as_str(_require(item, 'id', where), f'{where}.id'),
            label=_as_str(_require(item, 'label', where), f'{where}.label'),
            cwd=_as_str(_require(item, 'cwd', where), f'{where}.cwd'),
            argv=_as_str_tuple(_require(item, 'argv', where), f'{where}.argv'),
        ))

    launch = _require(data, 'launch', 'manifesto')
    _reject_unknown(launch, {'kind', 'command', 'operator_hint'}, 'launch')
    launch_kind = _as_str(_require(launch, 'kind', 'launch'), 'launch.kind')
    if launch_kind != 'managed-launcher':
        raise RoundSchemaError(f'launch.kind={launch_kind!r} não suportado em D1')

    diagnostics = _require(data, 'diagnostics', 'manifesto')
    _reject_unknown(diagnostics, {'ordered_markers', 'optional_markers'}, 'diagnostics')
    ordered = [_marker(item, f'ordered_markers[{i}]')
               for i, item in enumerate(_require(diagnostics, 'ordered_markers', 'diagnostics'))]
    optional = [_marker(item, f'optional_markers[{i}]')
                for i, item in enumerate(diagnostics.get('optional_markers', []))]
    if not ordered:
        raise RoundSchemaError('diagnostics.ordered_markers: precisa de ao menos um marcador')

    manuals: list[ManualAssertion] = []
    for index, item in enumerate(_require(data, 'manual_assertions', 'manifesto')):
        where = f'manual_assertions[{index}]'
        _reject_unknown(item, {'id', 'question', 'accept', 'reject'}, where)
        manuals.append(ManualAssertion(
            id=_as_str(_require(item, 'id', where), f'{where}.id'),
            question=_as_str(_require(item, 'question', where), f'{where}.question'),
            accept=_as_str_tuple(_require(item, 'accept', where), f'{where}.accept'),
            reject=_as_str_tuple(_require(item, 'reject', where), f'{where}.reject'),
        ))
    if not manuals:
        raise RoundSchemaError(
            'manual_assertions: uma rodada precisa de ao menos uma afirmação humana; '
            'logs nunca provam o que a pessoa viu',
        )

    retention = _require(data, 'retention', 'manifesto')
    _reject_unknown(retention, {'keep_runs', 'max_age_days'}, 'retention')
    for key in ('keep_runs', 'max_age_days'):
        value = _require(retention, key, 'retention')
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise RoundSchemaError(f'retention.{key}: esperado um inteiro >= 1')

    # Cross-check: every prepare path must be covered by the cleanup profile.
    allowlist = _as_str_tuple(_require(profile, 'allowlisted_generated', 'cleanup_profile'),
                              'cleanup_profile.allowlisted_generated')
    for step in prepare:
        if step.path not in allowlist:
            raise RoundSchemaError(
                f'prepare path {step.path!r} não está em cleanup_profile.allowlisted_generated',
            )

    return Round(
        id=_as_str(_require(head, 'id', 'round'), 'round.id'),
        title=_as_str(_require(head, 'title', 'round'), 'round.title'),
        phase=_as_str(_require(head, 'phase', 'round'), 'round.phase'),
        ready_for_publish=ready,
        tested_sha=tested_sha,
        expected_branch=_as_str(_require(git, 'expected_branch', 'git'), 'git.expected_branch'),
        prepare=tuple(prepare),
        cleanup=CleanupProfile(
            id=_as_str(_require(profile, 'id', 'cleanup_profile'), 'cleanup_profile.id'),
            allowlisted_generated=allowlist,
        ),
        tests=tuple(tests),
        launch=LaunchSpec(
            kind=launch_kind,
            command=_as_str_tuple(_require(launch, 'command', 'launch'), 'launch.command'),
            operator_hint=_as_str(_require(launch, 'operator_hint', 'launch'), 'launch.operator_hint'),
        ),
        ordered_markers=tuple(ordered),
        optional_markers=tuple(optional),
        manual_assertions=tuple(manuals),
        retention=Retention(
            keep_runs=int(_require(retention, 'keep_runs', 'retention')),
            max_age_days=int(_require(retention, 'max_age_days', 'retention')),
        ),
        source=source or Path('.'),
    )


def load_round_file(path: Path) -> Round:
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except OSError as exc:
        raise RoundSchemaError(f'não consegui ler {path}: {exc}') from exc
    except json.JSONDecodeError as exc:
        raise RoundSchemaError(f'{path}: JSON inválido ({exc})') from exc
    return validate_round(data, source=path)


def active_round_id(pointer: Path = ACTIVE_POINTER) -> str:
    try:
        data = json.loads(pointer.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise RoundSchemaError(f'{pointer}: ponteiro de rodada ativa ilegível ({exc})') from exc
    if not isinstance(data, dict) or set(data) - {'schema_version', 'round_id'}:
        raise RoundSchemaError(f'{pointer}: esperado {{"schema_version": 1, "round_id": "..."}}')
    if data.get('schema_version') != SCHEMA_VERSION:
        raise RoundSchemaError(f'{pointer}: schema_version não suportado')
    return _as_str(data.get('round_id'), f'{pointer}.round_id')


def load_active_round(rounds_dir: Path = ROUNDS_DIR, pointer: Path = ACTIVE_POINTER) -> Round:
    """Loads the round the pointer names. Unknown id = hard error."""
    round_id = active_round_id(pointer)
    candidates = sorted(rounds_dir.glob('*.json'))
    for candidate in candidates:
        try:
            data = json.loads(candidate.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and isinstance(data.get('round'), dict) \
                and data['round'].get('id') == round_id:
            return load_round_file(candidate)
    known = [candidate.name for candidate in candidates]
    raise RoundSchemaError(f'nenhuma rodada com id {round_id!r} em {rounds_dir} (presentes: {known})')
