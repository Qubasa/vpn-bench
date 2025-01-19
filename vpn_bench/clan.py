import logging
import shutil
from pathlib import Path

import clan_cli.clan.create
from clan_cli.clan_uri import FlakeId
from clan_cli.cmd import RunOpts, run
from clan_cli.errors import ClanError
from clan_cli.git import commit_file
from clan_cli.inventory import load_inventory_eval, set_inventory
from clan_cli.inventory.classes import (
    Inventory,
    MachineDeploy,
)
from clan_cli.inventory.classes import (
    Machine as InventoryMachine,
)

# TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.machines.create import CreateOptions as ClanCreateOptions
from clan_cli.machines.create import create_machine
from clan_cli.machines.hardware import HardwareConfig
from clan_cli.machines.install import InstallOptions, install_machine
from clan_cli.machines.machines import Machine
from clan_cli.nix import nix_command
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


def clan_init(
    config: Config,
    provider: Provider,
    ssh_key_path: Path,
    tr_machines: list[TrMachine],
) -> None:
    try:
        clan_cli.clan.create.create_clan(
            clan_cli.clan.create.CreateOptions(config.clan_dir)
        )
    except ClanError as e:
        log.error(e)

    clan_dir = FlakeId(str(config.clan_dir))

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
        inv_machine = InventoryMachine(
            name=tr_machine.name, deploy=MachineDeploy(targetHost=tr_machine.ip)
        )
        create_machine(
            ClanCreateOptions(clan_dir, inv_machine, target_host=tr_machine.ip)
        )

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
    set_inventory(inventory, clan_dir.path, "Add myadmin service")

    # Install the machines
    hardware_conf = get_cloud_asset(provider, "clan") / "hardware-configuration.nix"
    for tr_machine in tr_machines:
        # TODO: This is a hack, we should automatically generate the hardware-config.nix
        # kenji is working on this
        shutil.copy(
            hardware_conf,
            config.clan_dir
            / "machines"
            / tr_machine.name
            / "hardware-configuration.nix",
        )
        machine = Machine(
            name=tr_machine.name, flake=clan_dir, host_key_check=HostKeyCheck.NONE
        )

        install_machine(
            InstallOptions(
                machine,
                target_host=f"{tr_machine.name}@{tr_machine.ip}",
                update_hardware_config=HardwareConfig.NIXOS_FACTER,
            )
        )
