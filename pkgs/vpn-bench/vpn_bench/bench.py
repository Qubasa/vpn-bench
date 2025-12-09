import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, ParamSpec

from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine
from clan_lib.ssh.upload import upload

from vpn_bench.assets import get_iperf_asset
from vpn_bench.comparison import generate_comparison_data
from vpn_bench.connection_timings import wait_for_vpn_connectivity
from vpn_bench.data import VPN, BenchMachine, BenchmarkRun, Config, TCSettings, TestType
from vpn_bench.errors import TestMetadataDict, save_bench_report
from vpn_bench.iperf3 import IperfCreds, run_iperf_test
from vpn_bench.nix_cache import run_nix_cache_test
from vpn_bench.ping import run_ping_test
from vpn_bench.progress import ProgressTracker
from vpn_bench.qperf import run_qperf_test
from vpn_bench.retry import retry_operation_with_info
from vpn_bench.rist_stream import run_rist_test
from vpn_bench.terraform import TrMachine
from vpn_bench.vpn import install_vpn

log = logging.getLogger(__name__)


def get_vpn_service_name(vpn: VPN) -> str:
    """Get the systemd service name for a given VPN type."""
    match vpn:
        case VPN.Zerotier:
            return "zerotierone.service"
        case VPN.Mycelium:
            return "mycelium.service"
        case VPN.Hyprspace:
            return "hyprspace.service"
        case VPN.VpnCloud:
            return "vpncloud.service"
        case VPN.Yggdrasil:
            return "yggdrasil.service"
        case VPN.Easytier:
            return "easytier-easytier.service"
        case VPN.Nebula:
            return "nebula@nebula.service"
        case VPN.Tinc:
            return "tinc.tinc.service"
        case _:
            msg = f"Unknown VPN type: {vpn}"
            raise ValueError(msg)


def get_test_service_name(test: TestType) -> str | None:
    """Get the systemd service name for a given test type.

    Returns None for tests that don't have a dedicated server-side service.
    """
    match test:
        case TestType.QPERF:
            return "qperf.service"
        case TestType.IPERF3:
            return "iperf3.service"
        case TestType.RIST_STREAM:
            return "rist-receiver.service"
        case TestType.PING | TestType.NIX_CACHE:
            # These tests don't have dedicated server services
            return None
        case _:
            return None


def get_service_logs(
    machine: Machine, service_name: str, since: str = "5 minutes ago"
) -> str:
    """Fetch systemd service logs from a remote machine.

    Args:
        machine: The Machine to fetch logs from
        service_name: The systemd service name (e.g., "qperf.service")
        since: Time specification for journalctl --since (default: "5 minutes ago")

    Returns:
        The service logs as a string, or error message if fetching fails
    """
    try:
        host = machine.target_host().override(host_key_check="none")
        with host.host_connection() as ssh:
            result = ssh.run(
                ["journalctl", "-u", service_name, "--since", since, "--no-pager"],
                RunOpts(log=Log.BOTH, timeout=30),
            )
            return result.stdout
    except Exception as e:
        log.warning(f"Failed to fetch logs for {service_name} from {machine.name}: {e}")
        return f"Failed to fetch logs: {e}"


def restart_vpn_service(bmachines: list[BenchMachine], vpn: VPN) -> int:
    """Restart the VPN service on all benchmark machines and wait for connectivity.

    Returns:
        Number of retries needed (0 = all succeeded on first try)
    """
    if vpn == VPN.Internal or vpn == VPN.Wireguard:
        # No VPN service to restart for internal tests
        return 0

    service_name = get_vpn_service_name(vpn)
    log.info(f"Restarting VPN service {service_name} on all machines")

    total_retries = 0

    def restart_service_on_machine(bmachine: BenchMachine) -> int:
        def _restart() -> None:
            host = bmachine.cmachine.target_host().override(host_key_check="none")
            with host.host_connection() as ssh:
                ssh.run(
                    ["systemctl", "restart", service_name],
                    RunOpts(log=Log.BOTH),
                )

        result = retry_operation_with_info(
            _restart,
            max_retries=3,
            initial_delay=2.0,
            operation_name=f"restart {service_name} on {bmachine.cmachine.name}",
        )
        # Return retries (attempts - 1, since 1 attempt = success on first try)
        return result.attempts - 1

    for bmachine in bmachines:
        retries = restart_service_on_machine(bmachine)
        total_retries += retries

    log.info(f"VPN service {service_name} restarted on all machines")

    # Wait for VPN connectivity to be re-established
    machines = [bm.cmachine for bm in bmachines]
    wait_for_vpn_connectivity(machines)

    return total_retries


