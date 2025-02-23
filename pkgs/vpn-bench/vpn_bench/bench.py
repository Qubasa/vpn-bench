import json
import logging
from dataclasses import dataclass
from typing import Any

from clan_cli.api import dataclass_to_dict
from clan_cli.async_run import AsyncFutureRef, AsyncRuntime
from clan_cli.cmd import CmdOut
from clan_cli.facts.list import get_all_facts
from clan_cli.flake import Flake
from clan_cli.inventory import patch_inventory_with
from clan_cli.machines.machines import Machine
from clan_cli.machines.update import deploy_machines
from clan_cli.nix import nix_shell
from clan_cli.ssh.host_key import HostKeyCheck

# from clan_cli.ssh.upload import upload
from vpn_bench.data import VPN, Config
from vpn_bench.errors import VpnBenchError
from vpn_bench.iperf_report import compare_vpn_reports
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


@dataclass
class BenchMachine:
    cmachine: Machine
    vpn_ip: str
    iperf_report: dict[str, Any] | None = None


def install_zerotier(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory: dict[str, Any] = {
        "zerotier": {
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
        },
    }
    for machine_num, tr_machine in enumerate(tr_machines):
        # Configure ZeroTier role
        if machine_num == 0:
            log.info(f"Setting up {tr_machine['name']} as the zerotier controller")
            inventory["zerotier"]["someid"]["roles"]["controller"]["machines"].append(
                tr_machine["name"]
            )
        else:
            log.info(f"Adding {tr_machine['name']} to the zerotier peers")
            inventory["zerotier"]["someid"]["roles"]["peer"]["machines"].append(
                tr_machine["name"]
            )

    patch_inventory_with(config.clan_dir, "services.zerotier", inventory)


def benchmark_vpn(config: Config, vpn: VPN, tr_machines: list[TrMachine]) -> None:
    clan_dir = Flake(str(config.clan_dir))

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
    deploy_machines(machines)

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
    with AsyncRuntime() as ctx:
        futures: list[AsyncFutureRef[CmdOut, BenchMachine]] = []
        for bmachine in bmachines:
            host = bmachine.cmachine.target_host
            log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")
            future: AsyncFutureRef[CmdOut, BenchMachine] = ctx.async_run_ref(
                bmachine,
                None,
                host.run,
                nix_shell(["nixpkgs#iperf3"], ["iperf3", "--json", "-c", "qube.email"]),
            )
            futures.append(future)

        for fut in futures:
            fut.wait()
            res = fut.get_result()
            assert res is not None
            json_data = json.loads(res.result.stdout)
            assert fut.ref is not None
            fut.ref.iperf_report = {"qube.email": json_data}

    # Save reports
    reports: Any = {}
    for bmachine in bmachines:
        assert bmachine.iperf_report is not None
        json_data = dataclass_to_dict(bmachine)
        result_dir = config.bench_dir / bmachine.cmachine.name
        result_dir.mkdir(parents=True, exist_ok=True)
        with (result_dir / "report.json").open("w") as f:
            json.dump(json_data, f, indent=4)
        reports[f"Host {bmachine.cmachine.name} -> qube.email"] = bmachine.iperf_report

    # Compare reports
    compare_vpn_reports(reports, config.bench_dir)
