"""
Post-processing module to generate cross-VPN comparison data.

This module reads benchmark data from multiple VPNs, averages results
across machines, and writes aggregated comparison data for visualization.
"""

import json
import logging
import statistics
from pathlib import Path
from typing import Any, TypedDict

from vpn_bench.errors import save_bench_report

log = logging.getLogger(__name__)


# --- TypedDict Definitions ---


class MetricStatsDict(TypedDict):
    """Statistics for a single metric."""

    min: float
    average: float
    max: float
    percentiles: dict[str, float]


class PingComparisonDict(TypedDict):
    """Comparison data for ping benchmarks across VPNs."""

    rtt_min_ms: MetricStatsDict
    rtt_avg_ms: MetricStatsDict
    rtt_max_ms: MetricStatsDict
    rtt_mdev_ms: MetricStatsDict
    packet_loss_percent: MetricStatsDict


class QperfComparisonDict(TypedDict):
    """Comparison data for qperf benchmarks across VPNs."""

    total_bandwidth_mbps: MetricStatsDict
    cpu_usage_percent: MetricStatsDict
    ttfb_ms: MetricStatsDict
    conn_time_ms: MetricStatsDict


class RistComparisonDict(TypedDict):
    """Comparison data for RIST streaming benchmarks across VPNs."""

    bitrate_kbps: MetricStatsDict
    fps: MetricStatsDict
    dropped_frames: MetricStatsDict


class TcpIperfComparisonDict(TypedDict):
    """Comparison data for TCP iperf3 benchmarks across VPNs."""

    sender_throughput_mbps: MetricStatsDict
    receiver_throughput_mbps: MetricStatsDict
    retransmits: MetricStatsDict
    max_snd_cwnd_bytes: MetricStatsDict  # Max congestion window in bytes
    max_snd_wnd_bytes: MetricStatsDict  # Max send window in bytes
    total_bytes_sent: MetricStatsDict  # Total bytes sent during test
    total_bytes_received: MetricStatsDict  # Total bytes received during test
    duration_seconds: MetricStatsDict  # Test duration in seconds


class UdpIperfComparisonDict(TypedDict):
    """Comparison data for UDP iperf3 benchmarks across VPNs."""

    sender_throughput_mbps: MetricStatsDict
    receiver_throughput_mbps: MetricStatsDict
    jitter_ms: MetricStatsDict
    lost_percent: MetricStatsDict
    total_bytes_sent: MetricStatsDict  # Total bytes sent during test
    total_bytes_received: MetricStatsDict  # Total bytes received during test
    duration_seconds: MetricStatsDict  # Test duration in seconds


class NixCacheComparisonDict(TypedDict):
    """Comparison data for Nix Cache benchmarks across VPNs."""

    mean_seconds: MetricStatsDict
    stddev_seconds: MetricStatsDict
    min_seconds: MetricStatsDict
    max_seconds: MetricStatsDict


class ParallelTcpComparisonDict(TypedDict):
    """Comparison data for Parallel TCP iperf3 benchmarks across VPNs."""

    sender_throughput_mbps: MetricStatsDict  # Total sender throughput (sum_sent)
    receiver_throughput_mbps: (
        MetricStatsDict  # Total receiver throughput (sum_received)
    )
    total_retransmits: MetricStatsDict  # Sum of retransmits
    max_snd_cwnd_bytes: MetricStatsDict  # Max congestion window across all pairs
    max_snd_wnd_bytes: MetricStatsDict  # Max send window across all pairs
    total_bytes_sent: MetricStatsDict  # Total bytes sent across all pairs
    total_bytes_received: MetricStatsDict  # Total bytes received across all pairs
    duration_seconds: MetricStatsDict  # Test duration in seconds


# --- Helper Functions ---


def aggregate_metric_stats(stats_list: list[MetricStatsDict]) -> MetricStatsDict:
    """
    Aggregate multiple MetricStatsDict into a single summary.

    Takes the average of averages, min of mins, max of maxes,
    and average of percentiles.
    """
    if not stats_list:
        return {
            "min": 0.0,
            "average": 0.0,
            "max": 0.0,
            "percentiles": {"p25": 0.0, "p50": 0.0, "p75": 0.0},
        }

    mins = [s["min"] for s in stats_list]
    averages = [s["average"] for s in stats_list]
    maxes = [s["max"] for s in stats_list]
    p25s = [s["percentiles"]["p25"] for s in stats_list]
    p50s = [s["percentiles"]["p50"] for s in stats_list]
    p75s = [s["percentiles"]["p75"] for s in stats_list]

    return {
        "min": min(mins),
        "average": statistics.mean(averages),
        "max": max(maxes),
        "percentiles": {
            "p25": statistics.mean(p25s),
            "p50": statistics.mean(p50s),
            "p75": statistics.mean(p75s),
        },
    }


