"""Commands and file uploads on the benchmark machines, over clan's ssh.

ssh exits with 255 when the connection itself fails, for example when the banner
exchange times out. About 1-5 % of new connections from the workstation do, with
and without impairment. Such a failure is retried; a command that ran and failed
on the remote side is not.
"""

import copy
import logging
import shlex
from collections.abc import Callable
from pathlib import Path

from clan_lib.cmd import CmdOut, RunOpts
from clan_lib.errors import ClanCmdError
from clan_lib.ssh.remote import Remote
from clan_lib.ssh.upload import upload

from vpn_bench.retry import interruptible_sleep

log = logging.getLogger(__name__)

SSH_CONNECTION_FAILED = 255
SSH_ATTEMPTS = 3
# Failures can come in bursts of a few seconds: wait 5 s, then 10 s.
SSH_RETRY_DELAY_SECONDS = 5.0


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
