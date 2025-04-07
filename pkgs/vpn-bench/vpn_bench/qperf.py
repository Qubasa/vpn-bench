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

# Define TypeVar for numeric types (int or float)
T = TypeVar("T", int, float)

log = logging.getLogger(__name__)

# --- TypedDict Definitions ---


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


# New TypedDict for combined metric statistics
class MetricStatsDict(TypedDict):
    min: float
    average: float
    max: float
    percentiles: dict[str, float]  # e.g., {"p25": val, "p50": val, "p75": val}


# Updated Summary TypedDict
class QperfSummaryDict(TypedDict):
    total_bandwidth_mbps: MetricStatsDict
    cpu_usage_percent: MetricStatsDict
    ttfb_ms: MetricStatsDict
    conn_time_ms: MetricStatsDict


# --- Parsing Function (Unchanged) ---
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
    # Corrected regex to handle different bandwidth units (gbit/s, mbit/s, kbit/s)
    # Use non-capturing group for units: (?:gbit/s|mbit/s|kbit/s)
    pattern = re.compile(
        r"second (\d+): ([\d.]+) (gbit/s|mbit/s|kbit/s), cpu (\d+): ([\d.]+)%"
    )
    for line in lines[3:connection_closed_index]:
        second_match = pattern.match(line)
        if second_match:
            second_num = int(second_match.group(1))
            bandwidth_value = float(second_match.group(2))
            # Ensure bandwidth_unit gets assigned the correct matched group
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
        if line.startswith("connect failed"):  # Handle failed connections too
            result["connection_status"] = "failed"
            break
    if not result["connection_status"]:  # If neither closed nor failed found
        log.warning("Connection status (closed/failed) not found in qperf output.")
        result["connection_status"] = "unknown"

    return result


# --- Helper Function to Calculate All Stats for a Metric ---
def calculate_metric_stats(values: list[int | float]) -> MetricStatsDict:
    """
    Calculate min, average, max, and percentiles for a list of numeric values.
    """
    if not values:
        # Return default zero values if the list is empty
        return {
            "min": 0.0,
            "average": 0.0,
            "max": 0.0,
            "percentiles": {"p25": 0.0, "p50": 0.0, "p75": 0.0},
        }

    # Ensure values are floats for consistency, especially important for statistics.mean
    float_values = [float(v) for v in values]
    sorted_values = sorted(float_values)

    # Calculate stats
    min_val = sorted_values[0]
    max_val = sorted_values[-1]
    avg_val = statistics.mean(float_values)

    # Calculate percentiles using the quantiles method for better handling
    # Ensure n=4 for quartiles (p25, p50, p75)
    # statistics.quantiles returns [q1, q2, q3] = [p25, p50, p75] when n=4
    try:
        # Need at least two points for quantiles with n=4
        if len(sorted_values) >= 2:
            qs = statistics.quantiles(sorted_values, n=4)
            p25 = qs[0]
            p75 = qs[2]
        else:  # Handle lists with 0 or 1 element for quantiles
            p25 = sorted_values[0]
            p75 = sorted_values[0]

        # Use median for p50 as it's robust
        p50 = statistics.median(sorted_values)

        percentiles = {"p25": p25, "p50": p50, "p75": p75}
    except statistics.StatisticsError as e:
        log.warning(
            f"Could not calculate quantiles (list length {len(sorted_values)}): {e}"
        )
        # Fallback if quantiles fail for some reason
        median_val = statistics.median(sorted_values)
        percentiles = {"p25": median_val, "p50": median_val, "p75": median_val}

    return {
        "min": min_val,
        "average": avg_val,
        "max": max_val,
        "percentiles": percentiles,
    }


# --- Main Summary Calculation Function (Updated) ---
def calculate_qperf_summary(parsed_outputs: list[QperfOutputDict]) -> QperfSummaryDict:
    """
    Calculate summary statistics (min, avg, max, percentiles)
    from a list of QperfOutputDict objects.

    Args:
        parsed_outputs: List of QperfOutputDict objects from multiple qperf runs.

    Returns:
        Dictionary containing summary statistics for each key metric.
    """
    if not parsed_outputs:
        log.warning("No parsed qperf outputs provided for summary calculation.")
        # Return structure with default zero values if input is empty
        zero_stats = calculate_metric_stats([])
        return {
            "total_bandwidth_mbps": zero_stats,
            "cpu_usage_percent": zero_stats,
            "ttfb_ms": zero_stats,
            "conn_time_ms": zero_stats,
        }

    # Aggregate bandwidth values per second, converting to Mbps
    bandwidth_by_second: dict[int, float] = {}
    for output in parsed_outputs:
        for stat in output["per_second_stats"]:
            second = stat["second"]
            bw = stat["bandwidth_value"]
            unit = stat["bandwidth_unit"]

            bw_mbps: float
            if unit == "gbit/s":
                bw_mbps = bw * 1000
            elif unit == "kbit/s":
                bw_mbps = bw / 1000
            elif unit == "mbit/s":
                bw_mbps = bw
            else:
                log.warning(f"Unknown bandwidth unit '{unit}' found, skipping.")
                continue  # Skip this stat if unit is unknown

            bandwidth_by_second[second] = bandwidth_by_second.get(second, 0.0) + bw_mbps

    # List of total bandwidth values for each second
    aggregated_bandwidths = list(bandwidth_by_second.values())

    # Collect all CPU usage percentages
    all_cpu_usages = []
    for output in parsed_outputs:
        for stat in output["per_second_stats"]:
            all_cpu_usages.append(stat["cpu_usage_percent"])

    # Collect time to first byte and connection establishment times (only include successful runs if needed)
    # Filter based on connection_status if required, e.g. only 'closed'
    successful_outputs = [
        o for o in parsed_outputs if o["connection_status"] == "closed"
    ]
    if not successful_outputs:
        log.warning(
            "No successful qperf runs found ('connection_status' != 'closed'). TTFB/Conn Time stats might be misleading or zero."
        )
        # Use all outputs if no successful ones, or decide how to handle
        outputs_to_consider = parsed_outputs
    else:
        outputs_to_consider = successful_outputs

    all_ttfb = [
        output["time_to_first_byte_ms"]
        for output in outputs_to_consider
        if "time_to_first_byte_ms" in output
    ]
    all_conn_times = [
        output["connection_establishment_time_ms"]
        for output in outputs_to_consider
        if "connection_establishment_time_ms" in output
    ]

    # Calculate full statistics for each metric using the helper function
    bandwidth_stats = calculate_metric_stats(aggregated_bandwidths)
    cpu_stats = calculate_metric_stats(all_cpu_usages)
    ttfb_stats = calculate_metric_stats([float(val) for val in all_ttfb])
    conn_time_stats = calculate_metric_stats([float(val) for val in all_conn_times])

    return {
        "total_bandwidth_mbps": bandwidth_stats,
        "cpu_usage_percent": cpu_stats,
        "ttfb_ms": ttfb_stats,
        "conn_time_ms": conn_time_stats,
    }


def run_qperf_test(host: Host, target_host: str) -> QperfSummaryDict:
    """Run a single qperf test and return the results."""

    parsed_outputs: list[QperfOutputDict] = []
    num_cores = int(host.run(["nproc"]).stdout.strip())
    with ThreadPoolExecutor() as executor:
        futures = []
        for core in range(num_cores):
            cmd = [
                "qperf",
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
