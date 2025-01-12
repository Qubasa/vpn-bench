#!/usr/bin/env python3

import argparse
from clan_cli.custom_logger import setup_logging
import logging
from vpn_bench.terraform import create, destroy
from vpn_bench import Config

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

    args = parser.parse_args()
    is_debug = getattr(args, "debug", False)
    config = Config(debug=is_debug)

    if config.debug:
        setup_logging(debug=config.debug)

    if args.subcommand == "create":
        create(config)
    elif args.subcommand == "destroy":
        destroy(config)
