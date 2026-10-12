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

import ctypes
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
    # -1 = we could not verify at all. 0 = verified gone. >0 = verified alive.
    descendants: int = -1
    # Recorded descendants whose state we could not determine. A Win32 API
    # failure is NOT a dead process, so it must never be counted as one.
    unverified: int = 0
    # Outcome of the external kill tool (taskkill), when one was used.
    # None = no external tool involved (POSIX signals), so nothing to fail.
    kill_ok: bool | None = None

    @property
    def state(self) -> str:
        """
        'PASS' | 'FAIL' | 'UNKNOWN'.

        PASS is narrow on purpose and requires ALL of:
          * the kill tool, if any, actually succeeded;
          * the root confirmed dead;
          * every recorded descendant verified terminated.

        A dead root is NOT proof the tree is gone: the Stage child is
        reparented to init and keeps running. And a taskkill that returned
        nonzero is a failure even if the root later died on its own - we did
        not do the killing, so we may not claim the cleanup.
        """
        # A failed taskkill dominates everything else. Without this the
        # combination (root already dead + zero descendants verified) turned a
        # refused kill into `Process cleanup: PASS`.
        if self.kill_ok is False:
            return 'FAIL'
        if not self.root_terminated:
            return 'FAIL'
        if self.descendants > 0:
            return 'FAIL'
        # Unverified is unverified, whether the platform could not verify at
        # all or verified some descendants and gave up on others. An
        # early-exiting launcher is exactly when a Stage child is left running
        # with nobody watching it.
        if self.descendants < 0 or self.unverified > 0:
            return 'UNKNOWN'
        return 'PASS'

    @property
    def ok(self) -> bool:
        return self.state == 'PASS'

    def describe(self) -> str:
        parts = [f'[{self.state}]', self.method or 'sem método registrado']
        if self.detail:
            parts.append(self.detail)
        if self.kill_ok is False:
            parts.append('ferramenta de kill FALHOU')
        if self.descendants == 0:
            parts.append('descendentes verificados: nenhum vivo')
        elif self.descendants > 0:
            parts.append(f'descendentes verificados: {self.descendants} ainda vivo(s)')
        else:
            parts.append('descendentes: NÃO VERIFICADOS')
        if self.unverified > 0:
            parts.append(f'{self.unverified} descendente(s) NÃO VERIFICÁVEL(is)')
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

# Tri-state PID inspection. A Win32 API failure is NOT a dead process: turning
# "could not ask" into "is gone" is how a failed OpenProcess used to become
# `descendentes: nenhum vivo` and then a cleanup PASS.
ALIVE = 'ALIVE'
DEAD = 'DEAD'
UNKNOWN = 'UNKNOWN'

# --------------------------------------------------------------------------
# Win32 declarations.
#
# Every kernel32 entry point used here has a COMPLETE prototype. Without them
# ctypes assumes `restype = c_int`, which truncates a 64-bit HANDLE to 32 bits,
# and it never fills the ctypes-private last-error slot, so `get_last_error()`
# returns a stale value. Both are silent: the code appears to work.
#
# Deliberately plain ctypes instead of ctypes.wintypes, because wintypes cannot
# even be imported on Linux - which would make the declaration contract below
# untestable anywhere but Windows.
# --------------------------------------------------------------------------
HANDLE = ctypes.c_void_p          # pointer-sized. NOT c_int.
BOOL = ctypes.c_int
DWORD = ctypes.c_uint32
ULONG_PTR = ctypes.c_size_t       # pointer-sized by definition
LONG = ctypes.c_int32
LPDWORD = ctypes.POINTER(DWORD)

TH32CS_SNAPPROCESS = 0x00000002
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
ERROR_ACCESS_DENIED = 5
ERROR_INVALID_PARAMETER = 87
ERROR_NO_MORE_FILES = 18


