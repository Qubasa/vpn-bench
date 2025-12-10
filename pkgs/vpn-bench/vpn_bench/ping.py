import logging
import re
import statistics
from typing import TypedDict

from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine

log = logging.getLogger(__name__)


# --- TypedDict Definitions ---


class PingConfigDict(TypedDict):
    target_host: str
    packet_count: int
    packet_size: int
    interval_ms: int


class PingRawDict(TypedDict):
    """Raw ping output from a single run."""

    config: PingConfigDict
    packets_transmitted: int
    packets_received: int
    packet_loss_percent: float
    time_ms: int
    rtt_min_ms: float
    rtt_avg_ms: float
    rtt_max_ms: float
    rtt_mdev_ms: float  # Standard deviation (jitter)
    individual_rtts_ms: list[float]  # Individual RTT measurements


class MetricStatsDict(TypedDict):
    min: float
    average: float
    max: float
    percentiles: dict[str, float]  # e.g., {"p25": val, "p50": val, "p75": val}


class PingSummaryDict(TypedDict):
    """Summary statistics from ping test."""

    rtt_min_ms: MetricStatsDict
    rtt_avg_ms: MetricStatsDict
    rtt_max_ms: MetricStatsDict
    rtt_mdev_ms: MetricStatsDict  # Jitter
    packet_loss_percent: MetricStatsDict


# --- Parsing Function ---


def parse_ping_output(output_text: str, target_host: str, count: int) -> PingRawDict:
    """
    Parse ping command output and extract latency metrics.

    Expected ping output format:
        PING 10.0.0.1 (10.0.0.1) 56(84) bytes of data.
        64 bytes from 10.0.0.1: icmp_seq=1 ttl=64 time=0.123 ms
        ...
        --- 10.0.0.1 ping statistics ---
        100 packets transmitted, 100 received, 0% packet loss, time 99123ms
        rtt min/avg/max/mdev = 0.123/0.456/1.234/0.123 ms
    """
    lines = output_text.strip().split("\n")

    result: PingRawDict = {
        "config": {
            "target_host": target_host,
            "packet_count": count,
            "packet_size": 56,  # Default ping packet size
            "interval_ms": 1000,  # Default 1 second interval
        },
        "packets_transmitted": 0,
        "packets_received": 0,
        "packet_loss_percent": 100.0,  # Default to 100% loss if parsing fails
        "time_ms": 0,
        "rtt_min_ms": 0.0,
        "rtt_avg_ms": 0.0,
        "rtt_max_ms": 0.0,
        "rtt_mdev_ms": 0.0,
        "individual_rtts_ms": [],
    }

    # Extract individual RTT measurements
    individual_rtts: list[float] = []
    rtt_pattern = re.compile(r"time=([\d.]+) ms")
    for line in lines:
        rtt_match = rtt_pattern.search(line)
        if rtt_match:
            individual_rtts.append(float(rtt_match.group(1)))

    result["individual_rtts_ms"] = individual_rtts

    # Parse summary statistics
    # Example: "100 packets transmitted, 100 received, 0% packet loss, time 99123ms"
    stats_pattern = re.compile(
        r"(\d+) packets transmitted, (\d+) received, ([\d.]+)% packet loss, time (\d+)ms"
    )
    for line in lines:
        stats_match = stats_pattern.search(line)
        if stats_match:
            result["packets_transmitted"] = int(stats_match.group(1))
            result["packets_received"] = int(stats_match.group(2))
            result["packet_loss_percent"] = float(stats_match.group(3))
            result["time_ms"] = int(stats_match.group(4))
            break

    # Parse RTT statistics
    # Example: "rtt min/avg/max/mdev = 0.123/0.456/1.234/0.123 ms"
    rtt_stats_pattern = re.compile(
        r"rtt min/avg/max/mdev = ([\d.]+)/([\d.]+)/([\d.]+)/([\d.]+) ms"
    )
    for line in lines:
        rtt_stats_match = rtt_stats_pattern.search(line)
        if rtt_stats_match:
            result["rtt_min_ms"] = float(rtt_stats_match.group(1))
            result["rtt_avg_ms"] = float(rtt_stats_match.group(2))
            result["rtt_max_ms"] = float(rtt_stats_match.group(3))
            result["rtt_mdev_ms"] = float(rtt_stats_match.group(4))
            break

    # Validate that we got meaningful results
    if result["packets_transmitted"] == 0:
        log.warning("Failed to parse ping statistics from output")

    return result


# --- Helper Function to Calculate Stats ---


