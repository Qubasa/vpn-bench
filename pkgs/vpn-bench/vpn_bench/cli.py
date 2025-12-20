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
from vpn_bench.connection_timings import analyse_connection_timings
from vpn_bench.data import (
    VPN,
    BenchmarkEntry,
    Config,
    Provider,
    SSHKeyPair,
    TCProfile,
    TestType,
    parse_benchmark_config,
)
from vpn_bench.errors import VpnBenchError
from vpn_bench.plot import build_ui, plot_data
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
    bench_parser.add_argument(
        "--config",
        type=Path,
        help="TOML config file specifying per-VPN test configuration",
    )

    plot_parser = subparsers.add_parser("plot", help="Plot the data from benchmark")
    plot_parser.add_argument("--debug", action="store_true", help="Enable debug mode")

    compare_parser = subparsers.add_parser(
        "compare", help="Generate cross-VPN comparison data"
    )
    compare_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    build_ui_parser = subparsers.add_parser(
        "build-ui", help="Build the webview-ui and create a result symlink"
    )
    build_ui_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )
    build_ui_parser.add_argument(
        "--no-symlink",
        action="store_true",
        help="Don't create a result symlink in the current directory",
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
        machines = tr_metadata(config)

        # Build list of BenchmarkEntry from config file or CLI options
        entries: list[BenchmarkEntry] = []

        if args.config:
            # Load entries from config file
            entries = parse_benchmark_config(args.config)
            log.info(f"Loaded {len(entries)} benchmark entries from {args.config}")

        # Parse CLI options for overrides
        cli_vpns: list[VPN] | None = None
        if args.vpn:
            vpns_raw: list[str] = args.vpn
            if len(vpns_raw) == 1 and vpns_raw[0] == "all":
                cli_vpns = list(VPN)
            else:
                cli_vpns = [VPN.from_str(v) for v in vpns_raw]

        cli_tests: list[TestType] | None = None
        if args.test:
            tests_raw: list[str] = args.test
            if len(tests_raw) == 1 and tests_raw[0] == "all":
                cli_tests = list(TestType)
            else:
                cli_tests = [TestType.from_str(t) for t in tests_raw]

        cli_tc_profiles: list[TCProfile] | None = None
        if args.tc_profile:
            tc_raw: list[str] = args.tc_profile
            if len(tc_raw) == 1 and tc_raw[0] == "all":
                cli_tc_profiles = list(TCProfile)
            else:
                cli_tc_profiles = [TCProfile.from_str(p) for p in tc_raw]

        cli_skip_con_times: bool = args.skip_con_times

        # Apply CLI overrides to entries
        if cli_vpns:
            # Filter to only VPNs specified on CLI
            entries = [e for e in entries if e.vpn in cli_vpns]
            # Add any CLI VPNs not already in config
            existing_vpns = {e.vpn for e in entries}
            for vpn in cli_vpns:
                if vpn not in existing_vpns:
                    entries.append(
                        BenchmarkEntry(
                            vpn=vpn,
                            tests=cli_tests or [],
                            tc_profiles=cli_tc_profiles or [TCProfile.BASELINE],
                            skip_con_times=cli_skip_con_times,
                        )
                    )

        # Override tests/tc_profiles/skip_con_times if CLI specified
        if cli_tests:
            for entry in entries:
                entry.tests = cli_tests
        if cli_tc_profiles:
            for entry in entries:
                entry.tc_profiles = cli_tc_profiles
        if cli_skip_con_times:
            for entry in entries:
                entry.skip_con_times = True

        # Validate we have entries to run
        if len(entries) == 0:
            msg = (
                "No VPNs specified. Use --vpn or --config to specify VPNs to benchmark."
            )
            raise VpnBenchError(msg)

        # Warn if any entries have no tests
        for entry in entries:
            if len(entry.tests) == 0:
                log.warning(
                    f"No tests specified for {entry.vpn.value}, skipping benchmark tests"
                )

        # Decide whether to use TUI based on TTY detection and --no-tui flag
        use_tui = sys.stdout.isatty() and sys.stdin.isatty() and not args.no_tui

        if use_tui:
            # Run with TUI
            from vpn_bench.tui import BenchmarkTUI

            app = BenchmarkTUI(
                config=config,
                entries=entries,
                machines=machines,
            )
            app.run()
        else:
            # Run without TUI (standard logging)
            failed_vpns: list[tuple[VPN, str]] = []
            for entry in entries:
                log.info(f"========== Running benchmark for {entry.vpn} ==========")
                log.info(
                    f"  Default tests: {[t.value for t in entry.tests]}, "
                    f"TC profiles: {[p.value for p in entry.tc_profiles]}, "
                    f"Skip connection times: {entry.skip_con_times}"
                )
                if entry.profile_overrides:
                    for name, override in entry.profile_overrides.items():
                        log.info(f"  Profile '{name}' overrides: {override}")
                try:
                    benchmark_vpn(
                        config,
                        entry,
                        machines,
                    )
                except Exception as e:
                    error_msg = str(e)
                    log.error(
                        f"Benchmark for {entry.vpn} failed with error: {error_msg}"
                    )
                    failed_vpns.append((entry.vpn, error_msg))
                    log.info("Continuing with next VPN...")
                    continue

            if failed_vpns:
                log.warning("The following VPNs failed during benchmarking:")
                for vpn, error in failed_vpns:
                    log.warning(f"  - {vpn.value}: {error}")
                log.warning(f"Total: {len(failed_vpns)}/{len(entries)} VPNs failed")

    elif args.subcommand == "plot":
        machines = tr_metadata(config)
        generate_comparison_data(config.bench_dir)
        plot_data(config, machines)

    elif args.subcommand == "compare":
        generate_comparison_data(config.bench_dir)
        analyse_connection_timings(config)

    elif args.subcommand == "build-ui":
        generate_comparison_data(config.bench_dir)
        analyse_connection_timings(config)
        website_dir = build_ui(config.bench_dir, create_symlink=not args.no_symlink)
        print(website_dir)

    elif args.subcommand == "ssh":
        machines = tr_metadata(config)
        ssh_into_machine(machines, args.machine, config.ssh_keys[0])

    else:
        parser.print_help()
