import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, ParamSpec

from clan_lib.ssh.upload import upload

from vpn_bench.assets import get_iperf_asset
from vpn_bench.data import VPN, BenchMachine, Config, TestType
from vpn_bench.errors import save_bench_report
from vpn_bench.iperf3 import IperfCreds, run_iperf_test
from vpn_bench.nix_cache import run_nix_cache_test
from vpn_bench.qperf import run_qperf_test
from vpn_bench.terraform import TrMachine
from vpn_bench.vpn import install_vpn

log = logging.getLogger(__name__)


def run_benchmarks(
    config: Config, vpn: VPN, bmachines: list[BenchMachine], tests: list[TestType]
) -> None:
    """Run TCP and UDP benchmarks for each machine."""

    # Upload iperf3 public key
    remote_iperf3_pubkey = Path("/tmp/iperf3.public")
    for pos, bmachine in enumerate(bmachines):
        next_bmachine = bmachines[pos + 1] if pos + 1 < len(bmachines) else bmachines[0]
        log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")
        result_dir = config.bench_dir / vpn.name / f"{pos}_{bmachine.cmachine.name}"

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

                case TestType.NIX_CACHE:
                    nix_cache_result = execute_test(
                        run_nix_cache_test, bmachine, vpn, next_bmachine
                    )
                    save_bench_report(result_dir, nix_cache_result, "nix_cache.json")

                case _:
                    msg = f"Unknown BenchType: {test}"
                    raise ValueError(msg)


def benchmark_vpn(
    config: Config,
    vpn: VPN,
    tr_machines: list[TrMachine],
    tests: list[TestType],
    skip_reboot_timings: bool = False,
) -> None:
    """Main function to coordinate VPN benchmarking."""
    log.info(f"Benchmarking VPN {vpn}")

    # Install VPN
    bmachines = install_vpn(
        config, vpn, tr_machines, get_con_times=not skip_reboot_timings
    )

    # Run benchmarks
    run_benchmarks(config, vpn, bmachines, tests)