class LoadResult(TypedDict, total=False):
    """Result of loading a JSON file - can be success or error."""

    status: str
    data: dict[str, Any]
    error_type: str
    error: dict[str, Any]


def load_json_data(file_path: Path) -> dict[str, Any] | None:
    """Load JSON data from a file, returning None if it doesn't exist or fails."""
    if not file_path.exists():
        return None

    try:
        with file_path.open("r") as f:
            data = json.load(f)
            if data.get("status") == "success":
                return data.get("data")
            log.debug(f"Skipping failed benchmark: {file_path}")
            return None
    except (json.JSONDecodeError, OSError) as e:
        log.warning(f"Failed to load {file_path}: {e}")
        return None


def load_json_with_errors(file_path: Path) -> LoadResult | None:
    """Load JSON data including error information, returning None if file doesn't exist."""
    if not file_path.exists():
        return None

    try:
        with file_path.open("r") as f:
            data = json.load(f)
            return data
    except (json.JSONDecodeError, OSError) as e:
        log.warning(f"Failed to load {file_path}: {e}")
        return None


def check_duration_consistency(
    comparison_data: dict[str, Any], test_name: str, tolerance: float = 1.0
) -> None:
    """Check that all VPNs have consistent test durations.

    Logs a warning if durations differ by more than the tolerance.

    Args:
        comparison_data: Dict of VPN name -> comparison result
        test_name: Name of the test for logging
        tolerance: Maximum allowed difference in seconds
    """
    durations: list[float] = []
    for _vpn_name, vpn_data in comparison_data.items():
        if vpn_data.get("status") == "success":
            duration = vpn_data["data"].get("duration_seconds", {}).get("average", 0)
            if duration > 0:
                durations.append(duration)

    if len(durations) >= 2:
        min_dur, max_dur = min(durations), max(durations)
        if max_dur - min_dur > tolerance:
            log.warning(
                f"Duration mismatch in {test_name}: min={min_dur:.2f}s, max={max_dur:.2f}s "
                f"(tolerance={tolerance}s). This may indicate inconsistent test configurations."
            )


def get_vpn_error_for_test(
    bench_dir: Path, vpn_name: str, run_alias: str, test_file: str
) -> dict[str, Any] | None:
    """Get the first error found for a VPN's test across its machines."""
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    for machine_dir in sorted(vpn_dir.iterdir()):
        if not machine_dir.is_dir():
            continue

        test_path = machine_dir / test_file
        result = load_json_with_errors(test_path)
        if result and result.get("status") == "error":
            return {
                "error_type": result.get("error_type", "Unknown"),
                "error": result.get("error", {}),
                "machine": machine_dir.name,
            }

    return None


# --- Aggregation Functions ---


def aggregate_ping_data(
    bench_dir: Path, vpn_name: str, run_alias: str
) -> PingComparisonDict | None:
    """Aggregate ping data across all machines for a VPN."""
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    stats_list: list[dict[str, MetricStatsDict]] = []

    # Find all machine directories
    for machine_dir in sorted(vpn_dir.iterdir()):
        if not machine_dir.is_dir():
            continue

        ping_file = machine_dir / "ping.json"
        data = load_json_data(ping_file)
        if data:
            stats_list.append(data)

    if not stats_list:
        return None

    return {
        "rtt_min_ms": aggregate_metric_stats(
            [s["rtt_min_ms"] for s in stats_list if "rtt_min_ms" in s]
        ),
        "rtt_avg_ms": aggregate_metric_stats(
            [s["rtt_avg_ms"] for s in stats_list if "rtt_avg_ms" in s]
        ),
        "rtt_max_ms": aggregate_metric_stats(
            [s["rtt_max_ms"] for s in stats_list if "rtt_max_ms" in s]
        ),
        "rtt_mdev_ms": aggregate_metric_stats(
            [s["rtt_mdev_ms"] for s in stats_list if "rtt_mdev_ms" in s]
        ),
        "packet_loss_percent": aggregate_metric_stats(
            [s["packet_loss_percent"] for s in stats_list if "packet_loss_percent" in s]
        ),
    }


