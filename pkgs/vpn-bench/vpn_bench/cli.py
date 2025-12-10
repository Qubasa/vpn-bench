#!/usr/bin/env python3

import argparse
import logging
import os
import sys
from pathlib import Path

from clan_lib.custom_logger import setup_logging
from clan_lib.dirs import user_cache_dir, user_data_dir

from vpn_bench.bench import benchmark_vpn
from vpn_bench.comparison import generate_comparison_data
from vpn_bench.data import (
    VPN,
    Config,
    Provider,
    SSHKeyPair,
    TCProfile,
    TestType,
    get_benchmark_runs,
)
from vpn_bench.errors import VpnBenchError
from vpn_bench.plot import plot_data
from vpn_bench.setup import AgeOpts, clan_clean, clan_init, install_machines_only
from vpn_bench.ssh import generate_ssh_key, ssh_into_machine
from vpn_bench.terraform import tr_create, tr_destroy, tr_metadata

log = logging.getLogger(__name__)


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    subparsers = parser.add_subparsers(dest="subcommand")

    create_parser = subparsers.add_parser("create", help="Create resources")
    create_parser.add_argument("-m", action="append", help="Add machine", default=[])
    create_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    create_parser.add_argument(
        "--provider",
        choices=[p.value for p in Provider],
        default=Provider.Hetzner.value,
    )
    create_parser.add_argument(
        "--ssh-pubkey",
        help="SSH pubkey path",
        type=Path,
    )
    create_parser.add_argument("--location", help="Server location")
    create_parser.add_argument(
        "--host",
        action="append",
        default=[],
        help="Hardware host in format user@ip:port:name or user@ip:name (for hardware provider)",
    )

    destroy_parser = subparsers.add_parser("destroy", help="Destroy resources")
    destroy_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )
    destroy_parser.add_argument(
        "--provider",
        choices=[p.value for p in Provider],
        default=Provider.Hetzner.value,
    )
    destroy_parser.add_argument(
        "--force", action="store_true", help="Delete local data even if remote fails"
    )

    metadata_parser = subparsers.add_parser("meta", help="Show metadata")
    metadata_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    ssh_parser = subparsers.add_parser("ssh", help="SSH into a machine")
    ssh_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    ssh_parser.add_argument("machine", help="Machine to SSH into")

    install_parser = subparsers.add_parser("install", help="Install command")
    install_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )
    install_parser.add_argument(
        "--provider",
        choices=[p.value for p in Provider],
        default=Provider.Hetzner.value,
    )
    install_parser.add_argument("--age-user", help="Age user")
    install_parser.add_argument("--age-pubkey", help="Age pubkey", type=str)
    install_parser.add_argument(
        "--ssh-pubkey",
        help="SSH pubkey path",
        type=str,
    )
    install_parser.add_argument(
        "-m",
        action="append",
        default=[],
        help="Machine name(s) to install (can be specified multiple times). If not specified, all machines will be installed.",
    )

    bench_parser = subparsers.add_parser("bench", help="Benchmark command")
    bench_parser.add_argument(
        "--vpn",
        action="append",
        default=[],
        choices=[p.value for p in VPN] + ["all"],
    )
    bench_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    bench_parser.add_argument(
        "--skip-con-times",
        action="store_true",
        help="Don't get vpn connection timings",
    )
    bench_parser.add_argument(
        "--test",
        help="Tests to run, default is none",
        action="append",
        choices=[t.value for t in TestType] + ["all"],
        default=[],
    )
    bench_parser.add_argument(
        "--tc-profile",
        help="TC profiles to run (baseline, low, medium, high, extreme), default is baseline only",
        action="append",
        choices=[t.value for t in TCProfile] + ["all"],
        default=[],
    )
    bench_parser.add_argument(
        "--no-tui",
        action="store_true",
        help="Disable the TUI and use standard logging output",
    )

    plot_parser = subparsers.add_parser("plot", help="Plot the data from benchmark")
    plot_parser.add_argument("--debug", action="store_true", help="Enable debug mode")

    compare_parser = subparsers.add_parser(
        "compare", help="Generate cross-VPN comparison data"
    )
    compare_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    return parser


