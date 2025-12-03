#!/usr/bin/env python3

import json
import logging
import os
import shutil
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from clan_cli.vars.prompt import PromptType, ask
from clan_lib.cmd import Log, RunOpts, run
from clan_lib.templates.filesystem import copy_from_nixstore

from vpn_bench.assets import get_cloud_asset
from vpn_bench.data import Config, Provider, TrMachine
from vpn_bench.errors import VpnBenchError

log = logging.getLogger(__name__)


@dataclass
class HardwareHost:
    """Parsed hardware host information."""

    user: str
    ip: str
    port: int
    name: str


def parse_hardware_host(host_str: str) -> HardwareHost:
    """Parse a hardware host string in format user@ip:port:name or user@ip:name.

    Args:
        host_str: Host string like "root@192.168.1.100:22:server1" or "root@192.168.1.100:server1"

    Returns:
        HardwareHost with parsed values

    Raises:
        VpnBenchError: If the format is invalid
    """
    if "@" not in host_str:
        msg = f"Invalid host format '{host_str}': missing user (expected user@ip:port:name or user@ip:name)"
        raise VpnBenchError(msg)

    user_part, rest = host_str.split("@", 1)
    parts = rest.split(":")

    if len(parts) == 2:
        # Format: user@ip:name (port defaults to 22)
        ip, name = parts
        port = 22
    elif len(parts) == 3:
        # Format: user@ip:port:name
        ip, port_str, name = parts
        try:
            port = int(port_str)
        except ValueError as e:
            msg = f"Invalid port '{port_str}' in host '{host_str}'"
            raise VpnBenchError(msg) from e
    else:
        msg = f"Invalid host format '{host_str}': expected user@ip:port:name or user@ip:name"
        raise VpnBenchError(msg)

    return HardwareHost(user=user_part, ip=ip, port=port, name=name)


def verify_ssh_connectivity(
    host: HardwareHost, ssh_key: Path, timeout: int = 10
) -> bool:
    """Verify SSH connectivity to a hardware host.

    Args:
        host: Parsed hardware host
        ssh_key: Path to SSH private key
        timeout: Connection timeout in seconds

    Returns:
        True if connection succeeds, False otherwise
    """
    try:
        result = run(
            [
                "ssh",
                "-o",
                "StrictHostKeyChecking=accept-new",
                "-o",
                f"ConnectTimeout={timeout}",
                "-o",
                "BatchMode=yes",
                "-i",
                str(ssh_key),
                "-p",
                str(host.port),
                f"{host.user}@{host.ip}",
                "true",
            ],
            RunOpts(log=Log.STDERR, check=False),
        )
    except Exception:
        return False
    else:
        return result.returncode == 0


def write_hardware_metadata(config: Config, hosts: list[HardwareHost]) -> None:
    """Write hardware machine metadata to JSON file."""
    vm_info: dict[str, Any] = {}
    for host in hosts:
        vm_info[host.name] = {
            "name": host.name,
            "location": None,
            "server_type": "hardware",
            "ipv4": host.ip,
            "ipv6": None,
            "internal_ipv6": None,
            "provider": "hardware",
            "ssh_user": host.user,
            "ssh_port": host.port,
        }

    metadata = {"vm_info": vm_info}
    metadata_path = config.get_hardware_metadata_path()
    with metadata_path.open("w") as f:
        json.dump(metadata, f, indent=2)
    log.info(f"Hardware metadata written to {metadata_path}")


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


def _read_hardware_metadata(config: Config) -> list[TrMachine]:
    """Read machine metadata from hardware JSON file."""
    metadata_path = config.get_hardware_metadata_path()
    with metadata_path.open() as f:
        jdata = json.load(f)

    machines = []
    for _name, data in jdata["vm_info"].items():
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


def tr_metadata(config: Config) -> list[TrMachine]:
    # Check for Hardware provider (JSON file exists)
    hardware_meta_path = config.get_hardware_metadata_path()
    if hardware_meta_path.exists():
        return _read_hardware_metadata(config)

    # Fall back to Terraform output
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
                api_token = ask(
                    "Hetzner Cloud API token", PromptType.HIDDEN, None, machine_names=[]
                )
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
        case Provider.Hardware:
            pass  # No API key needed for hardware provider


def tr_create(
    config: Config,
    provider: Provider,
    location: str | None,
    user_ssh_pubkey: Path | None,
    machines: list[str],
    hardware_hosts: list[str] | None = None,
) -> None:
    # Handle Hardware provider separately (no Terraform)
    if provider == Provider.Hardware:
        if not hardware_hosts:
            msg = "Hardware provider requires --host arguments"
            raise VpnBenchError(msg)

        parsed_hosts = [parse_hardware_host(h) for h in hardware_hosts]

        # Verify SSH connectivity to all hosts
        log.info("Verifying SSH connectivity to hardware hosts...")
        ssh_key = config.ssh_keys[0].private
        failed_hosts: list[str] = []

        for host in parsed_hosts:
            log.info(
                f"  Testing connection to {host.name} ({host.user}@{host.ip}:{host.port})..."
            )
            if verify_ssh_connectivity(host, ssh_key):
                log.info(f"    ✓ {host.name} OK")
            else:
                log.error(f"    ✗ {host.name} FAILED")
                failed_hosts.append(host.name)

        if failed_hosts:
            msg = f"SSH connectivity check failed for hosts: {', '.join(failed_hosts)}"
            raise VpnBenchError(msg)

        # Write metadata
        write_hardware_metadata(config, parsed_hosts)
        log.info("Hardware machines registered successfully")
        return

    # Cloud providers use Terraform
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
    # Handle Hardware provider separately (no Terraform)
    if provider == Provider.Hardware:
        hardware_meta_path = config.get_hardware_metadata_path()
        if hardware_meta_path.exists():
            hardware_meta_path.unlink()
            log.info(f"Removed hardware metadata: {hardware_meta_path}")
        else:
            log.info("No hardware metadata found to clean")
        log.info("Hardware resources cleaned (local state only)")
        return

    # Cloud providers use Terraform
    tr_ask_for_api_key(provider)
    run(
        ["tofu", f"-chdir={config.tr_dir}", "destroy", "-auto-approve"],
        RunOpts(log=Log.BOTH, check=force),
    )
    tr_clean(config)
    log.info("Resources destroyed")
