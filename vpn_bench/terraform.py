#!/usr/bin/env python3

from clan_cli.cmd import run, RunOpts, Log
import logging
from vpn_bench import Config, Provider
from vpn_bench.assets import get_asset
import shutil
from pathlib import Path
import json
from dataclasses import dataclass
from string import Template

log = logging.getLogger(__name__)


@dataclass
class TrMachine:
    name: str
    ip: str


def terra_create_machine(config: Config, provider: Provider, name: str) -> None:
    tr_template_f = get_asset(provider, "templates") / "vm.tf"
    with tr_template_f.open("r") as f:
        template = Template(f.read())

    dest_f = config.tr_dir / f"{name}-instance.tf"

    with dest_f.open("w") as f:
        instance = template.substitute({"vm_name": name})
        f.write(instance)
    log.info(f"Written {dest_f}")


def tr_init(config: Config, provider: Provider) -> None:
    config.data_dir.mkdir(parents=True, exist_ok=True)
    log.debug(f"Data dir: {config.data_dir}")
    tr_folder = get_asset(provider, "terraform")
    tr_dest_folder = config.tr_dir
    if not tr_dest_folder.exists():
        shutil.copytree(tr_folder, tr_dest_folder, dirs_exist_ok=True)
        run(["tofu", "init"], RunOpts(cwd=tr_dest_folder, log=Log.BOTH))


def tr_metadata(config: Config) -> list[TrMachine]:
    res = run(["tofu", "output", "--json"], RunOpts(cwd=config.tr_dir, log=Log.STDERR))
    jdata = json.loads(res.stdout)

    machines = []
    for name, data in jdata.items():
        machine = TrMachine(name, data["value"]["ip_address"])
        max_name_length = (
            max(len(m.name) for m in machines) if machines else len(machine.name)
        )
        log.info(f"{machine.name:<{max_name_length}}: {machine.ip}")
        machines.append(machine)

    return machines


def tr_clean(config: Config):
    tr_folder = config.tr_dir
    shutil.rmtree(tr_folder)


def tr_create(config: Config, provider: Provider, machines: list[str]):
    tr_init(config, provider)
    for machine in machines:
        terra_create_machine(config, provider, machine)
    run(["tofu", "apply", "-auto-approve"], RunOpts(cwd=config.tr_dir, log=Log.BOTH))


def tr_destroy(config: Config):
    run(["tofu", "destroy", "-auto-approve"], RunOpts(cwd=config.tr_dir, log=Log.BOTH))
    tr_clean(config)
