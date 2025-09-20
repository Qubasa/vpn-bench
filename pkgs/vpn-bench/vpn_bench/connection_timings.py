import concurrent
import contextlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from clan_lib.cmd import Log, RunOpts
from clan_lib.errors import ClanError  # Assuming these are available
from clan_lib.flake import Flake
from clan_lib.machines.machines import Machine
from clan_lib.persist.inventory_store import InventoryStore, set_value_by_path
from clan_lib.ssh.upload import upload

from vpn_bench.assets import get_script_asset

# from clan_lib.ssh.upload import upload
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

        inventory_store = InventoryStore(Flake(str(config.clan_dir)))
        inventory = inventory_store.read()
        set_value_by_path(
            inventory, f"instances.my-nginx-{bmachine.cmachine.name}_id", conf
        )
        inventory_store.write(
            inventory,
            message=f"Add connection timings conf for {bmachine.cmachine.name}",
        )


def download_connection_timings(
    config: Config, vpn: VPN, machines: list[Machine], reboot: bool = False
) -> None:
    match vpn:
        case VPN.Internal:
            return
        case _:
            pass

    def download_save(machine: Machine, dest: Path) -> None:
        host = machine.target_host()
        with host.host_connection() as ssh:
            res = ssh.run(
                ["cat", "/var/lib/connection-check/connection_timings.json"],
                RunOpts(log=Log.BOTH),
            )
            res = json.loads(res.stdout)

            with dest.open("w") as f:
                json.dump(res, f, indent=4)

    with ThreadPoolExecutor() as executor:
        futures = []
        for index, machine in enumerate(machines):
            dest = config.bench_dir / vpn.name / f"{index}_{machine.name}"
            dest.mkdir(parents=True, exist_ok=True)

            if reboot:
                dest /= "reboot_connection_timings.json"
            else:
                dest /= "connection_timings.json"

            future = executor.submit(
                download_save,
                machine,
                dest,
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

    def _reboot(machine: Machine) -> None:
        host = machine.target_host()
        with host.host_connection() as ssh:
            ssh.run(
                ["reboot"],
                RunOpts(log=Log.BOTH),
            )

    # Reboot machines
    with ThreadPoolExecutor() as executor:
        futures = []
        for machine in machines:
            future = executor.submit(_reboot, machine)
            futures.append(future)

        done, not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                raise exc

    # Wait for machines to be offline
    for machine in machines:
        host = machine.target_host()
        with contextlib.suppress(ClanError):
            host.check_machine_ssh_reachable()
            log.info(f"Waiting for {machine.name} to be offline")
            time.sleep(0.5)
        log.info(f"{machine.name} is offline")

    # Wait for machines to come online
    for machine in machines:
        while True:
            host = machine.target_host()
            with contextlib.suppress(ClanError):
                host.check_machine_ssh_reachable()
                log.info(f"{machine.name} is back online")
                break
            log.info(f"Waiting for {machine.name} to come online")
            time.sleep(1)

    def _wait_service(machine: Machine, wait_service_path: Path) -> None:
        host = machine.target_host()
        upload(host, script, wait_service_path, file_mode=0o777)
        with host.host_connection() as ssh:
            ssh.run(
                [f"{wait_service_path}", "-s", "connection-check.service"],
                RunOpts(log=Log.BOTH),
            )

    # Wait for connection-check service to finish
    with ThreadPoolExecutor() as executor:
        futures = []
        for machine in machines:
            script = get_script_asset("wait_service.sh")
            wait_service_path = Path("/tmp/wait_service.sh")
            future = executor.submit(
                _wait_service,
                machine,
                wait_service_path,
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
