import json
import logging
import re
from pathlib import Path
from typing import TypedDict

from clan_cli.cmd import Log, RunOpts
from clan_cli.ssh.host import Host

# from clan_cli.ssh.upload import upload

log = logging.getLogger(__name__)


class ConfigDict(TypedDict):
    host: str
    port: int
    runtime: int
    cc: str
    iw: int


class SecondStatDict(TypedDict):
    second: int
    bandwidth_mbps: float
    bytes_received: int


class QperfOutputDict(TypedDict):
    config: ConfigDict
    connection_establishment_time_ms: int
    time_to_first_byte_ms: int
    per_second_stats: list[SecondStatDict]
    connection_status: str


def parse_qperf_output(output_text: str) -> QperfOutputDict:
    lines = output_text.strip().split("\n")
    result: QperfOutputDict = {
        "config": {"host": "", "port": 0, "runtime": 0, "cc": "", "iw": 0},
        "connection_establishment_time_ms": 0,
        "time_to_first_byte_ms": 0,
        "per_second_stats": [],
        "connection_status": "",
    }

    # Parse the first line for configuration details
    config_line = lines[0]
    config_match = re.match(
        r"starting client with host ([\d.]+), port (\d+), runtime (\d+)s, cc (\w+), iw (\d+)",
        config_line,
    )
    if config_match:
        result["config"] = {
            "host": config_match.group(1),
            "port": int(config_match.group(2)),
            "runtime": int(config_match.group(3)),
            "cc": config_match.group(4),
            "iw": int(config_match.group(5)),
        }

    # Parse connection times
    conn_time_match = re.match(r"connection establishment time: (\d+)ms", lines[1])
    if conn_time_match:
        result["connection_establishment_time_ms"] = int(conn_time_match.group(1))

    ttfb_match = re.match(r"time to first byte: (\d+)ms", lines[2])
    if ttfb_match:
        result["time_to_first_byte_ms"] = int(ttfb_match.group(1))

    # Parse per-second statistics
    result["per_second_stats"] = []
    for line in lines[3:-1]:  # Skip the last line which is "connection closed"
        second_match = re.match(
            r"second (\d+): ([\d.]+) mbit/s \((\d+) bytes received\)", line
        )
        if second_match:
            second_num = int(second_match.group(1))
            bandwidth = float(second_match.group(2))
            bytes_received = int(second_match.group(3))

            result["per_second_stats"].append(
                {
                    "second": second_num,
                    "bandwidth_mbps": bandwidth,
                    "bytes_received": bytes_received,
                }
            )

    # Check if connection closed properly
    if lines[-1] == "connection closed":
        result["connection_status"] = "closed"

    return result


def run_qperf_test(host: Host, target_host: str) -> QperfOutputDict:
    """Run a single iperf3 test and return the results."""
    cmd = [
        "qperf",
        "-c",
        target_host,
    ]

    res = host.run(cmd, RunOpts(log=Log.BOTH))
    return parse_qperf_output(res.stdout)


def save_qperf_results(result_dir: Path, json_data: QperfOutputDict) -> None:
    """Save qperf test results to a file."""
    result_dir.mkdir(parents=True, exist_ok=True)
    with (result_dir / "qperf.json").open("w") as f:
        json.dump(json_data, f, indent=4)
