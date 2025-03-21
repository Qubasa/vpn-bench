import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clan_cli.cmd import Log, RunOpts
from clan_cli.nix import nix_command
from clan_cli.ssh.host import Host

# from clan_cli.ssh.upload import upload

log = logging.getLogger(__name__)


@dataclass
class IperfCreds:
    username: str
    password: str
    pubkey: Path


def run_iperf_test(
    host: Host, target_host: str, creds: IperfCreds, udp_mode: bool = False
) -> dict[str, Any]:
    """Run a single iperf3 test and return the results."""
    cmd = [
        "shell",
        "nixpkgs#iperf3",
        "-c",
        "iperf3",
        "--bidir",
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
        cmd.extend(["-u", "--udp-counters-64bit", "-b", "0"])

    res = host.run(
        nix_command(cmd),
        RunOpts(log=Log.BOTH),
        extra_env={"IPERF3_PASSWORD": creds.password},
    )
    return json.loads(res.stdout)


def save_iperf_results(
    result_dir: Path, json_data: dict[str, Any], test_type: str
) -> None:
    """Save iperf test results to a file."""
    result_dir.mkdir(parents=True, exist_ok=True)
    with (result_dir / f"{test_type}_iperf3.json").open("w") as f:
        json.dump(json_data, f, indent=4)
