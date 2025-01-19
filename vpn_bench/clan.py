import json
import logging
import shutil
from pathlib import Path

import clan_cli.clan.create
from clan_cli.api.disk import set_machine_disk_schema
from clan_cli.clan_uri import FlakeId
from clan_cli.cmd import RunOpts, run
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
from clan_cli.nix import nix_command, nix_eval
from clan_cli.ssh.host import Host
from clan_cli.ssh.host_key import HostKeyCheck

from vpn_bench import Config
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)
from vpn_bench import Provider
from vpn_bench.assets import get_clan_module, get_cloud_asset


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


def install_clan_module(clan_dir: Path, module_name: str, machine: Machine) -> None:
    pass


def get_clan_core_dir(clan_dir: FlakeId) -> str:
    cmd = nix_eval(
        [
            "--impure",
            "--json",
            "--expr",
            f'(builtins.getFlake "{clan_dir.path}").inputs.clan-core.outPath',
        ]
    )
    res = run(cmd).stdout
    return json.loads(res)


# Clan TODO: We should generally start thinking about API usability and how to make it less fragmented
# I spend a lot of time trying to figure out which functions I needed to call to do what I wanted to do (and I know where to look)
# I feel like it could be time to factor out the API into an external python package?
def clan_init(
    config: Config,
    provider: Provider,
    ssh_key_path: Path,
    tr_machines: list[TrMachine],
) -> None:
    clan_dir = FlakeId(str(config.clan_dir))

    if clan_dir.path.exists():
        result = input(f"Directory {clan_dir.path} already exists. Delete it? [y/N] ")
        if result.lower() != "y":
            log.error("Aborting")
        else:
            shutil.rmtree(clan_dir.path)

    clan_cli.clan.create.create_clan(
        clan_cli.clan.create.CreateOptions(config.clan_dir)
    )

    # Update the flake.nix to point to my fork of clan-core
    flake_nix = clan_dir.path / "flake.nix"
    with flake_nix.open("r+") as f:
        orig_url = "https://git.clan.lol/clan/clan-core/archive/main.tar.gz"
        my_url = "https://git.clan.lol/Qubasa/clan-core/archive/imports_dir.tar.gz"
        text = f.read().replace(orig_url, my_url)
        f.seek(0)
        f.write(text)
    run(nix_command(["flake", "update", "clan-core"]), RunOpts(cwd=clan_dir.path))

    # Create the machines
    for tr_machine in tr_machines:
        host = Host(user=tr_machine.name, host=tr_machine.ip)
        # TODO: We should have somekind of method that creates a Machine object from a InventoryMachine object
        inv_machine = InventoryMachine(
            name=tr_machine.name, deploy=MachineDeploy(targetHost=host.host)
        )
        # Clan TODO: We should require the Host object here instead of a string
        create_machine(ClanCreateOptions(clan_dir, inv_machine, target_host=host.host))

    # Add the machines to the myadmin module
    add_clan_module(clan_dir.path, "myadmin", exists_ok=True)
    inventory: Inventory = load_inventory_eval(clan_dir.path)
    inventory["services"]["myadmin"] = {
        "someid": {
            "roles": {
                "default": {
                    "machines": [tr_machines.name for tr_machines in tr_machines]
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
        # kenji is working on this
        shutil.copy(
            hardware_conf,
            config.clan_dir / "machines" / tr_machine.name / "facter.json",
        )
        shutil.copy(
            nix_config,
            config.clan_dir / "machines" / tr_machine.name / "configuration.nix",
        )
        # Clan TODO: We should have a method that creates a Host object from a machine object
        machine = Machine(
            name=tr_machine.name, flake=clan_dir, host_key_check=HostKeyCheck.NONE
        )

        placeholders = {"mainDisk": "/dev/sda"}
        set_machine_disk_schema(
            clan_dir.path, machine.name, "single-disk", placeholders
        )

        # Clan TODO: machine.target_host assumes that the host is reachable over root@ip but this is not always the case
        # We should have a way to specify the user
        host = Host(user=tr_machine.name, host=tr_machine.ip)
        install_machine(
            InstallOptions(
                machine,
                target_host=host.target,
                update_hardware_config=HardwareConfig.NIXOS_FACTER,
            )
        )
