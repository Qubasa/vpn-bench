import concurrent
import json
import logging
import re
import statistics
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal, TypedDict, TypeVar, cast

from clan_cli.cmd import Log, RunOpts
from clan_cli.ssh.host import Host

T = TypeVar("T", int, float)
log = logging.getLogger(__name__)


class ConfigDict(TypedDict):
    host: str
    port: int
    runtime: int
    cc: str
    iw: int


type BandwidthUnit = Literal["kbit/s", "mbit/s", "gbit/s"]


class SecondStatDict(TypedDict):
    second: int
    bandwidth_value: float
    bandwidth_unit: BandwidthUnit
    cpu_core: int
    cpu_usage_percent: float


class QperfOutputDict(TypedDict):
    config: ConfigDict
    connection_establishment_time_ms: int
    time_to_first_byte_ms: int
    per_second_stats: list[SecondStatDict]
    connection_status: str


class QperfSummaryDict(TypedDict):
    total_bandwidth_mbps_percentiles: dict[str, float]
    cpu_usage_percent_percentiles: dict[str, float]
    ttfb_ms_percentiles: dict[str, float]
    conn_time_ms_percentiles: dict[str, float]


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
        r"starting client with host ([^,]+), port (\d+), runtime (\d+)s, cc (\w+), iw (\d+)",
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

    # Determine where the connection closed line is
    connection_closed_index = next(
        (i for i, line in enumerate(lines) if line.startswith("connection closed")),
        len(lines),
    )

    for line in lines[3:connection_closed_index]:
        # Match the new format with CPU usage information
        second_match = re.match(
            r"second (\d+): ([\d.]+) (gbit/s|mbit/s), cpu (\d+): ([\d.]+)%", line
        )
        if second_match:
            second_num = int(second_match.group(1))
            bandwidth_value = float(second_match.group(2))
            bandwidth_unit = second_match.group(3)
            cpu_core = int(second_match.group(4))
            cpu_usage_percent = float(second_match.group(5))

            result["per_second_stats"].append(
                {
                    "second": second_num,
                    "bandwidth_value": bandwidth_value,
                    "bandwidth_unit": cast(BandwidthUnit, bandwidth_unit),
                    "cpu_core": cpu_core,
                    "cpu_usage_percent": cpu_usage_percent,
                }
            )

    # Check if connection closed properly
    for line in lines:
        if line.startswith("connection closed"):
            result["connection_status"] = "closed"
            break

    return result


def run_qperf_test(host: Host, target_host: str) -> QperfSummaryDict:
    """Run a single qperf test and return the results."""

    parsed_outputs: list[QperfOutputDict] = []
    num_cores = int(host.run(["nproc"]).stdout.strip())
    with ThreadPoolExecutor() as executor:
        futures = []
        for core in range(num_cores):
            cmd = [
                "qperf",
                #    "-mm",
                "-i",
                "1",
                "-g",
                "1",
                "-p",
                str(18000 + core),
                "-c",
                target_host,
            ]
            future = executor.submit(host.run, cmd, RunOpts(log=Log.BOTH))
            futures.append(future)
        done, not_done = concurrent.futures.wait(futures)
        for future in done:
            exc = future.exception()
            if exc is not None:
                raise exc
            res = future.result()
            parsed_outputs.append(parse_qperf_output(res.stdout))

    return calculate_qperf_summary(parsed_outputs)


def calculate_qperf_summary(parsed_outputs: list[QperfOutputDict]) -> QperfSummaryDict:
    """
    Calculate summary statistics from a list of QperfOutputDict objects.

    Args:
        parsed_outputs: List of QperfOutputDict objects from multiple qperf runs

    Returns:
        Dictionary containing summary statistics:
        - total_bandwidth_mbps: Total bandwidth achieved across all runs
        - cpu_usage_percentiles: Dict with 25th, 50th, 75th percentiles of CPU usage
        - ttfb_percentiles: Dict with 25th, 50th, 75th percentiles of time to first byte
        - conn_time_percentiles: Dict with 25th, 50th, 75th percentiles of connection time
    """

    # Calculate total bandwidth
    # Group per-second bandwidth values by second across all outputs
    bandwidth_by_second: dict[int, float] = {}
    for output in parsed_outputs:
        for stat in output["per_second_stats"]:
            second = stat["second"]
            bw = stat["bandwidth_value"]
            if stat["bandwidth_unit"] == "gbit/s":
                bw *= 1000  # Convert gbit/s to mbit/s
            elif stat["bandwidth_unit"] == "kbit/s":
                bw /= 1000  # Convert kbit/s to mbit/s
            bandwidth_by_second[second] = bandwidth_by_second.get(second, 0.0) + bw

    # Compute percentiles over the total bandwidth per second
    aggregated_bandwidths = list(bandwidth_by_second.values())
    bandwidth_percentiles = calculate_percentiles(aggregated_bandwidths)

    # Collect all CPU usage percentages
    all_cpu_usages = []
    for output in parsed_outputs:
        for stat in output["per_second_stats"]:
            all_cpu_usages.append(stat["cpu_usage_percent"])

    # Collect time to first byte and connection establishment times
    all_ttfb = [output["time_to_first_byte_ms"] for output in parsed_outputs]
    all_conn_times = [
        output["connection_establishment_time_ms"] for output in parsed_outputs
    ]

    # Calculate percentiles for each metric
    cpu_percentiles = calculate_percentiles(all_cpu_usages)
    ttfb_percentiles = calculate_percentiles(all_ttfb)
    conn_time_percentiles = calculate_percentiles(all_conn_times)

    return {
        "total_bandwidth_mbps_percentiles": bandwidth_percentiles,
        "cpu_usage_percent_percentiles": cpu_percentiles,
        "ttfb_ms_percentiles": ttfb_percentiles,
        "conn_time_ms_percentiles": conn_time_percentiles,
    }


def calculate_percentiles(values: list[T]) -> dict[str, float]:
    """
    Calculate percentiles more precisely using the statistics module.
    For even-length lists, this uses interpolation between the two middle values.
    """
    if not values:
        return {"p25": 0, "p50": 0, "p75": 0}

    sorted_values = sorted(values)

    return {
        "p25": statistics.quantiles(sorted_values, n=4)[0],
        "p50": statistics.median(sorted_values),
        "p75": statistics.quantiles(sorted_values, n=4)[2],
    }


def save_qperf_results(result_dir: Path, json_data: QperfSummaryDict) -> None:
    """Save qperf test results to a file."""
    result_dir.mkdir(parents=True, exist_ok=True)

    crash_file = result_dir / "qperf_crash.json"
    if crash_file.exists():
        crash_file.unlink()
    with (result_dir / "qperf.json").open("w") as f:
        json.dump(json_data, f, indent=4)
