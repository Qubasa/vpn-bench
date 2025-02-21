import json
import logging
from dataclasses import dataclass
from typing import Any

from clan_cli.api import dataclass_to_dict
from clan_cli.async_run import AsyncFuture, AsyncOpts, AsyncRuntime
from clan_cli.cmd import CmdOut
from clan_cli.facts.list import get_all_facts
from clan_cli.flake import Flake
from clan_cli.machines.machines import Machine
from clan_cli.ssh.host_key import HostKeyCheck
from clan_cli.nix import nix_shell


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


def benchmark_vpn(config: Config, vpn: VPN, tr_machines: list[TrMachine]) -> None:
    bmachines: list[BenchMachine] = []

    log.info(f"Benchmarking VPN {vpn}")

    clan_dir = Flake(str(config.clan_dir))

    for tr_machine in tr_machines:
        machine = Machine(
            name=tr_machine["name"], flake=clan_dir, host_key_check=HostKeyCheck.NONE
        )

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

    with AsyncRuntime() as ctx:
        futures: list[AsyncFuture[CmdOut, BenchMachine]] = []
        for bmachine in bmachines:
            host = bmachine.cmachine.target_host
            # upload(host, )
            log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")
            future: AsyncFuture[CmdOut, BenchMachine] = ctx.async_run(
                AsyncOpts(reference=bmachine),
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

    reports: Any = {}
    for bmachine in bmachines:
        assert bmachine.iperf_report is not None
        json_data = dataclass_to_dict(bmachine)
        result_dir = config.bench_dir / bmachine.cmachine.name
        result_dir.mkdir(parents=True, exist_ok=True)
        with (result_dir / "report.json").open("w") as f:
            json.dump(json_data, f, indent=4)
        reports[f"Host {bmachine.cmachine.name} -> qube.email"] = bmachine.iperf_report

    compare_vpn_reports(reports, config.bench_dir)
