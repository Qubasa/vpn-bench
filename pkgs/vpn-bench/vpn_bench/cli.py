#!/usr/bin/env python3

import argparse
import logging
import os
from pathlib import Path

from clan_cli.custom_logger import setup_logging
from clan_cli.dirs import user_cache_dir, user_data_dir

from vpn_bench.clan import AgeOpts, clan_clean, clan_init
from vpn_bench.data import Config, Provider
from vpn_bench.errors import VpnBenchError
from vpn_bench.terraform import tr_create, tr_destroy, tr_metadata

log = logging.getLogger(__name__)


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    subparsers = parser.add_subparsers(dest="subcommand")

    create_parser = subparsers.add_parser("create", help="Create resources")
    create_parser.add_argument(
        "-m", action="append", help="Add machine", default=["jon"]
    )
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
        default=os.environ.get("SSH_PUB_KEY_PATH"),
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

    metadata_parser = subparsers.add_parser("metadata", help="Show metadata")
    metadata_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    clan_parser = subparsers.add_parser("install", help="Install command")
    clan_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    clan_parser.add_argument(
        "--provider",
        choices=[p.value for p in Provider],
        default=Provider.Hetzner.value,
    )
    clan_parser.add_argument("--age-user", help="Age user")
    clan_parser.add_argument("--age-pubkey", help="Age pubkey", type=Path)
    clan_parser.add_argument(
        "--ssh-pubkey",
        help="SSH pubkey path",
        default=os.environ.get("SSH_PUBKEY_PATH"),
        type=Path,
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
    config = Config(
        debug=is_debug,
        data_dir=data_dir,
        tr_dir=tr_dir,
        cache_dir=cache_dir,
        clan_dir=clan_dir,
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

    if args.subcommand == "create":
        if args.ssh_pubkey is None:
            msg = """Please specify an SSH key with --ssh-pubkey
            or set the SSH_PUBKEY_PATH environment variable"""
            raise VpnBenchError(msg)

        tr_create(config, args.ssh_pubkey, provider, machines=args.m)
    elif args.subcommand == "destroy":
        tr_destroy(config, provider, args.force)
        clan_clean(config)
    elif args.subcommand == "metadata":
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

    else:
        parser.print_help()
