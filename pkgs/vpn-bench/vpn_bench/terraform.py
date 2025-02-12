#!/usr/bin/env python3

import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any, TypedDict

from clan_cli.cmd import Log, RunOpts, run

from vpn_bench.assets import get_cloud_asset
from vpn_bench.data import Config, Provider
from vpn_bench.errors import VpnBenchError

log = logging.getLogger(__name__)


class TrMachine(TypedDict):
    name: str
    location: str
    server_type: str
    ipv4: str | None


def tr_init(config: Config, provider: Provider) -> None:
    log.debug(f"Data dir: {config.data_dir}")
    tr_folder = get_cloud_asset(provider, "terraform")
    tr_dest_folder = config.tr_dir
    providers_cache_dir = config.cache_dir / ".terraform"
    providers_cache_dir.mkdir(parents=True, exist_ok=True)
    providers_dir = tr_dest_folder / ".terraform"

    if not tr_dest_folder.exists():
        shutil.copytree(tr_folder, tr_dest_folder, dirs_exist_ok=True)

        log.info(f"Symlink: {providers_cache_dir} -> {providers_dir}")
        providers_dir.symlink_to(providers_cache_dir)

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

    for _, data in jdata.items():
        machines_dict = data["value"]
        return list(machines_dict.values())

    return []


def tr_clean(config: Config) -> None:
    tr_folder = config.tr_dir
    shutil.rmtree(tr_folder, ignore_errors=True)


def tr_write_vars(config: Config, data: dict[str, Any]) -> None:
    vars_file = config.tr_dir / "servers.auto.tfvars.json"
    with vars_file.open("w") as json_file:
        json.dump(data, json_file, indent=2)


def tr_ask_for_api_key(provider: Provider) -> None:
    match provider:
        case Provider.Hetzner:
            if os.environ.get("TF_VAR_hcloud_token"):
                return
            if bitwarden_api_key_loc := os.environ.get("BW_API_KEY_LOC"):
                log.debug("Bitwarden API key location found in environment")
                did_login = run(
                    ["bw", "login", "--check"], RunOpts(log=Log.BOTH, check=False)
                )
                if did_login.returncode != 0:
                    log.info("Bitwarden not logged in")
                    log.info("Please login to Bitwarden CLI")
                    run(
                        ["bw", "login"],
                        RunOpts(
                            log=Log.BOTH,
                            stderr=sys.stderr.buffer,
                            error_msg="Failed to login to Bitwarden CLI",
                            needs_user_terminal=True,
                        ),
                    )

                res = run(
                    ["bw", "get", "item", bitwarden_api_key_loc],
                    RunOpts(
                        log=Log.NONE,
                        stderr=sys.stderr.buffer,
                        needs_user_terminal=True,
                        error_msg="Failed to get Hetzner Cloud API token from Bitwarden",
                    ),
                )
                api_token = json.loads(res.stdout)["login"]["password"]
                os.environ["TF_VAR_hcloud_token"] = api_token
            if not os.environ.get("TF_VAR_hcloud_token"):
                log.info("Hetzner Cloud API token not found in environment")
                log.info(
                    "Please generate one. Follow for more info: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/"
                )
                api_token = input("Enter your Hetzner Cloud API token: ")
                os.environ["TF_VAR_hcloud_token"] = api_token
        case Provider.GCloud:
            msg = "GCloud not implemented yet"
            raise NotImplementedError(msg)


def tr_create(
    config: Config, ssh_key: Path, provider: Provider, machines: list[str]
) -> None:
    if not ssh_key.exists():
        msg = f"SSH key {ssh_key} does not exist, please specify one with --ssh-key"
        raise VpnBenchError(msg)

    tr_ask_for_api_key(provider)
    tr_init(config, provider)
    match provider:
        case Provider.Hetzner:
            servers: list[TrMachine] = []
            for machine in machines:
                servers.append(
                    {
                        "name": machine,
                        "location": "sin",  # TODO: Make configurable
                        "server_type": "ccx13",
                        "ipv4": None,
                    }
                )
            tr_write_vars(
                config,
                {
                    "ssh_pubkey": ssh_key.read_text(),
                    "os_image": "ubuntu-24.04",
                    "servers": servers,
                },
            )
        case Provider.GCloud:
            msg = "GCloud not implemented yet"
            raise NotImplementedError(msg)

    run(
        ["tofu", f"-chdir={config.tr_dir}", "apply", "-auto-approve"],
        RunOpts(log=Log.BOTH),
    )


def tr_destroy(config: Config, provider: Provider, force: bool) -> None:
    tr_ask_for_api_key(provider)
    run(
        ["tofu", f"-chdir={config.tr_dir}", "destroy", "-auto-approve"],
        RunOpts(log=Log.BOTH, check=force),
    )
    tr_clean(config)
    log.info("Resources destroyed")
