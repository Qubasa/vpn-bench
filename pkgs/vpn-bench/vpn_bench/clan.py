import json
import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import clan_cli.clan.create
from clan_cli.api.disk import hw_main_disk_options, set_machine_disk_schema
from clan_cli.clan_uri import Flake
from clan_cli.cmd import RunOpts, run
from clan_cli.dirs import specific_machine_dir
from clan_cli.inventory import patch_inventory_with
from clan_cli.inventory.classes import (
    Machine as InventoryMachine,
)
from clan_cli.inventory.classes import (
    MachineDeploy,
)

# Clan TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.machines.create import CreateOptions as ClanCreateOptions
from clan_cli.machines.create import create_machine
from clan_cli.machines.hardware import HardwareConfig
from clan_cli.machines.install import InstallOptions, install_machine
from clan_cli.machines.machines import Machine
from clan_cli.nix import nix_command
from clan_cli.secrets.key import generate_key
from clan_cli.secrets.sops import (
    KeyType,
    maybe_get_admin_public_key,
)
from clan_cli.secrets.users import add_user
from clan_cli.ssh.host import Host
from clan_cli.ssh.host_key import HostKeyCheck

from vpn_bench.data import Config, Provider
from vpn_bench.errors import VpnBenchError
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


def clan_clean(config: Config) -> None:
    shutil.rmtree(config.clan_dir, ignore_errors=True)


def can_ssh_login(host: Host) -> bool:
    host = Host.from_host(host)
    host.host_key_check = HostKeyCheck.NONE
    host.ssh_options.update(
        {
            "PasswordAuthentication": "no",
            "BatchMode": "yes",
        }
    )

    result = host.run(["exit"], RunOpts(check=False, shell=True))

    # Check the return code
    return result.returncode == 0


@dataclass
class AgeOpts:
    username: str
    pubkey: None | Path = None