def aggregate_qperf_data(
    bench_dir: Path, vpn_name: str, run_alias: str
) -> QperfComparisonDict | None:
    """Aggregate qperf data across all machines for a VPN."""
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    stats_list: list[dict[str, MetricStatsDict]] = []

    for machine_dir in sorted(vpn_dir.iterdir()):
        if not machine_dir.is_dir():
            continue

        qperf_file = machine_dir / "qperf.json"
        data = load_json_data(qperf_file)
        if data:
            stats_list.append(data)

    if not stats_list:
        return None

    return {
        "total_bandwidth_mbps": aggregate_metric_stats(
            [
                s["total_bandwidth_mbps"]
                for s in stats_list
                if "total_bandwidth_mbps" in s
            ]
        ),
        "cpu_usage_percent": aggregate_metric_stats(
            [s["cpu_usage_percent"] for s in stats_list if "cpu_usage_percent" in s]
        ),
        "ttfb_ms": aggregate_metric_stats(
            [s["ttfb_ms"] for s in stats_list if "ttfb_ms" in s]
        ),
        "conn_time_ms": aggregate_metric_stats(
            [s["conn_time_ms"] for s in stats_list if "conn_time_ms" in s]
        ),
    }


def aggregate_rist_data(
    bench_dir: Path, vpn_name: str, run_alias: str
) -> RistComparisonDict | None:
    """Aggregate RIST streaming data across all machines for a VPN."""
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    stats_list: list[dict[str, MetricStatsDict]] = []

    for machine_dir in sorted(vpn_dir.iterdir()):
        if not machine_dir.is_dir():
            continue

        rist_file = machine_dir / "rist_stream.json"
        data = load_json_data(rist_file)
        if data:
            stats_list.append(data)

    if not stats_list:
        return None

    return {
        "bitrate_kbps": aggregate_metric_stats(
            [s["bitrate_kbps"] for s in stats_list if "bitrate_kbps" in s]
        ),
        "fps": aggregate_metric_stats([s["fps"] for s in stats_list if "fps" in s]),
        "dropped_frames": aggregate_metric_stats(
            [s["dropped_frames"] for s in stats_list if "dropped_frames" in s]
        ),
    }


def extract_tcp_iperf_metrics(data: dict[str, Any]) -> TcpIperfComparisonDict | None:
    """Extract key metrics from iperf3 TCP JSON output."""
    try:
        end = data.get("end", {})
        sum_sent = end.get("sum_sent", {})
        sum_received = end.get("sum_received", {})

        # Convert bits_per_second to Mbps
        sender_bps = sum_sent.get("bits_per_second", 0)
        receiver_bps = sum_received.get("bits_per_second", 0)
        retransmits = sum_sent.get("retransmits", 0)

        sender_mbps = sender_bps / 1_000_000
        receiver_mbps = receiver_bps / 1_000_000

        # Extract total bytes and duration
        bytes_sent = sum_sent.get("bytes", 0)
        bytes_received = sum_received.get("bytes", 0)
        duration_seconds = sum_sent.get("seconds", 0)

        # Extract max window sizes from streams (sender stream has window data)
        max_snd_cwnd = 0
        max_snd_wnd = 0
        streams = end.get("streams", [])
        for stream in streams:
            sender_data = stream.get("sender", {})
            if sender_data.get("sender", False):  # This is the sender stream
                max_snd_cwnd = max(max_snd_cwnd, sender_data.get("max_snd_cwnd", 0))
                max_snd_wnd = max(max_snd_wnd, sender_data.get("max_snd_wnd", 0))

        # Create MetricStatsDict for single values
        def single_value_stats(value: float) -> MetricStatsDict:
            return {
                "min": value,
                "average": value,
                "max": value,
                "percentiles": {"p25": value, "p50": value, "p75": value},
            }

        return {
            "sender_throughput_mbps": single_value_stats(sender_mbps),
            "receiver_throughput_mbps": single_value_stats(receiver_mbps),
            "retransmits": single_value_stats(float(retransmits)),
            "max_snd_cwnd_bytes": single_value_stats(float(max_snd_cwnd)),
            "max_snd_wnd_bytes": single_value_stats(float(max_snd_wnd)),
            "total_bytes_sent": single_value_stats(float(bytes_sent)),
            "total_bytes_received": single_value_stats(float(bytes_received)),
            "duration_seconds": single_value_stats(float(duration_seconds)),
        }
    except (KeyError, TypeError) as e:
        log.warning(f"Failed to extract TCP iperf metrics: {e}")
        return None


