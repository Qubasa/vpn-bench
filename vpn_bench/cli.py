#!/usr/bin/env python3

import argparse
from clan_cli.custom_logger import setup_logging
import logging
from vpn_bench.terraform import tr_create, tr_destroy, tr_metadata
from vpn_bench import Config
from clan_cli.dirs import user_data_dir


log = logging.getLogger(__name__)


def run_cli():
    parser = argparse.ArgumentParser()
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    subparsers = parser.add_subparsers(dest="subcommand")

    create_parser = subparsers.add_parser("create", help="Create resources")
    create_parser.add_argument("--debug", action="store_true", help="Enable debug mode")

    destroy_parser = subparsers.add_parser("destroy", help="Destroy resources")
    destroy_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    metadata_parser = subparsers.add_parser("metadata", help="Show metadata")
    metadata_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    args = parser.parse_args()
    is_debug = getattr(args, "debug", False)
    data_dir = user_data_dir() / "vpn_bench"
    config = Config(debug=is_debug, data_dir=data_dir)

    if config.debug:
        setup_logging(logging.DEBUG)
        setup_logging(logging.DEBUG, root_log_name=__name__.split(".")[0])
    else:
        setup_logging(logging.INFO)
        setup_logging(logging.INFO, root_log_name=__name__.split(".")[0])

    log.debug("Debug mode enabled")

    if args.subcommand == "create":
        tr_create(config)
    elif args.subcommand == "destroy":
        tr_destroy(config)
    elif args.subcommand == "metadata":
        tr_metadata(config)

    else:
        parser.print_help()
