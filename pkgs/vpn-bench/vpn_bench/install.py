import json
import logging
from pathlib import Path
from typing import Any

from clan_cli.api.disk import hw_main_disk_options, set_machine_disk_schema
from clan_cli.clan_uri import Flake
from clan_cli.cmd import RunOpts
from clan_cli.dirs import specific_machine_dir

# Clan TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.machines.hardware import HardwareConfig
from clan_cli.machines.install import InstallOptions, install_machine
from clan_cli.machines.machines import Machine
from clan_cli.ssh.host import Host
from clan_cli.ssh.host_key import HostKeyCheck

from vpn_bench.data import Config
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


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


def install_single_machine(
    config: Config,
    clan_dirp: Path,
    tr_machine: TrMachine,
    machine_num: int,
    inventory: dict[str, Any],
) -> None:
    clan_dir_flake = Flake(str(clan_dirp))
    log.info(f"Installing machine {tr_machine['name']}")
    assert tr_machine["ipv4"] is not None
    host = Host(user=tr_machine["name"], host=tr_machine["ipv4"])

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

    machine = Machine(
        name=tr_machine["name"], flake=clan_dir_flake, host_key_check=HostKeyCheck.NONE
    )

    identity_file = config.data_dir / "id_ed25519"

    assert tr_machine["ipv4"] is not None
    host = Host(user=tr_machine["name"], host=tr_machine["ipv4"])

    if not can_ssh_login(host):
        log.warning("Could not login with machine name user, trying root user")
        host.user = "root"

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
        specific_machine_dir(clan_dir_flake.path, machine.name) / "facter.json"
    )
    with facter_path.open("r") as f:
        facter_report = json.load(f)

    disk_devs = hw_main_disk_options(facter_report)

    assert disk_devs is not None

    placeholders = {"mainDisk": disk_devs[0]}
    set_machine_disk_schema(
        clan_dir_flake.path, machine.name, "single-disk", placeholders
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
