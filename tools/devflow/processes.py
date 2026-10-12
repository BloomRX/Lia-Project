"""
DevFlow: launching the managed Lia path and cleaning up the tree WE started.

The real Windows chain is:

    DevFlow -> cmd.exe -> Lia.bat -> pnpm dev:lia -> Launcher (Electron)
            -> managed Stage (node electron-vite.js dev -> Electron)

Terminating only the process Python created would strand pnpm/Electron/Stage.
So the round owns a PROCESS TREE rooted at the PID it spawned, and teardown is
always rooted at that PID:

  * Windows: `taskkill /PID <root> /T /F`, created with
    CREATE_NEW_PROCESS_GROUP so the tree is ours and nobody else's;
  * POSIX:   the child is a session leader (`start_new_session=True`), so
    `os.killpg` reaches exactly that tree.

There is no global kill by image name anywhere: nothing that DevFlow did not
start is ever signalled.

BATCH INVOCATION (audited, section 7 of D1.1). `launch_argv` is the single
platform seam that decides how a command becomes argv:
  * a `.bat`/`.cmd` on Windows is run through the interpreter named by the
    documented `%COMSPEC%` variable (falling back to `cmd.exe`) with
    `/d /s /c` - `/d` skips AutoRun, `/s /c` keeps cmd's own quoting rules;
  * anything else is passed through untouched.
argv is always a fixed, trusted list built here. `shell=True` is never used and
no user-supplied string is ever interpolated into a command line. stdout and
stderr are merged into one pipe, so the captured console carries both, and the
working directory is the repository root passed by the caller.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
import os
from pathlib import Path
import signal
import subprocess
import threading
from typing import Callable

CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000
_BATCH_SUFFIXES = ('.bat', '.cmd')


def launch_argv(command: list[str]) -> tuple[list[str], dict]:
    """
    Turns a declared command into the argv + Popen kwargs for THIS platform.

    Pure and side-effect free so the Windows construction can be asserted on
    any CI machine.
    """
    if not command:
        raise ValueError('comando vazio')
    head, rest = command[0], list(command[1:])
    if os.name == 'nt' and head.lower().endswith(_BATCH_SUFFIXES):
        comspec = os.environ.get('COMSPEC') or 'cmd.exe'
        return [comspec, '/d', '/s', '/c', head, *rest], {}
    return [head, *rest], {}


def _popen_kwargs() -> dict:
    """Platform flags that make the spawned tree OURS and nothing else's."""
    if os.name == 'nt':
        return {'creationflags': CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW}
    return {'start_new_session': True}


@dataclass
class TeardownResult:
    """
    What teardown actually PROVED, as opposed to what it attempted.

    `ok` is deliberately narrow: only a confirmed-dead root counts. Uncertainty
    stays uncertainty, so the report can never claim a cleanup it did not see.
    """

    requested: bool = False
    root_terminated: bool = False
    method: str = ''
    detail: str = ''
    # -1 = we could not verify. 0 = verified gone. >0 = verified still alive.
    descendants: int = -1

    @property
    def state(self) -> str:
        """
        'PASS' | 'FAIL' | 'UNKNOWN'.

        A dead root is NOT proof the tree is gone: the Stage child is
        reparented to init and keeps running. So PASS requires a dead root AND
        descendants verified gone. Anything we could not verify stays UNKNOWN
        and is never laundered into PASS by the caller.
        """
        if not self.root_terminated:
            return 'FAIL'
        if self.descendants > 0:
            return 'FAIL'
        # Unverified is unverified even when the root had already exited on its
        # own: an early-exiting launcher is exactly when a Stage child is left
        # running with nobody watching it.
        if self.descendants < 0:
            return 'UNKNOWN'
        return 'PASS'

    @property
    def ok(self) -> bool:
        return self.state == 'PASS'

    def describe(self) -> str:
        parts = [f'[{self.state}]', self.method or 'sem método registrado']
        if self.detail:
            parts.append(self.detail)
        if self.descendants == 0:
            parts.append('descendentes verificados: nenhum vivo')
        elif self.descendants > 0:
            parts.append(f'descendentes verificados: {self.descendants} ainda vivo(s)')
        else:
            parts.append('descendentes: NÃO VERIFICADOS')
        return '; '.join(parts)


