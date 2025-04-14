#!/usr/bin/env python3

import json
import logging
import os
import shutil
import textwrap
from pathlib import Path
from typing import Any

from clan_cli.cmd import Log, RunOpts, run
from clan_cli.templates import copy_from_nixstore
from clan_cli.vars.prompt import PromptType, ask

from vpn_bench.assets import get_cloud_asset
from vpn_bench.data import Config, Provider, TrMachine
from vpn_bench.errors import VpnBenchError

log = logging.getLogger(__name__)


def tr_init(config: Config, provider: Provider) -> None:
    log.debug(f"Data dir: {config.data_dir}")
    tr_folder = get_cloud_asset(provider, "terraform")
    tr_dest_folder = config.tr_dir
    providers_cache_dir = config.cache_dir / ".terraform"
    providers_cache_dir.mkdir(parents=True, exist_ok=True)
    providers_dir = tr_dest_folder / ".terraform"

    if not tr_dest_folder.exists():
        copy_from_nixstore(tr_folder, tr_dest_folder)

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

    machines = []
    for _name, data in jdata["vm_info"]["value"].items():
        tr_machine = TrMachine(
            name=data["name"],
            location=data.get("location"),
            server_type=data["server_type"],
            ipv4=data["ipv4"],
            ipv6=data.get("ipv6"),
            internal_ipv6=data.get("internal_ipv6"),
            provider=Provider.from_str(data["provider"]),
        )
        machines.append(tr_machine)

    return machines


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
            if not os.environ.get("TF_VAR_hcloud_token"):
                log.info("Hetzner Cloud API token not found in environment")
                log.info(
                    "Please generate one. Follow for more info: https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/"
                )
                api_token = ask("Hetzner Cloud API token", PromptType.HIDDEN, None)
                os.environ["TF_VAR_hcloud_token"] = api_token
        case Provider.GCloud:
            msg = "GCloud not implemented yet"
            raise NotImplementedError(msg)
        case Provider.Chameleon:
            openstack = Path("~/.config/openstack/clouds.yaml").expanduser()
            if not openstack.exists():
                msg = textwrap.dedent(
                    f"""\
                    Openstack cloud config not found at {openstack}.
                    Please download the file from the Chameleon portal and place it at the above location.
                    For more info go to: https://chameleoncloud.readthedocs.io/en/latest/technical/cli.html#creating-an-application-credential
                    """
                )
                raise VpnBenchError(msg)


def tr_create(
    config: Config,
    provider: Provider,
    location: str | None,
    user_ssh_pubkey: Path,
    machines: list[str],
) -> None:
    tr_ask_for_api_key(provider)
    tr_init(config, provider)

    ssh_pubkeys = [key.public.read_text() for key in config.ssh_keys]
    servers: list[dict[str, Any]] = []

    match provider:
        case Provider.Hetzner:
            allowed_locations = {
                "nbg1": "DE: Nuremberg",
                "fsn1": "DE: Falkenstein",
                "hel1": "FIN: Helsinki",
                "ash": "US: Ashburn",
                "hil": "US: Hillsboro",
                "sin": "SG: Singapore",
            }
            if location is None:
                location = "nbg1"
                log.info(f"No location specified. Using default location: {location}")

            if location not in allowed_locations:
                msg = f"Invalid location: {location}. Valid locations: {json.dumps(allowed_locations, indent=2)}"
                raise VpnBenchError(msg)

            for machine in machines:
                servers.append(
                    {
                        "name": machine,
                        "location": location,
                        # "server_type": "ccx23", # dedicated cpu
                        "server_type": "cpx31",  # shared cpu
                        "ipv4": None,
                        "ipv6": None,
                    }
                )
            tr_write_vars(
                config,
                {
                    "ssh_pubkeys": ssh_pubkeys,
                    "os_image": "ubuntu-24.04",
                    "servers": servers,
                },
            )
        case Provider.GCloud:
            msg = "GCloud not implemented yet"
            raise NotImplementedError(msg)

        case Provider.Chameleon:
            for machine in machines:
                servers.append(
                    {
                        "name": machine,
                        "server_type": "m1.large",
                        "ipv4": None,
                        "ipv6": None,
                    }
                )
                tr_write_vars(
                    config,
                    {
                        "ssh_pubkeys": ssh_pubkeys,
                        "os_image": "CC-Ubuntu24.04",
                        "servers": servers,
                    },
                )
        case _:
            msg = f"Provider {provider} not implemented yet"
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
