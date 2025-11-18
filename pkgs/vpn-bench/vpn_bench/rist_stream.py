import json
import logging
import re
import statistics
from collections.abc import Sequence
from pathlib import Path
from typing import TypedDict

from clan_lib.cmd import Log, RunOpts
from clan_lib.machines.machines import Machine

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


# --- Parsing Function ---


def parse_ffmpeg_stats(
    output_text: str, target_host: str, duration: int, profile: str = "main"
) -> RistOutputDict:
    """
    Parse ffmpeg progress output to extract streaming statistics.

    FFmpeg outputs progress information like:
    frame=   45 fps=30.0 q=-1.0 size=     256kB time=00:00:01.50 bitrate=1396.8kbits/s speed=   1x
    """
    lines = output_text.strip().split("\n")

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
    # Example: frame=   90 fps= 30 q=28.0 size=     512kB time=00:00:03.00 bitrate=1396.8kbits/s speed=   1x
    pattern = re.compile(
        r"frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+q=[\d.-]+\s+size=\s*(\d+)kB\s+time=([\d:.]+)\s+bitrate=\s*([\d.]+)kbits/s"
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
    duration: int = 45,
    bitrate: str = "5M",
    profile: str = "main",
) -> RistOutputDict:
    """
    Run a RIST video streaming test and return the results.

    Args:
        machine: The machine to run the test from (sender/client)
        target_host: The target host to stream to (receiver/server)
        duration: Test duration in seconds
        bitrate: Target bitrate (e.g., "5M" for 5 Mbps)
        profile: RIST profile (simple, main, or advanced)

    Returns:
        Parsed RIST streaming statistics
    """
    host = machine.target_host().override(host_key_check="none")

    # Restart the RIST receiver service on the target
    with host.host_connection() as ssh:
        ssh.run(["systemctl", "restart", "rist-stream.service"], RunOpts(log=Log.BOTH))

    # Build the ffmpeg command to stream test pattern
    # Generate 1080p@30fps test pattern with H.264 encoding
    cmd = [
        "nix",
        "shell",
        "nixpkgs#ffmpeg-full",
        "-c",
        "ffmpeg",
        "-re",  # Read input at native frame rate
        "-f",
        "lavfi",
        "-i",
        f"testsrc=size=1920x1080:rate=30:duration={duration}",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:duration=" + str(duration),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-b:v",
        bitrate,
        "-maxrate",
        bitrate,
        "-bufsize",
        "2M",
        "-g",
        "50",  # GOP size
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-f",
        "mpegts",
        "-stats",
        "-stats_period",
        "1",
        f"rist://{target_host}:40052?mode=caller&profile={profile}&buffer=400",
    ]

    with host.host_connection() as ssh:
        breakpoint()
        res = ssh.run(
            cmd,
            RunOpts(log=Log.BOTH, timeout=duration + 30),  # Add buffer to duration
        )

    # Parse the stderr output (ffmpeg writes stats to stderr)
    return parse_ffmpeg_stats(res.stderr, target_host, duration, profile)


# --- Save Results Function ---


def save_rist_results(
    result_dir: Path, json_data: RistSummaryDict | RistOutputDict
) -> None:
    """Save RIST test results to a file."""
    result_dir.mkdir(parents=True, exist_ok=True)

    crash_file = result_dir / "rist_stream_crash.json"
    if crash_file.exists():
        crash_file.unlink()

    with (result_dir / "rist_stream.json").open("w") as f:
        json.dump(json_data, f, indent=4)
