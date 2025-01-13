#!/usr/bin/env python3

from clan_cli.cmd import run, RunOpts, Log
import logging
from vpn_bench import Config
from vpn_bench.assets import get_asset
import shutil
from pathlib import Path
import json
from dataclasses import dataclass


@dataclass
class TrMachine:
    name: str
    ip: str


log = logging.getLogger(__name__)


def tr_init(config: Config) -> Path:
    config.data_dir.mkdir(parents=True, exist_ok=True)
    log.debug(f"Data dir: {config.data_dir}")
    tr_folder = get_asset("terraform")
    tr_dest_folder = config.data_dir / "terraform"
    if not tr_dest_folder.exists():
        shutil.copytree(tr_folder, tr_dest_folder, dirs_exist_ok=True)
        run(["tofu", "init"], RunOpts(cwd=tr_dest_folder, log=Log.BOTH))
    return tr_dest_folder


def tr_metadata(config: Config) -> list[TrMachine]:
    folder = tr_init(config)
    res = run(["tofu", "output", "--json"], RunOpts(cwd=folder, log=Log.STDERR))
    jdata = json.loads(res.stdout)

    machines = []
    for name, data in jdata.items():
        machine = TrMachine(name, data["value"]["ip_address"])
        machines.append(machine)

    log.debug(f"Machines: {machines}")
    return machines


def tr_clean(config: Config):
    tr_folder = config.data_dir / "terraform"
    shutil.rmtree(tr_folder)


def tr_create(config: Config):
    folder = tr_init(config)
    run(["tofu", "apply", "-auto-approve"], RunOpts(cwd=folder, log=Log.BOTH))


def tr_destroy(config: Config):
    folder = tr_init(config)
    run(["tofu", "destroy", "-auto-approve", RunOpts(cwd=folder, log=Log.BOTH)])
    tr_clean(config)
