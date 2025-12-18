import json
import logging
import re
import statistics
from collections.abc import Sequence
from typing import TypedDict

from clan_lib.cmd import Log, RunOpts
from clan_lib.errors import ClanCmdError
from clan_lib.machines.machines import Machine
from clan_lib.ssh.remote import Remote

log = logging.getLogger(__name__)


# --- TypedDict Definitions ---


class RistConfigDict(TypedDict):
    host: str
    port: int
    duration: int
    buffer_ms: int
    bitrate_mbps: float
    profile: str


class RistPerSecondStatsDict(TypedDict):
    second: int
    fps: float
    bitrate_kbps: float
    size_kb: int
    time_sec: float


class RistOutputDict(TypedDict):
    config: RistConfigDict
    per_second_stats: list[RistPerSecondStatsDict]
    total_frames: int
    dropped_frames: int
    avg_bitrate_kbps: float
    avg_fps: float


class MetricStatsDict(TypedDict):
    min: float
    average: float
    max: float
    percentiles: dict[str, float]


class RistSummaryDict(TypedDict):
    bitrate_kbps: MetricStatsDict
    fps: MetricStatsDict
    dropped_frames: MetricStatsDict


# --- RIST Network Stats TypedDicts (from ristreceiver) ---


class RistNetworkPerSecondDict(TypedDict):
    """Per-second network statistics from ristreceiver."""

    second: int
    packets_received: int
    packets_dropped: int
    packets_recovered: int
    packets_retransmitted: int
    bitrate_bps: int
    rtt_ms: float
    quality: int  # 0-100


class RistNetworkStatsDict(TypedDict):
    """Aggregated network statistics from ristreceiver."""

    per_second_stats: list[RistNetworkPerSecondDict]
    total_packets_received: int
    total_packets_dropped: int
    total_packets_recovered: int
    avg_rtt_ms: float
    avg_quality: float


class RistNetworkSummaryDict(TypedDict):
    """Summary statistics for RIST network metrics."""

    packets_dropped: MetricStatsDict
    packets_recovered: MetricStatsDict
    rtt_ms: MetricStatsDict
    quality: MetricStatsDict
    bitrate_bps: MetricStatsDict


class RistCombinedSummaryDict(TypedDict):
    """Combined summary with both encoding and network stats."""

    encoding: RistSummaryDict  # fps, bitrate from ffmpeg sender
    network: RistNetworkSummaryDict  # packet loss, RTT from ristreceiver


# --- Parsing Function ---


def parse_ffmpeg_stats(
    output_text: str, target_host: str, duration: int, profile: str = "main"
) -> RistOutputDict:
    """
    Parse ffmpeg progress output to extract streaming statistics.

    FFmpeg outputs progress information like:
    frame=   45 fps=30.0 q=-1.0 size=     256kB time=00:00:01.50 bitrate=1396.8kbits/s speed=   1x

    Note: ffmpeg uses \r to overwrite progress lines, so we need to split by both \r and \n
    """
    # Split by both \n and \r to capture all progress updates
    lines = output_text.replace("\r", "\n").strip().split("\n")

    result: RistOutputDict = {
        "config": {
            "host": target_host,
            "port": 40052,
            "duration": duration,
            "buffer_ms": 400,
            "bitrate_mbps": 5.0,
            "profile": profile,
        },
        "per_second_stats": [],
        "total_frames": 0,
        "dropped_frames": 0,
        "avg_bitrate_kbps": 0.0,
        "avg_fps": 0.0,
    }

    # Regex to parse ffmpeg progress output
    # Example: frame=   90 fps= 30 q=28.0 size=     512KiB time=00:00:03.00 bitrate=1396.8kbits/s speed=   1x
    # Note: size can be either "kB" or "KiB" depending on ffmpeg version
    pattern = re.compile(
        r"frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+q=[\d.-]+\s+size=\s*(\d+)KiB\s+time=([\d:.]+)\s+bitrate=\s*([\d.]+)kbits/s"
    )

    last_second = -1
    total_frames = 0

    for line in lines:
        # Look for progress lines
        match = pattern.search(line)
        if match:
            frame_num = int(match.group(1))
            fps = float(match.group(2))
            size_kb = int(match.group(3))
            time_str = match.group(4)
            bitrate_kbps = float(match.group(5))

            # Convert time to seconds
            time_parts = time_str.split(":")
            if len(time_parts) == 3:
                hours, minutes, seconds = time_parts
                total_seconds = int(hours) * 3600 + int(minutes) * 60 + float(seconds)
            else:
                total_seconds = float(time_str)

            current_second = int(total_seconds)

            # Only record stats once per second (approximately)
            if current_second > last_second and current_second <= duration:
                result["per_second_stats"].append(
                    {
                        "second": current_second,
                        "fps": fps,
                        "bitrate_kbps": bitrate_kbps,
                        "size_kb": size_kb,
                        "time_sec": total_seconds,
                    }
                )
                last_second = current_second

            total_frames = frame_num

    result["total_frames"] = total_frames

    # Calculate averages
    if result["per_second_stats"]:
        result["avg_bitrate_kbps"] = statistics.mean(
            [s["bitrate_kbps"] for s in result["per_second_stats"]]
        )
        result["avg_fps"] = statistics.mean(
            [s["fps"] for s in result["per_second_stats"]]
        )

    # Detect dropped frames (if actual fps is significantly lower than expected)
    expected_frames = duration * 30  # 30 fps expected
    result["dropped_frames"] = max(0, expected_frames - total_frames)

    return result


