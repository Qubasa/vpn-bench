import logging
from pathlib import Path

from clan_cli.ssh.upload import upload

from vpn_bench.assets import get_iperf_asset

# from clan_cli.ssh.upload import upload
from vpn_bench.data import VPN, BenchMachine, BenchType, Config
from vpn_bench.iperf3 import IperfCreds, run_iperf_test, save_iperf_results
from vpn_bench.qperf import run_qperf_test, save_qperf_results
from vpn_bench.terraform import TrMachine
from vpn_bench.vpn import install_vpn

log = logging.getLogger(__name__)


def run_benchmarks(
    config: Config, vpn: VPN, bmachines: list[BenchMachine], bench_type: BenchType
) -> None:
    """Run TCP and UDP benchmarks for each machine."""

    # Upload iperf3 public key
    remote_iperf3_pubkey = Path("/tmp/iperf3.public")
    for pos, bmachine in enumerate(bmachines):
        next_bmachine = bmachines[pos + 1] if pos + 1 < len(bmachines) else bmachines[0]
        host = bmachine.cmachine.target_host
        log.info(f"Benchmarking {bmachine.cmachine.name} with ip {bmachine.vpn_ip}")
        result_dir = config.bench_dir / vpn.name / f"{pos}_{bmachine.cmachine.name}"

        creds = None
        local_pubkey = None
        match vpn:
            case VPN.External:
                local_pubkey = get_iperf_asset("clan_public.pem")
                password = get_iperf_asset("clan_password.txt").read_text()
                creds = IperfCreds(
                    username="mario", password=password, pubkey=remote_iperf3_pubkey
                )
            case _:
                local_pubkey = get_iperf_asset("vpb_public.pem")
                password = get_iperf_asset("vpb_password.txt").read_text()
                creds = IperfCreds(
                    username="mario", password=password, pubkey=remote_iperf3_pubkey
                )

        # Upload iperf3 public key
        upload(host, local_pubkey, remote_iperf3_pubkey)

        match bench_type:
            case BenchType.ALL | BenchType.IPERF3:
                # Run TCP test
                tcp_results = run_iperf_test(
                    host, next_bmachine.vpn_ip, creds, udp_mode=False
                )
                save_iperf_results(result_dir, tcp_results, "tcp")

                match vpn:
                    case vpn.Mycelium:
                        pass
                    case _:
                        # Run UDP test
                        udp_results = run_iperf_test(
                            host, next_bmachine.vpn_ip, creds, udp_mode=True
                        )
                        save_iperf_results(result_dir, udp_results, "udp")
            case BenchType.ALL | BenchType.QPERF:
                # Run QUICK test
                quick_result = run_qperf_test(host, next_bmachine.vpn_ip)
                save_qperf_results(result_dir, quick_result)

            case BenchType.NONE:
                log.info("Skipping benchmarking")
            case _:
                msg = f"Unknown BenchType: {bench_type}"
                raise ValueError(msg)


def benchmark_vpn(
    config: Config,
    vpn: VPN,
    tr_machines: list[TrMachine],
    skip_reboot_timings: bool = False,
    bench_type: BenchType = BenchType.ALL,
) -> None:
    """Main function to coordinate VPN benchmarking."""
    log.info(f"Benchmarking VPN {vpn}")

    # Install VPN
    bmachines = install_vpn(
        config, vpn, tr_machines, get_con_times=not skip_reboot_timings
    )

    # Run benchmarks
    run_benchmarks(config, vpn, bmachines, bench_type)
