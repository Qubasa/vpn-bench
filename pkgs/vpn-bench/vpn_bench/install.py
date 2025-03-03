import json
import logging
from pathlib import Path

from clan_cli.api.disk import hw_main_disk_options, set_machine_disk_schema
from clan_cli.clan_uri import Flake
from clan_cli.dirs import specific_machine_dir

# Clan TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.machines.hardware import HardwareConfig
from clan_cli.machines.install import InstallOptions, install_machine
from clan_cli.machines.machines import Machine
from clan_cli.ssh.host_key import HostKeyCheck

from vpn_bench.data import Config, TrMachine
from vpn_bench.errors import VpnBenchError
from vpn_bench.ssh import can_ssh_login

log = logging.getLogger(__name__)


def install_single_machine(
    config: Config, clan_dirp: Path, tr_machine: TrMachine
) -> None:
    clan_dir_flake = Flake(str(clan_dirp))
    log.info(f"Installing machine {tr_machine['name']}")

    assert tr_machine["ipv4"] is not None
    identity_file = config.ssh_keys[0].private

    machine = Machine(
        name=tr_machine["name"],
        flake=clan_dir_flake,
        host_key_check=HostKeyCheck.NONE,
        private_key=identity_file,
        override_target_host=tr_machine["ipv4"],
    )
    assert tr_machine["ipv4"] is not None
    host = machine.target_host

    if not can_ssh_login(host):
        log.info("Could not login with machine name user, trying root user")
        host.user = "root"

    if not can_ssh_login(host):
        msg = f"Could not login to machine {tr_machine['name']} with user or root"
        raise VpnBenchError(msg)

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
