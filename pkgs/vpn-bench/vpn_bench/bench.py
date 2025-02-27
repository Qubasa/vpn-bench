import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clan_cli.cmd import Log, RunOpts, run
from clan_cli.facts.list import get_all_facts
from clan_cli.flake import Flake
from clan_cli.inventory import patch_inventory_with
from clan_cli.machines.machines import Machine
from clan_cli.nix import nix_command
from clan_cli.ssh.host_key import HostKeyCheck
from clan_cli.ssh.upload import upload

from vpn_bench.assets import get_asset

# from clan_cli.ssh.upload import upload
from vpn_bench.data import VPN, Config
from vpn_bench.errors import VpnBenchError
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


@dataclass
class BenchMachine:
    cmachine: Machine
    vpn_ip: str
    iperf_report: dict[str, Any] | None = None


def install_zerotier(config: Config, tr_machines: list[TrMachine]) -> None:
    zerotier_conf: dict[str, Any] = {
        "someid": {
            "roles": {
                "controller": {
                    "machines": [],
                    "config": {},
                },
                "peer": {
                    "machines": [],
                    "config": {},
                },
            }
        }
    }
    for machine_num, tr_machine in enumerate(tr_machines):
        # Configure ZeroTier role
        if machine_num == 0:
            log.info(f"Setting up {tr_machine['name']} as the zerotier controller")
            zerotier_conf["someid"]["roles"]["controller"]["machines"].append(
                tr_machine["name"]
            )
        else:
            log.info(f"Adding {tr_machine['name']} to the zerotier peers")
            zerotier_conf["someid"]["roles"]["peer"]["machines"].append(
                tr_machine["name"]
            )

    patch_inventory_with(config.clan_dir, "services.zerotier", zerotier_conf)


def benchmark_vpn(config: Config, vpn: VPN, tr_machines: list[TrMachine]) -> None:
    clan_dir = Flake(str(config.clan_dir))

    # TODO: Add build_host test in clan-cli
    machines = [
        Machine(
            name=tr_machine["name"], flake=clan_dir, host_key_check=HostKeyCheck.NONE
        )
        for tr_machine in tr_machines
    ]

    bmachines: list[BenchMachine] = []

    log.info(f"Benchmarking VPN {vpn}")

    # Add VPN to the inventory
    match vpn:
        case VPN.Zerotier:
            install_zerotier(config, tr_machines)
        case VPN.Mycelium:
            raise NotImplementedError
        case _:
            msg = f"VPN {vpn} not supported"
            raise VpnBenchError(msg)

    # Update machines
    # deploy_machines(machines)

    run(["nix", "flake", "update", "cvpn-bench", "--flake", str(clan_dir)])
    # Query VPN IPs
    for machine in machines:
        facts = get_all_facts(machine)["TODO"]
        match vpn:
            case VPN.Zerotier:
                vpn_ip = facts["zerotier-ip"].decode()
            case VPN.Mycelium:
                raise NotImplementedError
            case _:
                msg = f"VPN {vpn} not supported"
                raise VpnBenchError(msg)

        bmachines.append(BenchMachine(cmachine=machine, vpn_ip=vpn_ip))

    # Run iperf3
    for bmachine in bmachines:
        host = bmachine.cmachine.target_host
        log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")

        local_iperf3_pubkey = get_asset("iperf3.public")
        remote_iperf3_pubkey = Path("/tmp/iperf3.public")
        upload(host, local_iperf3_pubkey, remote_iperf3_pubkey)
        # TCP test
        res = host.run(
            nix_command(
                [
                    "shell",
                    "nixpkgs#iperf3",
                    "-c",
                    "iperf3",
                    "-Z",
                    "--bidir",
                    "--json",
                    "-c",
                    "gchq.icu",
                    "--username",
                    "mario",
                    "--rsa-public-key-path",
                    str(remote_iperf3_pubkey),
                ]
            ),
            RunOpts(log=Log.BOTH),
            extra_env={"IPERF3_PASSWORD": "mambaBudo"},
        )
        json_data = json.loads(res.stdout)

        result_dir = config.bench_dir / bmachine.cmachine.name / vpn.name
        result_dir.mkdir(parents=True, exist_ok=True)
        with (result_dir / "tcp_iperf3.json").open("w") as f:
            json.dump(json_data, f, indent=4)

        # UDP test
        res = host.run(
            nix_command(
                [
                    "shell",
                    "nixpkgs#iperf3",
                    "-c",
                    "iperf3",
                    "--bidir",
                    "--json",
                    "-Z",
                    "-u",
                    "--udp-counters-64bit",
                    "-c",
                    "gchq.icu",
                    "--username",
                    "mario",
                    "--rsa-public-key-path",
                    str(remote_iperf3_pubkey),
                ]
            ),
            RunOpts(log=Log.BOTH),
            extra_env={"IPERF3_PASSWORD": "mambaBudo"},
        )
        json_data = json.loads(res.stdout)

        result_dir = config.bench_dir / bmachine.cmachine.name / vpn.name
        result_dir.mkdir(parents=True, exist_ok=True)
        with (result_dir / "udp_iperf3.json").open("w") as f:
            json.dump(json_data, f, indent=4)
