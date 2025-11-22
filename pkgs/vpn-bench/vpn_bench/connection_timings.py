import concurrent
import contextlib
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import cast

from clan_lib.cmd import Log, RunOpts
from clan_lib.errors import ClanError  # Assuming these are available
from clan_lib.flake import Flake
from clan_lib.machines.machines import Machine
from clan_lib.nix_models.clan import InventoryInstance, Unknown
from clan_lib.persist.inventory_store import InventoryStore
from clan_lib.ssh.upload import upload

from vpn_bench.assets import get_script_asset

# from clan_lib.ssh.upload import upload
from vpn_bench.data import VPN, BenchMachine, Config, delete_dirs
from vpn_bench.errors import save_bench_report
from vpn_bench.retry import MaxRetriesExceededError, retry_operation
from vpn_bench.terraform import TrMachine

log = logging.getLogger(__name__)

# Maximum time to wait for a machine to come back online after reboot (in seconds)
MAX_MACHINE_ONLINE_WAIT = 300  # 5 minutes


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
        inventory_store = InventoryStore(Flake(str(config.clan_dir)))

        # BUG: Instead of using inventory_store, we use to directly modify the file
        # issue: https://git.clan.lol/clan/clan-core/issues/5236
        with inventory_store.inventory_file.open("r") as f:
            inventory = json.loads(f.read())

            conf: InventoryInstance = {
                "module": {"name": "my-nginx-new", "input": "cvpn-bench"},
                "roles": {
                    "default": {
                        "machines": {bmachine.cmachine.name: {}},
                        "settings": cast(
                            Unknown,
                            {
                                "publicIPs": cpub,
                                "vpnIPs": cvpn,
                            },
                        ),
                    }
                },
            }

            inventory["instances"][f"my-nginx-{bmachine.cmachine.name}"] = conf
        with inventory_store.inventory_file.open("w") as f:
            f.write(json.dumps(inventory, indent=4))


def download_connection_timings(
    config: Config,
    vpn: VPN,
    machines: list[Machine],
    reboot: bool = False,
    benchmark_run_alias: str = "default",
) -> None:
    match vpn:
        case VPN.Internal:
            return
        case _:
            pass

    def download_save(machine: Machine, dest: Path) -> None:
        host = machine.target_host().override(host_key_check="none")
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
            dest = (
                config.bench_dir
                / vpn.name
                / benchmark_run_alias
                / f"{index}_{machine.name}"
            )
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


def wait_for_vpn_connectivity(
    machines: list[Machine],
    max_retries: int = 3,
) -> None:
    """
    Wait for VPN connectivity between machines after a VPN service restart.

    This clears the connection check data, restarts the connection-check service,
    and waits for it to complete (which verifies machines can ping each other).

    Args:
        machines: List of machines to wait for connectivity
        max_retries: Maximum number of retry attempts for the entire operation
    """
    log.info("Waiting for VPN connectivity between machines")

    # Clear old connection check data
    delete_dirs(["/var/lib/connection-check"], machines)

    # Recreate the directory (needed for WorkingDirectory in connection-check.service)
    def _mkdir(machine: Machine) -> None:
        def _do_mkdir() -> None:
            host = machine.target_host().override(host_key_check="none")
            with host.host_connection() as ssh:
                ssh.run(
                    ["mkdir", "-p", "/var/lib/connection-check"],
                    RunOpts(log=Log.BOTH),
                )

        retry_operation(
            _do_mkdir,
            max_retries=2,
            initial_delay=1.0,
            operation_name=f"mkdir on {machine.name}",
        )

    with ThreadPoolExecutor() as executor:
        futures = [executor.submit(_mkdir, m) for m in machines]
        concurrent.futures.wait(futures)
        for f in futures:
            exc = f.exception()
            if exc is not None:
                raise exc

    def _restart_connection_check(machine: Machine) -> None:
        def _do_restart() -> None:
            host = machine.target_host().override(host_key_check="none")
            with host.host_connection() as ssh:
                ssh.run(
                    ["systemctl", "restart", "connection-check.service"],
                    RunOpts(log=Log.BOTH),
                )

        retry_operation(
            _do_restart,
            max_retries=2,
            initial_delay=2.0,
            operation_name=f"restart connection-check on {machine.name}",
        )

    # Restart connection-check service on all machines
    with ThreadPoolExecutor() as executor:
        futures = []
        for machine in machines:
            future = executor.submit(_restart_connection_check, machine)
            futures.append(future)

        done, not_done = concurrent.futures.wait(futures)

        for future in done:
            exc = future.exception()
            if exc is not None:
                raise exc

    def _wait_service(machine: Machine, wait_service_path: Path) -> None:
        def _do_wait() -> None:
            host = machine.target_host().override(host_key_check="none")
            with host.host_connection() as ssh:
                upload(ssh, script, wait_service_path, file_mode=0o777)
                ssh.run(
                    [f"{wait_service_path}", "-s", "connection-check.service"],
                    RunOpts(log=Log.BOTH, timeout=120),  # Add 2 minute timeout
                )

        retry_operation(
            _do_wait,
            max_retries=max_retries,
            initial_delay=5.0,
            max_delay=30.0,
            operation_name=f"wait for connection-check on {machine.name}",
        )

    # Wait for connection-check service to finish on all machines
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

    log.info("VPN connectivity established between all machines")


