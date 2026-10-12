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
    descendants: int = -1  # -1 = this platform cannot tell us

    @property
    def ok(self) -> bool:
        return self.root_terminated

    def describe(self) -> str:
        parts = [self.method or 'sem método registrado']
        if self.detail:
            parts.append(self.detail)
        if self.descendants == 0:
            parts.append('nenhum descendente vivo')
        elif self.descendants > 0:
            parts.append(f'ainda há descendente(s) vivo(s): {self.descendants}+')
        elif self.requested:
            parts.append('descendentes: desconhecido nesta plataforma')
        return '; '.join(parts)


class OwnedProcess:
    """
    A spawned root process plus teardown of the tree rooted at its PID.

    `terminate()` is idempotent and never touches a process this instance did
    not create: the only handle it has is its own root PID.
    """

    def __init__(self, process: subprocess.Popen) -> None:
        self._process = process
        self._pumped = False

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
        if self._process.poll() is not None:
            result.requested = False
            result.root_terminated = True
            result.method = 'já havia encerrado'
            result.descendants = self._alive_descendants()
            return result
        pid = self._process.pid
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
                ok, killed, detail = self._taskkill(pid)
                result.method = 'taskkill /T /F'
                result.detail = detail
                if killed >= 0:
                    result.descendants = killed
                if not ok and attempt:
                    break
            else:
                result.method = 'grupo de processo (SIGTERM/SIGKILL)'
                self._kill_group(pid, sig)
            try:
                self._process.wait(timeout=15 if not attempt else 5)
                result.root_terminated = True
                break
            except subprocess.TimeoutExpired:
                continue
        result.root_terminated = self._process.poll() is not None
        if result.descendants < 0:
            result.descendants = self._alive_descendants()
        return result

    def _alive_descendants(self) -> int:
        """
        How many processes of the owned group are still alive, or -1 when this
        platform cannot tell us. Never a guess presented as a count.
        """
        pid = self._process.pid
        if pid is None or os.name == 'nt':
            return -1
        try:
            os.killpg(os.getpgid(pid), 0)
        except ProcessLookupError:
            return 0
        except (OSError, PermissionError):
            return -1
        return 1  # at least the group still answers; the exact count is unknown

    @staticmethod
    def _taskkill(pid: int) -> tuple[bool, int, str]:
        """(succeeded, descendants_killed_or_-1, detail). Never a silent pass."""
        try:
            probe = subprocess.run(
                ['taskkill', '/PID', str(pid), '/T', '/F'],
                capture_output=True, text=True, encoding='utf-8',
                errors='replace', timeout=30, check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            return False, -1, f'taskkill não pôde ser executado: {type(exc).__name__}'
        text = ((probe.stdout or '') + (probe.stderr or '')).strip()
        killed = text.upper().count('SUCCESS:')
        if probe.returncode != 0:
            return False, -1, f'taskkill retornou {probe.returncode}: {text[:160]}'
        return True, killed, f'taskkill encerrou {killed} processo(s)'

    @staticmethod
    def _kill_group(pid: int, sig: int) -> None:
        try:
            os.killpg(os.getpgid(pid), sig)
        except (OSError, ProcessLookupError):
            try:
                os.kill(pid, sig)
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