def create_conf_obj(args: argparse.Namespace) -> Config:
    is_debug = getattr(args, "debug", False)
    data_dir = user_data_dir() / "vpn_bench"
    data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = user_cache_dir() / "vpn_bench"
    cache_dir.mkdir(parents=True, exist_ok=True)
    tr_dir = data_dir / "terraform"
    clan_dir = data_dir / "clan"
    bench_dir = data_dir / "bench"
    bench_dir.mkdir(parents=True, exist_ok=True)

    gen_key = generate_ssh_key(data_dir)
    ssh_keys = [gen_key]

    pubkey_path: Path | None = None
    if getattr(args, "ssh_pubkey", False):
        pubkey_path = Path(args.ssh_pubkey)
        assert pubkey_path is not None
        ssh_keys.append(
            SSHKeyPair(private=pubkey_path.with_suffix(""), public=pubkey_path)
        )

    if pubkey_path_str := os.environ.get("SSH_PUBKEY_PATH"):
        pubkey_path = Path(pubkey_path_str)
        ssh_keys.append(
            SSHKeyPair(
                private=Path(pubkey_path).with_suffix(""), public=Path(pubkey_path)
            )
        )

    return Config(
        debug=is_debug,
        data_dir=data_dir,
        tr_dir=tr_dir,
        cache_dir=cache_dir,
        clan_dir=clan_dir,
        bench_dir=bench_dir,
        ssh_keys=ssh_keys,
    )


