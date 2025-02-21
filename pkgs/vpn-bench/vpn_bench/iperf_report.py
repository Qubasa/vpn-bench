import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.ticker import FuncFormatter

log = logging.getLogger(__name__)


def analyze_iperf_report(
    json_data: dict[Any, Any],
    title: str = "VPN Performance Analysis",
    ax: list[plt.Axes] | None = None,
) -> list[plt.Axes] | None:
    """
    Analyze and plot iperf3 JSON report data using Matplotlib.

    Args:
        json_data: The iperf3 JSON report
        title: Title for the plot
        ax: Optional list of axes to plot on (for subplot integration)

    Returns:
        List of axes if created new, None if plotting on existing axes
    """
    # Extract time series data from intervals
    intervals = json_data["intervals"]

    # Create DataFrames for different metrics
    data = []
    for interval in intervals:
        stream = interval["streams"][0]
        data.append(
            {
                "Time (s)": stream["end"],
                "Bandwidth (Mbps)": stream["bits_per_second"]
                / 1_000_000,  # Convert to Mbps
                "RTT (ms)": stream["rtt"] / 1000,  # Convert to ms
                "TCP Window Size (KB)": stream["snd_cwnd"] / 1024,  # Convert to KB
            }
        )

    df = pd.DataFrame(data)

    # Create new figure and axes if not provided
    if ax is None:
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12, 10))
        fig.suptitle(title, fontsize=16, pad=20)
    else:
        ax1, ax2 = ax

    # Style configuration
    colors = {
        "bandwidth": "#2E86C1",  # Nice blue
        "rtt": "#E74C3C",  # Nice red
        "window": "#27AE60",  # Nice green
    }

    # Plot 1: Bandwidth over time with RTT
    line1 = ax1.plot(
        df["Time (s)"],
        df["Bandwidth (Mbps)"],
        color=colors["bandwidth"],
        linewidth=2,
        label="Bandwidth",
    )
    ax1.set_xlabel("Time (seconds)")
    ax1.set_ylabel("Bandwidth (Mbps)", color=colors["bandwidth"])
    ax1.tick_params(axis="y", labelcolor=colors["bandwidth"])
    ax1.grid(True, alpha=0.3)

    # Add RTT on secondary y-axis
    ax1_twin = ax1.twinx()
    line2 = ax1_twin.plot(
        df["Time (s)"], df["RTT (ms)"], color=colors["rtt"], linewidth=2, label="RTT"
    )
    ax1_twin.set_ylabel("RTT (ms)", color=colors["rtt"])
    ax1_twin.tick_params(axis="y", labelcolor=colors["rtt"])

    # Combine legends
    lines = line1 + line2
    labels = [line.get_label() for line in lines]
    ax1.legend(lines, labels, loc="upper right")

    # Plot 2: TCP Window Size over time
    ax2.plot(
        df["Time (s)"], df["TCP Window Size (KB)"], color=colors["window"], linewidth=2
    )
    ax2.set_xlabel("Time (seconds)")
    ax2.set_ylabel("TCP Window Size (KB)")
    ax2.grid(True, alpha=0.3)

    # Format y-axis with K/M suffixes for better readability
    def human_format(x: float, pos: int) -> str:
        if x >= 1e6:
            return f"{x / 1e6:.1f}M"
        if x >= 1e3:
            return f"{x / 1e3:.1f}K"
        return f"{x:.1f}"

    ax2.yaxis.set_major_formatter(FuncFormatter(human_format))

    # Add summary statistics
    summary_stats = {
        "Avg Bandwidth": f"{df['Bandwidth (Mbps)'].mean():.1f} Mbps",
        "Max Bandwidth": f"{df['Bandwidth (Mbps)'].max():.1f} Mbps",
        "Avg RTT": f"{df['RTT (ms)'].mean():.1f} ms",
        "TCP Window": f"{df['TCP Window Size (KB)'].max():.1f} KB",
        "Total Data": f"{json_data['end']['sum_sent']['bytes'] / (1024 * 1024):.1f} MB",
        "CPU Usage": f"{json_data['end']['cpu_utilization_percent']['host_total']:.1f}%",
    }

    # Create summary text box
    summary_text = "\n".join(f"{k}: {v}" for k, v in summary_stats.items())
    props = {"boxstyle": "round", "facecolor": "white", "alpha": 0.8}
    plt.figtext(0.02, 0.02, summary_text, fontsize=10, bbox=props)

    if ax is None:
        plt.tight_layout()
        return [ax1, ax2]
    return None


def compare_vpn_reports(
    reports: dict[str, dict],
    output_dir: Path,
    title: str = "VPN Performance Comparison",
    prefix: str = "",
    formats: list[str] | None = None,
) -> None:
    """
    Compare multiple VPN performance reports and save the plots to specified directory.

    Args:
        reports: Dictionary mapping report names to their JSON data
        output_dir: Directory where to save the plots
        title: Main title for the comparison plot
        prefix: Optional prefix for the output files
        formats: List of formats to save (e.g., ["png", "pdf"])
    """
    # Convert output_dir to Path object if it's a string
    if formats is None:
        formats = ["png", "pdf"]

    # Create output directory if it doesn't exist
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create timestamp for unique filenames
    timestamp = datetime.now(tz=UTC).strftime("%Y%m%d_%H%M%S")

    # Create the plot
    fig, axes = plt.subplots(2, 1, figsize=(12, 10))
    fig.suptitle(title, fontsize=16, pad=20)

    # Add summary table to the plot
    summary_data = []
    for name, report in reports.items():
        # Extract key metrics
        end_stats = report["end"]["sum_sent"]
        avg_bandwidth = end_stats["bits_per_second"] / 1_000_000  # Convert to Mbps
        total_bytes = end_stats["bytes"] / (1024 * 1024)  # Convert to MB
        cpu_util = report["end"]["cpu_utilization_percent"]["host_total"]

        summary_data.append(
            {
                "Host": name,
                "Avg Bandwidth (Mbps)": f"{avg_bandwidth:.1f}",
                "Total Data (MB)": f"{total_bytes:.1f}",
                "CPU Usage (%)": f"{cpu_util:.1f}",
            }
        )

        # Plot on existing axes
        analyze_iperf_report(report, title=name, ax=axes)

    # Create summary table as text
    summary_text = "Summary:\n" + "\n".join(
        f"{data['Host']}:\n"
        f"  Bandwidth: {data['Avg Bandwidth (Mbps)']} Mbps\n"
        f"  Data: {data['Total Data (MB)']} MB\n"
        f"  CPU: {data['CPU Usage (%)']}%"
        for data in summary_data
    )

    # Add summary text to plot
    plt.figtext(
        0.02, 0.02, summary_text, fontsize=10, bbox={"facecolor": "white", "alpha": 0.8}
    )

    plt.tight_layout()

    # Save plots in all specified formats
    base_filename = (
        f"{prefix}_vpn_comparison_{timestamp}"
        if prefix
        else f"vpn_comparison_{timestamp}"
    )

    for fmt in formats:
        filename = output_dir / f"{base_filename}.{fmt}"
        plt.savefig(filename, bbox_inches="tight", dpi=300)
        log.info(f"Saved plot to: {filename}")

    # Save summary data as JSON
    summary_file = output_dir / f"{base_filename}_summary.json"
    with summary_file.open("w") as f:
        json.dump(summary_data, f, indent=2)
    log.info(f"Saved summary data to: {summary_file}")

    # Close the figure to free memory
    plt.close(fig)
