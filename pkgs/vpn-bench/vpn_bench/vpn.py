from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

from clan_cli.vars.get import get_machine_var
from clan_cli.vars.list import stringify_all_vars
from clan_lib.api import dataclass_to_dict
from clan_lib.async_run import AsyncContext, AsyncOpts, AsyncRuntime, get_async_ctx
from clan_lib.cmd import run
from clan_lib.errors import ClanError
from clan_lib.flake import Flake
from clan_lib.machines.machines import Machine
from clan_lib.machines.update import run_machine_update
from clan_lib.persist.inventory_store import InventoryStore, set_value_by_path_tuple
from clan_lib.ssh.remote import Remote
from clan_lib.vars.generate import run_generators

from vpn_bench.connection_timings import (
    download_connection_timings,
    install_connection_timings_conf,
    reboot_connection_timings,
)
from vpn_bench.data import VPN, BenchMachine, Config, Provider, SSHKeyPair, delete_dirs
from vpn_bench.errors import VpnBenchError
from vpn_bench.nix_cache import install_nix_cache
from vpn_bench.retry import retry_operation
from vpn_bench.setup import create_base_inventory
from vpn_bench.terraform import TrMachine

if TYPE_CHECKING:
    from vpn_bench.timing import TimingTracker

log = logging.getLogger(__name__)


