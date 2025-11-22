import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, ParamSpec

from clan_lib.cmd import Log, RunOpts
from clan_lib.ssh.upload import upload

from vpn_bench.assets import get_iperf_asset
from vpn_bench.comparison import generate_comparison_data
from vpn_bench.connection_timings import wait_for_vpn_connectivity
from vpn_bench.data import VPN, BenchMachine, BenchmarkRun, Config, TCSettings, TestType
from vpn_bench.errors import save_bench_report
from vpn_bench.iperf3 import IperfCreds, run_iperf_test
from vpn_bench.nix_cache import run_nix_cache_test
from vpn_bench.ping import run_ping_test
from vpn_bench.qperf import run_qperf_test
from vpn_bench.retry import retry_operation
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


def restart_vpn_service(bmachines: list[BenchMachine], vpn: VPN) -> None:
    """Restart the VPN service on all benchmark machines and wait for connectivity."""
    if vpn == VPN.Internal or vpn == VPN.Wireguard:
        # No VPN service to restart for internal tests
        return

    service_name = get_vpn_service_name(vpn)
    log.info(f"Restarting VPN service {service_name} on all machines")

    def restart_service_on_machine(bmachine: BenchMachine) -> None:
        def _restart() -> None:
            host = bmachine.cmachine.target_host().override(host_key_check="none")
            with host.host_connection() as ssh:
                ssh.run(
                    ["systemctl", "restart", service_name],
                    RunOpts(log=Log.BOTH),
                )

        retry_operation(
            _restart,
            max_retries=3,
            initial_delay=2.0,
            operation_name=f"restart {service_name} on {bmachine.cmachine.name}",
        )

    for bmachine in bmachines:
        restart_service_on_machine(bmachine)

    log.info(f"VPN service {service_name} restarted on all machines")

    # Wait for VPN connectivity to be re-established
    machines = [bm.cmachine for bm in bmachines]
    wait_for_vpn_connectivity(machines)


def run_benchmarks(
    config: Config,
    vpn: VPN,
    bmachines: list[BenchMachine],
    tests: list[TestType],
    benchmark_run_alias: str = "default",
    tc_settings: TCSettings | None = None,
) -> None:
    """Run TCP and UDP benchmarks for each machine."""
    import json

    # Save TC settings JSON file once per benchmark run
    tc_settings_dir = config.bench_dir / vpn.name / benchmark_run_alias
    tc_settings_dir.mkdir(parents=True, exist_ok=True)
    tc_settings_file = tc_settings_dir / "tc_settings.json"

    tc_data = {
        "alias": benchmark_run_alias,
        "description": tc_settings.get_description()
        if tc_settings
        else "No network impairment applied",
        "settings": tc_settings.to_dict() if tc_settings else None,
    }
    tc_settings_file.write_text(json.dumps(tc_data, indent=2))
    log.info(f"Saved TC settings to {tc_settings_file}")

    # Upload iperf3 public key
    remote_iperf3_pubkey = Path("/tmp/iperf3.public")
    for pos, bmachine in enumerate(bmachines):
        next_bmachine = bmachines[pos + 1] if pos + 1 < len(bmachines) else bmachines[0]
        log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")
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

        def execute_test(
            func: Callable[P, Any], *args: P.args, **kwargs: P.kwargs
        ) -> dict[str, Any] | Exception:
            try:
                return func(*args, **kwargs)
            except Exception as err:
                return err

        for test in tests:
            match test:
                case TestType.IPERF3:
                    tcp_results = execute_test(
                        run_iperf_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                        creds,
                        udp_mode=False,
                    )
                    save_bench_report(result_dir, tcp_results, "tcp_iperf3.json")

                    udp_results = execute_test(
                        run_iperf_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                        creds,
                        udp_mode=True,
                    )
                    save_bench_report(result_dir, udp_results, "udp_iperf3.json")

                case TestType.QPERF:
                    quick_result = execute_test(
                        run_qperf_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                    )
                    save_bench_report(result_dir, quick_result, "qperf.json")

                case TestType.PING:
                    ping_result = execute_test(
                        run_ping_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                    )
                    save_bench_report(result_dir, ping_result, "ping.json")

                case TestType.NIX_CACHE:
                    nix_cache_result = execute_test(
                        run_nix_cache_test, bmachine, vpn, next_bmachine
                    )
                    save_bench_report(result_dir, nix_cache_result, "nix_cache.json")

                case TestType.RIST_STREAM:
                    rist_result = execute_test(
                        run_rist_test,
                        bmachine.cmachine,
                        "vpn." + next_bmachine.cmachine.name,
                        duration=45,
                    )
                    save_bench_report(result_dir, rist_result, "rist_stream.json")

                case _:
                    msg = f"Unknown BenchType: {test}"
                    raise ValueError(msg)

            # Restart VPN service after each test to ensure clean state
            restart_vpn_service(bmachines, vpn)


def benchmark_vpn(
    config: Config,
    vpn: VPN,
    tr_machines: list[TrMachine],
    tests: list[TestType],
    benchmark_runs: list[BenchmarkRun],
    skip_reboot_timings: bool = False,
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
    """
    from vpn_bench.tc import apply_tc_settings

    log.info(
        f"Benchmarking VPN {vpn} with {len(benchmark_runs)} different configurations"
    )

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
    for run_config in benchmark_runs:
        log.info(f"========== Running benchmark: {run_config.alias} ==========")

        # Use context manager to apply TC settings and automatically clean up
        with apply_tc_settings(machines, run_config.tc_settings):
            log.info("TC settings applied, waiting 30 seconds for stabilization")
            # Run benchmarks with this configuration
            run_benchmarks(
                config, vpn, bmachines, tests, run_config.alias, run_config.tc_settings
            )

    # Regenerate comparison data after benchmarks complete
    log.info("Regenerating comparison data...")
    generate_comparison_data(config.bench_dir)
