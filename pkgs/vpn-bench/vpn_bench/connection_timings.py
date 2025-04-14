import concurrent
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from clan_cli.cmd import Log, RunOpts, run
from clan_cli.inventory import patch_inventory_with
from clan_cli.machines.machines import Machine
from clan_cli.nix import nix_shell
from clan_cli.ssh.deploy_info import is_ssh_reachable
from clan_cli.ssh.upload import upload

from vpn_bench.assets import get_script_asset

# from clan_cli.ssh.upload import upload
from vpn_bench.data import VPN, BenchMachine, Config, delete_dirs
from vpn_bench.errors import save_bench_report
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)


def install_connection_timings_conf(
    config: Config,
    tr_machines: list[TrMachine],
    vpn: VPN,
    bmachines: list[BenchMachine],
) -> None:
    match vpn:
        case VPN.Internal:
            return
        case _:
            pass

    pub_ips = {f"v4.{machine['name']}": machine["name"] for machine in tr_machines}
    vpn_ips = {
        f"vpn.{bmachine.cmachine.name}": bmachine.cmachine.name
        for bmachine in bmachines
    }
    for bmachine in bmachines:
        cpub = pub_ips.copy()
        del cpub[f"v4.{bmachine.cmachine.name}"]
        cvpn = vpn_ips.copy()
        del cvpn[f"vpn.{bmachine.cmachine.name}"]
        conf = {
            "module": {"name": "my-nginx-new", "input": "cvpn-bench"},
            "roles": {
                "default": {
                    "machines": {bmachine.cmachine.name: {}},
                    "settings": {
                        "publicIPs": cpub,
                        "vpnIPs": cvpn,
                    },
                }
            },
        }

        patch_inventory_with(
            config.clan_dir, f"instances.my-nginx-{bmachine.cmachine.name}_id", conf
        )


def download_connection_timings(
    config: Config, vpn: VPN, machines: list[Machine], reboot: bool = False
) -> None:
    match vpn:
        case VPN.Internal:
            return
        case _:
            pass

    with ThreadPoolExecutor() as executor:
        futures = []
        for index, machine in enumerate(machines):
            src = f"{machine.target_host.target}:/var/lib/connection-check/connection_timings.json"
            dest = config.bench_dir / vpn.name / f"{index}_{machine.name}"
            dest.mkdir(parents=True, exist_ok=True)

            if reboot:
                dest /= "reboot_connection_timings.json"
            else:
                dest /= "connection_timings.json"

            priv_key = str(config.ssh_keys[0].private)
            future = executor.submit(
                run,
                nix_shell(["nixpkgs#openssh"], ["scp", "-i", priv_key, src, str(dest)]),
                RunOpts(log=Log.BOTH),
            )
            futures.append(future)
        done, not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                raise exc


def reboot_connection_timings(
    config: Config, vpn: VPN, machines: list[Machine]
) -> None:
    """Reboot machines to get connection timings."""
    log.info("Rebooting machines to get connection timings")

    delete_dirs(["/var/lib/connection-check", "/tmp/wait_service.sh"], machines)

    # Reboot machines
    with ThreadPoolExecutor() as executor:
        futures = []
        for machine in machines:
            host = machine.target_host
            future = executor.submit(
                host.run,
                ["reboot"],
                RunOpts(log=Log.BOTH),
            )
            futures.append(future)

        done, not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                raise exc

    # Wait for machines to be offline
    for machine in machines:
        host = machine.target_host
        while is_ssh_reachable(host):
            log.info(f"Waiting for {machine.name} to be offline")
            time.sleep(0.5)
        log.info(f"{machine.name} is offline")

    # Wait for machines to come online
    for machine in machines:
        host = machine.target_host
        while True:
            if is_ssh_reachable(host):
                log.info(f"{machine.name} is back online")
                break
            log.info(f"Waiting for {machine.name} to come online")
            time.sleep(1)

    # Wait for connection-check service to finish
    with ThreadPoolExecutor() as executor:
        futures = []
        for machine in machines:
            host = machine.target_host
            script = get_script_asset("wait_service.sh")
            wait_service_path = Path("/tmp/wait_service.sh")
            upload(host, script, wait_service_path, file_mode=0o777)
            future = executor.submit(
                host.run,
                [f"{wait_service_path}", "-s", "connection-check.service"],
                RunOpts(log=Log.BOTH),
            )
            futures.append(future)

        done, not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                raise exc

    download_connection_timings(config, vpn, machines, reboot=True)


def analyse_connection_timings(config: Config, tr_machines: list[TrMachine]) -> None:
    """
    Collect connection timing information from all machines for each VPN
    and generate summary files in the General folder.

    Args:
        config: Configuration containing benchmark directory
        tr_machines: List of test machines
    """
    log.info("Analyzing connection timings")

    # Create the General directory if it doesn't exist
    general_dir = config.bench_dir / "General"
    general_dir.mkdir(parents=True, exist_ok=True)

    # Process both regular and reboot connection timings
    for timing_type in ["connection_timings", "reboot_connection_timings"]:
        process_timing_files(config, timing_type, general_dir)


def process_timing_files(config: Config, timing_type: str, general_dir: Path) -> None:
    """
    Process timing files of a specific type across all VPNs and machines.

    Args:
        config: Configuration containing benchmark directory
        timing_type: Type of timing files to process ("connection_timings" or "reboot_connection_timings")
        general_dir: Directory to save the summary file
    """
    log.info(f"Processing {timing_type}")

    # Get all VPN directories (immediate subdirectories of the bench directory)
    vpn_dirs = [
        d
        for d in config.bench_dir.iterdir()
        if d.is_dir() and not d.name.startswith(".") and d.name != "General"
    ]

    # Dictionary to store the summary of all connection timings
    all_vpn_timings: dict[str, dict[str, str]] = {}

    for vpn_dir in vpn_dirs:
        vpn_name = vpn_dir.name
        log.info(f"Processing VPN: {vpn_name}")

        vpn_timings: dict[str, str] = {}
        all_vpn_timings[vpn_name] = vpn_timings

        # Process each machine directory
        for machine_dir in vpn_dir.iterdir():
            if (
                not machine_dir.is_dir()
                or machine_dir.name.startswith(".")
                or machine_dir.name == "layout.json"
            ):
                continue

            machine_name = machine_dir.name
            timing_file = machine_dir / f"{timing_type}.json"

            if not timing_file.exists():
                log.warning(
                    f"No {timing_type}.json found for {vpn_name}/{machine_name}"
                )
                continue

            try:
                with timing_file.open("r") as f:
                    data = json.load(f)

                # Extract connection time from VPN results
                # Find the first successful connection in vpn_results
                connection_time = None
                for _ip, result in data.get("vpn_results", {}).items():
                    if result.get("status") == "success":
                        connection_time = result.get("time_took")
                        break

                if connection_time:
                    vpn_timings[machine_name] = connection_time
                    log.info(f"  {machine_name}: {connection_time}")
                else:
                    log.warning(
                        f"No successful VPN connection found for {vpn_name}/{machine_name} in {timing_type}"
                    )
            except Exception as e:
                log.error(f"Error processing {timing_file}: {e}")

    save_bench_report(general_dir, all_vpn_timings, f"{timing_type}.json")
