import json
import logging
from typing import Any

from clan_cli.api import dataclass_to_dict
from clan_cli.cmd import run
from clan_cli.facts.generate import generate_facts
from clan_cli.facts.list import get_all_facts
from clan_cli.flake import Flake
from clan_cli.inventory import patch_inventory_with
from clan_cli.machines.machines import Machine
from clan_cli.machines.update import deploy_machines
from clan_cli.ssh.host import Host
from clan_cli.ssh.host_key import HostKeyCheck
from clan_cli.vars.generate import generate_vars
from clan_cli.vars.get import get_var
from clan_cli.vars.list import stringify_all_vars

from vpn_bench.connection_timings import (
    download_connection_timings,
    install_connection_timings_conf,
    reboot_connection_timings,
)

# from clan_cli.ssh.upload import upload
# from clan_cli.ssh.upload import upload
from vpn_bench.data import VPN, BenchMachine, Config, delete_dirs
from vpn_bench.errors import VpnBenchError

# from clan_cli.ssh.upload import upload
from vpn_bench.install import can_ssh_login
from vpn_bench.setup import create_base_inventory
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


def install_base_config(config: Config, tr_machines: list[TrMachine]) -> None:
    conf = create_base_inventory(tr_machines, config.ssh_keys)
    patch_inventory_with(config.clan_dir, "services", conf)


def install_zerotier(config: Config, tr_machines: list[TrMachine]) -> None:
    base = create_base_inventory(tr_machines, config.ssh_keys)
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

    base["zerotier"] = conf
    patch_inventory_with(config.clan_dir, "services", base)


def install_mycelium(config: Config, tr_machines: list[TrMachine]) -> None:
    base = create_base_inventory(tr_machines, config.ssh_keys)
    conf: dict[str, Any] = {
        "someid": {
            "roles": {
                "peer": {
                    "machines": [],
                    "config": {"openFirewall": True, "addHostedPublicNodes": True},
                },
            }
        }
    }
    for _, tr_machine in enumerate(tr_machines):
        log.info(f"Adding {tr_machine['name']} to the mycelium peers")
        conf["someid"]["roles"]["peer"]["machines"].append(tr_machine["name"])

    base["mycelium"] = conf
    patch_inventory_with(config.clan_dir, "services", base)


def get_vpn_ips(
    config: Config, machines: list[Machine], vpn: VPN
) -> list[BenchMachine]:
    """Query and collect VPN IPs for each machine."""
    bmachines: list[BenchMachine] = []
    generate_facts(machines)
    generate_vars(machines)
    for machine in machines:
        log.info(stringify_all_vars(machine))
        facts = get_all_facts(machine)["TODO"]
        vpn_ip: str | None = None
        match vpn:
            case VPN.Zerotier:
                vpn_ip = facts["zerotier-ip"].decode()
            case VPN.Mycelium:
                vpn_ip = (
                    get_var(str(config.clan_dir), machine.name, "mycelium/ip")
                    .value.decode()
                    .strip("\n")
                )  # TODO: Fix the newline in the var
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


def save_machine_layout(
    config: Config, vpn: VPN, bmachines: list[BenchMachine]
) -> None:
    """Save the machine layout to a file."""

    layout = dataclass_to_dict(bmachines)
    result_dir = config.bench_dir / vpn.name
    result_dir.mkdir(parents=True, exist_ok=True)
    with (result_dir / "layout.json").open("w") as f:
        json.dump(layout, f, indent=4)


def install_vpn(
    config: Config,
    vpn: VPN,
    tr_machines: list[TrMachine],
    get_con_times: bool = True,
) -> list[BenchMachine]:
    # Update cvpn-bench flake input, else error because of mismatched input
    run(["nix", "flake", "update", "cvpn-bench", "--flake", str(config.clan_dir)])

    install_base_config(config, tr_machines)

    # Initialize and configure machines
    machines = create_machine_obj(config, tr_machines)

    if get_con_times:
        # Update machine without VPNs to remove any previous VPN configuration
        deploy_machines(machines)

        state_dirs = [
            "/root/qperf",
            "/var/lib/qperf/qperf",
            "/etc/zerotier",
            "/var/lib/zerotier-one",
            "/var/lib/mycelium",
            "/var/lib/private/mycelium/",
            "/var/lib/connection-check",
        ]
        delete_dirs(state_dirs, machines)

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

    # Recreate machine objects, else the Flake object will point to
    # an old version of the Flake
    # FIXME: machine.flake.prefetch() does not work, but should invalidate the cache
    # TODO: Find should find a automated way to reset the Flake object as bugs that arise
    # from this are super hard to debug
    machines = create_machine_obj(config, tr_machines)

    # Get the VPN IP of each machine
    bmachines = get_vpn_ips(config, machines, vpn)
    save_machine_layout(config, vpn, bmachines)

    if get_con_times:
        # Install VPN connection timing service
        install_connection_timings_conf(config, tr_machines, bmachines)

    # Update machine configuration with VPNs
    deploy_machines(machines)

    if get_con_times:
        download_connection_timings(config, vpn, machines)
        reboot_connection_timings(config, vpn, machines)

    return bmachines