def run_cli() -> None:
    parser = create_parser()
    args = parser.parse_args()

    config = create_conf_obj(args)

    if config.debug:
        setup_logging(logging.DEBUG)
    else:
        setup_logging(logging.INFO)

    log.debug("Debug mode enabled")

    if getattr(args, "provider", False):
        provider = Provider.from_str(args.provider)

    if args.subcommand == "create":
        machines = args.m
        if len(machines) == 0 and provider != Provider.Hardware:
            machines = ["lom", "luna", "yuki"]
        hardware_hosts = args.host if args.host else None
        tr_create(
            config,
            provider,
            args.location,
            args.ssh_pubkey,
            machines=machines,
            hardware_hosts=hardware_hosts,
        )

    elif args.subcommand == "destroy":
        tr_destroy(config, provider, args.force)
        clan_clean(config)

    elif args.subcommand == "meta":
        meta = tr_metadata(config)
        for machine in meta:
            print(machine)

    elif args.subcommand == "install":
        machines = tr_metadata(config)

        # Filter machines if specific ones were requested
        if args.m:
            requested_machines = set(args.m)
            available_machines = {m["name"] for m in machines}

            # Check for invalid machine names
            invalid_machines = requested_machines - available_machines
            if invalid_machines:
                invalid_names = ", ".join(invalid_machines)
                available_names = ", ".join(sorted(available_machines))
                log.error(f"Invalid machine name(s): {invalid_names}")
                log.error(f"Available machines: {available_names}")
                msg = f"Invalid machine name(s): {invalid_names}"
                raise VpnBenchError(msg)

            # Filter to only requested machines
            machines = [m for m in machines if m["name"] in requested_machines]
            log.info(
                f"Installing only requested machines: {', '.join(m['name'] for m in machines)}"
            )
        else:
            log.info(
                f"Installing all machines: {', '.join(m['name'] for m in machines)}"
            )

        # Check if this is an additive install (clan dir exists and specific machines requested)
        if config.clan_dir.exists() and args.m:
            # Additive install - only install the requested machines
            install_machines_only(config, machines)
        else:
            # Full install - initialize clan and install machines
            age_pubkey_path: Path | None = None
            if args.age_pubkey is None:
                if age_pubkey_str := os.environ.get("AGE_PUBKEY_PATH"):
                    age_pubkey_path = Path(age_pubkey_str)

            age_usr_str = None
            if args.age_user is None:
                age_usr_str = os.environ.get("AGE_USER")
                if not age_usr_str:
                    age_usr_str = os.environ.get("USER")

            assert age_usr_str is not None
            age_opts = AgeOpts(username=age_usr_str, pubkey=age_pubkey_path)

            clan_init(config, age_opts, machines)

    elif args.subcommand == "bench":
        tests: list[str] = args.test
        tests_enum: list[TestType] = []

        if len(tests) == 0:
            log.warning("No benchmark tests specified with --test, defaulting to none")
        elif len(tests) == 1 and tests[0] == "all":
            for btest in TestType:
                tests_enum.append(btest)
        else:
            for test in tests:
                bench_type = TestType.from_str(test)
                tests_enum.append(bench_type)

        machines = tr_metadata(config)

        vpns: list[str] = args.vpn
        vpns_enum: list[VPN] = []

        if len(vpns) == 1 and vpns[0] == "all":
            for tvpn in VPN:
                vpns_enum.append(tvpn)
        else:
            for cvpn in vpns:
                vpn_type = VPN.from_str(cvpn)
                vpns_enum.append(vpn_type)

        if len(vpns_enum) == 0:
            msg = "No vpns specified with --vpns, defaulting to none"
            raise VpnBenchError(msg)

        # Parse TC profiles
        tc_profiles: list[str] = args.tc_profile
        tc_profiles_enum: list[TCProfile] = []

        if len(tc_profiles) == 0:
            log.info("No TC profiles specified, defaulting to baseline only")
            tc_profiles_enum.append(TCProfile.BASELINE)
        elif len(tc_profiles) == 1 and tc_profiles[0] == "all":
            for tc_profile in TCProfile:
                tc_profiles_enum.append(tc_profile)
        else:
            for profile_str in tc_profiles:
                tc_profile = TCProfile.from_str(profile_str)
                tc_profiles_enum.append(tc_profile)

        # Convert TC profiles to benchmark runs
        benchmark_runs = get_benchmark_runs(tc_profiles_enum)

        # Decide whether to use TUI based on TTY detection and --no-tui flag
        use_tui = sys.stdout.isatty() and sys.stdin.isatty() and not args.no_tui

        if use_tui:
            # Run with TUI
            from vpn_bench.tui import BenchmarkTUI

            app = BenchmarkTUI(
                config=config,
                vpns=vpns_enum,
                tests=tests_enum,
                benchmark_runs=benchmark_runs,
                machines=machines,
                skip_reboot_timings=args.skip_con_times,
            )
            app.run()
        else:
            # Run without TUI (standard logging)
            failed_vpns: list[tuple[VPN, str]] = []
            for vpn in vpns_enum:
                log.info(f"========== Running benchmark for {vpn} ==========")
                try:
                    benchmark_vpn(
                        config,
                        vpn,
                        machines,
                        tests_enum,
                        benchmark_runs,
                        args.skip_con_times,
                    )
                except Exception as e:
                    error_msg = str(e)
                    log.error(f"Benchmark for {vpn} failed with error: {error_msg}")
                    failed_vpns.append((vpn, error_msg))
                    log.info("Continuing with next VPN...")
                    continue

            if failed_vpns:
                log.warning("The following VPNs failed during benchmarking:")
                for vpn, error in failed_vpns:
                    log.warning(f"  - {vpn.value}: {error}")
                log.warning(f"Total: {len(failed_vpns)}/{len(vpns_enum)} VPNs failed")

    elif args.subcommand == "plot":
        machines = tr_metadata(config)
        generate_comparison_data(config.bench_dir)
        plot_data(config, machines)

    elif args.subcommand == "compare":
        generate_comparison_data(config.bench_dir)

    elif args.subcommand == "ssh":
        machines = tr_metadata(config)
        ssh_into_machine(machines, args.machine, config.ssh_keys[0])

    else:
        parser.print_help()
