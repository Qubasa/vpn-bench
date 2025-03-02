#!/usr/bin/env python3

import argparse
import logging
import os
from pathlib import Path

from clan_cli.custom_logger import setup_logging
from clan_cli.dirs import user_cache_dir, user_data_dir

from vpn_bench.bench import benchmark_vpn
from vpn_bench.clan import AgeOpts, clan_clean, clan_init
from vpn_bench.data import VPN, Config, Provider
from vpn_bench.errors import VpnBenchError
from vpn_bench.plot import plot_data
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
        default=os.environ.get("SSH_PUBKEY_PATH"),
        type=Path,
    )
    create_parser.add_argument("--location", help="Server location")

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
    install_parser.add_argument("--age-pubkey", help="Age pubkey", type=Path)
    install_parser.add_argument(
        "--ssh-pubkey",
        help="SSH pubkey path",
        default=os.environ.get("SSH_PUBKEY_PATH"),
        type=Path,
    )

    bench_parser = subparsers.add_parser("bench", help="Benchmark command")
    bench_parser.add_argument(
        "--vpn",
        choices=[p.value for p in VPN],
        default=VPN.Zerotier.value,
    )
    bench_parser.add_argument("--debug", action="store_true", help="Enable debug mode")

    plot_parser = subparsers.add_parser("plot", help="Plot the data from benchmark")
    plot_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    plot_parser.add_argument(
        "--vpn",
        choices=[p.value for p in VPN],
        default=VPN.Zerotier.value,
    )

    return parser


def run_cli() -> None:
    parser = create_parser()
    args = parser.parse_args()

    is_debug = getattr(args, "debug", False)
    data_dir = user_data_dir() / "vpn_bench"
    data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = user_cache_dir() / "vpn_bench"
    cache_dir.mkdir(parents=True, exist_ok=True)
    tr_dir = data_dir / "terraform"
    clan_dir = data_dir / "clan"
    bench_dir = data_dir / "bench"
    bench_dir.mkdir(parents=True, exist_ok=True)

    config = Config(
        debug=is_debug,
        data_dir=data_dir,
        tr_dir=tr_dir,
        cache_dir=cache_dir,
        clan_dir=clan_dir,
        bench_dir=bench_dir,
    )

    if config.debug:
        setup_logging(logging.DEBUG)
        setup_logging(logging.DEBUG, root_log_name=__name__.split(".")[0])
    else:
        setup_logging(logging.INFO)
        setup_logging(logging.INFO, root_log_name=__name__.split(".")[0])

    log.debug("Debug mode enabled")

    if getattr(args, "provider", False):
        provider = Provider.from_str(args.provider)

    if getattr(args, "vpn", False):
        vpn = VPN.from_str(args.vpn)

    if args.subcommand == "create":
        machines = args.m
        if len(machines) == 0:
            machines = ["milo", "luna"]

        tr_create(config, provider, args.location, args.ssh_pubkey, machines=machines)
    elif args.subcommand == "destroy":
        tr_destroy(config, provider, args.force)
        clan_clean(config)
    elif args.subcommand == "meta":
        meta = tr_metadata(config)
        for machine in meta:
            print(machine)

    elif args.subcommand == "install":
        machines = tr_metadata(config)

        if args.ssh_pubkey is None:
            msg = "Please specify a path to an SSH pubkey with --ssh-pubkey or set the SSH_PUBKEY_PATH environment variable"
            raise VpnBenchError(msg)

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

        clan_init(config, provider, args.ssh_pubkey, age_opts, machines)

    elif args.subcommand == "bench":
        machines = tr_metadata(config)
        benchmark_vpn(config, vpn, machines)
    elif args.subcommand == "plot":
        machines = tr_metadata(config)
        plot_data(config, machines, vpn)
    elif args.subcommand == "ssh":
        machines = tr_metadata(config)
        import subprocess

        found = False
        for machine in machines:
            if machine["name"] == args.machine:
                found = True
                target = f"root@{machine['ipv4']}"
                log.info(f"ssh {target}")
                subprocess.run(["ssh", f"{target}"])
        if not found:
            log.error(f"Machine {args.machine} not found")

    else:
        parser.print_help()