# --------------------------------------------------------------------------
# Owned-tree verification.
#
# A dead root proves nothing about its children: the Stage child survives and
# is reparented to init. So teardown records the tree BEFORE killing it and
# then checks those exact PIDs. Nothing here is a guess, and nothing here ever
# targets a process by image name.
# --------------------------------------------------------------------------
STILL_ACTIVE = 259


def descendants_from_table(root_pid: int,
                           table: Iterable[tuple[int, int]]) -> frozenset[int]:
    """
    Pure transitive-children walk over a (pid, ppid) table.

    Kept free of platform calls so the traversal - the part that can actually
    be wrong - is testable on any OS. Cycles and self-parenting are handled
    because a PID is only ever visited once.
    """
    children: dict[int, list[int]] = {}
    for pid, ppid in table:
        if pid == ppid:
            continue
        children.setdefault(ppid, []).append(pid)
    seen: set[int] = set()
    stack = [root_pid]
    while stack:
        current = stack.pop()
        for child in children.get(current, ()):
            if child in seen or child == root_pid:
                continue
            seen.add(child)
            stack.append(child)
    return frozenset(seen)


def _posix_process_table() -> list[tuple[int, int]]:
    """(pid, ppid) for every process, from /proc. Raises when unavailable."""
    proc = Path('/proc')
    if not proc.is_dir():
        raise OSError('/proc indisponível')
    table: list[tuple[int, int]] = []
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / 'stat').read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue  # the process exited between readdir and read
        # comm may contain spaces and parentheses, so split from the last ')'.
        _, _, rest = stat.rpartition(')')
        fields = rest.split()
        if len(fields) < 2:
            continue
        try:
            table.append((int(entry.name), int(fields[1])))
        except ValueError:
            continue
    return table


def _windows_process_table() -> list[tuple[int, int]]:
    """
    (pid, ppid) via a Toolhelp32 snapshot.

    kernel32 only - no WMIC, no PowerShell, no localized output to parse, and
    available on every Windows the launcher can run on.
    """
    import ctypes
    from ctypes import wintypes

    class PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ('dwSize', wintypes.DWORD),
            ('cntUsage', wintypes.DWORD),
            ('th32ProcessID', wintypes.DWORD),
            ('th32DefaultHeapID', ctypes.POINTER(ctypes.c_ulong)),
            ('th32ModuleID', wintypes.DWORD),
            ('cntThreads', wintypes.DWORD),
            ('th32ParentProcessID', wintypes.DWORD),
            ('pcPriClassBase', ctypes.c_long),
            ('dwFlags', wintypes.DWORD),
            ('szExeFile', ctypes.c_char * 260),
        ]

    TH32CS_SNAPPROCESS = 0x2
    INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
    kernel32 = ctypes.windll.kernel32
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snapshot == INVALID_HANDLE_VALUE:
        raise OSError(f'CreateToolhelp32Snapshot falhou: {ctypes.get_last_error()}')
    table: list[tuple[int, int]] = []
    try:
        entry = PROCESSENTRY32()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
        if not kernel32.Process32First(snapshot, ctypes.byref(entry)):
            raise OSError('Process32First falhou')
        while True:
            table.append((int(entry.th32ProcessID), int(entry.th32ParentProcessID)))
            if not kernel32.Process32Next(snapshot, ctypes.byref(entry)):
                break
    finally:
        kernel32.CloseHandle(snapshot)
    return table