def aggregate_tcp_iperf_data(
    bench_dir: Path, vpn_name: str, run_alias: str
) -> TcpIperfComparisonDict | None:
    """Aggregate TCP iperf3 data across all machines for a VPN."""
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    metrics_list: list[TcpIperfComparisonDict] = []

    for machine_dir in sorted(vpn_dir.iterdir()):
        if not machine_dir.is_dir():
            continue

        iperf_file = machine_dir / "tcp_iperf3.json"
        data = load_json_data(iperf_file)
        if data:
            metrics = extract_tcp_iperf_metrics(data)
            if metrics:
                metrics_list.append(metrics)

    if not metrics_list:
        return None

    return {
        "sender_throughput_mbps": aggregate_metric_stats(
            [m["sender_throughput_mbps"] for m in metrics_list]
        ),
        "receiver_throughput_mbps": aggregate_metric_stats(
            [m["receiver_throughput_mbps"] for m in metrics_list]
        ),
        "retransmits": aggregate_metric_stats([m["retransmits"] for m in metrics_list]),
        "max_snd_cwnd_bytes": aggregate_metric_stats(
            [m["max_snd_cwnd_bytes"] for m in metrics_list]
        ),
        "max_snd_wnd_bytes": aggregate_metric_stats(
            [m["max_snd_wnd_bytes"] for m in metrics_list]
        ),
        "total_bytes_sent": aggregate_metric_stats(
            [m["total_bytes_sent"] for m in metrics_list]
        ),
        "total_bytes_received": aggregate_metric_stats(
            [m["total_bytes_received"] for m in metrics_list]
        ),
        "duration_seconds": aggregate_metric_stats(
            [m["duration_seconds"] for m in metrics_list]
        ),
    }


def extract_udp_iperf_metrics(data: dict[str, Any]) -> UdpIperfComparisonDict | None:
    """Extract key metrics from iperf3 UDP JSON output.

    For bidirectional UDP tests, we extract:
    - sender_throughput_mbps: from end.sum_sent (client sending to server)
    - receiver_throughput_mbps: from end.sum_received (what server actually received)
    - jitter_ms: from end.sum_received (receiver-side jitter measurement)
    - lost_percent: from end.sum_received (receiver-side packet loss)
    """
    try:
        end = data.get("end", {})

        # Get sender stats from sum_sent (client sending primary direction)
        sum_sent = end.get("sum_sent", {})
        sender_bps = sum_sent.get("bits_per_second", 0)
        sender_mbps = sender_bps / 1_000_000

        # Get receiver stats from sum_received (what server actually received)
        # This contains the actual received throughput, jitter, and packet loss
        sum_received = end.get("sum_received", {})
        receiver_bps = sum_received.get("bits_per_second", 0)
        receiver_mbps = receiver_bps / 1_000_000
        jitter_ms = sum_received.get("jitter_ms", 0)
        lost_percent = sum_received.get("lost_percent", 0)

        # Extract total bytes and duration
        bytes_sent = sum_sent.get("bytes", 0)
        bytes_received = sum_received.get("bytes", 0)
        duration_seconds = sum_sent.get("seconds", 0)

        def single_value_stats(value: float) -> MetricStatsDict:
            return {
                "min": value,
                "average": value,
                "max": value,
                "percentiles": {"p25": value, "p50": value, "p75": value},
            }

        return {
            "sender_throughput_mbps": single_value_stats(sender_mbps),
            "receiver_throughput_mbps": single_value_stats(receiver_mbps),
            "jitter_ms": single_value_stats(jitter_ms),
            "lost_percent": single_value_stats(lost_percent),
            "total_bytes_sent": single_value_stats(float(bytes_sent)),
            "total_bytes_received": single_value_stats(float(bytes_received)),
            "duration_seconds": single_value_stats(float(duration_seconds)),
        }
    except (KeyError, TypeError) as e:
        log.warning(f"Failed to extract UDP iperf metrics: {e}")
        return None