def reboot_connection_timings(
    config: Config,
    vpn: VPN,
    machines: list[Machine],
    benchmark_run_alias: str = "default",
) -> None:
    """Reboot machines to get connection timings."""
    log.info("Rebooting machines to get connection timings")

    delete_dirs(["/var/lib/connection-check", "/tmp/wait_service.sh"], machines)

    def _reboot(machine: Machine) -> None:
        host = machine.target_host().override(host_key_check="none")
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
        host = machine.target_host().override(host_key_check="none")
        with contextlib.suppress(ClanError):
            host.check_machine_ssh_reachable()
            log.info(f"Waiting for {machine.name} to be offline")
            time.sleep(0.5)
        log.info(f"{machine.name} is offline")

    # Wait for machines to come online with timeout
    for machine in machines:
        start_time = time.time()
        while True:
            host = machine.target_host().override(host_key_check="none")
            with contextlib.suppress(ClanError):
                host.check_machine_ssh_reachable()
                log.info(f"{machine.name} is back online")
                break

            elapsed = time.time() - start_time
            if elapsed > MAX_MACHINE_ONLINE_WAIT:
                msg = f"{machine.name} did not come online within {MAX_MACHINE_ONLINE_WAIT} seconds"
                log.error(msg)
                raise MaxRetriesExceededError(msg)

            log.info(
                f"Waiting for {machine.name} to come online ({int(elapsed)}s elapsed)"
            )
            time.sleep(2)

    def _wait_service(machine: Machine, wait_service_path: Path) -> None:
        host = machine.target_host().override(host_key_check="none")
        with host.host_connection() as ssh:
            upload(ssh, script, wait_service_path, file_mode=0o777)
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

    download_connection_timings(
        config, vpn, machines, reboot=True, benchmark_run_alias=benchmark_run_alias
    )


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
    # Structure: {vpn_name: {run_alias: {machine_name: timing}}}
    all_vpn_timings: dict[str, dict[str, dict[str, str]]] = {}

    for vpn_dir in vpn_dirs:
        vpn_name = vpn_dir.name
        log.info(f"Processing VPN: {vpn_name}")

        vpn_timings: dict[str, dict[str, str]] = {}
        all_vpn_timings[vpn_name] = vpn_timings

        # Process each benchmark run directory
        for run_dir in vpn_dir.iterdir():
            if not run_dir.is_dir() or run_dir.name.startswith("."):
                continue

            run_alias = run_dir.name
            log.info(f"  Processing run: {run_alias}")

            run_timings: dict[str, str] = {}
            vpn_timings[run_alias] = run_timings

            # Process each machine directory within the run
            for machine_dir in run_dir.iterdir():
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
                        f"No {timing_type}.json found for {vpn_name}/{run_alias}/{machine_name}"
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
                        run_timings[machine_name] = connection_time
                        log.info(f"    {machine_name}: {connection_time}")
                    else:
                        log.warning(
                            f"No successful VPN connection found for {vpn_name}/{run_alias}/{machine_name} in {timing_type}"
                        )
                except Exception as e:
                    log.error(f"Error processing {timing_file}: {e}")

    save_bench_report(general_dir, all_vpn_timings, f"{timing_type}.json")