def _pid_alive_posix(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # it exists, we just may not signal it
    except OSError:
        return False
    return True


def _pid_alive_windows(pid: int) -> bool:
    import ctypes
    from ctypes import wintypes

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return False
    try:
        code = wintypes.DWORD(0)
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == STILL_ACTIVE
    finally:
        kernel32.CloseHandle(handle)


def _pid_alive(pid: int) -> bool:
    return _pid_alive_windows(pid) if os.name == 'nt' else _pid_alive_posix(pid)


def snapshot_owned_tree(root_pid: int | None) -> frozenset[int] | None:
    """
    The PIDs of the tree rooted at `root_pid`, or None when we cannot tell.

    Called BEFORE killing, because a parent-child map is only meaningful while
    the parent is still alive to appear in it.
    """
    if root_pid is None:
        return None
    try:
        table = _windows_process_table() if os.name == 'nt' else _posix_process_table()
    except (OSError, AttributeError, ImportError):
        return None
    # A snapshot taken after the root died is worthless: its children have
    # already been reparented, so the walk would find nothing and report "no
    # descendants" for a tree that is still running.
    if root_pid not in {pid for pid, _ppid in table}:
        return None
    return descendants_from_table(root_pid, table)


def count_alive(pids: frozenset[int] | None) -> int:
    """How many of the recorded PIDs are still alive. None counts as unknown."""
    if pids is None:
        return -1
    return sum(1 for pid in pids if _pid_alive(pid))


class OwnedProcess:
    """
    A spawned root process plus teardown of the tree rooted at its PID.

    `terminate()` is idempotent and never touches a process this instance did
    not create: the only handle it has is its own root PID.
    """

    def __init__(self, process: subprocess.Popen) -> None:
        self._process = process
        self._pumped = False
        # Owned-tree identity, captured while the root is unambiguously alive.
        # The process group is the durable part on POSIX: children inherit it,
        # and it keeps answering even after the root is reaped.
        self._pgid = self._process_group(process.pid)
        self._tree: set[int] = set(snapshot_owned_tree(process.pid) or ())

    @property
    def pid(self) -> int | None:
        return self._process.pid

    def wait(self, timeout: float) -> int | None:
        try:
            return self._process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            return None

    def terminate(self) -> TeardownResult:
        """
        Kills the owned tree and REPORTS what was actually proven.

        The old version returned None and the caller wrote `tree_cleaned = True`
        unconditionally, so a failed `taskkill` was reported to the user as
        `Process cleanup: PASS`. A cleanup claim has to come from evidence:
        the root process confirmed dead, plus whatever descendant evidence this
        platform can honestly produce.
        """
        result = TeardownResult()
        pid = self._process.pid

        # Record the tree and the process group BEFORE anything dies. Both are
        # only meaningful while the root is alive: after we reap it,
        # os.getpgid(pid) fails with ESRCH even when children still belong to
        # the group, which is exactly how a surviving Stage child used to be
        # reported as "nenhum descendente vivo".
        # Union of every snapshot we managed to take. The one from spawn misses
        # children created later; the one taken here misses children whose
        # parent already died. Either alone can under-report.
        fresh = snapshot_owned_tree(pid)
        if fresh:
            self._tree.update(fresh)
        tree = frozenset(self._tree) if self._tree else None
        pgid = self._pgid if self._pgid is not None else self._process_group(pid)

        if self._process.poll() is not None:
            result.requested = False
            result.root_terminated = True
            result.method = 'já havia encerrado'
            result.descendants = self._verify_descendants(tree, pgid)
            return result
        if pid is None:
            result.method = 'sem PID para encerrar'
            result.detail = 'o processo gerenciado não expôs PID'
            return result
        result.requested = True
        for attempt, sig in ((0, signal.SIGTERM), (1, signal.SIGKILL)):
            if attempt:
                result.detail = (result.detail + '; ' if result.detail else '') \
                    + 'SIGTERM não bastou, escalando'
            if os.name == 'nt':
                # Scoped to ONE root PID. /T walks only that process's
                # descendants; there is no kill-by-image-name anywhere here.
                ok, detail = self._taskkill(pid)
                result.method = 'taskkill /T /F'
                result.detail = detail
                if not ok:
                    # A failed taskkill is a failure even if the root later dies
                    # on its own: we did not do the killing.
                    result.root_terminated = self._process.poll() is not None
                    result.descendants = self._verify_descendants(tree, pgid)
                    return result
            else:
                result.method = 'grupo de processo (SIGTERM/SIGKILL)'
                self._kill_group(pgid if pgid is not None else pid, sig)
            try:
                self._process.wait(timeout=15 if not attempt else 5)
                break
            except subprocess.TimeoutExpired:
                continue
        result.root_terminated = self._process.poll() is not None
        result.descendants = self._verify_descendants(tree, pgid)
        return result

    @staticmethod
    def _process_group(pid: int | None) -> int | None:
        """The process group id, captured while the root is still alive."""
        if pid is None or os.name == 'nt':
            return None
        try:
            return os.getpgid(pid)
        except (OSError, ProcessLookupError):
            return None

    def _verify_descendants(self, tree: frozenset[int] | None,
                            pgid: int | None) -> int:
        """
        How many owned descendants are still alive: an exact count, or -1 when
        this platform could not verify. Never a guess dressed as a count.
        """
        if tree is not None:
            return count_alive(tree)
        # No tree snapshot: fall back to the recorded group, which can only
        # answer "gone" or "something is still there" - never a count.
        if pgid is None:
            return -1
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return 0
        except (OSError, PermissionError):
            return -1
        return -1

    @staticmethod
    def _taskkill(pid: int) -> tuple[bool, str]:
        """
        (succeeded, detail). Never a silent pass.

        The exit status is the only signal taken from taskkill. Its stdout is
        localized - a pt-BR Windows prints 'EXITO:' where an en-US one prints
        'SUCCESS:' - so counting a literal string there is not a reliable way
        to prove how many descendants died, and it is not used.
        """
        try:
            probe = subprocess.run(
                ['taskkill', '/PID', str(pid), '/T', '/F'],
                capture_output=True, text=True, encoding='utf-8',
                errors='replace', timeout=30, check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return False, f'taskkill nao pode ser executado: {type(exc).__name__}'
        text = ((probe.stdout or '') + (probe.stderr or '')).strip()
        if probe.returncode != 0:
            return False, f'taskkill retornou {probe.returncode}: {text[:160]}'
        return True, 'taskkill retornou 0'

    @staticmethod
    def _kill_group(target: int, sig: int) -> None:
        """Signals the recorded group; falls back to the single root PID."""
        try:
            os.killpg(target, sig)
        except (OSError, ProcessLookupError):
            try:
                os.kill(target, sig)
            except (OSError, ProcessLookupError):
                pass


def spawn_owned(
    command: list[str],
    cwd: Path,
    on_line: Callable[[str], None],
    env: dict[str, str] | None = None,
) -> OwnedProcess:
    """
    Starts the managed launch with its console captured, in a new process
    group so teardown can reach the whole tree. Fixed argv, no shell.

    `env` is ADDED to the inherited environment, never a replacement: the
    launch chain (cmd -> Lia.bat -> pnpm -> Launcher -> Stage) needs PATH and
    friends to work. The Stage inherits the Launcher's whole environment, which
    is how the DevFlow diagnostics flag reaches the renderer process.
    """
    argv, extra = launch_argv(list(command))
    child_env = None
    if env:
        child_env = dict(os.environ)
        child_env.update({str(k): str(v) for k, v in env.items()})
    process = subprocess.Popen(  # noqa: S603 - fixed argv, no shell
        argv,
        cwd=cwd,
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
        bufsize=1,
        **extra,
        **_popen_kwargs(),
    )

    def pump() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            on_line(line)

    handle = OwnedProcess(process)
    threading.Thread(target=pump, daemon=True).start()
    handle._pumped = True  # noqa: SLF001 - internal bookkeeping
    return handle