def aggregate_udp_iperf_data(
    bench_dir: Path, vpn_name: str, run_alias: str
) -> UdpIperfComparisonDict | None:
    """Aggregate UDP iperf3 data across all machines for a VPN."""
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    metrics_list: list[UdpIperfComparisonDict] = []

    for machine_dir in sorted(vpn_dir.iterdir()):
        if not machine_dir.is_dir():
            continue

        iperf_file = machine_dir / "udp_iperf3.json"
        data = load_json_data(iperf_file)
        if data:
            metrics = extract_udp_iperf_metrics(data)
            if metrics:
                metrics_list.append(metrics)

    if not metrics_list:
        return None

    return {
        "sender_throughput_mbps": aggregate_metric_stats(
            [m["sender_throughput_mbps"] for m in metrics_list]
        ),
        "receiver_throughput_mbps": aggregate_metric_stats(
            [m["receiver_throughput_mbps"] for m in metrics_list]
        ),
        "jitter_ms": aggregate_metric_stats([m["jitter_ms"] for m in metrics_list]),
        "lost_percent": aggregate_metric_stats(
            [m["lost_percent"] for m in metrics_list]
        ),
        "total_bytes_sent": aggregate_metric_stats(
            [m["total_bytes_sent"] for m in metrics_list]
        ),
        "total_bytes_received": aggregate_metric_stats(
            [m["total_bytes_received"] for m in metrics_list]
        ),
        "duration_seconds": aggregate_metric_stats(
            [m["duration_seconds"] for m in metrics_list]
        ),
    }


def extract_nix_cache_metrics(data: dict[str, Any]) -> NixCacheComparisonDict | None:
    """Extract key metrics from hyperfine JSON output (Nix Cache benchmark)."""
    try:
        results = data.get("results", [])
        if not results:
            return None

        result = results[0]  # Typically one result per benchmark

        mean = result.get("mean", 0)
        stddev = result.get("stddev", 0)
        min_val = result.get("min", 0)
        max_val = result.get("max", 0)

        def single_value_stats(value: float) -> MetricStatsDict:
            return {
                "min": value,
                "average": value,
                "max": value,
                "percentiles": {"p25": value, "p50": value, "p75": value},
            }

        return {
            "mean_seconds": single_value_stats(mean),
            "stddev_seconds": single_value_stats(stddev),
            "min_seconds": single_value_stats(min_val),
            "max_seconds": single_value_stats(max_val),
        }
    except (KeyError, TypeError, IndexError) as e:
        log.warning(f"Failed to extract Nix Cache metrics: {e}")
        return None


def aggregate_nix_cache_data(
    bench_dir: Path, vpn_name: str, run_alias: str
) -> NixCacheComparisonDict | None:
    """Aggregate Nix Cache data across all machines for a VPN."""
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    metrics_list: list[NixCacheComparisonDict] = []

    for machine_dir in sorted(vpn_dir.iterdir()):
        if not machine_dir.is_dir():
            continue

        nix_cache_file = machine_dir / "nix_cache.json"
        data = load_json_data(nix_cache_file)
        if data:
            metrics = extract_nix_cache_metrics(data)
            if metrics:
                metrics_list.append(metrics)

    if not metrics_list:
        return None

    return {
        "mean_seconds": aggregate_metric_stats(
            [m["mean_seconds"] for m in metrics_list]
        ),
        "stddev_seconds": aggregate_metric_stats(
            [m["stddev_seconds"] for m in metrics_list]
        ),
        "min_seconds": aggregate_metric_stats([m["min_seconds"] for m in metrics_list]),
        "max_seconds": aggregate_metric_stats([m["max_seconds"] for m in metrics_list]),
    }


