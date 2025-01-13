from vpn_bench.terraform import TrMachine
import clan_cli.clan.create
from clan_cli.machines.create import CreateOptions as ClanCreateOptions, create_machine
from clan_cli.machines.install import InstallOptions, install_machine
from clan_cli.machines.machines import Machine
from clan_cli.inventory.classes import Machine as InventoryMachine, MachineDeploy
from clan_cli.clan_uri import FlakeId
from clan_cli.ssh.host_key import HostKeyCheck
from vpn_bench.cli import Config
from clan_cli.machines.hardware import HardwareConfig
from clan_cli.errors import ClanError
import logging

log = logging.getLogger(__name__)

def clan_init(tr_machines: list[TrMachine], config: Config):
    try:
        clan_cli.clan.create.create_clan(
            clan_cli.clan.create.CreateOptions(config.clan_dir)
        )
    except ClanError as e:
        log.error(e)

    clan_dir = FlakeId(config.clan_dir)

    for tr_machine in tr_machines:
        inv_machine = InventoryMachine(name=tr_machine.name, deploy=MachineDeploy(targetHost=tr_machine.ip))
        create_machine(ClanCreateOptions(clan_dir, inv_machine, target_host=tr_machine.ip))

    for tr_machine in tr_machines:
        machine = Machine(name=tr_machine.name, flake=clan_dir, host_key_check=HostKeyCheck.NONE)
        install_machine(InstallOptions(machine, target_host=tr_machine.ip, update_hardware_config=HardwareConfig.NIXOS_FACTER))
