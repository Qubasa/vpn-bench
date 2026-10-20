"""Commands and file uploads on the benchmark machines, over clan's ssh.

Every command to a machine goes through one ssh ControlMaster that stays open for
the whole run, see `shared_connections`. A clan `host_connection` per command
would open a new ssh connection each time, and a run with parallel tests on
several machines then holds dozens at once.

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


@dataclass(frozen=True)
class _Connection:
    remote: Remote
    control_socket: Path
    stack: ExitStack
    # Held while a master is started, so parallel commands wait for it instead
    # of each becoming a master of its own.
    starting: threading.Lock


def _open_connection(host: Remote) -> _Connection:
    stack = ExitStack()
    remote = stack.enter_context(host.host_connection())
    # clan has no public accessor; remote.py puts the socket here.
    control_dir = remote._control_path_dir  # noqa: SLF001
    if control_dir is None:
        stack.close()
        msg = f"clan's host_connection set no ControlPath for {host.target}"
        raise RuntimeError(msg)
    return _Connection(remote, control_dir / "socket", stack, threading.Lock())


def _master_running(control_socket: Path) -> bool:
    with socket.socket(socket.AF_UNIX) as probe:
        try:
            probe.connect(str(control_socket))
        except OSError:
            return False
    return True


class _SharedConnections:
    """clan host_connections kept open per ssh target, keyed by user@host:port.

    `_open` is None outside `scope`. AsyncRuntime runs tasks on threads, so the
    lock guards it.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._open: dict[str, _Connection] | None = None

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
                for connection in opened.values():
                    closing.callback(connection.stack.close)

    def get(self, host: Remote) -> Remote:
        key = host.ssh_url()
        with self._lock:
            if self._open is None:
                msg = "ssh connection requested outside shared_connections()"
                raise RuntimeError(msg)
            connection = self._open.get(key)
            if connection is None:
                connection = _open_connection(host)
                self._open[key] = connection
        with connection.starting:
            if not _master_running(connection.control_socket):
                # A master killed without cleanup leaves its socket behind, and
                # every client that finds it refused would unlink it and become
                # a master itself.
                connection.control_socket.unlink(missing_ok=True)
                ssh_run(connection.remote, ["true"], RunOpts(log=Log.NONE))
        return connection.remote

    def close(self, host: Remote) -> None:
        with self._lock:
            connection = (
                None if self._open is None else self._open.pop(host.ssh_url(), None)
            )
        if connection is not None:
            connection.stack.close()


_SHARED = _SharedConnections()


def shared_connections() -> AbstractContextManager[None]:
    """Keep one ssh ControlMaster per machine open until the block ends.

    A master that dies, because its machine rebooted or ControlPersist expired
    while idle, is restarted before the next command runs. sshd's MaxSessions
    (10 by default) caps how many commands may run on one machine at the same
    time.
    """
    return _SHARED.scope()


def remote_connection(host: Remote) -> Remote:
    """The run's shared connection to `host`, opened on first use."""
    return _SHARED.get(host)


def _target(machine: Machine) -> Remote:
    return machine.target_host().override(host_key_check="none")


def machine_connection(machine: Machine) -> Remote:
    """The run's shared connection to `machine`, opened on first use."""
    return _SHARED.get(_target(machine))


def close_machine_connection(machine: Machine) -> None:
    """Stop the shared master to `machine`; the next command opens a new one.

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
    ssh: Remote,
    cmd: list[str],
    opts: RunOpts | None = None,
    extra_env: dict[str, str] | None = None,
) -> CmdOut:
    """`ssh.run`, retried when the ssh connection fails.

    Do not use it for a command that ends the connection on purpose (`reboot`):
    ssh exits with 255 there as well.
    """
    # Remote.run mutates its RunOpts (prefix, shell), so each attempt gets a copy.
    return _retry_connection_failure(
        lambda: ssh.run(cmd, copy.copy(opts), extra_env=extra_env),
        ssh,
        shlex.join(cmd)[:80],
    )


def ssh_upload(
    ssh: Remote, local_src: Path, remote_dest: Path, file_mode: int = 0o400
) -> None:
    """clan's `upload`, retried when the ssh connection fails.

    The whole upload is repeated, because the tarball stream of a failed attempt
    may have been partly read.
    """
    _retry_connection_failure(
        lambda: upload(ssh, local_src, remote_dest, file_mode=file_mode),
        ssh,
        f"upload {remote_dest}",
    )
