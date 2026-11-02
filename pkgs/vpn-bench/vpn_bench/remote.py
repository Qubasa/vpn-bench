"""Commands and file uploads on the benchmark machines, over clan's ssh.

Every command to a machine goes through an ssh ControlMaster that stays open for
the whole run, see `shared_connections`. A clan `host_connection` per command
would open a new ssh connection each time, and a run with parallel tests on
several machines then holds dozens at once. sshd refuses an eleventh session on
one connection (MaxSessions), so a machine gets another master whenever all of
its masters carry ten commands.

ssh exits with 255 when the connection itself fails, for example when the banner
exchange times out. About 1-5 % of new connections from the workstation do, with
and without impairment. Such a failure is retried; a command that ran and failed
on the remote side is not.
"""

import copy
import logging
import shlex
import socket
import threading
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, ExitStack, contextmanager
from dataclasses import dataclass
from pathlib import Path

from clan_lib.cmd import CmdOut, Log, RunOpts
from clan_lib.errors import ClanCmdError
from clan_lib.machines.machines import Machine
from clan_lib.ssh.remote import Remote
from clan_lib.ssh.upload import upload

from vpn_bench.retry import interruptible_sleep

log = logging.getLogger(__name__)

SSH_CONNECTION_FAILED = 255
SSH_ATTEMPTS = 3
# Failures can come in bursts of a few seconds: wait 5 s, then 10 s.
SSH_RETRY_DELAY_SECONDS = 5.0
# sshd's MaxSessions default. The ssh client would answer a refused session by
# quietly opening a connection of its own.
SESSIONS_PER_MASTER = 10
# Defined by the benchmark-resources clan service. The VPN daemons and the test
# servers run in it as system services.
BENCHMARK_SLICE = "benchmark.slice"


def in_benchmark_slice(cmd: list[str]) -> list[str]:
    """Wrap a benchmark client command so it runs in a scope under BENCHMARK_SLICE.

    A command started over ssh otherwise runs in user.slice, which gets a ninth of
    the slice's CPU share when CPUs are contested, so the VPN would win against its
    own load generator. systemd-run execs `cmd` in its own process, so output, exit
    code and environment stay those of `cmd`.
    """
    return [
        "systemd-run",
        "--scope",
        "--quiet",
        "--collect",
        f"--slice={BENCHMARK_SLICE}",
        "--",
        *cmd,
    ]


@dataclass(frozen=True)
class SharedConnection:
    """An ssh target whose commands run over the run's shared masters."""

    host: Remote


@dataclass(frozen=True)
class _Master:
    remote: Remote
    control_socket: Path
    stack: ExitStack
    # Held while a master is started, so parallel commands wait for it instead
    # of each becoming a master of its own.
    starting: threading.Lock


def _open_master(host: Remote) -> _Master:
    stack = ExitStack()
    remote = stack.enter_context(host.host_connection())
    # clan has no public accessor, remote.py puts the socket here.
    control_dir = remote._control_path_dir  # noqa: SLF001
    if control_dir is None:
        stack.close()
        msg = f"clan's host_connection set no ControlPath for {host.target}"
        raise RuntimeError(msg)
    return _Master(remote, control_dir / "socket", stack, threading.Lock())


def _master_running(control_socket: Path) -> bool:
    with socket.socket(socket.AF_UNIX) as probe:
        try:
            probe.connect(str(control_socket))
        except OSError:
            return False
    return True


class _Pool:
    """The masters to one ssh target and how many sessions each carries."""

    def __init__(self, host: Remote) -> None:
        self.host = host
        self.masters: list[_Master] = []
        self.sessions: list[int] = []

    def claim(self) -> _Master:
        for index, count in enumerate(self.sessions):
            if count < SESSIONS_PER_MASTER:
                self.sessions[index] += 1
                return self.masters[index]
        master = _open_master(self.host)
        self.masters.append(master)
        self.sessions.append(1)
        return master

    def release(self, master: _Master) -> None:
        self.sessions[self.masters.index(master)] -= 1

    def close(self) -> None:
        with ExitStack() as closing:
            for master in self.masters:
                closing.callback(master.stack.close)