class PROCESSENTRY32(ctypes.Structure):
    """
    The ANSI PROCESSENTRY32, matched to `Process32First`/`Process32Next`.

    `th32DefaultHeapID` is a ULONG_PTR - pointer-sized - so the struct is 304
    bytes on 64-bit and 296 on 32-bit. The test suite asserts both numbers,
    because a wrong layout does not raise: it silently shifts
    `th32ParentProcessID` and the whole parent/child table becomes nonsense.
    """

    _fields_ = [
        ('dwSize', DWORD),
        ('cntUsage', DWORD),
        ('th32ProcessID', DWORD),
        ('th32DefaultHeapID', ULONG_PTR),
        ('th32ModuleID', DWORD),
        ('cntThreads', DWORD),
        ('th32ParentProcessID', DWORD),
        ('pcPriClassBase', LONG),
        ('dwFlags', DWORD),
        ('szExeFile', ctypes.c_char * 260),
    ]


PROCESSENTRY32_PTR = ctypes.POINTER(PROCESSENTRY32)

# (name, restype, argtypes) for EVERY Win32 call this module makes. The test
# suite asserts this table covers all of them and that every HANDLE-returning
# entry declares a pointer-sized restype.
WIN32_PROTOTYPES: tuple[tuple[str, object, tuple], ...] = (
    ('CreateToolhelp32Snapshot', HANDLE, (DWORD, DWORD)),
    ('Process32First', BOOL, (HANDLE, PROCESSENTRY32_PTR)),
    ('Process32Next', BOOL, (HANDLE, PROCESSENTRY32_PTR)),
    ('CloseHandle', BOOL, (HANDLE,)),
    ('OpenProcess', HANDLE, (DWORD, BOOL, DWORD)),
    ('GetExitCodeProcess', BOOL, (HANDLE, LPDWORD)),
)

# HANDLE-returning entry points. A truncated HANDLE can alias another process's
# handle, which is exactly the kind of failure that must not read as DEAD.
WIN32_HANDLE_FUNCTIONS = ('CreateToolhelp32Snapshot', 'OpenProcess')

_KERNEL32 = None


def invalid_handle_value() -> int:
    """INVALID_HANDLE_VALUE, computed at the running interpreter's width."""
    value = ctypes.c_void_p(-1).value
    return value if value is not None else 0


def _kernel32():
    """
    kernel32 with complete prototypes, built once.

    `use_last_error=True` is what makes `ctypes.get_last_error()` meaningful:
    with the plain `ctypes.windll.kernel32` handle the ctypes-private error
    slot is never written, so the reported WinError would be whatever the
    previous unrelated call left behind.
    """
    global _KERNEL32
    if _KERNEL32 is None:
        library = ctypes.WinDLL('kernel32', use_last_error=True)
        for name, restype, argtypes in WIN32_PROTOTYPES:
            function = getattr(library, name)
            function.restype = restype
            function.argtypes = list(argtypes)
        _KERNEL32 = library
    return _KERNEL32


def _reset_win32_error() -> None:
    """
    Clear the ctypes last-error slot before a call we intend to diagnose.

    Goes through getattr because `ctypes.set_last_error` only exists where
    ctypes can load foreign functions - i.e. on Windows. The seam also keeps
    the Windows decision table testable off Windows.
    """
    setter = getattr(ctypes, 'set_last_error', None)
    if setter is not None:
        setter(0)


def _win32_error() -> int:
    """The ctypes last-error slot, or 0 where ctypes does not provide one."""
    getter = getattr(ctypes, 'get_last_error', None)
    return int(getter()) if getter is not None else 0


