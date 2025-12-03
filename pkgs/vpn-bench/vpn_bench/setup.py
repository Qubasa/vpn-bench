import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import clan_cli.clan.create
from clan_cli.machines.create import CreateOptions as ClanCreateOptions
from clan_cli.machines.create import create_machine
from clan_cli.secrets.key import generate_key
from clan_cli.secrets.sops import KeyType, SopsKey, maybe_get_admin_public_keys
from clan_cli.secrets.users import add_user
from clan_lib.async_run import AsyncContext, AsyncOpts, AsyncRuntime
from clan_lib.cmd import RunOpts, run
from clan_lib.dirs import nixpkgs_flake
from clan_lib.flake import Flake
from clan_lib.git import commit_file
from clan_lib.nix import nix_command
from clan_lib.nix_models.clan import InventoryMachine, InventoryMachineDeploy
from clan_lib.persist.inventory_store import InventoryStore, set_value_by_path_tuple
from clan_lib.ssh.remote import Remote

from vpn_bench.data import Config, Provider
from vpn_bench.errors import VpnBenchError
from vpn_bench.install import install_single_machine
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


@dataclass
class AgeOpts:
    username: str
    pubkey: None | Path = None


def clan_clean(config: Config) -> None:
    shutil.rmtree(config.clan_dir, ignore_errors=True)

    if config.bench_dir.exists():
        answer = input("Want to delete the benchmark results too? [y/N]")
        if answer.lower() == "y":
            shutil.rmtree(config.bench_dir, ignore_errors=True)


def check_and_clean_directory(clan_dir: Path) -> None:
    """Check if directory exists and ask for deletion if it does."""
    if clan_dir.exists():
        result = input(f"Directory {clan_dir} already exists. Delete it? [y/N] ")
        if result.lower() != "y":
            msg = "Directory already exists, please delete it."
            raise VpnBenchError(msg)
        shutil.rmtree(clan_dir)


def setup_sops_key(age_opts: AgeOpts) -> str:
    """Set up and return the SOPS public key."""
    if age_opts.pubkey is not None:
        return age_opts.pubkey.read_text()

    sops_keys = maybe_get_admin_public_keys()
    if not sops_keys:
        res = input("No sops key found. Do you want to generate one? [y/N] ")
        if res.lower() != "y":
            msg = "No sops key found, please generate one."
            raise VpnBenchError(msg)
        sops_key = generate_key()
        return sops_key.pubkey

    if len(sops_keys) > 1:
        log.warning("Multiple sops keys found, using the first one.")
    return sops_keys[0].pubkey


def update_flake_nix(clan_dir: Path, vpnbench_clan: Path) -> None:
    """Update flake.nix with correct path."""
    flake_nix = clan_dir / "flake.nix"
    # vpnbench_flake = Flake(str(vpnbench_clan))
    # vpnbench_flake.prefetch()
    with flake_nix.open("r+") as f:
        text = f.read().replace(
            "__VPN_BENCH_PATH__",
            f"path://{vpnbench_clan}",
        )
        f.seek(0)
        f.write(text)
    commit_file(flake_nix, clan_dir, "Update flake.nix with correct path")
    run(nix_command(["flake", "lock"]), RunOpts(cwd=clan_dir))


@dataclass
class InvSSHKeyEntry:
    username: str
    ssh_pubkey_txt: str


@dataclass
class InventoryWrapper:
    instances: dict[str, Any]
    services: dict[str, Any]


