#!/usr/bin/env python3

from clan_cli.cmd import run
import argparse
from dataclasses import dataclass
from clan_cli.custom_logger import setup_logging
import logging
from vpn_bench.terraform import create, destroy
from vpn_bench import Config

log = logging.getLogger(__name__)


def create_cli():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="subcommand")

    create_parser = subparsers.add_parser("create", help="Create resources")
    create_parser.add_argument("--debug", action="store_true", help="Enable debug mode")

    destroy_parser = subparsers.add_parser("destroy", help="Destroy resources")
    destroy_parser.add_argument(
        "--debug", action="store_true", help="Enable debug mode"
    )

    args = parser.parse_args()
    config = Config(debug=args.debug)

    if config.debug:
        setup_logging(debug=config.debug)

    if args.subcommand == "create":
        create(config)
    elif args.subcommand == "destroy":
        destroy(config)
