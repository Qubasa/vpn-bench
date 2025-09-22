import json
import logging
from pathlib import Path
from typing import Any

from clan_lib.cmd import Log, RunOpts
from clan_lib.flake import Flake
from clan_lib.machines.machines import Machine
from clan_lib.nix import nix_command
from clan_lib.persist.inventory_store import InventoryStore, set_value_by_path
from clan_lib.ssh.remote import Remote

from vpn_bench.data import VPN, BenchMachine, Config
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


def install_nix_cache(
    config: Config,
    tr_machines: list[TrMachine],
    bmachines: list[BenchMachine],
) -> None:
    ip_to_hostnames: dict[str, list[str]] = {}
    for index, machine in enumerate(tr_machines):
        assert machine["ipv4"] is not None
        ip_to_hostnames[machine["ipv4"]] = [
            f"v4.{machine['name']}",
            f"cache.{machine['name']}",
        ]
        if machine["ipv6"] is not None:
            ip_to_hostnames[machine["ipv6"]] = [
                f"v6.{machine['name']}",
                f"cache.v6.{machine['name']}",
            ]
        if machine["internal_ipv6"] is not None:
            ip_to_hostnames[machine["internal_ipv6"]] = [
                f"internal.v6.{machine['name']}",
                f"cache.internal.v6.{machine['name']}",
            ]
        ip_to_hostnames[bmachines[index].vpn_ip] = [
            f"vpn.{machine['name']}",
            f"cache.vpn.{machine['name']}",
        ]

    conf = {
        "module": {"name": "my-static-hosts-new", "input": "cvpn-bench"},
        "roles": {
            "default": {
                "tags": {"all": {}},
                "settings": {
                    "ipToHostnames": ip_to_hostnames,
                },
            }
        },
    }
    inventory_store = InventoryStore(Flake(str(config.clan_dir)))
    inventory = inventory_store.read()
    set_value_by_path(inventory, "instances.my-static-hosts-new-all", conf)

    conf = {
        "module": {"name": "nix-cache-new", "input": "cvpn-bench"},
        "roles": {
            "default": {
                "tags": {"all": {}},
            }
        },
    }
    set_value_by_path(inventory, "instances.nix-cache-new-all", conf)
    inventory_store.write(
        inventory,
        message="Add nix-cache configuration for vpn and internal ips",
    )


def init_nix_cache_path(host: Remote, cache_target: Machine) -> None:
    cmd = [
        "copy",
        "--from",
        "https://hetzner-cache.numtide.com/",
        "/nix/store/jlkypcf54nrh4n6r0l62ryx93z752hb2-firefox-132.0",
    ]

    with host.host_connection() as ssh:
        ssh.run(nix_command(cmd), RunOpts(log=Log.BOTH))


def run_nix_cache_test(
    fetch_machine: BenchMachine, vpn: VPN, cache_target: BenchMachine
) -> dict[str, Any]:
    host = fetch_machine.cmachine.target_host().override(host_key_check="none")
    with host.host_connection() as ssh:
        init_nix_cache_path(host, cache_target.cmachine)

        clear_cache_cmd = (
            "rm -R ~/.cache/nix/binary-cache-*.sqlite*; rm -rf /tmp/cache;"
        )

        nix_copy_cmd_list = [
            "nix",
            "copy",
            "--from",
            "{url}",
            "--to",
            "file:///tmp/cache?compression=none",
            "/nix/store/jlkypcf54nrh4n6r0l62ryx93z752hb2-firefox-132.0",
        ]

        urls = ",".join([f"http://cache.vpn.{cache_target.cmachine.name}"])

        cmd = [
            "hyperfine",
            "-w",
            "1",
            "-r",
            "4",
            "--show-output",
            "--export-json",
            f"{vpn.value}_nix-cache.json",
            "--prepare",
            clear_cache_cmd,
            " ".join(nix_copy_cmd_list),
            "-L",
            "url",
            urls,
        ]

        ssh.run(cmd, RunOpts(log=Log.BOTH, timeout=120))  # 2 minutes

        res = ssh.run(["cat", f"{vpn.value}_nix-cache.json"])
        return json.loads(res.stdout)


def save_nix_cache_results(result_dir: Path, json_data: dict[str, Any]) -> None:
    """Save iperf test results to a file."""
    result_dir.mkdir(parents=True, exist_ok=True)
    crash_file = result_dir / "nix-cache_crash.json"
    if crash_file.exists():
        crash_file.unlink()

    with (result_dir / "nix-cache.json").open("w") as f:
        json.dump(json_data, f, indent=4)
