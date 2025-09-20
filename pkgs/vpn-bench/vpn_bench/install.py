import json
import logging
from pathlib import Path

# Clan TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.machines.hardware import HardwareConfig
from clan_lib.dirs import specific_machine_dir
from clan_lib.flake import Flake
from clan_lib.machines.install import InstallOptions, run_machine_install
from clan_lib.machines.machines import Machine
from clan_lib.templates.disk import hw_main_disk_options, set_machine_disk_schema

from vpn_bench.data import Config, Provider, TrMachine
from vpn_bench.errors import VpnBenchError
from vpn_bench.ssh import can_ssh_login

log = logging.getLogger(__name__)


def install_single_machine(
    config: Config, clan_dirp: Path, tr_machine: TrMachine
) -> None:
    clan_dir_flake = Flake(str(clan_dirp))
    log.info(f"Installing machine {tr_machine['name']}")

    host_ip = (
        f"[{tr_machine['ipv6']}]"
        if tr_machine["ipv6"] is not None
        else tr_machine["ipv4"]
    )
    assert host_ip is not None
    identity_file = config.ssh_keys[0].private

    machine = Machine(name=tr_machine["name"], flake=clan_dir_flake)

    host = machine.target_host().override(
        host_key_check="none", private_key=identity_file, address=host_ip
    )

    match tr_machine["provider"]:
        case Provider.Chameleon:
            if not can_ssh_login(machine):
                host = host.override(user="cc")

            if not can_ssh_login(machine):
                msg = f"Could not login to machine {tr_machine['name']} with cc or root"
                raise VpnBenchError(msg)

        case _:
            if not can_ssh_login(machine):
                log.info("Could not login with machine name user, trying root user")
                host = host.override(user="root")

            if not can_ssh_login(machine):
                msg = (
                    f"Could not login to machine {tr_machine['name']} with user or root"
                )
                raise VpnBenchError(msg)

    run_machine_install(
        InstallOptions(
            machine=machine,
            update_hardware_config=HardwareConfig.NIXOS_FACTER,
            phases="kexec",
            debug=config.debug,
        ),
        target_host=host,
    )

    # We need to set the user to root after the kexec phase
    # as this os image only has the root user
    host = host.override(user="root")

    facter_path = specific_machine_dir(machine) / "facter.json"
    with facter_path.open("r") as f:
        facter_report = json.load(f)

    disk_devs = hw_main_disk_options(facter_report)

    assert disk_devs is not None

    placeholders = {"mainDisk": disk_devs[0]}
    set_machine_disk_schema(machine, "single-disk", placeholders)

    run_machine_install(
        InstallOptions(
            machine,
            update_hardware_config=HardwareConfig.NIXOS_FACTER,
            phases="disko,install,reboot",
            debug=config.debug,
        ),
        target_host=host,
    )
