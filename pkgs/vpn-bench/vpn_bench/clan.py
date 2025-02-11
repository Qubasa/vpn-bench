import logging
import shutil
from pathlib import Path

import clan_cli.clan.create
from clan_cli.api.disk import set_machine_disk_schema
from clan_cli.clan_uri import Flake
from clan_cli.cmd import RunOpts, run
from clan_cli.dirs import get_clan_flake_toplevel
from clan_cli.git import commit_file
from clan_cli.inventory import load_inventory_eval, set_inventory
from clan_cli.inventory.classes import (
    Inventory,
    MachineDeploy,
)
from clan_cli.inventory.classes import (
    Machine as InventoryMachine,
)

# Clan TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.machines.create import CreateOptions as ClanCreateOptions
from clan_cli.machines.create import create_machine
from clan_cli.machines.hardware import HardwareConfig
from clan_cli.machines.install import InstallOptions, install_machine
from clan_cli.machines.machines import Machine
from clan_cli.nix import nix_command
from clan_cli.ssh.host import Host
from clan_cli.ssh.host_key import HostKeyCheck

from vpn_bench.assets import get_clan_module, get_cloud_asset
from vpn_bench.data import Config, Provider
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


def clan_clean(config: Config) -> None:
    shutil.rmtree(config.clan_dir, ignore_errors=True)


def add_clan_module(clan_dir: Path, module_name: str, exists_ok: bool = False) -> None:
    autoimports_dir = clan_dir / "imports" / "inventory"
    autoimports_dir.mkdir(parents=True, exist_ok=True)

    shutil.copytree(
        get_clan_module(module_name),
        autoimports_dir / module_name,
        dirs_exist_ok=exists_ok,
    )
    commit_file(autoimports_dir, clan_dir, f"Add {module_name} module")


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


# Clan TODO: We should generally start thinking about API usability and how to make it less fragmented
# I spend a lot of time trying to figure out which functions I needed to call to do what I wanted to do (and I know where to look)
# I feel like it could be time to factor out the API into an external python package?
def clan_init(
    config: Config,
    provider: Provider,
    ssh_key_path: Path,
    tr_machines: list[TrMachine],
) -> None:
    if config.clan_dir.exists():
        result = input(f"Directory {config.clan_dir} already exists. Delete it? [y/N] ")
        if result.lower() != "y":
            log.error("Aborting")
        else:
            shutil.rmtree(config.clan_dir)

    clan_dir = Flake(str(config.clan_dir))

    local_clan = get_clan_flake_toplevel()
    clan_cli.clan.create.create_clan(
        clan_cli.clan.create.CreateOptions(
            src_flake=Flake(str(local_clan)),
            template_name="vpnBenchClan",
            dest=config.clan_dir,
            update_clan=False,
        )
    )

    # Update the flake.nix to point to my fork of clan-core
    flake_nix = clan_dir.path / "flake.nix"
    with flake_nix.open("r+") as f:
        orig_url = "__VPN_BENCH_PATH__"
        my_url = str(local_clan)
        text = f.read().replace(orig_url, my_url)
        f.seek(0)
        f.write(text)
    run(nix_command(["flake", "update", "clan-core"]), RunOpts(cwd=clan_dir.path))

    # Create the machines
    for tr_machine in tr_machines:
        assert tr_machine["ipv4"] is not None
        host = Host(user=tr_machine["name"], host=tr_machine["ipv4"])
        # TODO: We should have somekind of method that creates a Machine object from a InventoryMachine object
        inv_machine = InventoryMachine(
            name=tr_machine["name"], deploy=MachineDeploy(targetHost=host.host)
        )
        # Clan TODO: We should require the Host object here instead of a string
        create_machine(ClanCreateOptions(clan_dir, inv_machine, target_host=host.host))

    # Add the machines to the myadmin module
    inventory: Inventory = load_inventory_eval(clan_dir.path)
    inventory["services"]["myadmin"] = {
        "someid": {
            "roles": {
                "default": {
                    "machines": [tr_machine["name"] for tr_machine in tr_machines],
                    "config": {
                        "allowedKeys": [ssh_key_path.read_text()],
                    },
                }
            }
        }
    }

    # Clan TODO: flake_dir: str | Path should be replaced with FlakeId everywhere in clan_cli
    set_inventory(inventory, clan_dir.path, "Add myadmin service")

    # Install the machines
    hardware_conf = get_cloud_asset(provider, "clan") / "facter.json"
    nix_config = get_cloud_asset(provider, "clan") / "configuration.nix"
    for tr_machine in tr_machines:
        # Clan TODO: This is a hack, we should automatically generate the hardware-config.nix
        # in nixos-anywhere, kenji is working on this
        shutil.copy(
            hardware_conf,
            config.clan_dir / "machines" / tr_machine["name"] / "facter.json",
        )
        shutil.copy(
            nix_config,
            config.clan_dir / "machines" / tr_machine["name"] / "configuration.nix",
        )
        # Clan TODO: We should have a method that creates a Host object from a machine object
        machine = Machine(
            name=tr_machine["name"], flake=clan_dir, host_key_check=HostKeyCheck.NONE
        )

        # Clan TODO: We shouldn't need to set this manually, when the facter generation works this should be automatic
        placeholders = {"mainDisk": "/dev/sda"}
        set_machine_disk_schema(
            clan_dir.path,
            machine.name,
            "single-disk",
            placeholders,
            allow_uknown_placeholders=True,
        )

        # Clan TODO: machine.target_host assumes that the host is reachable over root@ip but this is not always the case
        # We should have a way to specify the user
        assert tr_machine["ipv4"] is not None
        host = Host(user=tr_machine["name"], host=tr_machine["ipv4"])

        # If we can't login with the machine name user we try root user
        if not can_ssh_login(host):
            log.warning("Could not login with machine name user, trying root user")
            host.user = "root"

        install_machine(
            InstallOptions(
                machine,
                target_host=host.target,
                update_hardware_config=HardwareConfig.NIXOS_FACTER,
            )
        )