def extract_parallel_tcp_metrics(
    data: dict[str, Any],
) -> ParallelTcpComparisonDict | None:
    """Extract key metrics from parallel TCP iperf3 JSON output.

    For bidirectional TCP tests, we extract:
    - sender_throughput_mbps: from sum_sent (total sent across all pairs)
    - receiver_throughput_mbps: from sum_received (total received across all pairs)
    - total_retransmits: sum of retransmits across all pairs
    - max_snd_cwnd_bytes: max congestion window across all pairs
    - max_snd_wnd_bytes: max send window across all pairs
    - total_bytes_sent: sum of bytes sent across all pairs
    - total_bytes_received: sum of bytes received across all pairs
    - duration_seconds: test duration (from first successful pair)
    """
    try:
        pairs = data.get("pairs", [])
        if not pairs:
            return None

        total_sender_throughput = 0.0
        total_receiver_throughput = 0.0
        total_retransmits = 0
        max_snd_cwnd = 0
        max_snd_wnd = 0
        total_bytes_sent = 0
        total_bytes_received = 0
        duration_seconds = 0.0  # Use duration from first successful pair
        successful_pairs = 0

        for pair in pairs:
            result = pair.get("result")
            if result is None:
                continue  # Skip failed pairs

            end = result.get("end", {})

            # Get sender stats from sum_sent
            sum_sent = end.get("sum_sent", {})
            sender_bps = sum_sent.get("bits_per_second", 0)
            retransmits = sum_sent.get("retransmits", 0)
            bytes_sent = sum_sent.get("bytes", 0)

            # Get receiver stats from sum_received
            sum_received = end.get("sum_received", {})
            receiver_bps = sum_received.get("bits_per_second", 0)
            bytes_received = sum_received.get("bytes", 0)

            # Get duration from first successful pair (all pairs run same duration)
            if successful_pairs == 0:
                duration_seconds = sum_sent.get("seconds", 0)

            # Extract max window sizes from streams
            streams = end.get("streams", [])
            for stream in streams:
                sender_data = stream.get("sender", {})
                if sender_data.get("sender", False):  # This is the sender stream
                    max_snd_cwnd = max(max_snd_cwnd, sender_data.get("max_snd_cwnd", 0))
                    max_snd_wnd = max(max_snd_wnd, sender_data.get("max_snd_wnd", 0))

            total_sender_throughput += sender_bps / 1_000_000
            total_receiver_throughput += receiver_bps / 1_000_000
            total_retransmits += retransmits
            total_bytes_sent += bytes_sent
            total_bytes_received += bytes_received
            successful_pairs += 1

        if successful_pairs == 0:
            return None

        def single_value_stats(value: float) -> MetricStatsDict:
            return {
                "min": value,
                "average": value,
                "max": value,
                "percentiles": {"p25": value, "p50": value, "p75": value},
            }

        return {
            "sender_throughput_mbps": single_value_stats(total_sender_throughput),
            "receiver_throughput_mbps": single_value_stats(total_receiver_throughput),
            "total_retransmits": single_value_stats(float(total_retransmits)),
            "max_snd_cwnd_bytes": single_value_stats(float(max_snd_cwnd)),
            "max_snd_wnd_bytes": single_value_stats(float(max_snd_wnd)),
            "total_bytes_sent": single_value_stats(float(total_bytes_sent)),
            "total_bytes_received": single_value_stats(float(total_bytes_received)),
            "duration_seconds": single_value_stats(float(duration_seconds)),
        }
    except (KeyError, TypeError) as e:
        log.warning(f"Failed to extract Parallel TCP metrics: {e}")
        return None


def aggregate_parallel_tcp_data(
    bench_dir: Path, vpn_name: str, run_alias: str
) -> ParallelTcpComparisonDict | None:
    """Aggregate Parallel TCP iperf3 data for a VPN.

    Note: Parallel TCP is stored at the run level, not per-machine.
    """
    vpn_dir = bench_dir / vpn_name / run_alias
    if not vpn_dir.exists():
        return None

    parallel_tcp_file = vpn_dir / "parallel_tcp_iperf3.json"
    data = load_json_data(parallel_tcp_file)
    if data:
        return extract_parallel_tcp_metrics(data)

    return None


def get_vpn_error_for_run_level_test(
    bench_dir: Path, vpn_name: str, run_alias: str, test_file: str
) -> dict[str, Any] | None:
    """Get error for a run-level test (not per-machine)."""
    vpn_dir = bench_dir / vpn_name / run_alias
    test_path = vpn_dir / test_file

    result = load_json_with_errors(test_path)
    if result and result.get("status") == "error":
        return {
            "error_type": result.get("error_type", "Unknown"),
            "error": result.get("error", {}),
            "machine": "all",  # Run-level test applies to all machines
        }

    return None


# --- Main Generation Function ---