# Clan TODO: We should generally start thinking about API usability and how to make it less fragmented
# I spend a lot of time trying to figure out which functions I needed to call to do what I wanted to do (and I know where to look)
# I feel like it could be time to factor out the API into an external python package?
def clan_init(
    config: Config,
    provider: Provider,
    ssh_key_path: Path,
    age_opts: AgeOpts,
    tr_machines: list[TrMachine],
) -> None:
    if config.clan_dir.exists():
        result = input(f"Directory {config.clan_dir} already exists. Delete it? [y/N] ")
        if result.lower() != "y":
            log.error("Aborting")
        else:
            shutil.rmtree(config.clan_dir)

    clan_dir = Flake(str(config.clan_dir))

    vpn_bench_flake = os.environ.get("VPN_BENCH_FLAKE")
    if vpn_bench_flake is None:
        msg = "Could not find VPN_BENCH_FLAKE in the environment"
        raise VpnBenchError(msg)

    vpnbench_clan = Path(vpn_bench_flake)

    clan_cli.clan.create.create_clan(
        clan_cli.clan.create.CreateOptions(
            src_flake=Flake(str(vpnbench_clan)),
            template_name="vpnBenchClan",
            dest=config.clan_dir,
            update_clan=False,
        )
    )

    if age_opts.pubkey is None:
        sops_key = maybe_get_admin_public_key()
        if sops_key is None:
            res = input("No sops key found. Do you want to generate one? [y/N] ")

            if res.lower() != "y":
                msg = "No sops key found, please generate one."
                raise VpnBenchError(msg)
            sops_key = generate_key()

        sops_pubkey = sops_key.pubkey
    else:
        sops_pubkey = age_opts.pubkey.read_text()

    add_user(clan_dir.path, age_opts.username, sops_pubkey, KeyType.AGE, False)

    # Update the flake.nix to point to my fork of clan-core
    flake_nix = clan_dir.path / "flake.nix"
    with flake_nix.open("r+") as f:
        orig_url = "__VPN_BENCH_PATH__"
        my_url = str(vpnbench_clan)
        text = f.read().replace(orig_url, my_url)
        f.seek(0)
        f.write(text)
    run(nix_command(["flake", "update", "clan-core"]), RunOpts(cwd=clan_dir.path))

    # Add the machines to the myadmin module
    inventory: dict[str, Any] = {}

    inventory["myadmin"] = {
        "someid": {
            "roles": {
                "default": {
                    "tags": ["all"],
                    "config": {
                        "allowedKeys": {age_opts.username: ssh_key_path.read_text()},
                    },
                }
            }
        }
    }

    inventory["sshd"] = {
        "someid": {
            "roles": {
                "server": {
                    "tags": ["all"],
                    "config": {},
                }
            }
        }
    }

    inventory["zerotier"] = {
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

    inventory["iperf"] = {
        "someid": {
            "roles": {
                "server": {"machines": [], "config": {}, "tags": ["all"]},
            }
        }
    }

    # Create the machines
    for machine_num, tr_machine in enumerate(tr_machines):
        assert tr_machine["ipv4"] is not None
        host = Host(user=tr_machine["name"], host=tr_machine["ipv4"])
        # TODO: We should have somekind of method that creates a Machine object from a InventoryMachine object
        inv_machine = InventoryMachine(
            name=tr_machine["name"], deploy=MachineDeploy(targetHost=host.host)
        )
        # Clan TODO: We should require the Host object here instead of a string
        create_machine(ClanCreateOptions(clan_dir, inv_machine, target_host=host.host))

        if machine_num == 0:
            log.info(
                f"Setting up the first machine {tr_machine['name']} as the zerotier controller"
            )
            inventory["zerotier"]["someid"]["roles"]["controller"]["machines"].append(
                tr_machine["name"]
            )
        else:
            log.info(f"Adding {tr_machine['name']} to the zerotier peers")
            inventory["zerotier"]["someid"]["roles"]["peer"]["machines"].append(
                tr_machine["name"]
            )

    # Clan TODO: flake_dir: str | Path should be replaced with FlakeId everywhere in clan_cli
    patch_inventory_with(clan_dir.path, "services", inventory)

    # Install the machines
    for tr_machine in tr_machines:
        # Clan TODO: We should have a method that creates a Host object from a machine object
        machine = Machine(
            name=tr_machine["name"], flake=clan_dir, host_key_check=HostKeyCheck.NONE
        )

        identity_file = config.data_dir / "id_ed25519"

        # Clan TODO: machine.target_host assumes that the host is reachable over root@ip but this is not always the case
        # We should have a way to specify the user
        assert tr_machine["ipv4"] is not None
        host = Host(user=tr_machine["name"], host=tr_machine["ipv4"])

        # If we can't login with the machine name user we try root user
        if not can_ssh_login(host):
            log.warning("Could not login with machine name user, trying root user")
            host.user = "root"

        # TODO: Check if I have noisy neighbors, then redeploy
        # fping, iperf, tc
        install_machine(
            InstallOptions(
                machine,
                target_host=host.target,
                update_hardware_config=HardwareConfig.NIXOS_FACTER,
                phases="kexec",
                identity_file=identity_file,
                debug=config.debug,
            )
        )

        facter_path = (
            specific_machine_dir(config.clan_dir, machine.name) / "facter.json"
        )
        with facter_path.open("r") as f:
            facter_report = json.load(f)

        disk_devs = hw_main_disk_options(facter_report)

        assert disk_devs is not None

        placeholders = {"mainDisk": disk_devs[0]}
        set_machine_disk_schema(
            clan_dir.path, machine.name, "single-disk", placeholders
        )

        install_machine(
            InstallOptions(
                machine,
                target_host=host.target,
                update_hardware_config=HardwareConfig.NIXOS_FACTER,
                phases="disko,install,reboot",
                identity_file=identity_file,
                debug=config.debug,
            )
        )