def run_benchmarks(
    config: Config,
    vpn: VPN,
    bmachines: list[BenchMachine],
    tests: list[TestType],
    benchmark_run_alias: str = "default",
    tc_settings: TCSettings | None = None,
    tracker: ProgressTracker | None = None,
) -> None:
    """Run TCP and UDP benchmarks for each machine."""
    import json

    # Save TC settings JSON file once per benchmark run
    tc_settings_dir = config.bench_dir / vpn.name / benchmark_run_alias
    tc_settings_dir.mkdir(parents=True, exist_ok=True)
    tc_settings_file = tc_settings_dir / "tc_settings.json"

    tc_data = {
        "alias": benchmark_run_alias,
        "settings": tc_settings.to_dict() if tc_settings else None,
    }
    tc_settings_file.write_text(json.dumps(tc_data, indent=2))
    log.info(f"Saved TC settings to {tc_settings_file}")

    # Upload iperf3 public key
    remote_iperf3_pubkey = Path("/tmp/iperf3.public")
    for pos, bmachine in enumerate(bmachines):
        next_bmachine = bmachines[pos + 1] if pos + 1 < len(bmachines) else bmachines[0]
        log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")

        # Track machine progress
        if tracker is not None:
            tracker.start_machine(
                bmachine.cmachine.name, next_bmachine.cmachine.name, pos
            )
        result_dir = (
            config.bench_dir
            / vpn.name
            / benchmark_run_alias
            / f"{pos}_{bmachine.cmachine.name}"
        )

        creds = None
        local_pubkey = None
        local_pubkey = get_iperf_asset("vpb_public.pem")
        password = get_iperf_asset("vpb_password.txt").read_text()
        creds = IperfCreds(
            username="mario", password=password, pubkey=remote_iperf3_pubkey
        )
        host = bmachine.cmachine.target_host().override(host_key_check="none")

        with host.host_connection() as ssh:
            # Upload iperf3 public key
            upload(ssh, local_pubkey, remote_iperf3_pubkey)

        P = ParamSpec("P")  # noqa: N806

        def execute_test_with_retry(
            func: Callable[P, Any], *args: P.args, **kwargs: P.kwargs
        ) -> tuple[dict[str, Any] | Exception, int]:
            """Execute a test with retry logic and return result plus attempt count."""
            result = retry_operation_with_info(
                lambda: func(*args, **kwargs),
                max_retries=2,
                initial_delay=5.0,
                operation_name=f"{func.__name__}",
            )
            return result.result, result.attempts

        def execute_test(
            func: Callable[P, Any], *args: P.args, **kwargs: P.kwargs
        ) -> tuple[dict[str, Any] | Exception, int]:
            """Execute a test and return result plus attempt count (1 on success, max_retries+1 on error)."""
            try:
                result, attempts = execute_test_with_retry(func, *args, **kwargs)
            except Exception as err:
                # Return the exception with attempt count of max retries + 1 (3 total attempts)
                return err, 3
            else:
                return result, attempts

        def collect_logs_on_failure(
            result: dict[str, Any] | Exception,
            test_type: TestType,
            target_machine: Machine,
        ) -> str | None:
            """Collect service logs from target machine if test failed.

            Args:
                result: Test result (Exception if failed)
                test_type: The type of test that was run
                target_machine: The machine running the server service

            Returns:
                Service logs if test failed and service exists, None otherwise
            """
            if not isinstance(result, Exception):
                return None

            service_name = get_test_service_name(test_type)
            if service_name is None:
                return None

            log.info(
                f"Test {test_type.name} failed after all retries, "
                f"collecting logs from {service_name} on {target_machine.name}"
            )
            return get_service_logs(target_machine, service_name)

        for test_idx, test in enumerate(tests):
            start_time = time.time()
            test_attempts = 0
            vpn_restart_attempts = 0

            # Track test progress
            if tracker is not None:
                tracker.start_test(test, test_idx)

            match test:
                case TestType.IPERF3:
                    tcp_results, tcp_attempts = execute_test(
                        run_iperf_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                        creds,
                        udp_mode=False,
                        target_machine=next_bmachine.cmachine,
                    )
                    tcp_duration = time.time() - start_time
                    tcp_logs = collect_logs_on_failure(
                        tcp_results, TestType.IPERF3, next_bmachine.cmachine
                    )

                    udp_start = time.time()
                    # UDP test: no retry, 120s timeout
                    try:
                        udp_results: dict[str, Any] | Exception = run_iperf_test(
                            bmachine.cmachine,
                            "vpn." + next_bmachine.cmachine.name,
                            creds,
                            target_machine=next_bmachine.cmachine,
                            udp_mode=True,
                            timeout=120,
                        )
                        udp_attempts = 1
                        udp_logs = None
                    except Exception as err:
                        udp_results = err
                        udp_attempts = 1
                        # Collect logs for UDP failure (single attempt)
                        udp_logs = get_service_logs(
                            next_bmachine.cmachine, "iperf3.service"
                        )
                    udp_duration = time.time() - udp_start

                    # Restart VPN and track attempts
                    vpn_restart_attempts = restart_vpn_service(bmachines, vpn)

                    # Save TCP results with metadata
                    tcp_metadata: TestMetadataDict = {
                        "duration_seconds": tcp_duration,
                        "test_attempts": tcp_attempts,
                        "vpn_restart_attempts": vpn_restart_attempts,
                    }
                    if tcp_logs:
                        tcp_metadata["service_logs"] = tcp_logs
                    save_bench_report(
                        result_dir, tcp_results, "tcp_iperf3.json", tcp_metadata
                    )

                    # Save UDP results with metadata
                    udp_metadata: TestMetadataDict = {
                        "duration_seconds": udp_duration,
                        "test_attempts": udp_attempts,
                        "vpn_restart_attempts": 0,  # Already counted in TCP
                    }
                    if udp_logs:
                        udp_metadata["service_logs"] = udp_logs
                    save_bench_report(
                        result_dir, udp_results, "udp_iperf3.json", udp_metadata
                    )
                    continue  # Skip the restart at the end since we already did it

                case TestType.QPERF:
                    quick_result, test_attempts = execute_test(
                        run_qperf_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                        next_bmachine.cmachine,
                    )
                    duration = time.time() - start_time
                    service_logs = collect_logs_on_failure(
                        quick_result, TestType.QPERF, next_bmachine.cmachine
                    )
                    vpn_restart_attempts = restart_vpn_service(bmachines, vpn)
                    metadata: TestMetadataDict = {
                        "duration_seconds": duration,
                        "test_attempts": test_attempts,
                        "vpn_restart_attempts": vpn_restart_attempts,
                    }
                    if service_logs:
                        metadata["service_logs"] = service_logs
                    save_bench_report(result_dir, quick_result, "qperf.json", metadata)
                    continue

                case TestType.PING:
                    ping_result, test_attempts = execute_test(
                        run_ping_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                    )
                    duration = time.time() - start_time
                    vpn_restart_attempts = restart_vpn_service(bmachines, vpn)
                    metadata = {
                        "duration_seconds": duration,
                        "test_attempts": test_attempts,
                        "vpn_restart_attempts": vpn_restart_attempts,
                    }
                    save_bench_report(result_dir, ping_result, "ping.json", metadata)
                    continue

                case TestType.NIX_CACHE:
                    nix_cache_result, test_attempts = execute_test(
                        run_nix_cache_test,
                        bmachine,
                        vpn,
                        next_bmachine,
                    )
                    duration = time.time() - start_time
                    vpn_restart_attempts = restart_vpn_service(bmachines, vpn)
                    metadata = {
                        "duration_seconds": duration,
                        "test_attempts": test_attempts,
                        "vpn_restart_attempts": vpn_restart_attempts,
                    }
                    save_bench_report(
                        result_dir, nix_cache_result, "nix_cache.json", metadata
                    )
                    continue

                case TestType.RIST_STREAM:
                    rist_result, test_attempts = execute_test(
                        run_rist_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                        duration=30,
                        target_machine=next_bmachine.cmachine,
                    )
                    duration = time.time() - start_time
                    service_logs = collect_logs_on_failure(
                        rist_result, TestType.RIST_STREAM, next_bmachine.cmachine
                    )
                    vpn_restart_attempts = restart_vpn_service(bmachines, vpn)
                    metadata = {
                        "duration_seconds": duration,
                        "test_attempts": test_attempts,
                        "vpn_restart_attempts": vpn_restart_attempts,
                    }
                    if service_logs:
                        metadata["service_logs"] = service_logs
                    save_bench_report(
                        result_dir, rist_result, "rist_stream.json", metadata
                    )
                    continue

                case _:
                    msg = f"Unknown BenchType: {test}"
                    raise ValueError(msg)


