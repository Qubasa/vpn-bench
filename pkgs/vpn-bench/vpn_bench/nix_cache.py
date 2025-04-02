import json
import logging
from pathlib import Path
from typing import Any

from clan_cli.cmd import Log, RunOpts
from clan_cli.inventory import patch_inventory_with
from clan_cli.nix import nix_command
from clan_cli.ssh.host import Host

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
        "some_id": {
            "roles": {
                "default": {
                    "tags": ["all"],
                    "config": {
                        "ipToHostnames": ip_to_hostnames,
                    },
                }
            }
        }
    }

    patch_inventory_with(config.clan_dir, "services.my-static-hosts", conf)

    conf = {
        "some_id": {
            "roles": {
                "default": {
                    "tags": ["all"],
                }
            }
        }
    }

    patch_inventory_with(config.clan_dir, "services.nix-cache", conf)


def init_nix_cache_path(host: Host, cache_target: Host) -> None:
    cmd = [
        "copy",
        "--from",
        "https://hetzner-cache.numtide.com/",
        "/nix/store/jlkypcf54nrh4n6r0l62ryx93z752hb2-firefox-132.0",
    ]

    cache_target.run(nix_command(cmd), RunOpts(log=Log.BOTH))


def run_nix_cache_test(
    fetch_machine: BenchMachine, vpn: VPN, cache_target: BenchMachine
) -> dict[str, Any]:
    host = fetch_machine.cmachine.target_host
    init_nix_cache_path(host, cache_target.cmachine.target_host)

    clear_cache_cmd = "rm -R ~/.cache/nix/binary-cache-*.sqlite*; rm -rf /tmp/cache;"

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

    host.run(cmd, RunOpts(log=Log.BOTH))

    res = host.run(["cat", f"{vpn.value}_nix-cache.json"])
    return json.loads(res.stdout)


def save_nix_cache_results(result_dir: Path, json_data: dict[str, Any]) -> None:
    """Save iperf test results to a file."""
    result_dir.mkdir(parents=True, exist_ok=True)
    crash_file = result_dir / "nix-cache_crash.json"
    if crash_file.exists():
        crash_file.unlink()

    with (result_dir / "nix-cache.json").open("w") as f:
        json.dump(json_data, f, indent=4)
