import json
import logging
from pathlib import Path

# Clan TODO: We need to fix this circular import problem in clan_cli!
from clan_cli.machines.hardware import HardwareConfig
from clan_lib.dirs import specific_machine_dir
from clan_lib.errors import ClanError
from clan_lib.flake import Flake
from clan_lib.machines.install import InstallOptions, run_machine_install
from clan_lib.machines.machines import Machine
from clan_lib.templates.disk import hw_main_disk_options, set_machine_disk_schema
from clan_lib.vars.generate import get_generators, run_generators

from vpn_bench.data import Config, Provider, TrMachine
from vpn_bench.errors import VpnBenchError

log = logging.getLogger(__name__)


def automate_prompts(machine: Machine) -> None:
    """
    Sets up automated responses for machine installation prompts.
    Currently, it only handles root-password prompt by setting it to 'terraform'.
    """
    generators = get_generators(machines=[machine], full_closure=True)
    collected_prompt_values = {}
    for generator in generators:
        prompt_values = {}
        for prompt in generator.prompts:
            var_id = f"{generator.name}/{prompt.name}"
            if generator.name == "root-password" and prompt.name == "password":
                prompt_values[prompt.name] = "terraform"
            else:
                msg = f"Prompt {var_id} not handled in test, please fix it"
                raise ClanError(msg)
        collected_prompt_values[generator.name] = prompt_values

    run_generators(
        machines=[machine],
        generators=[gen.name for gen in generators],
        prompt_values=collected_prompt_values,
    )


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
            try:
                host.check_machine_ssh_login()
            except ClanError:
                host = host.override(user="cc")

            try:
                host.check_machine_ssh_login()
            except ClanError as e:
                msg = f"Could not login to machine {tr_machine['name']} with cc or root"
                raise VpnBenchError(msg) from e

        case _:
            try:
                host.check_machine_ssh_login()
            except ClanError:
                log.info("Could not login with machine name user, trying root user")
                host = host.override(user="root")

            try:
                host.check_machine_ssh_login()
            except ClanError as e:
                msg = (
                    f"Could not login to machine {tr_machine['name']} with user or root"
                )
                raise VpnBenchError(msg) from e

    automate_prompts(machine)

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