# --- ristreceiver Stats Parser ---


def parse_ristreceiver_stats(journalctl_output: str) -> RistNetworkStatsDict:
    """
    Parse ristreceiver JSON stats output from journalctl.

    ristreceiver outputs JSON stats like:
    {"receiver-stats":{"flowinstant":{"flow_id":...,"stats":{
      "quality":...,"received":...,"missing":...,"recovered_total":...,
      "lost":...,"bitrate":...},"peers":[{"stats":{"rtt":...,"avg_rtt":...}}]}}}
    """
    result: RistNetworkStatsDict = {
        "per_second_stats": [],
        "total_packets_received": 0,
        "total_packets_dropped": 0,
        "total_packets_recovered": 0,
        "avg_rtt_ms": 0.0,
        "avg_quality": 0.0,
    }

    lines = journalctl_output.strip().split("\n")
    second = 0
    all_rtt = []
    all_quality = []

    for line in lines:
        # Try to find JSON in the line
        # ristreceiver outputs: timestamp|...|[INFO] {"receiver-stats":...}
        json_start = line.find("{")
        if json_start == -1:
            continue

        json_str = line[json_start:]

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError:
            continue

        # Parse receiver-stats format
        if "receiver-stats" in data:
            receiver_stats = data["receiver-stats"]
            # flowinstant contains per-interval stats
            if "flowinstant" in receiver_stats:
                flow = receiver_stats["flowinstant"]
                second += 1

                # Stats are nested under "stats" key
                stats = flow.get("stats", {})

                packets_received = int(stats.get("received", 0))
                packets_lost = int(stats.get("lost", 0))
                packets_recovered = int(stats.get("recovered_total", 0))
                retries = int(stats.get("retries", 0))
                bitrate_bps = int(stats.get("bitrate", 0))
                quality = int(stats.get("quality", 100))

                # RTT is in peers array
                rtt_ms = 0.0
                peers = flow.get("peers", [])
                if peers:
                    # Average RTT across all peers
                    peer_rtts = []
                    for peer in peers:
                        peer_stats = peer.get("stats", {})
                        avg_rtt = peer_stats.get("avg_rtt", 0.0)
                        if avg_rtt > 0:
                            peer_rtts.append(float(avg_rtt))
                    if peer_rtts:
                        rtt_ms = statistics.mean(peer_rtts)

                result["per_second_stats"].append(
                    {
                        "second": second,
                        "packets_received": packets_received,
                        "packets_dropped": packets_lost,  # "lost" = permanently lost
                        "packets_recovered": packets_recovered,
                        "packets_retransmitted": retries,
                        "bitrate_bps": bitrate_bps,
                        "rtt_ms": rtt_ms,
                        "quality": quality,
                    }
                )

                result["total_packets_received"] += packets_received
                result["total_packets_dropped"] += packets_lost
                result["total_packets_recovered"] += packets_recovered

                if rtt_ms > 0:
                    all_rtt.append(rtt_ms)
                all_quality.append(quality)

    # Calculate averages
    if all_rtt:
        result["avg_rtt_ms"] = statistics.mean(all_rtt)
    if all_quality:
        result["avg_quality"] = statistics.mean(all_quality)

    return result


def calculate_network_summary(
    network_stats: RistNetworkStatsDict,
) -> RistNetworkSummaryDict:
    """
    Calculate summary statistics from network stats.
    """
    zero_stats = calculate_metric_stats([])

    if not network_stats["per_second_stats"]:
        return {
            "packets_dropped": zero_stats,
            "packets_recovered": zero_stats,
            "rtt_ms": zero_stats,
            "quality": zero_stats,
            "bitrate_bps": zero_stats,
        }

    stats = network_stats["per_second_stats"]

    return {
        "packets_dropped": calculate_metric_stats(
            [s["packets_dropped"] for s in stats]
        ),
        "packets_recovered": calculate_metric_stats(
            [s["packets_recovered"] for s in stats]
        ),
        "rtt_ms": calculate_metric_stats([s["rtt_ms"] for s in stats]),
        "quality": calculate_metric_stats([s["quality"] for s in stats]),
        "bitrate_bps": calculate_metric_stats([s["bitrate_bps"] for s in stats]),
    }


# --- Helper Function to Calculate All Stats for a Metric ---


