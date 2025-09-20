import logging

from clan_lib.errors import ClanError

from vpn_bench import cli
from vpn_bench.errors import VpnBenchError

log = logging.getLogger(__name__)


def main() -> None:
    try:
        cli.run_cli()
    except (VpnBenchError, ClanError) as e:
        if log.isEnabledFor(logging.DEBUG):
            raise
        log.error(e)
        exit(1)