def generate_comparison_data(bench_dir: Path) -> None:
    """
    Generate comparison data for all VPNs and benchmark types.

    Scans the bench directory for VPN results, aggregates data across machines,
    and writes comparison files to the General/comparison directory.
    """
    log.info(f"Generating comparison data from {bench_dir}")

    general_dir = bench_dir / "General"
    comparison_dir = general_dir / "comparison"

    # Find all VPN directories (exclude General)
    vpn_dirs = [d for d in bench_dir.iterdir() if d.is_dir() and d.name != "General"]

    if not vpn_dirs:
        log.warning("No VPN directories found in bench directory")
        return

    # Find all run aliases (TC profiles) across all VPNs
    run_aliases: set[str] = set()
    for vpn_dir in vpn_dirs:
        for subdir in vpn_dir.iterdir():
            if subdir.is_dir():
                # Check if this is a run alias directory (contains machine subdirs)
                has_machine_dirs = any(
                    d.is_dir() and not d.name.endswith(".json")
                    for d in subdir.iterdir()
                    if d.is_dir()
                )
                if has_machine_dirs:
                    run_aliases.add(subdir.name)

    if not run_aliases:
        log.warning("No benchmark runs found")
        return

    log.info(f"Found VPNs: {[d.name for d in vpn_dirs]}")
    log.info(f"Found run aliases: {run_aliases}")

    # Generate comparison data for each run alias (TC profile)
    for run_alias in sorted(run_aliases):
        log.info(f"Processing run alias: {run_alias}")

        run_comparison_dir = comparison_dir / run_alias
        run_comparison_dir.mkdir(parents=True, exist_ok=True)

        # Aggregate ping data (including errors)
        ping_comparison: dict[str, Any] = {}
        for vpn_dir in vpn_dirs:
            ping_data = aggregate_ping_data(bench_dir, vpn_dir.name, run_alias)
            if ping_data:
                ping_comparison[vpn_dir.name] = {"status": "success", "data": ping_data}
            else:
                # Check if there are any error files
                error_info = get_vpn_error_for_test(
                    bench_dir, vpn_dir.name, run_alias, "ping.json"
                )
                if error_info:
                    ping_comparison[vpn_dir.name] = {
                        "status": "error",
                        "error_type": error_info["error_type"],
                        "error": error_info["error"],
                        "machine": error_info["machine"],
                    }

        if ping_comparison:
            save_bench_report(run_comparison_dir, ping_comparison, "ping.json")
            success_count = sum(
                1 for v in ping_comparison.values() if v.get("status") == "success"
            )
            error_count = len(ping_comparison) - success_count
            log.info(
                f"  Saved ping comparison ({success_count} success, {error_count} errors)"
            )

        # Aggregate qperf data (including errors)
        qperf_comparison: dict[str, Any] = {}
        for vpn_dir in vpn_dirs:
            qperf_data = aggregate_qperf_data(bench_dir, vpn_dir.name, run_alias)
            if qperf_data:
                qperf_comparison[vpn_dir.name] = {
                    "status": "success",
                    "data": qperf_data,
                }
            else:
                error_info = get_vpn_error_for_test(
                    bench_dir, vpn_dir.name, run_alias, "qperf.json"
                )
                if error_info:
                    qperf_comparison[vpn_dir.name] = {
                        "status": "error",
                        "error_type": error_info["error_type"],
                        "error": error_info["error"],
                        "machine": error_info["machine"],
                    }

        if qperf_comparison:
            save_bench_report(run_comparison_dir, qperf_comparison, "qperf.json")
            success_count = sum(
                1 for v in qperf_comparison.values() if v.get("status") == "success"
            )
            error_count = len(qperf_comparison) - success_count
            log.info(
                f"  Saved qperf comparison ({success_count} success, {error_count} errors)"
            )

        # Aggregate RIST data (including errors)
        rist_comparison: dict[str, Any] = {}
        for vpn_dir in vpn_dirs:
            rist_data = aggregate_rist_data(bench_dir, vpn_dir.name, run_alias)
            if rist_data:
                rist_comparison[vpn_dir.name] = {"status": "success", "data": rist_data}
            else:
                error_info = get_vpn_error_for_test(
                    bench_dir, vpn_dir.name, run_alias, "rist_stream.json"
                )
                if error_info:
                    rist_comparison[vpn_dir.name] = {
                        "status": "error",
                        "error_type": error_info["error_type"],
                        "error": error_info["error"],
                        "machine": error_info["machine"],
                    }

        if rist_comparison:
            save_bench_report(
                run_comparison_dir, rist_comparison, "video_streaming.json"
            )
            success_count = sum(
                1 for v in rist_comparison.values() if v.get("status") == "success"
            )
            error_count = len(rist_comparison) - success_count
            log.info(
                f"  Saved video streaming comparison ({success_count} success, {error_count} errors)"
            )

        # Aggregate TCP iperf3 data (including errors)
        tcp_comparison: dict[str, Any] = {}
        for vpn_dir in vpn_dirs:
            tcp_data = aggregate_tcp_iperf_data(bench_dir, vpn_dir.name, run_alias)
            if tcp_data:
                tcp_comparison[vpn_dir.name] = {"status": "success", "data": tcp_data}
            else:
                error_info = get_vpn_error_for_test(
                    bench_dir, vpn_dir.name, run_alias, "tcp_iperf3.json"
                )
                if error_info:
                    tcp_comparison[vpn_dir.name] = {
                        "status": "error",
                        "error_type": error_info["error_type"],
                        "error": error_info["error"],
                        "machine": error_info["machine"],
                    }

        if tcp_comparison:
            save_bench_report(run_comparison_dir, tcp_comparison, "tcp_iperf3.json")
            check_duration_consistency(tcp_comparison, "TCP iperf3")
            success_count = sum(
                1 for v in tcp_comparison.values() if v.get("status") == "success"
            )
            error_count = len(tcp_comparison) - success_count
            log.info(
                f"  Saved TCP iperf3 comparison ({success_count} success, {error_count} errors)"
            )

        # Aggregate UDP iperf3 data (including errors)
        udp_comparison: dict[str, Any] = {}
        for vpn_dir in vpn_dirs:
            udp_data = aggregate_udp_iperf_data(bench_dir, vpn_dir.name, run_alias)
            if udp_data:
                udp_comparison[vpn_dir.name] = {"status": "success", "data": udp_data}
            else:
                error_info = get_vpn_error_for_test(
                    bench_dir, vpn_dir.name, run_alias, "udp_iperf3.json"
                )
                if error_info:
                    udp_comparison[vpn_dir.name] = {
                        "status": "error",
                        "error_type": error_info["error_type"],
                        "error": error_info["error"],
                        "machine": error_info["machine"],
                    }

        if udp_comparison:
            save_bench_report(run_comparison_dir, udp_comparison, "udp_iperf3.json")
            check_duration_consistency(udp_comparison, "UDP iperf3")
            success_count = sum(
                1 for v in udp_comparison.values() if v.get("status") == "success"
            )
            error_count = len(udp_comparison) - success_count
            log.info(
                f"  Saved UDP iperf3 comparison ({success_count} success, {error_count} errors)"
            )

        # Aggregate Nix Cache data (including errors)
        nix_cache_comparison: dict[str, Any] = {}
        for vpn_dir in vpn_dirs:
            nix_cache_data = aggregate_nix_cache_data(
                bench_dir, vpn_dir.name, run_alias
            )
            if nix_cache_data:
                nix_cache_comparison[vpn_dir.name] = {
                    "status": "success",
                    "data": nix_cache_data,
                }
            else:
                error_info = get_vpn_error_for_test(
                    bench_dir, vpn_dir.name, run_alias, "nix_cache.json"
                )
                if error_info:
                    nix_cache_comparison[vpn_dir.name] = {
                        "status": "error",
                        "error_type": error_info["error_type"],
                        "error": error_info["error"],
                        "machine": error_info["machine"],
                    }

        if nix_cache_comparison:
            save_bench_report(
                run_comparison_dir, nix_cache_comparison, "nix_cache.json"
            )
            success_count = sum(
                1 for v in nix_cache_comparison.values() if v.get("status") == "success"
            )
            error_count = len(nix_cache_comparison) - success_count
            log.info(
                f"  Saved Nix Cache comparison ({success_count} success, {error_count} errors)"
            )

        # Aggregate Parallel TCP data (including errors)
        parallel_tcp_comparison: dict[str, Any] = {}
        for vpn_dir in vpn_dirs:
            parallel_tcp_data = aggregate_parallel_tcp_data(
                bench_dir, vpn_dir.name, run_alias
            )
            if parallel_tcp_data:
                parallel_tcp_comparison[vpn_dir.name] = {
                    "status": "success",
                    "data": parallel_tcp_data,
                }
            else:
                error_info = get_vpn_error_for_run_level_test(
                    bench_dir, vpn_dir.name, run_alias, "parallel_tcp_iperf3.json"
                )
                if error_info:
                    parallel_tcp_comparison[vpn_dir.name] = {
                        "status": "error",
                        "error_type": error_info["error_type"],
                        "error": error_info["error"],
                        "machine": error_info["machine"],
                    }

        if parallel_tcp_comparison:
            save_bench_report(
                run_comparison_dir, parallel_tcp_comparison, "parallel_tcp_iperf3.json"
            )
            check_duration_consistency(parallel_tcp_comparison, "Parallel TCP iperf3")
            success_count = sum(
                1
                for v in parallel_tcp_comparison.values()
                if v.get("status") == "success"
            )
            error_count = len(parallel_tcp_comparison) - success_count
            log.info(
                f"  Saved Parallel TCP comparison ({success_count} success, {error_count} errors)"
            )

    log.info("Comparison data generation complete")
