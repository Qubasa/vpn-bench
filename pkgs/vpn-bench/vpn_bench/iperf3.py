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
    machine: Machine, target_host: str, creds: IperfCreds, udp_mode: bool = False
) -> dict[str, Any]:
    """Run a single iperf3 test and return the results."""

    bench_cmd = [
        "shell",
        "nixpkgs#iperf3",
        "-c",
        "iperf3",
        "--bidir",
        "--connect-timeout",
        "600",  # 5 seconds
        "--time",
        "45",  # 45 seconds
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

    host = machine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        # Restart iperf3 service before running the test
        ssh.run(["systemctl", "restart", "iperf3.service"], RunOpts(log=Log.BOTH))
        # Set the password for the iperf3 server
        res = ssh.run(
            nix_command(bench_cmd),
            RunOpts(log=Log.BOTH, timeout=60),  # 60 seconds
            extra_env={"IPERF3_PASSWORD": creds.password},
        )

    return json.loads(res.stdout)
