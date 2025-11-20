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


class UdpIperfComparisonDict(TypedDict):
    """Comparison data for UDP iperf3 benchmarks across VPNs."""

    sender_throughput_mbps: MetricStatsDict
    receiver_throughput_mbps: MetricStatsDict
    jitter_ms: MetricStatsDict
    lost_percent: MetricStatsDict


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
    }


def extract_udp_iperf_metrics(data: dict[str, Any]) -> UdpIperfComparisonDict | None:
    """Extract key metrics from iperf3 UDP JSON output."""
    try:
        end = data.get("end", {})
        sum_data = end.get("sum", {})

        # Convert bits_per_second to Mbps
        sender_bps = sum_data.get("bits_per_second", 0)
        jitter_ms = sum_data.get("jitter_ms", 0)
        lost_percent = sum_data.get("lost_percent", 0)

        sender_mbps = sender_bps / 1_000_000
        # For UDP, receiver might be in a different location
        receiver_mbps = sender_mbps  # Approximate

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
    }


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

        # Aggregate ping data
        ping_comparison: dict[str, PingComparisonDict] = {}
        for vpn_dir in vpn_dirs:
            ping_data = aggregate_ping_data(bench_dir, vpn_dir.name, run_alias)
            if ping_data:
                ping_comparison[vpn_dir.name] = ping_data

        if ping_comparison:
            save_bench_report(run_comparison_dir, ping_comparison, "ping.json")
            log.info(f"  Saved ping comparison ({len(ping_comparison)} VPNs)")

        # Aggregate qperf data
        qperf_comparison: dict[str, QperfComparisonDict] = {}
        for vpn_dir in vpn_dirs:
            qperf_data = aggregate_qperf_data(bench_dir, vpn_dir.name, run_alias)
            if qperf_data:
                qperf_comparison[vpn_dir.name] = qperf_data

        if qperf_comparison:
            save_bench_report(run_comparison_dir, qperf_comparison, "qperf.json")
            log.info(f"  Saved qperf comparison ({len(qperf_comparison)} VPNs)")

        # Aggregate RIST data
        rist_comparison: dict[str, RistComparisonDict] = {}
        for vpn_dir in vpn_dirs:
            rist_data = aggregate_rist_data(bench_dir, vpn_dir.name, run_alias)
            if rist_data:
                rist_comparison[vpn_dir.name] = rist_data

        if rist_comparison:
            save_bench_report(
                run_comparison_dir, rist_comparison, "video_streaming.json"
            )
            log.info(
                f"  Saved video streaming comparison ({len(rist_comparison)} VPNs)"
            )

        # Aggregate TCP iperf3 data
        tcp_comparison: dict[str, TcpIperfComparisonDict] = {}
        for vpn_dir in vpn_dirs:
            tcp_data = aggregate_tcp_iperf_data(bench_dir, vpn_dir.name, run_alias)
            if tcp_data:
                tcp_comparison[vpn_dir.name] = tcp_data

        if tcp_comparison:
            save_bench_report(run_comparison_dir, tcp_comparison, "tcp_iperf3.json")
            log.info(f"  Saved TCP iperf3 comparison ({len(tcp_comparison)} VPNs)")

        # Aggregate UDP iperf3 data
        udp_comparison: dict[str, UdpIperfComparisonDict] = {}
        for vpn_dir in vpn_dirs:
            udp_data = aggregate_udp_iperf_data(bench_dir, vpn_dir.name, run_alias)
            if udp_data:
                udp_comparison[vpn_dir.name] = udp_data

        if udp_comparison:
            save_bench_report(run_comparison_dir, udp_comparison, "udp_iperf3.json")
            log.info(f"  Saved UDP iperf3 comparison ({len(udp_comparison)} VPNs)")

    log.info("Comparison data generation complete")
