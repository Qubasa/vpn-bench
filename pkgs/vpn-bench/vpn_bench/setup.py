import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import clan_cli.clan.create
from clan_cli.async_run import AsyncContext, AsyncOpts, AsyncRuntime
from clan_cli.clan_uri import Flake
from clan_cli.cmd import RunOpts, run
from clan_cli.git import commit_file
from clan_cli.inventory import patch_inventory_with
from clan_cli.inventory.classes import Machine as InventoryMachine
from clan_cli.inventory.classes import MachineDeploy
from clan_cli.machines.create import CreateOptions as ClanCreateOptions
from clan_cli.machines.create import create_machine
from clan_cli.nix import nix_command, nix_shell
from clan_cli.secrets.key import generate_key
from clan_cli.secrets.sops import KeyType, maybe_get_admin_public_key
from clan_cli.secrets.users import add_user
from clan_cli.ssh.host import Host

from vpn_bench.data import Config, Provider, SSHKeyPair
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

    sops_key = maybe_get_admin_public_key()
    if sops_key is None:
        res = input("No sops key found. Do you want to generate one? [y/N] ")
        if res.lower() != "y":
            msg = "No sops key found, please generate one."
            raise VpnBenchError(msg)
        sops_key = generate_key()

    return sops_key.pubkey


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


def create_base_inventory(
    tr_machines: list[TrMachine], ssh_keys_pairs: list[SSHKeyPair]
) -> dict[str, Any]:
    ssh_keys = [
        InvSSHKeyEntry("nixos-anywhere", ssh_keys_pairs[0].public.read_text()),
    ]
    for num, ssh_key in enumerate(ssh_keys_pairs[1:]):
        ssh_keys.append(InvSSHKeyEntry(f"user_{num}", ssh_key.public.read_text()))

    """Create the base inventory structure."""
    inventory: dict[str, Any] = {
        "myadmin": {
            "someid": {
                "roles": {
                    "default": {
                        "tags": ["all"],
                        "config": {
                            "allowedKeys": {
                                key.username: key.ssh_pubkey_txt for key in ssh_keys
                            },
                        },
                    }
                }
            }
        },
        "sshd": {
            "someid": {
                "roles": {
                    "server": {
                        "tags": ["all"],
                        "config": {},
                    }
                }
            }
        },
        "iperf": {
            "someid": {
                "roles": {
                    "server": {"machines": [], "config": {}, "tags": ["all"]},
                }
            }
        },
        "nperf": {
            "someid": {
                "roles": {
                    "server": {"tags": ["all"]},
                }
            }
        },
        "state-version": {
            "someid": {
                "roles": {
                    "default": {
                        "tags": ["all"],
                    }
                }
            }
        },
        "my-trusted-nix-caches": {
            "someid": {
                "roles": {
                    "default": {
                        "tags": ["all"],
                    }
                }
            }
        },
    }

    for machine in tr_machines:
        match machine["provider"]:
            case Provider.Hetzner:
                if "hetzner-ips" not in inventory:
                    inventory["hetzner-ips"] = {}
                instance_name = f"{machine['name']}_id"
                inventory["hetzner-ips"][instance_name] = {
                    "roles": {
                        "default": {
                            "machines": [machine["name"]],
                            "config": {
                                "ipAddresses": [
                                    f"{machine['ipv4']}/32",
                                    f"{machine['ipv6']}/64",
                                ],
                            },
                        }
                    }
                }

            case _:
                pass

    return inventory


def setup_machine(
    clan_dir: Path, tr_machine: TrMachine, machine_num: int, inventory: dict[str, Any]
) -> None:
    """Set up a single machine in the inventory."""
    assert tr_machine["ipv4"] is not None
    host = Host(user=tr_machine["name"], host=tr_machine["ipv4"])

    inv_machine = InventoryMachine(
        name=tr_machine["name"], deploy=MachineDeploy(targetHost=host.host)
    )

    create_machine(
        ClanCreateOptions(Flake(str(clan_dir)), inv_machine, target_host=host.host)
    )


# TODO: We should add something like this into clan_cli
def reset_terminal() -> None:
    """
    Reset the terminal to its initial state, similar to 'tput reset'.
    This clears the screen, resets all attributes, and moves cursor to home position.
    """
    run(nix_shell(["nixpkgs#ncurses"], ["tput", "reset"]))


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
            template_name="vpnBenchClan",
            dest=config.clan_dir,
            update_clan=False,
        )
    )

    # Setup SOPS and user
    sops_pubkey = setup_sops_key(age_opts)
    add_user(config.clan_dir, age_opts.username, sops_pubkey, KeyType.AGE, False)

    # Update flake configuration
    update_flake_nix(config.clan_dir, vpnbench_clan)

    # Create and configure inventory
    inventory = create_base_inventory(tr_machines, config.ssh_keys)

    # Set up machines
    for machine_num, tr_machine in enumerate(tr_machines):
        setup_machine(config.clan_dir, tr_machine, machine_num, inventory)

    # Update inventory and install machines
    patch_inventory_with(config.clan_dir, "services", inventory)

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
