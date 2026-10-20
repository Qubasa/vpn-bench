import logging

from clan_lib.errors import ClanError

from vpn_bench import cli
from vpn_bench.errors import VpnBenchError
from vpn_bench.remote import shared_connections

log = logging.getLogger(__name__)


def main() -> None:
    try:
        with shared_connections():
            cli.run_cli()
    except (VpnBenchError, ClanError) as e:
        if log.isEnabledFor(logging.DEBUG):
            raise
        log.error(e)
        exit(1)