def calculate_metric_stats(values: Sequence[int | float]) -> MetricStatsDict:
    """
    Calculate min, average, max, and percentiles for a sequence of numeric values.
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


# --- Main Summary Calculation Function ---


def calculate_rist_summary(parsed_outputs: list[RistOutputDict]) -> RistSummaryDict:
    """
    Calculate summary statistics from a list of RistOutputDict objects.

    Args:
        parsed_outputs: List of RistOutputDict objects from multiple runs.

    Returns:
        Dictionary containing summary statistics for each key metric.
    """
    if not parsed_outputs:
        log.warning("No parsed RIST outputs provided for summary calculation.")
        zero_stats = calculate_metric_stats([])
        return {
            "bitrate_kbps": zero_stats,
            "fps": zero_stats,
            "dropped_frames": zero_stats,
        }

    # Collect all bitrate values
    all_bitrates = []
    for output in parsed_outputs:
        for stat in output["per_second_stats"]:
            all_bitrates.append(stat["bitrate_kbps"])

    # Collect all fps values
    all_fps = []
    for output in parsed_outputs:
        for stat in output["per_second_stats"]:
            all_fps.append(stat["fps"])

    # Collect dropped frames
    all_dropped_frames = [output["dropped_frames"] for output in parsed_outputs]

    return {
        "bitrate_kbps": calculate_metric_stats(all_bitrates),
        "fps": calculate_metric_stats(all_fps),
        "dropped_frames": calculate_metric_stats(all_dropped_frames),
    }


# --- Main Test Function ---


def run_rist_test(
    machine: Machine,
    target_host: str,
    duration: int = 30,
    bitrate: str = "25M",
    profile: str = "main",
    target_machine: Machine | None = None,
) -> RistCombinedSummaryDict:
    """
    Run a RIST video streaming test and return combined summary statistics.

    This test captures both:
    - Encoding stats from ffmpeg sender (fps, bitrate)
    - Network stats from ristreceiver (packet loss, RTT, quality)

    Args:
        machine: The machine to run the test from (sender/client)
        target_host: The target host to stream to (receiver/server)
        duration: Test duration in seconds
        bitrate: Target bitrate (e.g., "5M" for 5 Mbps)
        profile: RIST profile (simple, main, or advanced)
        target_machine: The target Machine object for SSH access (uses public IP)

    Returns:
        Combined summary with encoding stats and network stats.
    """
    # Set up target connection
    if target_machine:
        # Use the target machine's public IP for SSH
        target = target_machine.target_host().override(host_key_check="none")
    else:
        # Fallback for backwards compatibility
        target = Remote(target_host).override(host_key_check="none")

    # Restart the RIST receiver service on the target
    with target.host_connection() as ssh:
        ssh.run(
            ["systemctl", "restart", "rist-stream.service"],
            RunOpts(log=Log.BOTH),
        )

    host = machine.target_host().override(host_key_check="none")

    # Build the ffmpeg command to stream test pattern
    # Generate 4K@30fps test pattern with H.264 encoding
    ffmpeg_cmd = (
        f"ffmpeg -re -f lavfi -i testsrc=size=3840x2160:rate=30:duration={duration} "
        f"-f lavfi -i sine=frequency=1000:duration={duration} "
        f"-c:v libx264 -preset ultrafast -tune zerolatency "
        f"-b:v {bitrate} -maxrate {bitrate} -bufsize 2M -g 50 -pix_fmt yuv420p "
        f"-c:a aac -b:a 128k "
        f"-f mpegts -stats -stats_period 1 "
        f"rist://{target_host}:40052"
    )

    cmd = [
        "nix",
        "shell",
        "nixpkgs#ffmpeg-full",
        "-c",
        "bash",
        "-c",
        ffmpeg_cmd,
    ]

    # Run ffmpeg sender and collect encoding stats
    with host.host_connection() as ssh:
        try:
            res = ssh.run(
                cmd,
                RunOpts(log=Log.BOTH, timeout=duration + 30),  # Add buffer to duration
            )
            stderr = res.stderr
        except ClanCmdError as e:
            # RIST often fails on close even after successful transmission
            # Capture stderr from the exception to parse stats
            log.warning(
                f"ffmpeg exited with error code {e.cmd.returncode} (likely RIST close timeout)"
            )
            stderr = e.cmd.stderr
            if not stderr:
                raise

    # Parse ffmpeg encoding stats
    parsed_encoding = parse_ffmpeg_stats(stderr, target_host, duration, profile)
    encoding_summary = calculate_rist_summary([parsed_encoding])

    # Collect RIST network stats from the receiver via journalctl
    with target.host_connection() as ssh:
        try:
            journalctl_res = ssh.run(
                [
                    "journalctl",
                    "-u",
                    "rist-stream.service",
                    "--since",
                    f"{duration + 10} seconds ago",
                    "--no-pager",
                    "-o",
                    "cat",  # Output just the message, no timestamp prefix
                ],
                RunOpts(log=Log.BOTH),
            )
            journalctl_output = journalctl_res.stdout
        except ClanCmdError as e:
            log.warning(f"Failed to collect journalctl logs: {e}")
            journalctl_output = ""

    # Parse ristreceiver network stats
    network_stats = parse_ristreceiver_stats(journalctl_output)
    network_summary = calculate_network_summary(network_stats)

    log.info(
        f"RIST test complete: {network_stats['total_packets_received']} packets received, "
        f"{network_stats['total_packets_dropped']} dropped, "
        f"{network_stats['total_packets_recovered']} recovered"
    )

    return {
        "encoding": encoding_summary,
        "network": network_summary,
    }
