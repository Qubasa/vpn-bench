#!/usr/bin/env python3

import argparse
import logging
from pathlib import Path

from clan_cli.custom_logger import setup_logging
from clan_cli.dirs import user_cache_dir, user_data_dir

from vpn_bench import Config, Provider
from vpn_bench.clan import clan_clean
from vpn_bench.terraform import tr_create, tr_destroy, tr_metadata

from .clan import clan_init

log = logging.getLogger(__name__)


def run_cli() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    subparsers = parser.add_subparsers(dest="subcommand")

    create_parser = subparsers.add_parser("create", help="Create resources")
    create_parser.add_argument(
        "-m", action="append", help="Add machine", default=["jon"]
    )
    create_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    create_parser.add_argument(
        "--provider", choices=[p.value for p in Provider], default=Provider.GCloud.value
    )
    create_parser.add_argument(
        "--ssh-key", help="SSH key path", default="~/.ssh/id_rsa.pub"
    )

    destroy_parser = subparsers.add_parser("destroy", help="Destroy resources")
    destroy_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    metadata_parser = subparsers.add_parser("metadata", help="Show metadata")
    metadata_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    clan_parser = subparsers.add_parser("clan", help="Clan command")
    clan_parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    clan_parser.add_argument(
        "--provider", choices=[p.value for p in Provider], default=Provider.GCloud.value
    )
    clan_parser.add_argument(
        "--ssh-key", help="SSH key path", default="~/.ssh/id_rsa.pub"
    )

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

    if getattr(args, "ssh_key", False):
        ssh_key = Path(args.ssh_key).expanduser()
        if not ssh_key.exists():
            log.error(
                f"SSH key {ssh_key} does not exist, please specify one with --ssh-key"
            )
            return

    if getattr(args, "provider", False):
        provider = Provider.from_str(args.provider)

    if args.subcommand == "create":
        tr_create(config, ssh_key, provider, args.m)
    elif args.subcommand == "destroy":
        tr_destroy(config)
        clan_clean(config)
    elif args.subcommand == "metadata":
        tr_metadata(config)
    elif args.subcommand == "clan":  #
        machines = tr_metadata(config)
        clan_init(config, provider, ssh_key, machines)

    else:
        parser.print_help()
