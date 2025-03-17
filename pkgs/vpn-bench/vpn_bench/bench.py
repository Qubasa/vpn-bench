import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clan_cli.cmd import Log, RunOpts
from clan_cli.nix import nix_command
from clan_cli.ssh.upload import upload

from vpn_bench.assets import get_iperf_asset

# from clan_cli.ssh.upload import upload
from vpn_bench.data import VPN, BenchMachine, Config
from vpn_bench.terraform import TrMachine
from vpn_bench.vpn import install_vpn

log = logging.getLogger(__name__)


@dataclass
class IperfCreds:
    username: str
    password: str
    pubkey: Path


def run_iperf_test(
    host: Any, target_host: str, creds: IperfCreds, udp_mode: bool = False
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


def run_benchmarks(config: Config, vpn: VPN, bmachines: list[BenchMachine]) -> None:
    """Run TCP and UDP benchmarks for each machine."""

    # Upload iperf3 public key
    remote_iperf3_pubkey = Path("/tmp/iperf3.public")
    for pos, bmachine in enumerate(bmachines):
        next_bmachine = bmachines[pos + 1] if pos + 1 < len(bmachines) else bmachines[0]
        host = bmachine.cmachine.target_host
        log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")
        result_dir = config.bench_dir / vpn.name / f"{pos}_{bmachine.cmachine.name}"

        creds = None
        local_pubkey = None
        match vpn:
            case VPN.External:
                local_pubkey = get_iperf_asset("clan_public.pem")
                password = get_iperf_asset("clan_password.txt").read_text()
                creds = IperfCreds(
                    username="mario", password=password, pubkey=remote_iperf3_pubkey
                )
            case _:
                local_pubkey = get_iperf_asset("vpb_public.pem")
                password = get_iperf_asset("vpb_password.txt").read_text()
                creds = IperfCreds(
                    username="mario", password=password, pubkey=remote_iperf3_pubkey
                )

        # Upload iperf3 public key
        upload(host, local_pubkey, remote_iperf3_pubkey)

        # Run TCP test
        tcp_results = run_iperf_test(host, next_bmachine.vpn_ip, creds, udp_mode=False)
        save_iperf_results(result_dir, tcp_results, "tcp")

        match vpn:
            case vpn.Mycelium:
                pass
            case _:
                # Run UDP test
                udp_results = run_iperf_test(
                    host, next_bmachine.vpn_ip, creds, udp_mode=True
                )
                save_iperf_results(result_dir, udp_results, "udp")


def benchmark_vpn(
    config: Config, vpn: VPN, tr_machines: list[TrMachine], only_update: bool = False
) -> None:
    """Main function to coordinate VPN benchmarking."""
    log.info(f"Benchmarking VPN {vpn}")

    # Install VPN
    bmachines = install_vpn(config, vpn, tr_machines)

    if not only_update:
        # Run benchmarks
        run_benchmarks(config, vpn, bmachines)
    else:
        log.info("Only updating the machine configuration, skipping benchmarks")
