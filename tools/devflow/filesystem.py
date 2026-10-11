"""
DevFlow: filesystem redirection detection and scoped deletion.

ONE authority for two questions:

  * is this path component a filesystem REDIRECTION (POSIX symlink, Windows
    symlink, junction or any other reparse point)?
  * may this tree be deleted, given an explicit allowed root?

Why a shared helper: `safe_paths` (round cleanup) and `report.prune_runs`
(retention) both delete directories. D1 shipped two different, weaker checks
- `Path.is_symlink()` in one, `os.path.islink()` plus a root derived from
`__file__` in the other. D1.1 collapses them here so neither can drift.

Python floor is 3.10 (the DevKit's own minimum), so `Path.is_junction()`
(3.12+) is NOT relied upon. On Windows the authoritative signal is the
`FILE_ATTRIBUTE_REPARSE_POINT` bit from `GetFileAttributesW`, which covers
symlinks, junctions and mount points alike. The bit interpretation lives in a
pure function so it can be tested on Linux CI with synthetic attribute values.

Inspection errors FAIL CLOSED: if we cannot prove a component is a plain
directory, we treat it as a redirection and refuse.
"""
from __future__ import annotations

import os
from pathlib import Path, PurePosixPath
import shutil
from typing import Sequence

FILE_ATTRIBUTE_REPARSE_POINT = 0x400
INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF
# GetLastError values that mean "there is nothing there to redirect".
_MISSING_ERRORS = frozenset({2, 3})  # ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND


class RedirectionError(RuntimeError):
    """A component is (or may be) a filesystem redirection. Refuse."""


def reparse_from_attributes(attrs: int, last_error: int) -> bool:
    """
    Pure interpretation of the Win32 attribute probe. Kept separate from the
    ctypes call so the Windows decision can be tested on any platform.
    """
    if attrs == INVALID_FILE_ATTRIBUTES:
        # Nothing there is not a redirection; anything else we could not read
        # is treated as one, because guessing is how deletions escape.
        return last_error not in _MISSING_ERRORS
    return bool(attrs & FILE_ATTRIBUTE_REPARSE_POINT)


def _probe_attributes(path: Path) -> tuple[int, int]:
    """Raw Win32 probe. Split out so the fail-closed path is testable anywhere."""
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel32.GetFileAttributesW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetFileAttributesW.restype = wintypes.DWORD
    ctypes.set_last_error(0)
    attrs = kernel32.GetFileAttributesW(str(path))
    error = ctypes.get_last_error() or ctypes.GetLastError()
    return int(attrs), int(error)


def _windows_reparse(path: Path) -> bool:
    try:
        attrs, error = _probe_attributes(path)
    except Exception:  # noqa: BLE001 - ANY inspection failure fails closed
        return True
    return reparse_from_attributes(attrs, error)


def is_redirection(path: Path) -> bool:
    """True when `path` is - or cannot be proven not to be - a redirection."""
    try:
        if path.is_symlink():
            return True
        # 3.12+ has a direct junction test; use it when present, but the
        # attribute bit below is the authority on older interpreters.
        is_junction = getattr(path, 'is_junction', None)
        if callable(is_junction) and is_junction():
            return True
    except OSError:
        return True  # cannot inspect -> fail closed
    if os.name == 'nt':
        return _windows_reparse(path)
    return False


def assert_no_redirection(root: Path, relative: Sequence[str] | PurePosixPath) -> None:
    """
    Every EXISTING component from `root` down to the target must be a plain
    directory - the target included.

    Components are inspected LEXICALLY, one by one, before any resolution.
    Resolving first and then inspecting would follow the redirection and erase
    the very evidence that a component was a reparse point.
    """
    parts = tuple(PurePosixPath(relative).parts) if not isinstance(relative, tuple) else relative
    walk = root
    for part in parts:
        walk = walk / part
        if not walk.exists() and not walk.is_symlink():
            # A missing component cannot redirect; deeper checks are pointless.
            return
        if is_redirection(walk):
            raise RedirectionError(
                f'componente {part!r} é um link/junction/reparse point; '
                'recuso para evitar fuga da raiz',
            )


def remove_tree_scoped(target: Path, allowed_root: Path) -> None:
    """
    Deletes `target`, which must sit strictly inside `allowed_root`.

    The allowed root is supplied by the CALLER (the repo actually being
    operated on), never derived from this file's location - retention has to
    work in worktrees, temp repos and CI checkouts alike.
    """
    root = allowed_root.resolve()
    resolved = target.resolve()
    if resolved == root or not resolved.is_relative_to(root):
        raise RedirectionError(f'recuso remover {resolved} (fora de {root})')
    assert_no_redirection(root, resolved.relative_to(root).parts)
    if is_redirection(target):
        raise RedirectionError(f'recuso remover a redireção {resolved}')
    if target.is_dir():
        shutil.rmtree(resolved, ignore_errors=False)
    else:
        resolved.unlink()
