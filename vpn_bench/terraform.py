#!/usr/bin/env python3

import json
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path
from string import Template

from clan_cli.cmd import Log, RunOpts, run

from vpn_bench import Config, Provider
from vpn_bench.assets import get_cloud_asset

log = logging.getLogger(__name__)


@dataclass
class TrMachine:
    name: str
    ip: str


def terra_create_machine(
    config: Config, ssh_key_path: Path, provider: Provider, name: str
) -> None:
    tr_template_f = get_cloud_asset(provider, "templates") / "vm.tf"
    with tr_template_f.open("r") as f:
        template = Template(f.read())

    dest_f = config.tr_dir / f"{name}-instance.tf"

    ssh_key = ssh_key_path.read_text().removesuffix("\n")

    with dest_f.open("w") as f:
        instance = template.substitute({"vm_name": name, "ssh_key": ssh_key})
        f.write(instance)
    log.info(f"Written {dest_f}")


def tr_init(config: Config, provider: Provider) -> None:
    log.debug(f"Data dir: {config.data_dir}")
    tr_folder = get_cloud_asset(provider, "terraform")
    tr_dest_folder = config.tr_dir
    if not tr_dest_folder.exists():
        shutil.copytree(tr_folder, tr_dest_folder, dirs_exist_ok=True)
        run(
            ["tofu", f"-chdir={config.tr_dir}", "init"],
            RunOpts(cwd=tr_dest_folder, log=Log.BOTH),
        )


def tr_metadata(config: Config) -> list[TrMachine]:
    res = run(
        ["tofu", f"-chdir={config.tr_dir}", "output", "--json"],
        RunOpts(cwd=config.tr_dir, log=Log.STDERR),
    )
    jdata = json.loads(res.stdout)

    machines: list[TrMachine] = []
    for name, data in jdata.items():
        machine = TrMachine(name, data["value"]["ip_address"])
        max_name_length = (
            max(len(m.name) for m in machines) if machines else len(machine.name)
        )
        log.info(f"{machine.name:<{max_name_length}}: {machine.ip}")
        machines.append(machine)

    return machines


def tr_clean(config: Config) -> None:
    tr_folder = config.tr_dir
    shutil.rmtree(tr_folder, ignore_errors=True)


def tr_create(config: Config, ssh_key: Path, provider: Provider, machines: list[str]) -> None:
    tr_init(config, provider)
    for machine in machines:
        terra_create_machine(config, ssh_key, provider, machine)
    run(
        ["tofu", f"-chdir={config.tr_dir}", "apply", "-auto-approve"],
        RunOpts(log=Log.BOTH),
    )


def tr_destroy(config: Config) -> None:
    run(
        ["tofu", f"-chdir={config.tr_dir}", "destroy", "-auto-approve"],
        RunOpts(log=Log.BOTH, check=False),
    )
    tr_clean(config)
    log.info("Resources destroyed")