def install_zerotier(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    conf: dict[str, Any] = {
        "module": {"name": "zerotier", "input": "cvpn-bench"},
        "roles": {
            "controller": {
                "machines": {},
            },
            "peer": {
                "machines": {},
            },
            "moon": {"machines": {}},
        },
    }
    for machine_num, tr_machine in enumerate(tr_machines):
        # Configure ZeroTier role
        if machine_num == 0:
            ipv4 = tr_machine["ipv4"]
            assert ipv4 is not None, (
                "Zerotier requires one public moon IPv4 address, for holepunching"
            )
            log.info(f"Setting up {tr_machine['name']} as the zerotier controller")
            conf["roles"]["controller"]["machines"][tr_machine["name"]] = {}
            conf["roles"]["moon"]["machines"][tr_machine["name"]] = {
                "settings": {"stableEndpoints": [ipv4]}
            }
        else:
            log.info(f"Adding {tr_machine['name']} to the zerotier peers")
            conf["roles"]["peer"]["machines"][tr_machine["name"]] = {}
    set_value_by_path_tuple(inventory, ("instances", "zerotier"), conf)
    inventory_store.write(inventory, message="Add zerotier configuration")


def install_nebula(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    conf: dict[str, Any] = {
        "module": {"name": "nebula", "input": "cvpn-bench"},
        "roles": {
            "lighthouse": {"machines": {}, "settings": {}},
            "peer": {
                "machines": {},
            },
        },
    }
    for machine_num, tr_machine in enumerate(tr_machines):
        if machine_num == 0:
            log.info(f"Setting up {tr_machine['name']} as a nebula lighthouse")
            conf["roles"]["lighthouse"]["machines"][tr_machine["name"]] = {}
            conf["roles"]["lighthouse"]["settings"]["publicAddress"] = tr_machine[
                "ipv4"
            ]
        else:
            log.info(f"Adding {tr_machine['name']} to the nebula peers")
            conf["roles"]["peer"]["machines"][tr_machine["name"]] = {}
    set_value_by_path_tuple(inventory, ("instances", "nebula"), conf)
    inventory_store.write(inventory, message="Add nebula configuration")


def install_tinc(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    conf: dict[str, Any] = {
        "module": {"name": "tinc", "input": "cvpn-bench"},
        "roles": {
            "bootstrap": {"machines": {}, "settings": {"publicAddress": {}}},
            "peer": {
                "machines": {},
            },
        },
    }
    for machine_num, tr_machine in enumerate(tr_machines):
        if machine_num == 0:
            log.info(f"Setting up {tr_machine['name']} as a tinc bootstrap node")
            conf["roles"]["bootstrap"]["machines"][tr_machine["name"]] = {}
            conf["roles"]["bootstrap"]["settings"]["publicAddress"] = tr_machine["ipv4"]
        else:
            log.info(f"Adding {tr_machine['name']} to the tinc peers")
            conf["roles"]["peer"]["machines"][tr_machine["name"]] = {}
    set_value_by_path_tuple(inventory, ("instances", "tinc"), conf)
    inventory_store.write(inventory, message="Add tinc configuration")


def install_easytier(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    conf: dict[str, Any] = {
        "module": {"name": "easytier", "input": "cvpn-bench"},
        "roles": {
            "bootstrap": {"machines": {}, "settings": {"publicAddress": {}}},
            "peer": {
                "machines": {},
            },
        },
    }
    for machine_num, tr_machine in enumerate(tr_machines):
        if machine_num == 0:
            log.info(f"Setting up {tr_machine['name']} as an easytier bootstrap node")
            conf["roles"]["bootstrap"]["machines"][tr_machine["name"]] = {}
            conf["roles"]["bootstrap"]["settings"]["publicAddress"] = tr_machine["ipv4"]
        else:
            log.info(f"Adding {tr_machine['name']} to the easytier peers")
            conf["roles"]["peer"]["machines"][tr_machine["name"]] = {}
    set_value_by_path_tuple(inventory, ("instances", "easytier"), conf)
    inventory_store.write(inventory, message="Add easytier configuration")


def install_mycelium(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    conf: dict[str, Any] = {
        "module": {"name": "mycelium", "input": "cvpn-bench"},
        "roles": {
            "peer": {
                "tags": {"all": {}},
                "settings": {"openFirewall": True, "addHostedPublicNodes": True},
            },
        },
    }
    set_value_by_path_tuple(inventory, ("instances", "mycelium"), conf)
    inventory_store.write(inventory, message="Add mycelium configuration")


def install_wireguard(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()

    machines = {}

    for num, machine in enumerate(tr_machines):
        if machine["ipv4"] is None:
            msg = "Wireguard requires public IPv4 addresses"
            raise VpnBenchError(msg)

        # TODO: We hardcode the IP address here
        # This should be generated by the module automatically
        machines[machine["name"]] = {
            "settings": {
                "endpoint": f"{machine['ipv4']}:6666",
                "address": f"192.168.2.{num + 1}",
            }
        }

    conf: dict[str, Any] = {
        "module": {"name": "wireguard", "input": "cvpn-bench"},
        "roles": {
            "mesh": {"machines": machines},
        },
    }
    set_value_by_path_tuple(inventory, ("instances", "wireguard-all"), conf)
    inventory_store.write(inventory, message="Add wireguard configuration")


def install_hyprspace(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    if tr_machines[0]["provider"] == Provider.Hetzner:
        block_addresses = True
    else:
        block_addresses = False
    conf: dict[str, Any] = {
        "module": {"name": "hyprspace", "input": "cvpn-bench"},
        "roles": {
            "server": {
                "tags": {"all": {}},
                "settings": {"blockRfc1918Addresses": block_addresses},
            },
        },
    }
    set_value_by_path_tuple(inventory, ("instances", "hyprspace-all"), conf)
    inventory_store.write(
        inventory,
        message="Add hyprspace configuration",
    )


def install_vpncloud(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    peer_ips = []

    for machine in tr_machines:
        if machine["ipv4"] is None:
            msg = "VPNCloud requires public IPv4 addresses"
            raise VpnBenchError(msg)
        # FIXME: Hardcoded port 17000, could be improved
        peer_ips.append(f"{machine['ipv4']}:17000")

    conf: dict[str, Any] = {
        "module": {"name": "vpncloud", "input": "cvpn-bench"},
        "roles": {
            "peer": {
                "tags": {"all": {}},
                "settings": {"peerIps": peer_ips},
            },
        },
    }
    set_value_by_path_tuple(inventory, ("instances", "vpncloud-all"), conf)
    inventory_store.write(inventory, message="Add vpncloud configuration")


def install_yggdrasil(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    peers = {}
    enable_mulicast = True
    if tr_machines[0]["provider"] == Provider.Hetzner:
        enable_mulicast = False

    for machine in tr_machines:
        if machine["ipv4"] is None:
            msg = "VPNCloud requires public IPv4 addresses"
            raise VpnBenchError(msg)

        peers[machine["name"]] = {
            "protocol": "quic",
            "ip": machine["ipv4"],
        }

    conf: dict[str, Any] = {
        "module": {"name": "yggdrasil", "input": "cvpn-bench"},
        "roles": {
            "peer": {
                "tags": {"all": {}},
                "settings": {"peers": peers, "enableMulticast": enable_mulicast},
            },
        },
    }
    set_value_by_path_tuple(inventory, ("instances", "yggdrasil-all"), conf)
    inventory_store.write(inventory, message="Add yggdrasil configuration")


def install_headscale(config: Config, tr_machines: list[TrMachine]) -> None:
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    conf: dict[str, Any] = {
        "module": {"name": "headscale", "input": "cvpn-bench"},
        "roles": {
            "controller": {"machines": {}, "settings": {}},
            "peer": {
                "machines": {},
            },
        },
    }
    for machine_num, tr_machine in enumerate(tr_machines):
        if machine_num == 0:
            if tr_machine["ipv4"] is None:
                msg = "Headscale controller requires a public IPv4 address"
                raise VpnBenchError(msg)
            log.info(f"Setting up {tr_machine['name']} as the headscale controller")
            conf["roles"]["controller"]["machines"][tr_machine["name"]] = {}
            conf["roles"]["controller"]["settings"]["publicAddress"] = tr_machine[
                "ipv4"
            ]
        # All machines (including controller) are peers
        log.info(f"Adding {tr_machine['name']} to the headscale peers")
        conf["roles"]["peer"]["machines"][tr_machine["name"]] = {}
    set_value_by_path_tuple(inventory, ("instances", "headscale"), conf)
    inventory_store.write(inventory, message="Add headscale configuration")


def get_vpn_ips(
    config: Config, machines: list[Machine], vpn: VPN
) -> list[BenchMachine]:
    """Query and collect VPN IPs for each machine."""
    bmachines: list[BenchMachine] = []
    # Invalidate cache for all machines
    for machine in machines:
        machine.flake.invalidate_cache()

    run_generators(machines=machines)
    for idx, machine in enumerate(machines):
        machine.flake.invalidate_cache()
        log.info(stringify_all_vars(machine))
        vpn_ip: str | None = None
        match vpn:
            case VPN.Zerotier:
                vpn_ip = get_machine_var(machine, "zerotier/zerotier-ip").value.decode()
            case VPN.Mycelium:
                vpn_ip = (
                    get_machine_var(machine, "mycelium/ip").value.decode().strip("\n")
                )  # TODO: Fix the newline in the var
            case VPN.Hyprspace:
                vpn_ip = get_machine_var(machine, "hyprspace/ip").value.decode()
            case VPN.VpnCloud:
                vpn_ip = get_machine_var(machine, "vpncloud/ip").value.decode()
            case VPN.Yggdrasil:
                vpn_ip = get_machine_var(machine, "yggdrasil/ip").value.decode()
            case VPN.Easytier:
                vpn_ip = get_machine_var(machine, "easytier-easytier/ip").value.decode()
            case VPN.Nebula:
                vpn_ip = get_machine_var(machine, "nebula-nebula/ip").value.decode()
            case VPN.Tinc:
                vpn_ip = get_machine_var(machine, "tinc-tinc/ip").value.decode()
            case VPN.Headscale:
                vpn_ip = get_machine_var(
                    machine, "headscale-headscale/ip"
                ).value.decode()
            case VPN.Wireguard:
                # TODO: We hardcode the IP address here
                # We should get it from the var
                vpn_ip = f"192.168.2.{idx + 1}"
            case VPN.Internal:
                host = machine.target_host().override(host_key_check="none")
                vpn_ip = host.address
            case _:
                msg = f"VPN {vpn} not supported"
                raise VpnBenchError(msg)
        assert vpn_ip is not None
        bmachines.append(BenchMachine(cmachine=machine, vpn_ip=vpn_ip))
    return bmachines


def save_machine_layout(
    config: Config, vpn: VPN, bmachines: list[BenchMachine]
) -> None:
    """Save the machine layout to a file."""

    layout = dataclass_to_dict(bmachines)
    result_dir = config.bench_dir / vpn.name
    result_dir.mkdir(parents=True, exist_ok=True)
    with (result_dir / "layout.json").open("w") as f:
        json.dump(layout, f, indent=4)


def deploy_machines(
    machines: list[Machine],
    build_host: Remote | None,
    ssh_key: SSHKeyPair,
    max_retries: int = 2,
) -> None:
    """
    Deploy machines with retry logic for robustness.

    Args:
        machines: List of machines to deploy
        build_host: Optional remote build host
        ssh_key: SSH key pair for authentication
        max_retries: Maximum number of retry attempts for the entire deployment
    """

    def _do_deploy() -> None:
        # Get current context to preserve stdout/stderr capture for TUI
        current_ctx = get_async_ctx()

        with AsyncRuntime() as runtime:
            for machine in machines:
                # Re-create machine / flake instance to avoid thread safety issues
                new_inst_machine = Machine(
                    name=machine.name, flake=Flake(str(machine.flake.path))
                )
                target_host = new_inst_machine.target_host().override(
                    host_key_check="none",
                    private_key=ssh_key.private,
                )
                runtime.async_run(
                    AsyncOpts(
                        tid=new_inst_machine.name,
                        async_ctx=AsyncContext(
                            prefix=new_inst_machine.name,
                            stdout=current_ctx.stdout,
                            stderr=current_ctx.stderr,
                            should_cancel=current_ctx.should_cancel,
                        ),
                    ),
                    run_machine_update,
                    new_inst_machine,
                    target_host=target_host,
                    build_host=build_host,
                )
            runtime.join_all()
            runtime.check_all()

    retry_operation(
        _do_deploy,
        max_retries=max_retries,
        initial_delay=10.0,
        max_delay=60.0,
        operation_name="deploy machines",
    )


def install_vpn(
    config: Config,
    vpn: VPN,
    tr_machines: list[TrMachine],
    get_con_times: bool = True,
    benchmark_run_alias: str = "default",
    timing: TimingTracker | None = None,
) -> list[BenchMachine]:
    """Install and configure VPN on all machines.

    Args:
        config: Configuration object
        vpn: VPN type to install
        tr_machines: List of terraform machines
        get_con_times: Whether to collect connection timing measurements
        benchmark_run_alias: Alias for the benchmark run (for timing results)
        timing: Optional TimingTracker for operation-level timing

    Returns:
        List of BenchMachine objects with VPN IPs
    """
    from contextlib import nullcontext

    def timed_op(name: str) -> Any:
        """Return timing context manager if timing is enabled, else nullcontext."""
        if timing is not None:
            return timing.operation(name)
        return nullcontext()

    # Update cvpn-bench flake input, else error because of mismatched input
    with timed_op("nix_flake_update"):
        run(["nix", "flake", "update", "cvpn-bench", "--flake", str(config.clan_dir)])

    with timed_op("create_base_inventory"):
        create_base_inventory(config, tr_machines)

    # Initialize and configure machines

    clan_dir = Flake(str(config.clan_dir))
    machines = [
        Machine(
            name=tr_machine["name"],
            flake=clan_dir,
        )
        for tr_machine in tr_machines
    ]

    build_host: Remote | None = Remote(
        address="localhost",
        command_prefix="local-buildhost",
        host_key_check="none",
    )
    assert build_host is not None
    try:
        build_host.check_machine_ssh_login()
    except ClanError:
        build_host = None

    if get_con_times and vpn != VPN.Internal:
        # Update machine without VPNs to remove any previous VPN configuration
        with timed_op("deploy_base_machines"):
            deploy_machines(machines, build_host=build_host, ssh_key=config.ssh_keys[0])

        with timed_op("clean_state_dirs"):
            state_dirs = [
                "/root/qperf",
                "/var/lib/qperf/qperf",
                "/etc/zerotier",
                "/etc/tinc",
                "/var/lib/zerotier-one",
                "/var/lib/mycelium",
                "/var/lib/private/mycelium/",
                "/var/lib/connection-check",
            ]
            delete_dirs(state_dirs, machines)

    # Setup VPN configuration
    with timed_op(f"install_{vpn.value.lower()}_config"):
        match vpn:
            case VPN.Zerotier:
                install_zerotier(config, tr_machines)
            case VPN.Mycelium:
                install_mycelium(config, tr_machines)
            case VPN.Hyprspace:
                install_hyprspace(config, tr_machines)
            case VPN.VpnCloud:
                install_vpncloud(config, tr_machines)
            case VPN.Yggdrasil:
                install_yggdrasil(config, tr_machines)
            case VPN.Wireguard:
                install_wireguard(config, tr_machines)
            case VPN.Easytier:
                install_easytier(config, tr_machines)
            case VPN.Nebula:
                install_nebula(config, tr_machines)
            case VPN.Tinc:
                install_tinc(config, tr_machines)
            case VPN.Headscale:
                install_headscale(config, tr_machines)
            case VPN.Internal:
                pass
            case _:
                msg = f"VPN {vpn} not supported"
                raise VpnBenchError(msg)

    for machine in machines:
        machine.flake.invalidate_cache()

    if vpn == VPN.Zerotier:
        # Because of facts to vars migration code,
        # we need to generate the zerotier network-id var
        # for the controller machine
        with timed_op("run_zerotier_generators"):
            run_generators([machines[0]], "zerotier")

    # Get the VPN IP of each machine
    with timed_op("get_vpn_ips"):
        bmachines = get_vpn_ips(config, machines, vpn)
        save_machine_layout(config, vpn, bmachines)

    # Install Nix cache (first machine is the server, others are clients)
    with timed_op("install_nix_cache"):
        install_nix_cache(config, tr_machines, bmachines)

    # Always install connection timings service (needed for wait_for_vpn_connectivity)
    if vpn != VPN.Internal or vpn == VPN.Wireguard:
        with timed_op("install_connection_timings_service"):
            install_connection_timings_conf(config, tr_machines, vpn, bmachines)

    machines = [bmachine.cmachine for bmachine in bmachines]

    # Invalidate cache for all machines
    for machine in machines:
        machine.flake.invalidate_cache()

    for bmachine in bmachines:
        bmachine.cmachine.flake.invalidate_cache()

    with timed_op("run_generators"):
        run_generators(machines, generators=None, full_closure=False)

    # Update machine configuration with VPNs
    with timed_op("deploy_vpn_machines"):
        deploy_machines(machines, build_host=build_host, ssh_key=config.ssh_keys[0])

    if get_con_times and vpn != VPN.Internal:
        with timed_op("initial_connection_timings"):
            download_connection_timings(
                config, vpn, machines, benchmark_run_alias=benchmark_run_alias
            )
        with timed_op("reboot_connection_timings"):
            reboot_connection_timings(
                config, vpn, machines, benchmark_run_alias=benchmark_run_alias
            )

    return bmachines