def create_base_inventory(config: Config, tr_machines: list[TrMachine]) -> None:
    ssh_keys = [
        InvSSHKeyEntry("nixos-anywhere", config.ssh_keys[0].public.read_text()),
    ]
    for num, ssh_key in enumerate(config.ssh_keys[1:]):
        ssh_keys.append(InvSSHKeyEntry(f"user_{num}", ssh_key.public.read_text()))

    """Create the base inventory structure."""

    flake = Flake(str(config.clan_dir))
    inventory_store = InventoryStore(flake)

    # Delete all existing instances and services?
    inventory = inventory_store.read()
    inventory["instances"] = {}
    inventory_store.write(inventory, message="Clear existing inventory")

    flake.prefetch()
    inventory = inventory_store.read()
    set_value_by_path_tuple(
        inventory,
        ("instances", "iperf-new"),
        {
            "module": {"name": "iperf-new", "input": "cvpn-bench"},
            "roles": {
                "server": {"tags": {"all": {}}},
            },
        },
    )

    set_value_by_path_tuple(
        inventory,
        ("instances", "my-trusted-nix-caches-new"),
        {
            "module": {"name": "my-trusted-nix-caches-new", "input": "cvpn-bench"},
            "roles": {
                "default": {
                    "tags": {"all": {}},
                }
            },
        },
    )
    set_value_by_path_tuple(
        inventory,
        ("instances", "qperf-new"),
        {
            "module": {"name": "qperf-new", "input": "cvpn-bench"},
            "roles": {
                "server": {"tags": {"all": {}}},
            },
        },
    )

    set_value_by_path_tuple(
        inventory,
        ("instances", "admin"),
        {
            # "module": {"name": "myadmin-new", "input": "cvpn-bench"},
            "roles": {
                "default": {
                    "tags": {"all": {}},
                    "settings": {
                        "allowedKeys": {
                            key.username: key.ssh_pubkey_txt for key in ssh_keys
                        },
                    },
                }
            },
        },
    )

    set_value_by_path_tuple(
        inventory,
        ("instances", "rist-stream"),
        {
            "module": {"name": "rist-stream", "input": "cvpn-bench"},
            "roles": {
                "server": {"tags": {"all": {}}},
            },
        },
    )

    for machine in tr_machines:
        match machine["provider"]:
            case Provider.Hetzner:
                instance_name = f"hetzner-ips-{machine['name']}_id"
                ip_addresses = []
                if machine["ipv4"] is not None:
                    ip_addresses.append(f"{machine['ipv4']}/32")
                if machine["internal_ipv6"] is not None:
                    ip_addresses.append(f"{machine['internal_ipv6']}/64")
                if machine["ipv6"] is not None:
                    ip_addresses.append(f"{machine['ipv6']}/64")
                set_value_by_path_tuple(
                    inventory,
                    ("instances", f"{instance_name}"),
                    {
                        "module": {"name": "hetzner-ips-new", "input": "cvpn-bench"},
                        "roles": {
                            "default": {
                                "machines": {machine["name"]: {}},
                                "settings": {
                                    "ipAddresses": ip_addresses,
                                },
                            }
                        },
                    },
                )

            case Provider.Hardware:
                # Hardware provider doesn't need special IP module configuration
                pass

            case _:
                pass

    inventory_store.write(inventory, message="Add base configuration")


def setup_machine(clan_dir: Path, tr_machine: TrMachine, machine_num: int) -> None:
    """Set up a single machine in the inventory."""
    host_ip = (
        f"[{tr_machine['ipv6']}]"
        if tr_machine["ipv6"] is not None
        else tr_machine["ipv4"]
    )
    assert host_ip is not None
    host = Remote(user="root", address=host_ip, command_prefix=tr_machine["name"])

    inv_machine = InventoryMachine(
        name=tr_machine["name"], deploy=InventoryMachineDeploy(targetHost=host.target)
    )

    create_machine(
        ClanCreateOptions(Flake(str(clan_dir)), inv_machine, target_host=host.target)
    )


# TODO: We should add something like this into clan_cli
def reset_terminal() -> None:
    """
    Reset the terminal to its initial state, similar to 'tput reset'.
    This clears the screen, resets all attributes, and moves cursor to home position.
    """
    run(
        nix_command(
            [
                "shell",
                "--inputs-from",
                f"{nixpkgs_flake()!s}",
                "nixpkgs#ncurses",
                "-c",
                "tput",
                "reset",
            ]
        )
    )


def clan_init(
    config: Config,
    age_opts: AgeOpts,
    tr_machines: list[TrMachine],
) -> None:
    """Initialize the clan configuration."""
    # Initial setup
    check_and_clean_directory(config.clan_dir)

    # Get VPN bench flake path
    vpn_bench_flake = os.environ.get("VPN_BENCH_FLAKE")
    if vpn_bench_flake is None:
        msg = "Could not find VPN_BENCH_FLAKE in the environment"
        raise VpnBenchError(msg)
    vpnbench_clan = Path(vpn_bench_flake)

    # Create clan
    clan_cli.clan.create.create_clan(
        clan_cli.clan.create.CreateOptions(
            src_flake=Flake(str(vpnbench_clan)),
            template="#vpnBenchClan",
            dest=config.clan_dir,
            update_clan=False,
        )
    )

    # Setup SOPS and user
    sops_pubkey = setup_sops_key(age_opts)
    add_user(
        config.clan_dir,
        age_opts.username,
        [
            SopsKey(
                source="sops_file",
                pubkey=sops_pubkey,
                username=age_opts.username,
                key_type=KeyType.AGE,
            )
        ],
        False,
    )

    # Update flake configuration
    update_flake_nix(config.clan_dir, vpnbench_clan)

    # Create and configure inventory
    create_base_inventory(config, tr_machines)

    # Set up machines
    for machine_num, tr_machine in enumerate(tr_machines):
        setup_machine(config.clan_dir, tr_machine, machine_num)

    with AsyncRuntime() as runtime:
        for tr_machine in tr_machines:
            name = tr_machine["name"]
            runtime.async_run(
                AsyncOpts(tid=name, async_ctx=AsyncContext(prefix=name)),
                install_single_machine,
                config,
                config.clan_dir,
                tr_machine,
            )
        runtime.join_all()
        runtime.check_all()

    reset_terminal()
    log.info("Clan configuration initialized")
