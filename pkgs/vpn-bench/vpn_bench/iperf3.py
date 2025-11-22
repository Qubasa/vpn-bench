import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine
from clan_lib.nix import nix_command

# from clan_lib.ssh.upload import upload

log = logging.getLogger(__name__)


@dataclass
class IperfCreds:
    username: str
    password: str
    pubkey: Path


def run_iperf_test(
    machine: Machine,
    target_host: str,
    creds: IperfCreds,
    target_machine: Machine,
    udp_mode: bool = False,
    timeout: int = 250,
) -> dict[str, Any]:
    """Run a single iperf3 test and return the results.

    Args:
        machine: The source machine to run the test from
        target_host: The VPN hostname to connect to (e.g., "vpn.yuki")
        creds: Iperf3 credentials
        udp_mode: Whether to run in UDP mode
        target_machine: The target Machine object for SSH access (uses public IP)
        timeout: SSH command timeout in seconds (default 250 for TCP, use 120 for UDP)
    """

    bench_cmd = [
        "shell",
        "nixpkgs#iperf3",
        "-c",
        "iperf3",
        "--bidir",
        "--connect-timeout",
        "600",  # 5 seconds
        "--time",
        "30",  # 30 seconds
        "--json",
        "-Z",
        "-c",
        target_host,
        "--username",
        creds.username,
        "--rsa-public-key-path",
        str(creds.pubkey),
    ]

    if udp_mode:
        bench_cmd.extend(["-u", "--udp-counters-64bit", "-b", "0"])

    # Restart iperf3 service on target (server) before running the test
    if target_machine:
        # Use the target machine's public IP for SSH
        target = target_machine.target_host().override(host_key_check="none")
    with target.host_connection() as ssh:
        ssh.run(["systemctl", "restart", "iperf3.service"], RunOpts(log=Log.BOTH))

    # Run iperf3 client on source machine
    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        # Set the password for the iperf3 server
        res = ssh.run(
            nix_command(bench_cmd),
            RunOpts(log=Log.BOTH, timeout=timeout),
            extra_env={"IPERF3_PASSWORD": creds.password},
        )

    return json.loads(res.stdout)
