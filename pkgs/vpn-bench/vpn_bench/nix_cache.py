import json
import logging
from pathlib import Path
from typing import Any

from clan_lib.cmd import Log, RunOpts
from clan_lib.flake import Flake
from clan_lib.machines.machines import Machine
from clan_lib.nix import nix_command
from clan_lib.persist.inventory_store import InventoryStore
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

    # BUG: Instead of using inventory_store, we use to directly modify the file
    # issue: https://git.clan.lol/clan/clan-core/issues/5236
    with inventory_store.inventory_file.open("r") as f:
        data = json.loads(f.read())

    with inventory_store.inventory_file.open("w") as f:
        data["instances"]["my-static-hosts-new-all"] = conf

        conf = {
            "module": {"name": "nix-cache-new", "input": "cvpn-bench"},
            "roles": {
                "default": {
                    "tags": {"all": {}},
                }
            },
        }
        data["instances"]["nix-cache-new-all"] = conf
        f.write(json.dumps(data, indent=4))


def init_nix_cache_path(host: Remote, cache_target: Machine) -> None:
    firefox = cache_target.select("pkgs.firefox.outPath")
    cmd = [
        "copy",
        "--from",
        "https://hetzner-cache.numtide.com/",
        firefox,
    ]

    with host.host_connection() as ssh:
        ssh.run(nix_command(cmd), RunOpts(log=Log.BOTH))


def run_nix_cache_test(
    fetch_machine: BenchMachine, vpn: VPN, cache_target: BenchMachine
) -> dict[str, Any]:
    # Restart harmonia service on cache_target (server) before running the test
    cache_host = cache_target.cmachine.target_host().override(host_key_check="none")
    with cache_host.host_connection() as ssh:
        ssh.run(["systemctl", "restart", "harmonia.service"], RunOpts(log=Log.BOTH))

    host = fetch_machine.cmachine.target_host().override(host_key_check="none")
    firefox = fetch_machine.cmachine.select("pkgs.firefox.outPath")
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
            firefox,
        ]

        urls = ",".join([f"http://cache.vpn.{cache_target.cmachine.name}"])

        cmd = [
            "hyperfine",
            "-w",
            "1",
            "-r",
            "2",
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

        ssh.run(cmd, RunOpts(log=Log.BOTH, timeout=1200))  # 20 minutes

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
