#!/usr/bin/env python3

from clan_cli.cmd import run
import argparse
from dataclasses import dataclass
from clan_cli.custom_logger import setup_logging
import logging
from vpn_bench import Config


log = logging.getLogger(__name__)


def create(config: Config):
    run(["terraform", "apply", "-auto-approve"])


def destroy(config: Config):
    run(["terraform", "destroy", "-auto-approve"])
