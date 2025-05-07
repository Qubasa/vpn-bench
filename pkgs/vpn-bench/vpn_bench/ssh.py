#!/usr/bin/env python3

import logging
import subprocess
from pathlib import Path

from clan_cli.cmd import Log, RunOpts, run
from clan_cli.machines.machines import Machine

# Clan TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.ssh.host_key import HostKeyCheck

from vpn_bench.data import SSHKeyPair, TrMachine

log = logging.getLogger(__name__)


def can_ssh_login(machine: Machine) -> bool:
    with machine.target_host() as host:
        host.host_key_check = HostKeyCheck.NONE
        host.ssh_options.update(
            {
                "PasswordAuthentication": "no",
                "BatchMode": "yes",
            }
        )

        result = host.run(["exit"], RunOpts(check=False, shell=True))

        # Check the return code
        return result.returncode == 0


def generate_ssh_key(root_dir: Path) -> SSHKeyPair:
    # do a ssh-keygen -t ed25519 -C "your_email@example.com"
    key_dir = root_dir / "keys"
    key_dir.mkdir(parents=True, exist_ok=True)
    key_dir.chmod(0o700)
    priv_key = key_dir / "id_ed25519"

    if not priv_key.exists():
        cmd = [
            "ssh-keygen",
            "-N",
            "",
            "-t",
            "ed25519",
            "-f",
            str(priv_key),
        ]
        run(cmd, RunOpts(log=Log.BOTH))

    return SSHKeyPair(
        private=priv_key,
        public=key_dir / "id_ed25519.pub",
    )


def ssh_into_machine(
    machines: list[TrMachine], target_name: str, keypair: SSHKeyPair
) -> None:
    found = False
    for machine in machines:
        if machine["name"] == target_name:
            found = True
            target = f"root@{machine['ipv4']}"
            log.info(f"ssh {target}")
            subprocess.run(["ssh", f"{target}", "-i", f"{keypair.private}"])
    if not found:
        log.error(f"Machine {target_name} not found")