def calculate_metric_stats(values: list[int | float]) -> MetricStatsDict:
    """
    Calculate min, average, max, and percentiles for a list of numeric values.
    """
    if not values:
        return {
            "min": 0.0,
            "average": 0.0,
            "max": 0.0,
            "percentiles": {"p25": 0.0, "p50": 0.0, "p75": 0.0},
        }

    float_values = [float(v) for v in values]
    sorted_values = sorted(float_values)

    min_val = sorted_values[0]
    max_val = sorted_values[-1]
    avg_val = statistics.mean(float_values)

    try:
        if len(sorted_values) >= 2:
            qs = statistics.quantiles(sorted_values, n=4)
            p25 = qs[0]
            p75 = qs[2]
        else:
            p25 = sorted_values[0]
            p75 = sorted_values[0]

        p50 = statistics.median(sorted_values)
        percentiles = {"p25": p25, "p50": p50, "p75": p75}
    except statistics.StatisticsError as e:
        log.warning(
            f"Could not calculate quantiles (list length {len(sorted_values)}): {e}"
        )
        median_val = statistics.median(sorted_values)
        percentiles = {"p25": median_val, "p50": median_val, "p75": median_val}

    return {
        "min": min_val,
        "average": avg_val,
        "max": max_val,
        "percentiles": percentiles,
    }


# --- Summary Calculation Function ---


def calculate_ping_summary(parsed_outputs: list[PingRawDict]) -> PingSummaryDict:
    """
    Calculate summary statistics from multiple ping test runs.

    Args:
        parsed_outputs: List of PingRawDict objects from multiple ping runs.

    Returns:
        Dictionary containing summary statistics for ping metrics.
    """
    if not parsed_outputs:
        log.warning("No parsed ping outputs provided for summary calculation.")
        zero_stats = calculate_metric_stats([])
        return {
            "rtt_min_ms": zero_stats,
            "rtt_avg_ms": zero_stats,
            "rtt_max_ms": zero_stats,
            "rtt_mdev_ms": zero_stats,
            "packet_loss_percent": zero_stats,
        }

    # Collect all metrics across runs
    all_rtt_mins: list[float] = []
    all_rtt_avgs: list[float] = []
    all_rtt_maxs: list[float] = []
    all_rtt_mdevs: list[float] = []
    all_packet_losses: list[float] = []

    for output in parsed_outputs:
        # Only include runs that had at least some successful packets
        if output["packets_received"] > 0:
            all_rtt_mins.append(output["rtt_min_ms"])
            all_rtt_avgs.append(output["rtt_avg_ms"])
            all_rtt_maxs.append(output["rtt_max_ms"])
            all_rtt_mdevs.append(output["rtt_mdev_ms"])

        # Always include packet loss stats
        all_packet_losses.append(output["packet_loss_percent"])

    # Calculate statistics for each metric
    rtt_min_stats = calculate_metric_stats(all_rtt_mins)
    rtt_avg_stats = calculate_metric_stats(all_rtt_avgs)
    rtt_max_stats = calculate_metric_stats(all_rtt_maxs)
    rtt_mdev_stats = calculate_metric_stats(all_rtt_mdevs)
    packet_loss_stats = calculate_metric_stats(all_packet_losses)

    return {
        "rtt_min_ms": rtt_min_stats,
        "rtt_avg_ms": rtt_avg_stats,
        "rtt_max_ms": rtt_max_stats,
        "rtt_mdev_ms": rtt_mdev_stats,
        "packet_loss_percent": packet_loss_stats,
    }


# --- Main Test Function ---


def run_ping_test(
    machine: Machine,
    target_host: str,
    count: int = 100,
    num_runs: int = 3,
) -> PingSummaryDict:
    """
    Run ping tests from a machine to a target host.

    Args:
        machine: The machine to run ping from
        target_host: The target hostname or IP to ping
        count: Number of ping packets to send per run (default: 100)
        num_runs: Number of test runs to perform (default: 3)

    Returns:
        Summary statistics from all ping runs
    """
    log.info(f"Running ping test from {machine.name} to {target_host}")

    parsed_outputs: list[PingRawDict] = []
    host = machine.target_host().override(host_key_check="none")

    for run in range(num_runs):
        log.debug(f"Ping test run {run + 1}/{num_runs}")

        with host.host_connection() as ssh:
            # Run ping command
            # -c: count of packets
            # -i: interval between packets (0.2 = 200ms for faster testing)
            # -W: timeout for each packet (1 second)
            cmd = [
                "ping",
                "-c",
                str(count),
                "-i",
                "0.2",  # 200ms interval for faster testing
                "-W",
                "1",  # 1 second timeout
                target_host,
            ]

            try:
                # Timeout should be count * interval + some buffer
                timeout = int(count * 0.3) + 10
                res = ssh.run(cmd, RunOpts(log=Log.BOTH, timeout=timeout))
                parsed = parse_ping_output(res.stdout, target_host, count)
                parsed_outputs.append(parsed)
            except Exception as e:
                log.error(f"Ping test run {run + 1} failed: {e}")
                # Add a failed result
                parsed_outputs.append(
                    {
                        "config": {
                            "target_host": target_host,
                            "packet_count": count,
                            "packet_size": 56,
                            "interval_ms": 200,
                        },
                        "packets_transmitted": count,
                        "packets_received": 0,
                        "packet_loss_percent": 100.0,
                        "time_ms": 0,
                        "rtt_min_ms": 0.0,
                        "rtt_avg_ms": 0.0,
                        "rtt_max_ms": 0.0,
                        "rtt_mdev_ms": 0.0,
                        "individual_rtts_ms": [],
                    }
                )

    return calculate_ping_summary(parsed_outputs)