def benchmark_vpn(
    config: Config,
    vpn: VPN,
    tr_machines: list[TrMachine],
    tests: list[TestType],
    benchmark_runs: list[BenchmarkRun],
    skip_reboot_timings: bool = False,
    tracker: ProgressTracker | None = None,
) -> None:
    """
    Run VPN benchmarks with multiple TC configurations.

    Args:
        config: Configuration object
        vpn: VPN to benchmark
        tr_machines: List of terraform machines
        tests: List of tests to run
        benchmark_runs: List of benchmark run configurations with TC settings
        skip_reboot_timings: Whether to skip reboot timing measurements
        tracker: Optional progress tracker for TUI updates
    """
    from vpn_bench.tc import apply_tc_settings

    log.info(
        f"Benchmarking VPN {vpn} with {len(benchmark_runs)} different configurations"
    )

    # Track installation phase
    if tracker is not None:
        tracker.set_phase("installing VPN")

    # Install VPN once (connection timings collected for baseline if enabled)
    bmachines = install_vpn(
        config,
        vpn,
        tr_machines,
        get_con_times=not skip_reboot_timings,
        benchmark_run_alias=benchmark_runs[0].alias if benchmark_runs else "default",
    )

    # Get list of machines for TC application
    machines = [bm.cmachine for bm in bmachines]
    for profile_idx, run_config in enumerate(benchmark_runs):
        log.info(f"========== Running benchmark: {run_config.alias} ==========")

        # Track profile progress
        if tracker is not None:
            tracker.start_profile(run_config.alias, profile_idx)

        # Use context manager to apply TC settings and automatically clean up
        with apply_tc_settings(machines, run_config.tc_settings):
            log.info("TC settings applied, waiting 30 seconds for stabilization")
            # Run benchmarks with this configuration
            run_benchmarks(
                config,
                vpn,
                bmachines,
                tests,
                run_config.alias,
                run_config.tc_settings,
                tracker,
            )

        # Track profile completion
        if tracker is not None:
            tracker.complete_profile()

    # Regenerate comparison data after benchmarks complete
    log.info("Regenerating comparison data...")
    generate_comparison_data(config.bench_dir)
