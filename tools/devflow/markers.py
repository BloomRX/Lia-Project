"""
DevFlow: ordered diagnostic-marker evaluation.

The managed Stage gate is a SEQUENCE, not a set. The build prerequisite has
to start, then succeed, and only then may the dev server be spawned - that
order is the whole point of Phase 8.0D-M3.0b. So a marker that appears out
of order is a FAILURE, exactly like a missing one.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .schema import Marker


@dataclass
class MarkerReport:
    ok: bool
    matched: list[tuple[str, int]] = field(default_factory=list)
    missing: str | None = None
    reason: str = ''

    def describe(self) -> list[str]:
        lines = [f'marcador {name}: linha {index + 1}' for name, index in self.matched]
        if not self.ok:
            lines.append(f'FALHA: {self.reason}')
        return lines


def evaluate_markers(
    lines: list[str],
    ordered: tuple[Marker, ...],
    optional: tuple[Marker, ...] = (),
) -> MarkerReport:
    """
    Every ordered marker must appear, each strictly at or after the previous
    one's line. Optional markers are reported but never gate the verdict.
    """
    matched: list[tuple[str, int]] = []
    cursor = 0
    for marker in ordered:
        found = None
        for index in range(cursor, len(lines)):
            if marker.matches(lines[index]):
                found = index
                break
        if found is None:
            return MarkerReport(
                ok=False,
                matched=matched,
                missing=marker.id,
                reason=(
                    f'marcador {marker.id!r} não encontrado na ordem exigida '
                    f'(procurado a partir da linha {cursor + 1}): {marker.pattern!r}'
                ),
            )
        matched.append((marker.id, found))
        cursor = found + 1

    for marker in optional:
        for index, line in enumerate(lines):
            if marker.matches(line):
                matched.append((marker.id, index))
                break

    return MarkerReport(ok=True, matched=matched)