class _SharedConnections:
    """Pools of clan host_connections per ssh target, keyed by user@host:port.

    `_open` is None outside `scope`. AsyncRuntime runs tasks on threads, so the
    lock guards it and the pools' session counts.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._open: dict[str, _Pool] | None = None

    @contextmanager
    def scope(self) -> Iterator[None]:
        with self._lock:
            if self._open is not None:
                msg = "shared ssh connections are already open"
                raise RuntimeError(msg)
            self._open = {}
        try:
            yield
        finally:
            with self._lock:
                opened = self._open or {}
                self._open = None
            with ExitStack() as closing:
                for pool in opened.values():
                    closing.callback(pool.close)

    @contextmanager
    def session(self, host: Remote) -> Iterator[Remote]:
        key = host.ssh_url()
        with self._lock:
            if self._open is None:
                msg = "ssh connection requested outside shared_connections()"
                raise RuntimeError(msg)
            pool = self._open.get(key)
            if pool is None:
                pool = _Pool(host)
                self._open[key] = pool
            master = pool.claim()
        try:
            with master.starting:
                if not _master_running(master.control_socket):
                    # A master killed without cleanup leaves its socket behind,
                    # and every client that finds it refused would unlink it and
                    # become a master itself.
                    master.control_socket.unlink(missing_ok=True)
                    master.remote.run(["true"], RunOpts(log=Log.NONE))
            yield master.remote
        finally:
            with self._lock:
                pool.release(master)

    def close(self, host: Remote) -> None:
        with self._lock:
            pool = None if self._open is None else self._open.pop(host.ssh_url(), None)
        if pool is not None:
            pool.close()


_SHARED = _SharedConnections()


def shared_connections() -> AbstractContextManager[None]:
    """Keep the ssh ControlMasters to each machine open until the block ends.

    A master that dies, because its machine rebooted or ControlPersist expired
    while idle, is restarted before the next command runs.
    """
    return _SHARED.scope()


def remote_connection(host: Remote) -> SharedConnection:
    """The run's shared connection to `host`, opened on first use."""
    return SharedConnection(host)


def _target(machine: Machine) -> Remote:
    return machine.target_host().override(host_key_check="none")


def machine_connection(machine: Machine) -> SharedConnection:
    """The run's shared connection to `machine`, opened on first use."""
    return SharedConnection(_target(machine))


def session(connection: SharedConnection) -> AbstractContextManager[Remote]:
    """A Remote on a master with a free session, held until the block ends.

    For a command that must not be retried. `ssh_run` takes a session itself.
    """
    return _SHARED.session(connection.host)


def close_machine_connection(machine: Machine) -> None:
    """Stop the shared masters to `machine`; the next command opens a new one.

    For after a reboot, when a master whose connection died without a FIN would
    otherwise take every later command with it.
    """
    _SHARED.close(_target(machine))


def _connection_failed(result: object) -> bool:
    return isinstance(result, CmdOut) and result.returncode == SSH_CONNECTION_FAILED


def _retry_connection_failure[R](
    operation: Callable[[], R], host: Remote, what: str
) -> R:
    """Run `operation`, again after a short backoff when ssh exits with 255.

    A command run with `check=False` returns its CmdOut instead of raising, so a
    returned exit code of 255 counts as a connection failure too.
    """
    for attempt in range(1, SSH_ATTEMPTS):
        try:
            result = operation()
        except ClanCmdError as e:
            if e.cmd.returncode != SSH_CONNECTION_FAILED:
                raise
        else:
            if not _connection_failed(result):
                return result
        delay = SSH_RETRY_DELAY_SECONDS * 2 ** (attempt - 1)
        log.warning(
            f"ssh to {host.target} exited with {SSH_CONNECTION_FAILED} ({what}), "
            f"attempt {attempt}/{SSH_ATTEMPTS}, retrying in {delay:.0f}s"
        )
        interruptible_sleep(delay)
    return operation()


def ssh_run(
    connection: SharedConnection,
    cmd: list[str],
    opts: RunOpts | None = None,
    extra_env: dict[str, str] | None = None,
) -> CmdOut:
    """`Remote.run` on a shared master, retried when the ssh connection fails.

    Do not use it for a command that ends the connection on purpose (`reboot`):
    ssh exits with 255 there as well.
    """

    def attempt() -> CmdOut:
        with session(connection) as remote:
            # Remote.run mutates its RunOpts (prefix, shell), so each attempt
            # gets a copy.
            return remote.run(cmd, copy.copy(opts), extra_env=extra_env)

    return _retry_connection_failure(attempt, connection.host, shlex.join(cmd)[:80])


def ssh_upload(
    connection: SharedConnection,
    local_src: Path,
    remote_dest: Path,
    file_mode: int = 0o400,
) -> None:
    """clan's `upload` on a shared master, retried when the ssh connection fails.

    The whole upload is repeated, because the tarball stream of a failed attempt
    may have been partly read.
    """

    def attempt() -> None:
        with session(connection) as remote:
            upload(remote, local_src, remote_dest, file_mode=file_mode)

    _retry_connection_failure(attempt, connection.host, f"upload {remote_dest}")
