import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clan_cli.api import dataclass_to_dict
from clan_cli.async_run import AsyncRuntime
from clan_cli.cmd import Log, RunOpts, run
from clan_cli.facts.generate import generate_facts
from clan_cli.facts.list import get_all_facts
from clan_cli.flake import Flake
from clan_cli.inventory import patch_inventory_with
from clan_cli.machines.machines import Machine
from clan_cli.machines.update import deploy_machines
from clan_cli.nix import nix_command
from clan_cli.ssh.host import Host
from clan_cli.ssh.host_key import HostKeyCheck
from clan_cli.ssh.upload import upload
from clan_cli.vars.get import get_var

from vpn_bench.assets import get_iperf_asset

# from clan_cli.ssh.upload import upload
from vpn_bench.data import VPN, Config
from vpn_bench.errors import VpnBenchError
from vpn_bench.install import can_ssh_login
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


@dataclass
class BenchMachine:
    cmachine: Machine
    vpn_ip: str


def install_zerotier(config: Config, tr_machines: list[TrMachine]) -> None:
    conf: dict[str, Any] = {
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
            conf["someid"]["roles"]["controller"]["machines"].append(tr_machine["name"])
        else:
            log.info(f"Adding {tr_machine['name']} to the zerotier peers")
            conf["someid"]["roles"]["peer"]["machines"].append(tr_machine["name"])

    patch_inventory_with(config.clan_dir, "services.zerotier", conf)


def install_mycelium(config: Config, tr_machines: list[TrMachine]) -> None:
    conf: dict[str, Any] = {
        "someid": {
            "roles": {
                "peer": {
                    "machines": [],
                    "config": {},
                },
            }
        }
    }
    for _, tr_machine in enumerate(tr_machines):
        log.info(f"Adding {tr_machine['name']} to the mycelium peers")
        conf["someid"]["roles"]["peer"]["machines"].append(tr_machine["name"])

    patch_inventory_with(config.clan_dir, "services.mycelium", conf)


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
        cmd.extend(["-u", "--udp-counters-64bit"])

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

        # Run UDP test
        udp_results = run_iperf_test(host, next_bmachine.vpn_ip, creds, udp_mode=True)
        save_iperf_results(result_dir, udp_results, "udp")


def create_machine_obj(config: Config, tr_machines: list[TrMachine]) -> list[Machine]:
    """Initialize Machine objects for each terraform machine."""
    clan_dir = Flake(str(config.clan_dir))

    build_host = (
        "root@localhost" if can_ssh_login(Host(host="localhost", user="root")) else None
    )

    return [
        Machine(
            name=tr_machine["name"],
            flake=clan_dir,
            host_key_check=HostKeyCheck.NONE,
            override_build_host=build_host,
            private_key=config.ssh_keys[0].private,
        )
        for tr_machine in tr_machines
    ]


def get_vpn_ips(
    config: Config, machines: list[Machine], vpn: VPN
) -> list[BenchMachine]:
    """Query and collect VPN IPs for each machine."""
    bmachines: list[BenchMachine] = []
    for machine in machines:
        generate_facts([machine])
        facts = get_all_facts(machine)["TODO"]
        vpn_ip: str | None = None
        match vpn:
            case VPN.Zerotier:
                vpn_ip = facts["zerotier-ip"].decode()
            case VPN.Mycelium:
                vpn_ip = get_var(
                    str(config.clan_dir), machine.name, "mycelium/ip"
                ).value.decode()
            case VPN.External:
                vpn_ip = "clan.lol"
            case VPN.Internal:
                vpn_ip = machine.target_host.host
            case _:
                msg = f"VPN {vpn} not supported"
                raise VpnBenchError(msg)
        assert vpn_ip is not None
        bmachines.append(BenchMachine(cmachine=machine, vpn_ip=vpn_ip))
    return bmachines


def install_vpn(
    config: Config, vpn: VPN, tr_machines: list[TrMachine]
) -> list[Machine]:
    # Setup VPN configuration
    match vpn:
        case VPN.Zerotier:
            install_zerotier(config, tr_machines)
        case VPN.Mycelium:
            install_mycelium(config, tr_machines)
        case VPN.Internal | VPN.External:
            pass
        case _:
            msg = f"VPN {vpn} not supported"
            raise VpnBenchError(msg)

    # Initialize and configure machines
    machines = create_machine_obj(config, tr_machines)

    # Update cvpn-bench flake input, else error because of mismatched input
    run(["nix", "flake", "update", "cvpn-bench", "--flake", str(config.clan_dir)])

    # Update machine configuration
    deploy_machines(machines)

    # Restart zerotier-one on all machines except the first
    # TODO: This is a hack, we should have nix do this for us
    with AsyncRuntime() as runtime:
        for index, machine in enumerate(machines):
            host = machine.target_host
            match vpn:
                case VPN.Zerotier:
                    if index > 0:
                        runtime.async_run(
                            None, host.run, ["systemctl", "restart", "zerotierone"]
                        )
                case _:
                    pass

        runtime.join_all()
        runtime.check_all()

    return machines


def save_machine_layout(
    config: Config, vpn: VPN, bmachines: list[BenchMachine]
) -> None:
    """Save the machine layout to a file."""

    layout = dataclass_to_dict(bmachines)
    result_dir = config.bench_dir / vpn.name
    result_dir.mkdir(parents=True, exist_ok=True)
    with (result_dir / "layout.json").open("w") as f:
        json.dump(layout, f, indent=4)


def benchmark_vpn(config: Config, vpn: VPN, tr_machines: list[TrMachine]) -> None:
    """Main function to coordinate VPN benchmarking."""
    log.info(f"Benchmarking VPN {vpn}")

    # Install VPN
    machines = install_vpn(config, vpn, tr_machines)

    # Get the VPN IP of each machine
    bmachines = get_vpn_ips(config, machines, vpn)
    save_machine_layout(config, vpn, bmachines)

    # Run benchmarks
    run_benchmarks(config, vpn, bmachines)