def _escalation_signals(is_windows: bool) -> tuple[int, ...]:
    """
    The signals used to escalate a stubborn process tree.

    Windows gets NOTHING, and that is the point: `signal.SIGKILL` does not
    exist in Windows Python, so merely naming it in a tuple literal that both
    platforms evaluate makes EVERY Windows teardown raise AttributeError. The
    Windows branch kills with `taskkill /PID /T /F`, which is already forced
    and tree-wide, so there is nothing to escalate to.

    This function is the ONLY place in the module where SIGKILL may be named.
    """
    if is_windows:
        return ()
    return (signal.SIGTERM, signal.SIGKILL)


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
    kernel32 = _kernel32()
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    # restype is c_void_p, so NULL comes back as None and INVALID_HANDLE_VALUE
    # as a pointer-sized int. Comparing a truncated c_int against the 64-bit
    # constant never matched, which is why this check has to be explicit.
    if snapshot is None or snapshot == invalid_handle_value():
        raise OSError(
            f'CreateToolhelp32Snapshot falhou: WinError {_win32_error()}')
    table: list[tuple[int, int]] = []
    try:
        entry = PROCESSENTRY32()
        entry.dwSize = ctypes.sizeof(PROCESSENTRY32)
        if not kernel32.Process32First(snapshot, ctypes.byref(entry)):
            raise OSError(f'Process32First falhou: WinError {_win32_error()}')
        while True:
            table.append((int(entry.th32ProcessID), int(entry.th32ParentProcessID)))
            if not kernel32.Process32Next(snapshot, ctypes.byref(entry)):
                # ERROR_NO_MORE_FILES is the normal terminator, not an error.
                break
    finally:
        kernel32.CloseHandle(snapshot)
    return table


def pid_state_posix(pid: int) -> str:
    """ALIVE / DEAD / UNKNOWN from signal 0. Only ESRCH proves absence."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return DEAD          # ESRCH: documented proof the PID is not there
    except PermissionError:
        return ALIVE         # EPERM: it exists, we just may not signal it
    except OSError:
        return UNKNOWN       # anything else is not proof either way
    return ALIVE


def pid_state_windows(pid: int) -> str:
    """
    ALIVE / DEAD / UNKNOWN from OpenProcess + GetExitCodeProcess.

    Only two answers are ever DEAD: a documented "no such process" error, or a
    real exit code other than STILL_ACTIVE. Everything else - access denied, a
    failed OpenProcess for any other reason, a failed GetExitCodeProcess, a
    truncated or ambiguous handle - is UNKNOWN, because none of them proves the
    PID is gone.
    """
    kernel32 = _kernel32()
    _reset_win32_error()
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        error = _win32_error()
        # ERROR_INVALID_PARAMETER is the documented answer for a PID that does
        # not identify a running process. ERROR_ACCESS_DENIED (5) is the
        # opposite: the process EXISTS and we are not allowed to query it.
        return DEAD if error == ERROR_INVALID_PARAMETER else UNKNOWN
    try:
        code = DWORD(0)
        if not kernel32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return UNKNOWN
        return ALIVE if code.value == STILL_ACTIVE else DEAD
    finally:
        kernel32.CloseHandle(handle)


def pid_state(pid: int) -> str:
    return pid_state_windows(pid) if os.name == 'nt' else pid_state_posix(pid)


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
    except (OSError, AttributeError, ImportError, ValueError):
        return None
    # A snapshot taken after the root died is worthless: its children have
    # already been reparented, so the walk would find nothing and report "no
    # descendants" for a tree that is still running.
    if root_pid not in {pid for pid, _ppid in table}:
        return None
    return descendants_from_table(root_pid, table)


def summarize_descendants(pids: frozenset[int] | None) -> tuple[int, int]:
    """
    (still_alive, unverified) for a set of recorded descendant PIDs.

    Never a bare count: the caller has to be able to tell "verified none left"
    from "could not check any of them", and from "checked some, gave up on
    others". (-1, 0) means the platform could not verify at all.
    """
    if pids is None:
        return (-1, 0)
    alive = 0
    unverified = 0
    for pid in pids:
        state = pid_state(pid)
        if state == ALIVE:
            alive += 1
        elif state == UNKNOWN:
            unverified += 1
    return (alive, unverified)


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

        An earlier version returned None and the caller wrote
        `tree_cleaned = True` unconditionally, so a failed `taskkill` reached
        the user as `Process cleanup: PASS`. A cleanup claim has to come from
        evidence: the kill tool succeeded, the root is confirmed dead, and
        every recorded descendant is verified terminated.

        The Windows and POSIX branches are SEPARATE methods. They used to share
        one loop over `((0, signal.SIGTERM), (1, signal.SIGKILL))`, and because
        a tuple literal is evaluated when it is built - not when it is used -
        every Windows teardown raised `AttributeError: module 'signal' has no
        attribute 'SIGKILL'` before it ever reached taskkill.
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

        if pid is None:
            result.method = 'sem PID para encerrar'
            result.detail = 'o processo gerenciado não expôs PID'
            return result
        if self._process.poll() is not None:
            result.requested = False
            result.root_terminated = True
            result.method = 'já havia encerrado'
            result.descendants, result.unverified = self._verify_descendants(tree, pgid)
            return result

        result.requested = True
        if os.name == 'nt':
            self._terminate_windows(result, pid, tree, pgid)
        else:
            self._terminate_posix(result, pid, tree, pgid)
        return result

    def _terminate_windows(self, result: TeardownResult, pid: int,
                           tree: frozenset[int] | None, pgid: int | None) -> None:
        """
        Windows teardown. NEVER evaluates a POSIX escalation signal.

        `taskkill /PID <root> /T /F` is already forced and already tree-wide,
        so there is no SIGTERM->SIGKILL ladder here - and naming SIGKILL on
        this path would raise AttributeError on Windows Python.
        """
        ok, detail = self._taskkill(pid)
        result.method = 'taskkill /PID /T /F'
        result.detail = detail
        # Load-bearing. A taskkill that returned nonzero - or could not be
        # executed at all - is recorded here and dominates TeardownResult.state,
        # so it can never be laundered into PASS by a root that happened to die
        # on its own.
        result.kill_ok = ok
        if ok:
            try:
                self._process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                result.detail = (result.detail + '; ' if result.detail else '') \
                    + 'a raiz não encerrou em 15s após o taskkill'
        result.root_terminated = self._process.poll() is not None
        result.descendants, result.unverified = self._verify_descendants(tree, pgid)

    def _terminate_posix(self, result: TeardownResult, pid: int,
                         tree: frozenset[int] | None, pgid: int | None) -> None:
        """POSIX teardown: SIGTERM, then SIGKILL, at the recorded group."""
        result.method = 'grupo de processo (SIGTERM/SIGKILL)'
        result.kill_ok = None      # no external tool, so nothing that can fail
        target = pgid if pgid is not None else pid
        for index, sig in enumerate(_escalation_signals(False)):
            if index:
                result.detail = (result.detail + '; ' if result.detail else '') \
                    + 'SIGTERM não bastou, escalando'
            self._kill_group(target, sig)
            try:
                self._process.wait(timeout=15 if not index else 5)
                break
            except subprocess.TimeoutExpired:
                continue
        result.root_terminated = self._process.poll() is not None
        result.descendants, result.unverified = self._verify_descendants(tree, pgid)

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
                            pgid: int | None) -> tuple[int, int]:
        """
        (still_alive, unverified) for the owned tree. Never a guess dressed as
        a count: (-1, 0) means this platform could not verify at all.
        """
        if tree is not None:
            return summarize_descendants(tree)
        # No tree snapshot: fall back to the recorded group, which can only
        # answer "gone" or "something is still there" - never a count.
        if pgid is None:
            return (-1, 0)
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return (0, 0)
        except (OSError, PermissionError):
            return (-1, 0)
        return (-1, 0)

    @staticmethod
    def _taskkill(pid: int) -> tuple[bool, str]:
        """
        (succeeded, detail). Never a silent pass.

        The exit status is the only signal taken from taskkill. Its stdout is
        localized - a pt-BR Windows prints 'ÊXITO:' where an en-US one prints
        'SUCCESS:' - so counting a literal string there is not a reliable way
        to prove how many descendants died, and it is not used.

        Scoped to ONE root PID: /T walks only that process's descendants. There
        is no kill-by-image-name anywhere in this module, so an unrelated Lia
        or Electron is never touched.
        """
        try:
            probe = subprocess.run(
                ['taskkill', '/PID', str(pid), '/T', '/F'],
                capture_output=True, text=True, encoding='utf-8',
                errors='replace', timeout=30, check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            # Includes FileNotFoundError: taskkill missing is a failure to
            # verify, never a cleanup.
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
